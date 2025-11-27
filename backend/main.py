from fastapi import FastAPI, HTTPException, Body, BackgroundTasks, Depends, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional, Literal
from datetime import datetime
from pathlib import Path
from jose import jwt, JWTError
import asyncio, sqlite3, json, os, re, hashlib, hmac

# === Базовая директория и .env ===
BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"

def load_env_file(path: Path) -> dict:
    data = {}
    if path.exists():
        # читаем руками, без библиотек
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            k, v = line.split("=", 1)
            data[k.strip()] = v.strip()
    return data

env_file = load_env_file(ENV_PATH)

def env_get(name: str, default: str | None = None):
    # сначала системные переменные (Render),
    # потом .env, потом дефолт
    return os.environ.get(name) or env_file.get(name) or default

# === Секреты и конфиг ===
BOT_TOKEN = env_get("BOT_TOKEN")
SECRET_KEY = env_get("SECRET_KEY")
JWT_SECRET = env_get("JWT_SECRET") or SECRET_KEY
ALGORITHM = "HS256"
FRONTEND_URL = env_get("FRONTEND_URL", "https://projectguard-frontend-prod-7-1.onrender.com")
DB_PATH = env_get("DB_PATH", str(BASE_DIR / "data.sqlite3"))

print("DEBUG .env path:", ENV_PATH)
print("DEBUG env_file keys:", list(env_file.keys()))
print("DEBUG BOT_TOKEN value exists:", bool(BOT_TOKEN))
print("DEBUG SECRET_KEY exists:", bool(SECRET_KEY))
print("DEBUG JWT_SECRET exists:", bool(JWT_SECRET))
if JWT_SECRET:
    print("DEBUG JWT_SECRET length:", len(JWT_SECRET), "start:", JWT_SECRET[:10] + "...")
if SECRET_KEY:
    print("DEBUG SECRET_KEY length:", len(SECRET_KEY), "start:", SECRET_KEY[:10] + "...")

if not BOT_TOKEN:
    raise RuntimeError("BOT_TOKEN is not set. Проверь backend/.env или переменные окружения.")

# === Локальные модули ===
from backend.db import (
    get_user_by_id,
    get_conn, init_db, now_iso, add_days, load_skus,
    get_user_by_email, create_user, update_user, get_all_users,
    get_user_by_tg_id, upsert_user, _adapt_query, USE_POSTGRES
)
from backend.users import router as users_router, init_users_table
from backend.auth import (
    require_admin, require_auth, get_current_user, get_current_active_user,
    get_admin_user, get_superadmin_user, create_access_token
)
from passlib.context import CryptContext

# === Password hashing ===
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Проверка пароля"""
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    """Хеширование пароля"""
    return pwd_context.hash(password)




# === Вспомогательные функции ===

def fmt_iso(dt: datetime) -> str:
    """Преобразует datetime в ISO строку (YYYY-MM-DDTHH:MM:SS)"""
    if not dt:
        return None
    return dt.strftime("%Y-%m-%dT%H:%M:%S")

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print("🚀 Приложение запускается, инициализация в фоне...")
    # Запускаем инициализацию в фоне, не ждем завершения
    asyncio.create_task(_init_background())
    yield
    # Shutdown (если нужно)
    pass

app = FastAPI(title="ProjectGuard Mini API", version="2.2", lifespan=lifespan)
SKUS = load_skus()
# === CORS настройки ===
from fastapi.middleware.cors import CORSMiddleware


# 👇 Список разрешённых фронтов
origins = [
    FRONTEND_URL,              # берём из .env
    "https://web.telegram.org",
    "https://web.telegram.org/a",
    "https://web.telegram.org/k",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # разрешаем всем
    allow_credentials=False,  # без cookies, нам они не нужны
    allow_methods=["*"],
    allow_headers=["*"],
)

SKUS = load_skus()




# ====== ADMIN: approve / reject pending protections ======

@app.post("/api/admin/pending/{pid}/approve")
def approve_pending(pid: int, user=Depends(get_admin_user)):
    conn = get_conn()
    cur = conn.cursor()
    row = cur.execute(
        "SELECT * FROM protections WHERE id=? AND status='pending'", (pid,)
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Защита не найдена или уже обработана")

    cur.execute(
        "UPDATE protections SET status='active', approved_by_admin=1, updated_at=? WHERE id=?",
        (now_iso(), pid),
    )
    add_history(cur, pid, "admin", "approve", {"approved": True})
    conn.commit()
    conn.close()
    return {"ok": True}


@app.post("/api/admin/pending/{pid}/reject")
def reject_pending(pid: int, payload: dict, user=Depends(get_admin_user)):
    reason = payload.get("reason", "").strip() or "Отклонено администратором"
    conn = get_conn()
    cur = conn.cursor()
    row = cur.execute(
        "SELECT * FROM protections WHERE id=? AND status='pending'", (pid,)
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Защита не найдена или уже обработана")

    cur.execute(
        "UPDATE protections SET status='deleted', admin_comment=?, updated_at=? WHERE id=?",
        (reason, now_iso(), pid),
    )
    add_history(cur, pid, "admin", "reject", {"reason": reason})
    conn.commit()
    conn.close()
    return {"ok": True, "reason": reason}





# ===== Models =====
class SkuItem(BaseModel):
    sku: str
    type: str
    area: Optional[float] = None

class ProtectionCreate(BaseModel):
    manager: str
    client: str = ""
    partner: str = ""
    partner_city: str = ""
    sku: str = ""
    sku_data: Optional[List[SkuItem]] = None
    area_m2: Optional[float] = None
    last4: str = ""
    object_city: str = ""
    address: str = ""
    comment: str = ""

class ProtectionOut(BaseModel):
    id: int
    manager: str
    client: str
    partner: str
    partner_city: str
    sku: str
    area_m2: Optional[float]
    last4: str
    object_city: str
    address: str
    comment: str
    status: str
    created_at: str
    expires_at: str
    closed_at: Optional[str]
    days_left: int
    warn2d: Optional[bool] = None
    warn_text: Optional[str] = None
    extend_count: Optional[int] = 0
    manager_id: Optional[int] = None  # ID пользователя, создавшего защиту
    close_reason: Optional[str] = None  # Причина закрытия из истории
    success_doc: Optional[str] = None  # Документ 1С из истории
    delete_reason: Optional[str] = None  # Причина удаления из истории

class ProtectionUpdate(BaseModel):
    sku: Optional[str] = ""
    sku_data: Optional[List[SkuItem]] = None
    area_m2: Optional[float] = None
    comment: Optional[str] = None
    manager: Optional[str] = None  # кто редактировал, можно не присылать


# Флаг для отслеживания инициализации
_initialized = False

async def _init_background():
    """Инициализация в фоне после запуска приложения"""
    global _initialized
    if _initialized:
        return
    _initialized = True
    
    # Выполняем синхронные операции в отдельном потоке
    def init_sync():
        try:
            # 1. База и миграции (синхронные операции)
            init_db()
            init_users_table()
            _safe_migrate()
            print("✅ База данных инициализирована")
        except Exception as e:
            print(f"⚠️ Ошибка инициализации БД: {e}")
    
    # Используем to_thread для выполнения синхронных операций
    try:
        await asyncio.to_thread(init_sync)
    except AttributeError:
        # Fallback для старых версий Python
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, init_sync)
    
    # Запускаем async задачи
    try:
        # 2. Telegram бот (запускаем только один раз)
        if not _bot_running:
            print("🔄 Запуск Telegram бота...")
            asyncio.create_task(start_tg_bot())
        else:
            print("⚠️ Telegram бот уже запущен, пропускаем")
    except Exception as e:
        print(f"⚠️ Ошибка запуска Telegram бота: {e}")
    
    try:
    # 3. Проверка истекающих защит
        asyncio.create_task(check_expiring_protections())
    except Exception as e:
        print(f"⚠️ Ошибка запуска проверки защит: {e}")

    try:
    # 4. Авто-закрытие защит за бездействие
        asyncio.create_task(auto_close_expired_protections())
    except Exception as e:
        print(f"⚠️ Ошибка запуска авто-закрытия: {e}")

    try:
    # 5. Keep-alive механизм для предотвращения засыпания Render
        asyncio.create_task(keep_alive_worker())
    except Exception as e:
        print(f"⚠️ Ошибка запуска keep-alive: {e}")

    print("🚀 Startup: база и бот запущены, проверка защит активна, авто-закрытие включено, keep-alive включен")


    


# ===== Utils / Migration =====
def _safe_migrate():
    print("⚙️ Проверка структуры базы данных...")

    def exec_safe(sql):
        """Выполняет SQL и игнорирует 'duplicate column'"""
        conn2 = get_conn()
        cur2 = conn2.cursor()
        try:
            cur2.execute(sql)
            conn2.commit()
        except sqlite3.OperationalError as e:
            # SQLite ошибка
            if "duplicate column" not in str(e).lower():
                print("⚠️", e)
        except Exception as e:
            # PostgreSQL и другие ошибки
            error_str = str(e).lower()
            if "duplicate column" in error_str or "already exists" in error_str:
                # Колонка уже существует - это нормально, игнорируем
                pass
            else:
                print("⚠️", e)
        finally:
            conn2.close()

    # === Protections ===
    exec_safe("ALTER TABLE protections ADD COLUMN extend_count INTEGER DEFAULT 0")
    exec_safe("ALTER TABLE protections ADD COLUMN auto_closed INTEGER DEFAULT 0")
    exec_safe("ALTER TABLE protections ADD COLUMN updated_at TEXT")
    exec_safe("ALTER TABLE protections ADD COLUMN reminder_2days_sent INTEGER DEFAULT 0")
    exec_safe("ALTER TABLE protections ADD COLUMN close_reason TEXT")

    # === Users ===
    exec_safe("ALTER TABLE users ADD COLUMN group_tag TEXT")
    exec_safe("ALTER TABLE users ADD COLUMN region TEXT")

        # === Managers ===
    exec_safe("ALTER TABLE managers ADD COLUMN telegrams TEXT DEFAULT '[]'")

    

    print("✅ Авто-миграция базы завершена (extend_count, auto_closed, updated_at, users.extra)")



def row_to_out(row, history_data: dict = None) -> ProtectionOut:
    expires = datetime.fromisoformat(row["expires_at"].replace("Z", ""))
    days_left = (expires - datetime.utcnow()).days
    warn2d = row["status"] == "active" and days_left <= 2
    warn_text = "⏰ Через 2 дня истекает — напомни менеджеру." if warn2d else None
    # Проверяем наличие manager_id в строке (для совместимости с SQLite и PostgreSQL)
    manager_id = row["manager_id"] if "manager_id" in row.keys() else None
    history_data = history_data or {}
    return ProtectionOut(
        id=row["id"],
        manager=row["manager"],
        client=row["client"] or "",
        partner=row["partner"] or "",
        partner_city=row["partner_city"] or "",
        sku=row["sku"] or "",
        area_m2=row["area_m2"],
        last4=row["last4"] or "",
        object_city=row["object_city"] or "",
        address=row["address"] or "",
        comment=row["comment"] or "",
        status=row["status"],
        created_at=row["created_at"],
        expires_at=row["expires_at"],
        closed_at=row["closed_at"],
        days_left=days_left,
        warn2d=warn2d,
        warn_text=warn_text,
        extend_count=row["extend_count"] if "extend_count" in row.keys() else 0,
        manager_id=manager_id,  # ID пользователя, создавшего защиту
        close_reason=history_data.get("close_reason"),
        success_doc=history_data.get("success_doc"),
        delete_reason=history_data.get("delete_reason"),
    )

def normalize_sku(raw: str) -> str:
    return re.sub(r"[\(\)а-яА-Я\s]+", "", raw or "").strip()

def add_history(cur, protection_id: int, actor: str, action: str, payload: dict):
    query = _adapt_query("INSERT INTO history(protection_id, at, actor, action, payload) VALUES (?,?,?,?,?)")
    cur.execute(
        query,
        (protection_id, now_iso(), actor, action, json.dumps(payload, ensure_ascii=False)),
    )

# ===== Basic =====
@app.get("/api/skus")
def get_skus():
    return SKUS

@app.get("/api/ping")
def ping():
    """Keep-alive endpoint для предотвращения засыпания Render"""
    return {"ok": True, "timestamp": now_iso(), "status": "alive"}

@app.get("/")
def root():
    """Корневой endpoint для keep-alive"""
    return {"ok": True, "service": "ProjectGuard API", "timestamp": now_iso()}

# Keep-alive worker для внутреннего пинга
async def keep_alive_worker():
    """Внутренний механизм keep-alive: пингует сам себя каждые 5 минут"""
    import aiohttp
    
    # Ждем 30 секунд после старта, чтобы сервер полностью запустился
    await asyncio.sleep(30)
    
    # Получаем URL сервиса из переменных окружения или используем дефолтный
    service_url = os.environ.get("RENDER_SERVICE_URL") or "https://projectguard-prod-7-1.onrender.com"
    
    while True:
        try:
            # Пингуем корневой endpoint
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{service_url}/api/ping", timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status == 200:
                        print(f"✅ Keep-alive ping успешен: {now_iso()}")
                    else:
                        print(f"⚠️ Keep-alive ping вернул статус {resp.status}")
        except Exception as e:
            print(f"⚠️ Keep-alive ping ошибка: {e}")
        
        # Ждем 5 минут (300 секунд) перед следующим пингом
        await asyncio.sleep(300)


# --- Проверка Telegram-данных ---
def verify_telegram_auth(data: dict) -> bool:
    check_hash = data.pop("hash", None)
    data_check = "\n".join([f"{k}={v}" for k, v in sorted(data.items())])
    secret_key = hashlib.sha256(BOT_TOKEN.encode()).digest()
    h = hmac.new(secret_key, data_check.encode(), hashlib.sha256).hexdigest()
    return h == check_hash

# --- JWT токен ---
def create_token(user_id: int, role: str):
    """Старая функция для обратной совместимости. Использует create_access_token из auth.py"""
    user = {"id": user_id, "role": role}
    return create_access_token(user)


# === Pydantic модели для регистрации и логина ===
class UserRegister(BaseModel):
    email: str
    password: str
    full_name: str = ""
    phone: str = ""
    company: str = ""
    city: str = ""


class RegisterOrLogin(BaseModel):
    """Модель для единого эндпоинта регистрации/входа"""
    tg_id: str  # Обязательное, из Telegram WebApp или dev-режима
    full_name: str
    phone: str
    position: Optional[str] = None  # Должность


class UserLogin(BaseModel):
    # Поддержка разных форматов входа
    email: Optional[str] = None
    password: Optional[str] = None
    # Telegram данные
    telegram_id: Optional[int] = None
    username: Optional[str] = None
    first_name: Optional[str] = None
    # Простой вход по телефону/имени
    full_name: Optional[str] = None
    phone: Optional[str] = None
    company: Optional[str] = None


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    position: Optional[str] = None
    company: Optional[str] = None
    city: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[int] = None
    manager_id: Optional[int] = None
    receive_extend_notifications: Optional[int] = None
    manager_ids: Optional[str] = None  # JSON массив ID менеджеров


@app.get("/api/auth/verify")
async def verify_token(user=Depends(require_auth)):
    """Проверка валидности токена"""
    return {"ok": True, "user_id": user["id"], "role": user["role"]}


@app.get("/api/auth/me")
async def get_me(user=Depends(get_current_active_user)):
    """Получить информацию о текущем пользователе"""
    return {
        "ok": True,
        "user": {
            "id": user["id"],
            "email": user.get("email"),
            "full_name": user.get("full_name", ""),
            "role": user["role"],
            "phone": user.get("phone", ""),
            "company": user.get("company", ""),
            "city": user.get("city", ""),
        }
    }


@app.post("/api/auth/register_or_login")
async def register_or_login(data: RegisterOrLogin):
    """
    Единый эндпоинт для регистрации/входа по Telegram данным.
    Использует UPSERT логику: если пользователь с таким tg_id есть - обновляет, иначе создает.
    """
    if not data.tg_id:
        raise HTTPException(status_code=400, detail="tg_id is required")
    
    # Валидация обязательных полей
    if not data.full_name or not data.phone:
        raise HTTPException(status_code=400, detail="full_name and phone are required")
    
    # Определяем роль: суперадмин по номеру телефона, иначе user
    import re
    phone_clean = re.sub(r'\D', '', str(data.phone))
    superadmin_phone = "79207455960"  # Номер телефона суперадмина
    role = "superadmin" if phone_clean == superadmin_phone else "user"
    
    try:
        # Нормализуем tg_id - убираем префиксы "dev-", "tg-"
        from backend.db import normalize_tg_id
        normalized_tg_id = normalize_tg_id(data.tg_id)
        if not normalized_tg_id:
            raise HTTPException(status_code=400, detail="Invalid tg_id format")
        
        # Используем upsert_user для создания или обновления
        # Роль будет определена внутри upsert_user по телефону
        user = upsert_user({
            "tg_id": normalized_tg_id,
            "full_name": data.full_name,
            "phone": data.phone,
            "position": data.position,
            "role": role,  # Определяем роль по телефону (для новых пользователей)
            "is_active": 1,
        })
        
        # После upsert проверяем, что роль правильная (на случай обновления существующего пользователя)
        import re
        phone_clean_check = re.sub(r'\D', '', str(data.phone))
        if phone_clean_check == "79207455960" and user.get("role") != "superadmin":
            # Если роль не обновилась, обновляем вручную
            from backend.db import update_user
            user = update_user(user["id"], {"role": "superadmin"})
        
        # Создание токена
        token = create_access_token(user)
        
        return {
            "ok": True,
            "token": token,
            "user": {
                "id": user["id"],
                "tg_id": user.get("tg_id"),
                "full_name": user.get("full_name", ""),
                "phone": user.get("phone", ""),
                "position": user.get("position", ""),
                "role": user["role"],
            }
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"❌ Error in register_or_login: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/auth/register")
async def register(data: UserRegister):
    """Регистрация нового пользователя"""
    # Валидация email
    import re
    email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    if not re.match(email_pattern, data.email):
        raise HTTPException(status_code=400, detail="Invalid email format")
    
    # Валидация пароля
    if len(data.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    
    # Проверка существования email
    existing = get_user_by_email(data.email)
    if existing:
        raise HTTPException(status_code=400, detail="User with this email already exists")
    
    # Создание пользователя
    try:
        user = create_user({
            "email": data.email,
            "password_hash": get_password_hash(data.password),
            "full_name": data.full_name,
            "phone": data.phone,
            "company": data.company,
            "city": data.city,
            "role": "manager",
            "is_active": 1,
            "created_at": now_iso()
        })
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    # Создание токена
    token = create_access_token(user)
    
    return {
        "ok": True,
        "token": token,
        "user": {
            "id": user["id"],
            "email": user["email"],
            "full_name": user.get("full_name", ""),
            "role": user["role"],
        }
    }


@app.post("/api/auth/login")
async def login(data: UserLogin):
    """
    Универсальный вход:
        - По email/password
    - По Telegram данным (telegram_id, username, first_name)
    - По телефону/имени (phone, full_name) - создает пользователя, если его нет
    """
    user = None
    
    # 1. Вход по email/password
    if data.email and data.password:
        user = get_user_by_email(data.email)
        if not user:
            raise HTTPException(status_code=401, detail="Invalid email or password")
        
        password_hash = user.get("password_hash")
        if not password_hash or not verify_password(data.password, password_hash):
            raise HTTPException(status_code=401, detail="Invalid email or password")
    
    # 2. Вход по Telegram данным
    elif data.telegram_id:
        from backend.db import get_user_by_tg_id
        user = get_user_by_tg_id(data.telegram_id)
        
        if not user:
            # Создаем пользователя, если его нет
            role = "superadmin" if data.telegram_id == 426188469 else "manager"
            try:
                user = create_user({
                    "tg_id": data.telegram_id,
                    "tg_username": data.username or "",
                    "first_name": data.first_name or "",
                    "full_name": data.first_name or "",
                    "role": role,
                    "is_active": 1,
                    "created_at": now_iso()
                })
            except ValueError:
                # Пользователь уже существует, получаем его
                user = get_user_by_tg_id(data.telegram_id)
        else:
            # Обновляем данные Telegram, если изменились
            if data.username or data.first_name:
                update_data = {}
                if data.username:
                    update_data["tg_username"] = data.username
                if data.first_name:
                    update_data["first_name"] = data.first_name
                    if not user.get("full_name"):
                        update_data["full_name"] = data.first_name
                if update_data:
                    update_user(user["id"], update_data)
                    user = get_user_by_id(user["id"])
    
    # 3. Вход по телефону/имени (простая регистрация/логин)
    elif data.phone and data.full_name:
        # Ищем по телефону
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("SELECT * FROM users WHERE phone = ?", (data.phone,))
        row = cur.fetchone()
        conn.close()
        
        if row:
            user = dict(row)
        else:
            # Создаем нового пользователя
            try:
                user = create_user({
                    "full_name": data.full_name,
                    "phone": data.phone,
                    "company": data.company or "",
                    "role": "manager",
                    "is_active": 1,
                    "created_at": now_iso()
                })
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))
    else:
        raise HTTPException(status_code=400, detail="Provide email/password, telegram_id, or phone/full_name")
    
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    
    # Проверка is_active
    if user.get("is_active", 1) == 0:
        raise HTTPException(status_code=401, detail="User is inactive")
    
    # Обновление last_login
    update_user(user["id"], {"last_login": now_iso()})
    user = get_user_by_id(user["id"])  # Обновляем данные
    
    # Создание токена
    token = create_access_token(user)
    
    return {
        "ok": True,
        "token": token,
        "user": {
            "id": user["id"],
            "email": user.get("email"),
            "full_name": user.get("full_name", user.get("first_name", "")),
            "role": user["role"],
        }
    }


@app.post("/api/auth/telegram")
async def telegram_auth(request: Request):
    data = await request.json()

    # ===== DEV AUTH (кнопка на фронте) =====
    # Если hash == "dev-mode", пропускаем проверку Telegram,
    # но всё равно работаем через таблицу users.
    if data.get("hash") == "dev-mode":
        from backend.db import normalize_tg_id
        tg_id_raw = data["id"]
        tg_id_normalized = normalize_tg_id(tg_id_raw)
        if not tg_id_normalized:
            raise HTTPException(status_code=400, detail="Invalid tg_id format")
        tg_id = int(tg_id_normalized)
        username = data.get("username") or ""
        first_name = data.get("first_name") or "DevUser"
        role = "superadmin" if tg_id == 426188469 else "manager"

        conn = get_conn()
        cur = conn.cursor()
        # Используем нормализованный tg_id как строку для совместимости
        cur.execute(
            _adapt_query("""
                INSERT INTO users (tg_id, tg_username, first_name, role, created_at)
            VALUES (?,?,?,?,?)
                ON CONFLICT(tg_id) DO UPDATE SET
                    tg_username=excluded.tg_username,
                    first_name=excluded.first_name,
                    role=excluded.role
            """),
            (str(tg_id), username, first_name, role, now_iso()),
        )
        conn.commit()
        user = cur.execute(_adapt_query("SELECT * FROM users WHERE tg_id=?"), (str(tg_id),)).fetchone()
        conn.close()

        token = create_access_token(dict(user))
        return {
            "ok": True,
            "token": token,
            "user": {
                "id": user["id"],
                "email": user.get("email"),
                "full_name": user.get("full_name", user.get("first_name", "")),
                "role": role,
            }
        }

    # ===== Real Telegram Auth =====
    if not verify_telegram_auth(data):
        raise HTTPException(status_code=400, detail="Invalid Telegram auth data")

    from backend.db import normalize_tg_id
    tg_id_raw = data["id"]
    tg_id_normalized = normalize_tg_id(tg_id_raw)
    if not tg_id_normalized:
        raise HTTPException(status_code=400, detail="Invalid tg_id format")
    tg_id = int(tg_id_normalized)
    username = data.get("username")
    first_name = data.get("first_name")

    conn = get_conn()
    cur = conn.cursor()

    # === Главный админ ===
    if tg_id == 426188469:
        # Проверяем, есть ли пользователь с правильным tg_id
        user = cur.execute(_adapt_query("SELECT * FROM users WHERE tg_id=?"), (str(tg_id),)).fetchone()
        
        # Если пользователя с правильным tg_id нет, ищем пользователя с неправильным tg_id
        # (например, dev-79207455960) и обновляем его tg_id
        if not user:
            # Ищем пользователя с неправильными форматами tg_id для главного админа
            wrong_tg_ids = ["dev-79207455960", "79207455960", "tg-79207455960", "dev-426188469", "tg-426188469"]
            for wrong_id in wrong_tg_ids:
                existing_user = cur.execute(_adapt_query("SELECT * FROM users WHERE tg_id=?"), (wrong_id,)).fetchone()
                if existing_user:
                    # Обновляем tg_id на правильный
                    cur.execute(
                        _adapt_query("UPDATE users SET tg_id=?, tg_username=?, first_name=?, role=? WHERE id=?"),
                        (str(tg_id), username, first_name, "superadmin", existing_user["id"])
                    )
                    conn.commit()
                    user = cur.execute(_adapt_query("SELECT * FROM users WHERE tg_id=?"), (str(tg_id),)).fetchone()
                    print(f"✅ Обновлен tg_id пользователя с {wrong_id} на {tg_id}")
                    break
            
            # Если не нашли по tg_id, ищем по email или phone (если есть)
            if not user:
                # Ищем пользователя с ролью superadmin или admin, у которого неправильный tg_id
                superadmin_users = cur.execute(_adapt_query("SELECT * FROM users WHERE role IN ('superadmin', 'admin')")).fetchall()
                for existing_user in superadmin_users:
                    existing_tg_id = existing_user.get("tg_id", "")
                    # Если tg_id содержит неправильный формат (dev- или tg- префикс с неправильным числом)
                    if existing_tg_id and ("dev-" in existing_tg_id or "tg-" in existing_tg_id or existing_tg_id == "79207455960"):
                        # Обновляем tg_id на правильный
                        cur.execute(
                            _adapt_query("UPDATE users SET tg_id=?, tg_username=?, first_name=?, role=? WHERE id=?"),
                            (str(tg_id), username, first_name, "superadmin", existing_user["id"])
                        )
                        conn.commit()
                        user = cur.execute(_adapt_query("SELECT * FROM users WHERE tg_id=?"), (str(tg_id),)).fetchone()
                        print(f"✅ Обновлен tg_id пользователя {existing_user['id']} с {existing_tg_id} на {tg_id}")
                        break
        
        # Если пользователь все еще не найден, создаем нового
        if not user:
            cur.execute(
                _adapt_query("""
                    INSERT INTO users (tg_id, tg_username, first_name, role, created_at)
                    VALUES (?,?,?,?,?)
                    ON CONFLICT(tg_id) DO UPDATE SET
                        tg_username=excluded.tg_username,
                        first_name=excluded.first_name,
                        role=excluded.role
                """),
                (str(tg_id), username, first_name, "superadmin", now_iso())
            )
            conn.commit()
            user = cur.execute(_adapt_query("SELECT * FROM users WHERE tg_id=?"), (str(tg_id),)).fetchone()
        
        conn.close()
        token = create_access_token(dict(user))
        return {
            "ok": True,
            "token": token,
            "user": {
                "id": user["id"],
                "email": user.get("email"),
                "full_name": user.get("full_name", user.get("first_name", "")),
                "role": "superadmin",
            }
        }

    # --- Остальные пользователи ---
    row = cur.execute(_adapt_query("SELECT * FROM users WHERE tg_id=?"), (str(tg_id),)).fetchone()
    if not row:
        # Если пользователя с правильным tg_id нет, ищем пользователя с неправильным tg_id
        # (например, dev-79207455960 для главного админа) и обновляем его tg_id
        wrong_tg_ids = [f"dev-{tg_id}", f"tg-{tg_id}", str(tg_id)]
        for wrong_id in wrong_tg_ids:
            existing_user = cur.execute(_adapt_query("SELECT * FROM users WHERE tg_id=?"), (wrong_id,)).fetchone()
            if existing_user:
                # Обновляем tg_id на правильный
                cur.execute(
                    _adapt_query("UPDATE users SET tg_id=?, tg_username=?, first_name=? WHERE id=?"),
                    (str(tg_id), username, first_name, existing_user["id"])
                )
                conn.commit()
                row = cur.execute(_adapt_query("SELECT * FROM users WHERE tg_id=?"), (str(tg_id),)).fetchone()
                print(f"✅ Обновлен tg_id пользователя с {wrong_id} на {tg_id}")
                break
        
        # Если пользователь все еще не найден, создаем нового
        if not row:
            cur.execute(
                _adapt_query("INSERT INTO users (tg_id, tg_username, first_name, role, created_at) VALUES (?,?,?,?,?)"),
                (str(tg_id), username, first_name, "manager", now_iso())
            )
            conn.commit()
            row = cur.execute(_adapt_query("SELECT * FROM users WHERE tg_id=?"), (str(tg_id),)).fetchone()

        role = row["role"]
    token = create_access_token(dict(row))
    conn.close()

    return {
        "ok": True,
        "token": token,
        "user": {
            "id": row["id"],
            "email": row["email"] if "email" in row.keys() else None,
            "full_name": row["full_name"] if "full_name" in row.keys() else (row["first_name"] if "first_name" in row.keys() else ""),
            "role": role,
        }
    }


# ===== Обновление tg_id текущего пользователя =====
@app.post("/api/auth/update-tg-id")
def update_my_tg_id(data: dict = Body(...), user=Depends(get_current_user)):
    """Обновляет tg_id текущего пользователя"""
    new_tg_id = data.get("tg_id") or data.get("id")
    if not new_tg_id:
        raise HTTPException(status_code=400, detail="tg_id is required")
    
    from backend.db import normalize_tg_id
    tg_id_normalized = normalize_tg_id(new_tg_id)
    if not tg_id_normalized:
        raise HTTPException(status_code=400, detail="Invalid tg_id format")
    
    tg_id_str = str(int(tg_id_normalized))
    
    conn = get_conn()
    cur = conn.cursor()
    
    # Проверяем, не занят ли этот tg_id другим пользователем
    existing = cur.execute(_adapt_query("SELECT id FROM users WHERE tg_id=? AND id!=?"), (tg_id_str, user["id"])).fetchone()
    if existing:
        conn.close()
        raise HTTPException(status_code=409, detail="This tg_id is already used by another user")
    
    # Обновляем tg_id
    cur.execute(
        _adapt_query("UPDATE users SET tg_id=? WHERE id=?"),
        (tg_id_str, user["id"])
    )
    conn.commit()
    conn.close()
    
    print(f"✅ Пользователь {user['id']} обновил свой tg_id на {tg_id_str}")
    
    return {"ok": True, "message": f"tg_id обновлен на {tg_id_str}"}


# ===== DEV-авторизация без проверки Telegram =====
@app.post("/api/auth/dev-login")
def dev_login(payload: dict):
    from backend.db import normalize_tg_id
    tg_id_raw = payload.get("tg_id") or payload.get("id") or "0"
    tg_id_normalized = normalize_tg_id(tg_id_raw)
    if not tg_id_normalized:
        raise HTTPException(status_code=400, detail="tg_id is required")
    tg_id = int(tg_id_normalized)

    username = payload.get("username") or ""
    first_name = payload.get("first_name") or "DevUser"
    
    # Определяем роль: superadmin для главного админа, иначе из payload или manager
    if tg_id == 426188469:
        role = "superadmin"
    else:
        role = payload.get("role") or "manager"

    conn = get_conn()
    cur = conn.cursor()

    cur.execute(
        _adapt_query("""
        INSERT INTO users (tg_id, tg_username, first_name, role, created_at)
        VALUES (?,?,?,?,?)
        ON CONFLICT(tg_id) DO UPDATE SET
            tg_username=excluded.tg_username,
            first_name=excluded.first_name,
            role=excluded.role
        """),
        (str(tg_id), username, first_name, role, now_iso()),
    )
    conn.commit()

    user = cur.execute(_adapt_query("SELECT * FROM users WHERE tg_id=?"), (str(tg_id),)).fetchone()
    conn.close()

    if not user:
        raise HTTPException(status_code=500, detail="Failed to create user")

    token = create_access_token(dict(user))
    return {
        "ok": True,
        "token": token,
        "user": {
            "id": user["id"],
            "email": user.get("email"),
            "full_name": user.get("full_name", user.get("first_name", "")),
            "role": user["role"],
        }
    }



# ===== Admin: Управление пользователями =====
@app.get("/api/admin/users")
def admin_list_users(admin_user=Depends(require_admin)):
    """Список всех пользователей (для admin и superadmin)"""
    users = get_all_users()
    return {
        "ok": True,
        "users": [
            {
                "id": u["id"],
                "email": u.get("email"),
                "tg_id": u.get("tg_id"),
                "full_name": u.get("full_name", u.get("first_name", "")),
                "phone": u.get("phone", ""),
                "position": u.get("position", ""),
                "company": u.get("company", ""),
                "city": u.get("city", ""),
                "role": u["role"],
                "is_active": u.get("is_active", 1),
                "created_at": u.get("created_at", ""),
                "last_login": u.get("last_login"),
                "manager_id": u.get("manager_id"),
                "receive_extend_notifications": u.get("receive_extend_notifications", 0),
                "manager_ids": u.get("manager_ids", "[]"),
            }
            for u in users
        ]
    }


@app.patch("/api/admin/users/{user_id}")
def admin_update_user(user_id: int, data: UserUpdate, admin_user=Depends(get_admin_user)):
    """Обновить пользователя (для admin и superadmin)"""
    # Нельзя изменять самого себя (защита от случайного понижения)
    if user_id == admin_user["id"]:
        # Разрешаем изменение только не-ролевых полей
        if data.role is not None or data.is_active is not None:
            raise HTTPException(status_code=400, detail="Cannot change your own role or status")
    
    # Только superadmin может создавать/назначать superadmin
    if data.role == "superadmin" and admin_user["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="Only superadmin can assign superadmin role")
    
    # Проверка: только superadmin может назначать superadmin
    if data.role == "superadmin" and admin_user["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="Only superadmin can assign superadmin role")
    
    # Проверка: нельзя понизить последнего superadmin
    if data.role and data.role != "superadmin":
        conn = get_conn()
        cur = conn.cursor()
        superadmin_count = cur.execute(
            "SELECT COUNT(*) FROM users WHERE role = 'superadmin' AND is_active = 1"
        ).fetchone()[0]
        target_user = get_user_by_id(user_id)
        if target_user and target_user["role"] == "superadmin" and superadmin_count <= 1:
            conn.close()
            raise HTTPException(status_code=400, detail="Cannot demote the last superadmin")
        conn.close()
    
    # Обновление
    update_data = {}
    if data.full_name is not None:
        update_data["full_name"] = data.full_name
    if data.phone is not None:
        update_data["phone"] = data.phone
    if data.position is not None:
        update_data["position"] = data.position
    if data.company is not None:
        update_data["company"] = data.company
    if data.city is not None:
        update_data["city"] = data.city
    if data.role is not None:
        update_data["role"] = data.role
    if data.is_active is not None:
        update_data["is_active"] = data.is_active
    if data.manager_id is not None:
        update_data["manager_id"] = data.manager_id
    if data.receive_extend_notifications is not None:
        update_data["receive_extend_notifications"] = data.receive_extend_notifications
    if data.manager_ids is not None:
        # Валидируем, что это валидный JSON массив
        import json
        try:
            parsed = json.loads(data.manager_ids) if isinstance(data.manager_ids, str) else data.manager_ids
            if isinstance(parsed, list):
                # Фильтруем null значения и дубликаты для проверки уникальности
                non_null = [id for id in parsed if id is not None and id != ""]
                # Проверяем на дубликаты
                if len(non_null) != len(set(non_null)):
                    raise HTTPException(status_code=400, detail="Нельзя выбрать одного менеджера дважды")
                
                # Ограничиваем до 3 элементов, заполняем null до 3
                result = list(parsed[:3])
                while len(result) < 3:
                    result.append(None)
                update_data["manager_ids"] = json.dumps(result[:3], ensure_ascii=False)
            else:
                raise HTTPException(status_code=400, detail="manager_ids должен быть массивом")
        except (json.JSONDecodeError, TypeError):
            raise HTTPException(status_code=400, detail="manager_ids должен быть валидным JSON массивом")
    
    updated = update_user(user_id, update_data)
    
    return {
        "ok": True,
        "user": {
            "id": updated["id"],
            "email": updated.get("email"),
            "tg_id": updated.get("tg_id"),
            "full_name": updated.get("full_name", ""),
            "phone": updated.get("phone", ""),
            "position": updated.get("position", ""),
            "company": updated.get("company", ""),
            "city": updated.get("city", ""),
            "role": updated["role"],
            "is_active": updated.get("is_active", 1),
        }
    }


@app.delete("/api/admin/users/{user_id}")
def admin_delete_user(user_id: int, admin_user=Depends(get_admin_user)):
    """Удалить пользователя (soft-delete: is_active=0)"""
    # Нельзя удалить самого себя
    if user_id == admin_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    
    # Проверка: нельзя удалить последнего superadmin
    target_user = get_user_by_id(user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if target_user["role"] == "superadmin":
        conn = get_conn()
        cur = conn.cursor()
        superadmin_count = cur.execute(
            "SELECT COUNT(*) FROM users WHERE role = 'superadmin' AND is_active = 1"
        ).fetchone()[0]
        conn.close()
        if superadmin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last superadmin")
    
    # Soft delete: is_active = 0
    update_user(user_id, {"is_active": 0})
    
    return {"ok": True, "message": "User deleted"}


# ===== Managers CRUD =====
class ManagerCreate(BaseModel):
    name: str

class ManagerUpdate(BaseModel):
    name: str

@app.get("/api/admin/managers")
def admin_list_managers(user=Depends(get_admin_user)):
    conn = get_conn()
    if not USE_POSTGRES:
        conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    
    if USE_POSTGRES:
        query = """
            SELECT
                m.id, m.name, m.telegrams,
                COALESCE(t.total,0) AS total,
                COALESCE(t.active,0) AS active,
                COALESCE(t.success,0) AS success,
                COALESCE(t.closed,0) AS closed
            FROM managers m
            LEFT JOIN (
                SELECT manager,
                       COUNT(*) AS total,
                       SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active,
                       SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success,
                       SUM(CASE WHEN status='closed' THEN 1 ELSE 0 END) AS closed
                FROM protections
                GROUP BY manager
            ) t ON t.manager = m.name
            ORDER BY LOWER(m.name)
        """
    else:
        query = """
        SELECT
            m.id, m.name, m.telegrams,
            IFNULL(t.total,0) AS total,
            IFNULL(t.active,0) AS active,
            IFNULL(t.success,0) AS success,
            IFNULL(t.closed,0) AS closed
        FROM managers m
        LEFT JOIN (
            SELECT manager,
                   COUNT(*) AS total,
                   SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active,
                   SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success,
                   SUM(CASE WHEN status='closed' THEN 1 ELSE 0 END) AS closed
            FROM protections
            GROUP BY manager
        ) t ON t.manager = m.name
        ORDER BY m.name COLLATE NOCASE
        """
    cur.execute(query)
    rows = cur.fetchall()

    managers = []
    import json
    for r in rows:
        telegrams = []
        try:
            telegrams = json.loads(r["telegrams"]) if r["telegrams"] else []
        except Exception:
            telegrams = []
        managers.append({
            "id": r["id"],
            "name": r["name"],
            "total": r["total"],
            "active": r["active"],
            "success": r["success"],
            "closed": r["closed"],
            "telegrams": telegrams,
        })
    conn.close()
    return managers
# ================================================
# 🔐 Telegram WebApp Auto Login
# ================================================
# ================================================
# 🔐 Telegram WebApp AUTO LOGIN (POST)
# ================================================
@app.post("/api/auth/telegram-login")
async def telegram_login(request: Request):
    data = await request.json()

    tg_id = int(data.get("tg_id") or 0)
    if not tg_id:
        raise HTTPException(status_code=400, detail="tg_id is required")

    username = data.get("username") or ""
    first_name = data.get("first_name") or "User"

    # роль
    role = "superadmin" if tg_id == 426188469 else "manager"

    conn = get_conn()
    cur = conn.cursor()

    cur.execute("""
        INSERT INTO users (tg_id, tg_username, first_name, role, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(tg_id) DO UPDATE SET
            tg_username=excluded.tg_username,
            first_name=excluded.first_name,
            role=excluded.role
    """, (tg_id, username, first_name, role, now_iso()))

    conn.commit()
    user = cur.execute("SELECT * FROM users WHERE tg_id=?", (tg_id,)).fetchone()
    conn.close()

    # выдаём токен
    token = create_access_token(dict(user))

    return {
        "ok": True,
        "token": token,
        "user": {
            "id": user["id"],
            "email": user.get("email"),
            "full_name": user.get("full_name", user.get("first_name", "")),
            "role": role,
        }
    }


@app.post("/api/admin/managers")
def admin_add_manager(data: ManagerCreate, user=Depends(get_admin_user)):
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Имя не может быть пустым")
    conn = get_conn()
    cur = conn.cursor()
    try:
        query = _adapt_query("INSERT INTO managers(name, created_at) VALUES (?,?)")
        cur.execute(query, (name, now_iso()))
        conn.commit()
    except (sqlite3.IntegrityError, Exception) as e:
        # Обрабатываем ошибки для обеих БД
        error_str = str(e).lower()
        if "unique" in error_str or "duplicate" in error_str or "already exists" in error_str:
            conn.close()
        raise HTTPException(status_code=409, detail="Менеджер с таким именем уже существует")
        conn.close()
        raise
    conn.close()
    return {"ok": True}

@app.patch("/api/admin/managers/{mid}")
def admin_rename_manager(mid: int, data: ManagerUpdate, user=Depends(get_admin_user)):
    new_name = (data.name or "").strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="Имя не может быть пустым")
    conn = get_conn()
    cur = conn.cursor()
    row = cur.execute("SELECT * FROM managers WHERE id=?", (mid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Manager not found")
    old_name = row["name"]
    exists = cur.execute("SELECT 1 FROM managers WHERE name=? AND id<>?", (new_name, mid)).fetchone()
    if exists:
        conn.close()
        raise HTTPException(status_code=409, detail="Менеджер с таким именем уже существует")
    cur.execute("UPDATE managers SET name=? WHERE id=?", (new_name, mid))
    cur.execute("UPDATE protections SET manager=? WHERE manager=?", (new_name, old_name))
    conn.commit()
    conn.close()
    return {"ok": True}

@app.delete("/api/admin/managers/{mid}")
def admin_delete_manager(mid: int, transfer_to: Optional[int] = None, user=Depends(get_admin_user)):
    conn = get_conn()
    cur = conn.cursor()
    row = cur.execute("SELECT * FROM managers WHERE id=?", (mid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Manager not found")
    name = row["name"]
    cnt = cur.execute("SELECT COUNT(*) AS c FROM protections WHERE manager=?", (name,)).fetchone()["c"] or 0
    if cnt > 0:
        if not transfer_to:
            conn.close()
            raise HTTPException(status_code=400, detail="Нужно выбрать менеджера для перевода всех защит")
        row_to = cur.execute("SELECT * FROM managers WHERE id=?", (transfer_to,)).fetchone()
        if not row_to:
            conn.close()
            raise HTTPException(status_code=404, detail="transfer_to manager not found")
        new_name = row_to["name"]
        cur.execute("UPDATE protections SET manager=? WHERE manager=?", (new_name, name))
    cur.execute("DELETE FROM managers WHERE id=?", (mid,))
    conn.commit()
    conn.close()
    return {"ok": True}


# === PATCH: обновление имени и Telegram-списка ===


# === Добавление пользователя (админка) ===
@app.post("/api/users/")
def create_user(user: dict):
    try:
        print("📩 Новый пользователь:", user)
        conn = get_conn()
        cur = conn.cursor()

        # tg_id обязателен, но мы можем подставить временный ноль
        tg_id = user.get("tg_id") or 0

        cur.execute("""
            INSERT INTO users (tg_id, first_name, tg_username, group_tag, manager_id, region, created_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
        """, (
            tg_id,
            user.get("first_name"),
            user.get("tg_username"),
            user.get("group_tag"),
            user.get("manager_id"),
            user.get("region") or "Москва"
        ))

        conn.commit()
        cur.close()
        conn.close()
        print("✅ Пользователь добавлен успешно")
        return {"detail": "Пользователь добавлен"}

    except Exception as e:
        import traceback
        print("❌ Ошибка при добавлении пользователя:")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Ошибка при добавлении: {e}")


@app.get("/api/managers")
def public_managers():
    conn = get_conn()
    cur = conn.cursor()
    if USE_POSTGRES:
        query = "SELECT id, name FROM managers ORDER BY LOWER(name)"
    else:
        query = "SELECT id, name FROM managers ORDER BY name COLLATE NOCASE"
    cur.execute(query)
    rows = cur.fetchall()
    conn.close()
    return [{"id": r["id"], "name": r["name"]} for r in rows]


# ===== Менеджеры из таблицы users (для привязки ассистентов) =====
@app.get("/api/user-managers")
def get_user_managers():
    conn = get_conn()
    cur = conn.cursor()
    rows = cur.execute("""
        SELECT id, first_name AS name
        FROM users
        WHERE role = 'manager'
        ORDER BY first_name COLLATE NOCASE
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]

# ===== Проверка дублирующих защит =====
@app.post("/api/protections/check-duplicate")
def check_duplicate(data: dict):
    conn = get_conn()
    cur = conn.cursor()
    results = []
    sku_data = data.get("sku_data", [])
    area_m2 = data.get("area_m2")
    if not sku_data:
        return []
    cur.execute(
        "SELECT id, manager, partner, sku, area_m2, expires_at, status FROM protections WHERE status = 'active'"
    )
    protections = cur.fetchall()
    for item in sku_data:
        sku = item.get("sku")
        area = item.get("area") or area_m2
        if not sku or not area:
            continue
        sku_norm = normalize_sku(sku)
        for row in protections:
            _, p_manager, p_partner, p_sku, p_area, p_expires, _ = row
            if not p_area:
                continue
            if sku_norm != normalize_sku(p_sku):
                continue
            lower = float(p_area) * 0.9
            upper = float(p_area) * 1.1
            if lower <= float(area) <= upper:
                results.append(
                    {
                        "manager": p_manager,
                        "partner": p_partner,
                        "sku": p_sku,
                        "area_m2": p_area,
                        "expires_at": p_expires,
                    }
                )
    conn.close()
    return results

# === Утилита для сопоставления user_id с manager_id ===
def resolve_manager_for_user(cur, user_id):
    """Безопасно ищет менеджера по user_id, если требуется"""
    if not user_id:
        return None
    row = cur.execute("SELECT id FROM users WHERE id=?", (user_id,)).fetchone()
    return row["id"] if row else None

# ===== Создание защиты =====
@app.post("/api/protections", response_model=ProtectionOut)
def create_protection(payload: ProtectionCreate, user=Depends(get_current_active_user)):
    conn = get_conn()
    cur = conn.cursor()
    created = now_iso()
    skus_in: List[SkuItem] = payload.sku_data or []
    has_per_sku_areas = any((it.area is not None) for it in skus_in)
    
    # Получаем user_id из текущего пользователя
    current_user_id = user.get("id") if isinstance(user, dict) else None

    # представление и площадь
    if skus_in:
        if has_per_sku_areas:
            parts = []
            total_area = 0.0
            for it in skus_in:
                a = float(it.area or 0)
                total_area += a
                parts.append(
                    f"{it.sku} ({it.type}) — {int(a) if a.is_integer() else a} м²"
                )
            sku_display = "; ".join(parts)
        else:
            total_area = float(payload.area_m2) if payload.area_m2 else 0.0
            parts = [f"{it.sku} ({it.type})" for it in skus_in]
            sku_display = " + ".join(parts)
    else:
        sku_display = (payload.sku or (skus_in[0].sku if skus_in else "—")).strip()
        total_area = float(payload.area_m2) if payload.area_m2 else 0.0

    # ⛔ минимум 50 м²
    if total_area < 50:
        conn.close()
        raise HTTPException(
            status_code=400,
            detail="⚠️ Защита ставится от 50 м²"
        )

    # === ПРОВЕРКА ДУБЛЕЙ по SKU и метражу ±10% (без учёта партнёра) ===
    pairs = []
    if skus_in:
        if has_per_sku_areas:
            for it in skus_in:
                if it.area and it.area > 0:
                    pairs.append((normalize_sku(it.sku), float(it.area)))
        else:
            for it in skus_in:
                pairs.append((normalize_sku(it.sku), total_area))
    else:
        if sku_display and total_area > 0:
            pairs.append((normalize_sku(sku_display), total_area))

    cur.execute("""
        SELECT manager, partner, sku, area_m2, expires_at
        FROM protections
        WHERE status='active'
    """)
    active_rows = cur.fetchall()

    for sku_code, area_x in pairs:
        if not sku_code or area_x <= 0:
            continue
        min_a = area_x * 0.9
        max_a = area_x * 1.1
        for row in active_rows:
            if not row["area_m2"]:
                continue
            if normalize_sku(row["sku"]) != sku_code:
                continue
            if min_a <= float(row["area_m2"]) <= max_a:
                # Отправляем уведомление всем админам и суперадминам о похожей защите
                admins = cur.execute(
                    """
                    SELECT tg_id, full_name, first_name 
                    FROM users 
                    WHERE role IN ('admin', 'superadmin') 
                      AND tg_id IS NOT NULL 
                      AND tg_id != ''
                    """
                ).fetchall()
                
                duplicate_msg = (
                    f"⚠️ <b>Попытка создать похожую защиту</b>\n\n"
                    f"👤 Менеджер: {row['manager']}\n"
                    f"🏢 Партнёр: {row['partner'] or '—'}\n"
                    f"❗️Артикул: {row['sku']}\n"
                    f"📏 Метраж: {int(row['area_m2']) if float(row['area_m2']).is_integer() else row['area_m2']} м²\n"
                    f"⏰ Истекает: {row['expires_at'][:10]}\n\n"
                    f"👤 Пытается создать: {payload.manager or '—'}\n"
                    f"📦 SKU: {sku_display}\n"
                    f"📏 Метраж: {int(total_area) if total_area.is_integer() else total_area} м²\n\n"
                    f"💬 Пользователь должен обратиться к коллеге перед созданием."
                )
                
                # Отправляем уведомления асинхронно
                async def send_duplicate_notifications():
                    sent_count = 0
                    for admin in admins:
                        tg_id = admin["tg_id"] if "tg_id" in admin.keys() else None
                        if tg_id:
                            try:
                                tg_id_int = int(tg_id) if str(tg_id).isdigit() else None
                                if tg_id_int:
                                    await bot.send_message(
                                        tg_id_int,
                                        duplicate_msg,
                                        parse_mode="HTML"
                                    )
                                    sent_count += 1
                                    print(f"📩 Уведомление о похожей защите отправлено админу {tg_id_int}")
                            except Exception as e:
                                print(f"⚠️ Ошибка отправки уведомления о похожей защите админу {tg_id}: {e}")
                    
                    if sent_count > 0:
                        print(f"✅ Уведомления о похожей защите отправлены {sent_count} админам/суперадминам")
                
                try:
                    asyncio.create_task(send_duplicate_notifications())
                except Exception as e:
                    print(f"⚠️ Ошибка при создании задачи отправки уведомлений: {e}")
                
                conn.close()
                raise HTTPException(
                    status_code=409,
                    detail={
                        "msg": (
                            "⚠️ Похожая активная защита уже существует:\n"
                            f"👤 Менеджер: {row['manager']}\n"
                            f"🏢 Партнёр: {row['partner'] or '—'}\n"
                            f"❗️Артикул: {row['sku']}\n"
                            f"📏 Метраж: {int(row['area_m2']) if float(row['area_m2']).is_integer() else row['area_m2']} м²\n"
                            f"⏰ Истекает: {row['expires_at']}\n\n"
                            "💬 Обратись к коллеге, прежде чем ставить новую защиту."
                        )
                    }
                )

    # ===== TTL по суммарной площади =====
    ttl_days = 5
    if total_area > 0:
        if total_area < 100:
            ttl_days = 5
        elif total_area < 250:
            ttl_days = 10
        elif total_area < 500:
            ttl_days = 15
        else:
            ttl_days = 30

    expires = add_days(created, ttl_days)

    # 🆕 Сохраняем user_id создателя защиты в поле manager_id защиты
    # Это нужно для привязки защиты к пользователю и проверки прав на удаление
    manager_id = current_user_id  # Сохраняем ID пользователя, который создал защиту

    # 🆕 Вставляем новую защиту с manager_id
    # Строим INSERT запрос с RETURNING для PostgreSQL
    if USE_POSTGRES:
        insert_sql = """
            INSERT INTO protections(
                manager, client, partner, partner_city, sku, area_m2, last4,
                object_city, address, comment, status, created_at, expires_at, closed_at,
                extend_count, auto_closed, manager_id
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, 'active', %s, %s, NULL, 0, 0, %s)
            RETURNING id
        """
    else:
        insert_sql = _adapt_query("""
        INSERT INTO protections(
            manager, client, partner, partner_city, sku, area_m2, last4,
            object_city, address, comment, status, created_at, expires_at, closed_at,
            extend_count, auto_closed, manager_id
        ) VALUES (?,?,?,?,?,?,?,?,?,?, 'active', ?, ?, NULL, 0, 0, ?)
    """)
    
    cur.execute(insert_sql, (
        (payload.manager or "").strip(),
        (payload.client or "").strip(),
        (payload.partner or "").strip(),
        (payload.partner_city or "").strip(),
        sku_display,
        total_area if total_area > 0 else None,
        (payload.last4 or "").strip(),
        (payload.object_city or "").strip(),
        (payload.address or "").strip(),
        (payload.comment or "").strip(),
        created,
        expires,
        manager_id,
    ))

    # Получаем ID в зависимости от типа БД
    if USE_POSTGRES:
        result = cur.fetchone()
        new_id = result["id"] if result else None
    else:
        new_id = cur.lastrowid
    
    if not new_id:
        conn.close()
        raise HTTPException(status_code=500, detail="Не удалось создать защиту: ID не получен")
    
    add_history(cur, new_id, "manager", "create", {"sku": sku_display, "area_m2": total_area})
    conn.commit()

    # если защита "на проверке" — уведомляем админа
    query = _adapt_query("SELECT * FROM protections WHERE id=?")
    cur.execute(query, (new_id,))
    row = cur.fetchone()
    if row["status"] == "pending":
        try:
            asyncio.create_task(notify_admin_new_protection(row_to_out(row).dict()))
        except Exception as e:
            print(f"⚠️ Ошибка при отправке уведомления админу: {e}")

    conn.close()
    return row_to_out(row)

    # === Обновление Telegram уведомлений менеджера ===
from fastapi import Body

@app.put("/api/admin/managers/{manager_id}/telegrams")
def update_manager_telegrams(manager_id: int, body: dict = Body(...)):
    import json
    telegrams = body.get("telegrams")

    if not isinstance(telegrams, list):
        raise HTTPException(status_code=400, detail="Поле 'telegrams' должно быть списком")

    conn = get_conn()   # ✅ вместо get_db()
    cur = conn.cursor()
    cur.execute("SELECT id FROM managers WHERE id = ?", (manager_id,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Менеджер не найден")

    cur.execute(
        "UPDATE managers SET telegrams = ? WHERE id = ?",
        (json.dumps(telegrams, ensure_ascii=False), manager_id)
    )
    conn.commit()
    conn.close()

    return {"message": "✅ Telegram-уведомления успешно обновлены", "telegrams": telegrams}


# ===== Редактирование защиты =====
@app.put("/api/protections/{pid}", response_model=ProtectionOut)
def update_protection(pid: int, payload: ProtectionUpdate):
    conn = get_conn()
    cur = conn.cursor()

    # проверим, что защита есть и активна
    query = _adapt_query("SELECT * FROM protections WHERE id = ?")
    cur.execute(query, (pid,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Защита не найдена")
    if row["status"] != "active":
        conn.close()
        raise HTTPException(status_code=400, detail="Редактировать можно только активные защиты")

    # === формируем sku и площадь ТАК ЖЕ, как при создании ===
    skus_in: List[SkuItem] = payload.sku_data or []
    has_per_sku_areas = any((it.area is not None) for it in skus_in)

    if skus_in:
        if has_per_sku_areas:
            parts = []
            total_area = 0.0
            for it in skus_in:
                a = float(it.area or 0)
                total_area += a
                parts.append(f"{it.sku} ({it.type}) — {int(a) if a.is_integer() else a} м²")
            sku_display = "; ".join(parts)
        else:
            total_area = float(payload.area_m2 or 0)
            parts = [f"{it.sku} ({it.type})" for it in skus_in]
            sku_display = " + ".join(parts)
    else:
        sku_display = (payload.sku or "").strip()
        total_area = float(payload.area_m2 or 0)

    # === обновляем запись ===
    cur.execute(
        """
        UPDATE protections
        SET sku = ?, area_m2 = ?, comment = ?, updated_at = ?
        WHERE id = ?
        """,
        (sku_display, total_area, payload.comment or "", now_iso(), pid),
    )

    add_history(
        cur,
        pid,
        payload.manager or "system",
        "edit",
        {
            "new_area": total_area,
            "new_skus": sku_display,
            "comment": payload.comment or "",
        },
    )

    conn.commit()
    query = _adapt_query("SELECT * FROM protections WHERE id = ?")
    cur.execute(query, (pid,))
    updated = cur.fetchone()
    conn.close()

    return row_to_out(updated)

# ===== List / Actions / Stats =====
@app.get("/api/protections", response_model=List[ProtectionOut])
def list_protections(search: str = "", manager: str = "", status: str = ""):
    sql = "SELECT * FROM protections WHERE 1=1"
    params: list = []
    # по умолчанию скрываем deleted, но если status='archived' или status='deleted', показываем их
    if not status:
        sql += " AND status != 'deleted'"
    elif status == "archived":
        # В архиве показываем все неактивные, включая deleted
        sql += " AND (status = 'archived' OR status = 'success' OR status = 'closed' OR status = 'deleted')"
    if search:
        s = f"%{search.lower()}%"
        sql += """ AND (
            LOWER(manager) LIKE ? OR LOWER(client) LIKE ? OR LOWER(partner) LIKE ? 
            OR LOWER(partner_city) LIKE ? OR LOWER(sku) LIKE ? OR LOWER(last4) LIKE ? 
            OR LOWER(object_city) LIKE ? OR LOWER(address) LIKE ?
        )"""
        params += [s] * 8
    if manager:
        sql += " AND manager = ?"
        params.append(manager)
    # Для archived не добавляем дополнительное условие status = 'archived',
    # так как мы уже отфильтровали выше все неактивные статусы
    if status and status != "archived":
        sql += " AND status = ?"
        params.append(status)
    sql += " ORDER BY created_at DESC"

    # Адаптируем запрос для PostgreSQL
    sql = _adapt_query(sql)

    conn = get_conn()
    cur = conn.cursor()
    cur.execute(sql, params)
    rows = cur.fetchall()
    
    # Получаем историю для всех защит, чтобы извлечь комментарии
    protection_ids = [r["id"] for r in rows]
    history_map = {}
    if protection_ids:
        placeholders = ",".join(["?"] * len(protection_ids))
        history_sql = _adapt_query(f"SELECT * FROM history WHERE protection_id IN ({placeholders}) AND action IN ('close', 'success', 'delete') ORDER BY at DESC")
        history_cur = conn.cursor()
        history_cur.execute(history_sql, protection_ids)
        history_rows = history_cur.fetchall()
        for h in history_rows:
            pid = h["protection_id"]
            payload = json.loads(h["payload"] or "{}")
            action = h["action"]
            if pid not in history_map:
                history_map[pid] = {}
            if action == "close" and "reason" in payload:
                history_map[pid]["close_reason"] = payload["reason"]
            elif action == "success" and "doc_1c" in payload:
                history_map[pid]["success_doc"] = payload["doc_1c"]
            elif action == "delete" and "reason" in payload:
                history_map[pid]["delete_reason"] = payload["reason"]
        
        # Также проверяем поле close_reason напрямую из таблицы protections
        for r in rows:
            if "close_reason" in r.keys() and r["close_reason"]:
                pid = r["id"]
                if pid not in history_map:
                    history_map[pid] = {}
                history_map[pid]["close_reason"] = r["close_reason"]
    
    conn.close()
    return [row_to_out(r, history_map.get(r["id"], {})) for r in rows]

# --- история
@app.get("/api/history")
def history(protection_id: Optional[int] = None):
    conn = get_conn()
    cur = conn.cursor()
    if protection_id:
        rows = cur.execute(
            "SELECT * FROM history WHERE protection_id=? ORDER BY at DESC",
            (protection_id,),
        ).fetchall()
    else:
        rows = cur.execute(
            "SELECT * FROM history ORDER BY at DESC LIMIT 500"
        ).fetchall()
    out = []
    for r in rows:
        out.append(
            {
                "id": r["id"],
                "protection_id": r["protection_id"],
                "at": r["at"],
                "actor": r["actor"],
                "action": r["action"],
                "payload": json.loads(r["payload"] or "{}"),
            }
        )
    conn.close()
    return out

# --- продление
@app.post("/api/protections/{pid}/extend", response_model=ProtectionOut)
def extend(pid: int, days: int = 10, actor: Literal["manager", "admin"] = "manager", background_tasks: BackgroundTasks = None):
    conn = get_conn()
    cur = conn.cursor()
    query = _adapt_query("SELECT * FROM protections WHERE id=?")
    cur.execute(query, (pid,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Not found")
    if row["status"] not in ("active",):
        conn.close()
        raise HTTPException(
            status_code=400, detail="Можно продлевать только активные защиты"
        )

    # ограничение для менеджера: 2 раза
    extend_count = row["extend_count"] or 0
    if actor == "manager" and extend_count >= 2:
        add_history(
            cur,
            pid,
            "manager",
            "extend_denied_limit",
            {"current_extend_count": extend_count},
        )
        conn.commit()
        conn.close()
        raise HTTPException(
            status_code=403,
            detail={
                "msg": "Превышен лимит продлений менеджером. Запросите у администратора.",
                "needs_admin": True,
            },
        )

    new_exp = add_days(row["expires_at"], days)
    new_count = extend_count + (1 if actor == "manager" else 0)
    update_query = _adapt_query("UPDATE protections SET expires_at=?, extend_count=? WHERE id=?")
    cur.execute(update_query, (new_exp, new_count, pid))
    add_history(cur, pid, actor, "extend", {"days": days})
    conn.commit()
    
    # Отправляем уведомление админам и суперадминам о продлении
    if background_tasks:
        async def notify_admins_extend():
            try:
                # Получаем всех админов и суперадминов
                admin_conn = get_conn()
                admin_cur = admin_conn.cursor()
                admin_query = _adapt_query("SELECT tg_id FROM users WHERE role IN ('admin', 'superadmin') AND tg_id IS NOT NULL AND tg_id != ''")
                admin_cur.execute(admin_query)
                admins = admin_cur.fetchall()
                admin_conn.close()
                
                manager_name = row.get("manager", "—")
                sku = row.get("sku", "—")
                expires_at = new_exp[:10] if new_exp else "—"
                
                msg = (
                    f"🔄 <b>Защита продлена</b>\n\n"
                    f"👤 Менеджер: {manager_name}\n"
                    f"📦 SKU: {sku}\n"
                    f"⏰ Продлено на: {days} дней\n"
                    f"📅 Новая дата истечения: {expires_at}\n"
                    f"🆔 ID защиты: {pid}"
                )
                
                # Отправляем уведомления
                sent_count = 0
                for admin in admins:
                    tg_id = admin.get("tg_id") if isinstance(admin, dict) else admin[0] if isinstance(admin, (list, tuple)) else None
                    if not tg_id:
                        continue
                    
                    try:
                        # Пробуем разные форматы tg_id
                        tg_id_int = None
                        if isinstance(tg_id, int):
                            tg_id_int = tg_id
                        elif isinstance(tg_id, str):
                            # Убираем префикс "tg-" или "dev-" если есть
                            clean_id = tg_id.replace("tg-", "").replace("dev-", "").strip()
                            if clean_id.isdigit():
                                tg_id_int = int(clean_id)
                            elif tg_id.isdigit():
                                tg_id_int = int(tg_id)
                        
                        if not tg_id_int:
                            print(f"⚠️ Некорректный формат tg_id у админа: {tg_id} (тип: {type(tg_id)})")
                            continue
                        
                        # Проверяем, что бот инициализирован
                        if bot is None:
                            print(f"❌ Бот не инициализирован!")
                            continue
                        
                        await bot.send_message(tg_id_int, msg, parse_mode="HTML")
                        sent_count += 1
                        print(f"✅ Уведомление о продлении отправлено админу {tg_id_int} (исходный tg_id: {tg_id})")
                    except Exception as e:
                        error_msg = str(e)
                        if "chat not found" in error_msg.lower() or "chat_not_found" in error_msg.lower():
                            print(f"⚠️ Пользователь {tg_id} не начал диалог с ботом или ID неверный. Попросите пользователя отправить /start боту.")
                        else:
                            print(f"⚠️ Ошибка отправки уведомления админу {tg_id}: {e}")
                
                if sent_count == 0 and len(admins) > 0:
                    print(f"⚠️ Не удалось отправить уведомления о продлении ни одному админу. Всего админов: {len(admins)}")
                elif sent_count > 0:
                    print(f"✅ Уведомления о продлении отправлены {sent_count} админам/суперадминам")
            except Exception as e:
                print(f"⚠️ Ошибка при отправке уведомлений о продлении: {e}")
        
        background_tasks.add_task(notify_admins_extend)
    
    query = _adapt_query("SELECT * FROM protections WHERE id=?")
    cur.execute(query, (pid,))
    row = cur.fetchone()
    conn.close()
    return row_to_out(row)

@app.post("/api/protections/{pid}/request-extend")
def request_extend(pid: int, data: dict = Body(...), background_tasks: BackgroundTasks = None):
    days = data.get("days", 5)
    reason = (data.get("reason") or "").strip()
    conn = get_conn()
    cur = conn.cursor()
    query = _adapt_query("SELECT * FROM protections WHERE id=?")
    cur.execute(query, (pid,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Not found")

    if not reason:
        reason = "не указана"

    add_history(
        cur,
        pid,
        "manager",
        "extend_request",
        {"days": days, "reason": reason},
    )
    
    # Отправляем уведомление всем админам и суперадминам
    admin_query = _adapt_query("""
        SELECT tg_id, full_name, first_name 
        FROM users 
        WHERE role IN ('admin', 'superadmin') 
          AND tg_id IS NOT NULL 
          AND tg_id != ''
    """)
    cur.execute(admin_query)
    admins = cur.fetchall()
    
    # Получаем extend_count для информативности
    extend_count = row["extend_count"] if "extend_count" in row.keys() else 0
    extend_count_text = f" (уже продлевалась {extend_count} раз)" if extend_count > 0 else ""
    
    msg = (
        f"📨 <b>Запрос на продление защиты</b>\n\n"
        f"🆔 Защита: #{pid}\n"
        f"👤 Менеджер: {row['manager']}\n"
        f"📦 SKU: {row['sku'] if 'sku' in row.keys() else '—'}\n"
        f"⏰ Текущая дата истечения: {row['expires_at'][:10]}{extend_count_text}\n"
        f"📅 Запрошено продление на: {days} дней\n"
        f"💬 Причина: {reason}\n\n"
        f"Выберите действие:"
    )
    
    kb = InlineKeyboardBuilder()
    kb.button(text="✅ Продлить на 10 дней", callback_data=f"admin_extend:{pid}:10")
    kb.button(text="✅ Продлить на 30 дней", callback_data=f"admin_extend:{pid}:30")
    kb.button(text="📅 Продлить на N дней", callback_data=f"admin_extend_custom:{pid}")
    kb.button(text="🚫 Отклонить", callback_data=f"admin_reject_extend:{pid}")
    kb.adjust(2, 2)
    
    # Отправляем уведомления асинхронно
    async def send_admin_notifications():
        sent_count = 0
        print(f"🔍 Начинаю отправку уведомлений админам. Всего админов: {len(admins)}")
        print(f"🔍 BOT_TOKEN exists: {bool(BOT_TOKEN)}, bot instance: {bot is not None}")
        print(f"🔍 Bot token length: {len(BOT_TOKEN) if BOT_TOKEN else 0}")
        
        for admin in admins:
            tg_id = admin["tg_id"] if "tg_id" in admin.keys() else None
            if not tg_id:
                print(f"⚠️ У админа {admin.get('full_name', admin.get('first_name', 'Unknown'))} нет tg_id")
                continue
            try:
                # Пробуем разные форматы tg_id
                tg_id_int = None
                if isinstance(tg_id, int):
                    tg_id_int = tg_id
                elif isinstance(tg_id, str):
                    # Убираем префикс "tg-" или "dev-" если есть
                    clean_id = tg_id.replace("tg-", "").replace("dev-", "").strip()
                    if clean_id.isdigit():
                        tg_id_int = int(clean_id)
                    elif tg_id.isdigit():
                        tg_id_int = int(tg_id)
                
                if not tg_id_int:
                    print(f"⚠️ Некорректный формат tg_id у админа: {tg_id} (тип: {type(tg_id)})")
                    continue
                
                print(f"📤 Отправляю уведомление админу {tg_id_int} (исходный tg_id: {tg_id})...")
                
                # Проверяем, что бот инициализирован
                if bot is None:
                    print(f"❌ Бот не инициализирован!")
                    continue
                
                result = await bot.send_message(
                    tg_id_int,
                    msg,
                    parse_mode="HTML",
                    reply_markup=kb.as_markup()
                )
                sent_count += 1
                admin_name = admin["full_name"] if "full_name" in admin.keys() else (admin["first_name"] if "first_name" in admin.keys() else "Unknown")
                print(f"✅ Уведомление о запросе продления отправлено админу {tg_id_int} ({admin_name}), message_id={result.message_id}")
            except Exception as e:
                error_msg = str(e)
                if "chat not found" in error_msg.lower() or "chat_not_found" in error_msg.lower():
                    admin_name = admin.get("full_name", admin.get("first_name", "Unknown"))
                    print(f"⚠️ Пользователь {tg_id} ({admin_name}) не начал диалог с ботом или ID неверный. Попросите пользователя отправить /start боту.")
                else:
                    print(f"❌ Ошибка отправки уведомления админу {tg_id}: {e}")
                print(f"🔍 Тип ошибки: {type(e).__name__}")
                import traceback
                traceback.print_exc()
        
        if sent_count == 0:
            print(f"⚠️ Не удалось отправить уведомления ни одному админу. Всего админов: {len(admins)}")
            print(f"🔍 Список админов: {[(a.get('full_name', a.get('first_name', 'Unknown')), a.get('tg_id')) for a in admins]}")
        else:
            print(f"✅ Уведомления о запросе продления отправлены {sent_count} админам/суперадминам")
    
    # Запускаем в фоне через BackgroundTasks
    # FastAPI автоматически инжектит BackgroundTasks
    if background_tasks is None:
        from fastapi import BackgroundTasks as BT
        background_tasks = BT()
    
    # Добавляем задачу в фоновые задачи
    # BackgroundTasks в FastAPI правильно обрабатывает async функции
    background_tasks.add_task(send_admin_notifications)
    
    print(f"📋 Задача отправки уведомлений добавлена в BackgroundTasks (async функция)")
    
    conn.commit()
    conn.close()
    return {"ok": True}


# --- успешная / закрытая / удаление
@app.post("/api/protections/{pid}/success", response_model=ProtectionOut)
def mark_success(pid: int, data: dict = Body(...)):
    doc_1c = (data or {}).get("doc_1c", "").strip()
    if not doc_1c:
        raise HTTPException(
            status_code=400, detail="Нужно указать номер документа из 1С"
        )
    conn = get_conn()
    cur = conn.cursor()
    query = _adapt_query("SELECT * FROM protections WHERE id=?")
    cur.execute(query, (pid,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Not found")
    update_query = _adapt_query("UPDATE protections SET status='success', closed_at=? WHERE id=?")
    cur.execute(update_query, (now_iso(), pid))
    add_history(cur, pid, "manager", "success", {"doc_1c": doc_1c})
    conn.commit()
    query = _adapt_query("SELECT * FROM protections WHERE id=?")
    cur.execute(query, (pid,))
    row = cur.fetchone()
    conn.close()
    return row_to_out(row)

@app.post("/api/protections/{pid}/close", response_model=ProtectionOut)
def mark_closed(pid: int, data: dict = Body(...)):
    reason = (data or {}).get("reason", "").strip()
    if not reason:
        raise HTTPException(
            status_code=400, detail="Нужно указать причину закрытия"
        )
    conn = get_conn()
    cur = conn.cursor()
    query = _adapt_query("SELECT * FROM protections WHERE id=?")
    cur.execute(query, (pid,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Not found")
    update_query = _adapt_query("UPDATE protections SET status='closed', closed_at=? WHERE id=?")
    cur.execute(update_query, (now_iso(), pid))
    add_history(cur, pid, "manager", "close", {"reason": reason})
    conn.commit()
    query = _adapt_query("SELECT * FROM protections WHERE id=?")
    cur.execute(query, (pid,))
    row = cur.fetchone()
    conn.close()
    return row_to_out(row)

@app.delete("/api/protections/{pid}")
def delete_protection(pid: int, reason: Optional[str] = None, user=Depends(get_current_active_user)):
    """
    Мягкое удаление: статус -> 'deleted' + запись в историю.
    Удалить может только автор защиты (по manager_id) или админ/суперадмин.
    При удалении админом отправляется уведомление автору с причиной.
    """
    conn = get_conn()
    cur = conn.cursor()
    query = _adapt_query("SELECT * FROM protections WHERE id=?")
    cur.execute(query, (pid,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Not found")
    
    current_user_id = user.get("id") if isinstance(user, dict) else None
    user_role = user.get("role", "") if isinstance(user, dict) else ""
    is_admin = user_role in ("admin", "superadmin")
    
    # Проверяем права: автор или админ
    # Проверяем наличие manager_id в строке (для совместимости с SQLite и PostgreSQL)
    protection_manager_id = row["manager_id"] if "manager_id" in row.keys() else None
    is_author = current_user_id and protection_manager_id and current_user_id == protection_manager_id
    
    if not is_author and not is_admin:
        conn.close()
        raise HTTPException(
            status_code=403, 
            detail="Удалить защиту может только её автор или администратор"
        )
    
    # Если удаляет админ - отправляем уведомление автору
    if is_admin and not is_author and protection_manager_id:
        # Получаем данные автора
        author_row = cur.execute("SELECT tg_id, full_name, first_name FROM users WHERE id=?", (protection_manager_id,)).fetchone()
        if author_row and ("tg_id" in author_row.keys() and author_row["tg_id"]):
            reason_text = reason or "не указана"
            sku_value = row["sku"] if "sku" in row.keys() else "—"
            manager_value = row["manager"] if "manager" in row.keys() else "—"
            msg = (
                f"⚠️ <b>Ваша защита была удалена администратором</b>\n\n"
                f"🆔 Защита: #{pid}\n"
                f"📦 SKU: {sku_value}\n"
                f"👤 Менеджер: {manager_value}\n"
                f"💬 Причина удаления: {reason_text}\n"
            )
            
            # Отправляем уведомление асинхронно
            async def send_delete_notification():
                try:
                    await bot.send_message(
                        int(author_row["tg_id"]),
                        msg,
                        parse_mode="HTML"
                    )
                    print(f"📩 Уведомление об удалении защиты отправлено автору {author_row['tg_id']}")
                except Exception as e:
                    print(f"⚠️ Ошибка отправки уведомления автору {author_row['tg_id']}: {e}")
            
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    loop.create_task(send_delete_notification())
                else:
                    asyncio.run(send_delete_notification())
            except:
                asyncio.create_task(send_delete_notification())
    
    actor = "admin" if is_admin else "manager"
    cur.execute(
        "UPDATE protections SET status='deleted', closed_at=? WHERE id=?",
        (now_iso(), pid),
    )
    add_history(cur, pid, actor, "delete", {"reason": reason or "not provided"})
    conn.commit()
    conn.close()
    return {"ok": True}

# --- админ: запросы на продление
@app.get("/api/admin/extend-requests")
def admin_extend_requests(user=Depends(get_admin_user)):
    conn = get_conn()
    cur = conn.cursor()
    query = """
        SELECT h.id as hid, h.protection_id, h.at, h.payload,
               p.manager, p.partner, p.sku, p.expires_at
        FROM history h
        JOIN protections p ON p.id = h.protection_id
        WHERE h.action='extend_request'
        ORDER BY h.at DESC
        """
    cur.execute(query)
    rows = cur.fetchall()
    out = []  # 🟢 вот этой строки не хватало
    for r in rows:
        payload = json.loads(r["payload"] or "{}")
        out.append(
            {
                "history_id": r["hid"],
                "protection_id": r["protection_id"],
                "requested_at": r["at"],
                "days": payload.get("days", 0),
                "reason": payload.get("reason", "—"),
                "manager": r["manager"],
                "partner": r["partner"],
                "sku": r["sku"],
                "expires_at": r["expires_at"],
            }
        )
    conn.close()
    return out



@app.post("/api/admin/protections/{pid}/extend-any", response_model=ProtectionOut)
def admin_extend_any(pid: int, days: int = 10, user=Depends(get_admin_user)):
    # админ без лимита
    return extend(pid, days=days, actor="admin")

# ===== Stats =====
@app.get("/api/stats")
def stats():
    conn = get_conn()
    cur = conn.cursor()
    if USE_POSTGRES:
        query = """
            SELECT 
                manager,
                COUNT(*) AS total,
                SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active_cnt,
                SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success_cnt,
                SUM(CASE WHEN status='closed' THEN 1 ELSE 0 END) AS closed_cnt,
                ROUND(CAST(SUM(CASE WHEN status='active' THEN area_m2 ELSE 0 END) AS NUMERIC), 1) AS active_area,
                ROUND(CAST(SUM(CASE WHEN status='success' THEN area_m2 ELSE 0 END) AS NUMERIC), 1) AS success_area,
                ROUND(CAST(SUM(CASE WHEN status='closed' THEN area_m2 ELSE 0 END) AS NUMERIC), 1) AS closed_area
            FROM protections
            WHERE status != 'deleted'
            GROUP BY manager
        """
    else:
        query = """
        SELECT 
            manager,
            COUNT(*) AS total,
            SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active_cnt,
            SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success_cnt,
            SUM(CASE WHEN status='closed' THEN 1 ELSE 0 END) AS closed_cnt,
            ROUND(SUM(CASE WHEN status='active' THEN area_m2 ELSE 0 END), 1) AS active_area,
            ROUND(SUM(CASE WHEN status='success' THEN area_m2 ELSE 0 END), 1) AS success_area,
            ROUND(SUM(CASE WHEN status='closed' THEN area_m2 ELSE 0 END), 1) AS closed_area
        FROM protections
        WHERE status != 'deleted'
        GROUP BY manager
        """
    cur.execute(query)
    rows = cur.fetchall()
    conn.close()

    out = []
    for r in rows:
        total = r["total"] or 0
        success = r["success_cnt"] or 0
        rate = round((success / total * 100) if total else 0)
        out.append(
            {
                "manager": r["manager"],
                "total": total,
                "active": r["active_cnt"] or 0,
                "success": success,
                "closed": r["closed_cnt"] or 0,
                "success_rate": rate,
                "active_area": r["active_area"] or 0,
                "success_area": r["success_area"] or 0,
                "closed_area": r["closed_area"] or 0,
            }
        )
    return out
# ====== Новый эндпоинт: список защит по менеджеру ======
@app.get("/api/admin/manager-protections")
def admin_manager_protections(manager_id: int, user=Depends(get_admin_user)):
    """
    Возвращает все защиты указанного менеджера.
    Пример: /api/admin/manager-protections?manager_id=3
    """
    conn = get_conn()
    cur = conn.cursor()

    # Проверяем, что менеджер существует
    manager_row = cur.execute("SELECT name FROM managers WHERE id=?", (manager_id,)).fetchone()
    if not manager_row:
        conn.close()
        return []  # если менеджера нет — просто возвращаем пустой список

    manager_name = manager_row["name"]

    cur.execute("""
        SELECT 
            id,
            partner,
            partner_city,
            client,
            object_city,
            address,
            sku,
            area_m2,
            status,
            expires_at,
            comment
        FROM protections
        WHERE manager = ?
        ORDER BY 
            CASE status 
                WHEN 'active' THEN 1
                WHEN 'success' THEN 2
                WHEN 'closed' THEN 3
                WHEN 'deleted' THEN 4
                ELSE 5
            END,
            id DESC
    """, (manager_name,))

    rows = cur.fetchall()
    conn.close()

    protections = [
        {
            "id": r["id"],
            "partner": r["partner"],
            "partner_city": r["partner_city"],
            "client": r["client"],
            "object_city": r["object_city"],
            "address": r["address"],
            "sku": r["sku"],
            "area_m2": r["area_m2"],
            "status": r["status"],
            "expires_at": r["expires_at"],
            "comment": r["comment"],
        }
        for r in rows
    ]
    return protections
from fastapi import BackgroundTasks

@app.post("/api/protections/pending")
def create_pending_protection(payload: ProtectionCreate = Body(...), background_tasks: BackgroundTasks = None):
    conn = get_conn()
    cur = conn.cursor()
    created = now_iso()

    # === Формируем sku_display так же, как при обычном создании ===
    skus_in: List[SkuItem] = payload.sku_data or []
    has_per_sku_areas = any((it.area is not None) for it in skus_in)

    if skus_in:
        if has_per_sku_areas:
            parts = []
            total_area = 0.0
            for it in skus_in:
                a = float(it.area or 0)
                total_area += a
                parts.append(f"{it.sku} ({it.type}) — {int(a) if a.is_integer() else a} м²")
            sku_display = "; ".join(parts)
        else:
            total_area = float(payload.area_m2 or 0)
            parts = [f"{it.sku} ({it.type})" for it in skus_in]
            sku_display = " + ".join(parts)
    else:
        sku_display = (payload.sku or "").strip()
        total_area = float(payload.area_m2 or 0)

    # === TTL ===
    ttl_days = 5
    if total_area > 100:
        ttl_days = 10 if total_area < 250 else (15 if total_area < 500 else 30)
    expires = add_days(created, ttl_days)

    # === Запись в базу ===
    # Строим INSERT запрос с RETURNING для PostgreSQL
    if USE_POSTGRES:
        insert_sql = """
            INSERT INTO protections(
                manager, client, partner, partner_city, sku, area_m2, last4,
                object_city, address, comment, status, created_at, expires_at,
                closed_at, extend_count, auto_closed
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, 'pending', %s, %s, NULL, 0, 0)
            RETURNING id
        """
    else:
        insert_sql = _adapt_query("""
        INSERT INTO protections(
            manager, client, partner, partner_city, sku, area_m2, last4,
            object_city, address, comment, status, created_at, expires_at,
            closed_at, extend_count, auto_closed
        ) VALUES (?,?,?,?,?,?,?,?,?,?, 'pending', ?, ?, NULL, 0, 0)
        """)
    
    cur.execute(insert_sql, (
        (payload.manager or "").strip(),
        (payload.client or "").strip(),
        (payload.partner or "").strip(),
        (payload.partner_city or "").strip(),
        sku_display,
        total_area if total_area > 0 else None,
        (payload.last4 or "").strip(),
        (payload.object_city or "").strip(),
        (payload.address or "").strip(),
        (payload.comment or "отправлено админу").strip(),
        created,
        expires,
    ))

    # Получаем ID в зависимости от типа БД
    if USE_POSTGRES:
        result = cur.fetchone()
        new_id = result["id"] if result else None
    else:
        new_id = cur.lastrowid
    
    if not new_id:
        conn.close()
        raise HTTPException(status_code=500, detail="Не удалось создать защиту: ID не получен")
    
    add_history(cur, new_id, "manager", "create_pending", {"reason": payload.comment})
    conn.commit()
    conn.close()

    # === Telegram уведомление админу ===
    if background_tasks:
        background_tasks.add_task(
            notify_admin_new_protection,
            {
                "id": new_id,
                "manager": payload.manager,
                "partner": payload.partner,
                "partner_city": payload.partner_city,
                "sku": sku_display,  # ✅ теперь передаём нормализованный артикул
                "area_m2": total_area,
                "object_city": payload.object_city,
                "address": payload.address,
                "comment": payload.comment,
            }
        )
        print(f"📨 Уведомление о защите #{new_id} добавлено в очередь на отправку в Telegram.")

    return {"ok": True, "id": new_id, "msg": "✅ Защита отправлена админу на проверку"}

# ===== USERS MANAGEMENT (новые эндпоинты) =====
# Старые эндпоинты /api/users удалены, используются /api/users/me и /api/users (для superadmin)

from aiogram import Bot
import asyncio
from datetime import datetime, timedelta

# === Проверка истекающих защит (ежедневно) ===
async def check_expiring_protections():
    """Проверка истекающих защит и отправка напоминаний за 2 дня"""
    while True:
        try:
            conn = get_conn()
            cur = conn.cursor()
            now = datetime.utcnow()
            two_days = (now + timedelta(days=2)).isoformat()

            # Проверяем только активные защиты, которым осталось <= 2 дней
            # и для которых еще не отправлялось напоминание
            query = _adapt_query("""
                SELECT p.id, p.manager, p.sku, p.expires_at, p.manager_id, p.partner, p.partner_city,
                       p.area_m2, p.extend_count, p.reminder_2days_sent,
                       u.tg_id, u.id AS user_id
                FROM protections p
                LEFT JOIN users u ON u.id = p.manager_id
                WHERE p.status='active' 
                  AND p.expires_at <= ?
                  AND (p.reminder_2days_sent IS NULL OR p.reminder_2days_sent = 0)
            """)
            cur.execute(query, (two_days,))
            rows = cur.fetchall()

            for r in rows:
                manager_name = r["manager"]
                sku = r["sku"] if "sku" in r.keys() else "—"
                pid = r["id"]
                expires_at = r["expires_at"]
                manager_id = r["manager_id"] if "manager_id" in r.keys() else None
                tg_id = r["tg_id"] if "tg_id" in r.keys() else None
                partner = r["partner"] if "partner" in r.keys() else "—"
                partner_city = r["partner_city"] if "partner_city" in r.keys() else "—"
                area_m2 = r["area_m2"] if "area_m2" in r.keys() else None
                extend_count = r["extend_count"] if "extend_count" in r.keys() else 0

                # Получаем всех пользователей, привязанных к этому менеджеру
                recipients: list[int] = []
                
                # Добавляем пользователя-менеджера, если у него есть tg_id
                if tg_id:
                    try:
                        recipients.append(int(tg_id))
                    except:
                        pass
                
                # Ищем пользователей, привязанных через manager_id
                if manager_id:
                    recipients_query = _adapt_query("""
                        SELECT tg_id FROM users 
                        WHERE manager_id = ? AND tg_id IS NOT NULL AND tg_id != ''
                    """)
                    cur.execute(recipients_query, (manager_id,))
                    recipients_rows = cur.fetchall()
                    for row in recipients_rows:
                        if row["tg_id"]:
                            try:
                                recipients.append(int(row["tg_id"]))
                            except:
                                pass
                
                # Ищем пользователей, привязанных через manager_ids (JSON массив)
                import json
                query = _adapt_query("SELECT tg_id, manager_ids FROM users WHERE tg_id IS NOT NULL AND tg_id != ''")
                cur.execute(query)
                all_users = cur.fetchall()
                for user_row in all_users:
                    user_tg_id = user_row["tg_id"] if "tg_id" in user_row.keys() else None
                    manager_ids_json = user_row["manager_ids"] if "manager_ids" in user_row.keys() else "[]"
                    if user_tg_id and manager_ids_json:
                        try:
                            user_manager_ids = json.loads(manager_ids_json)
                            if isinstance(user_manager_ids, list) and manager_id in user_manager_ids:
                                try:
                                    recipients.append(int(user_tg_id))
                                except:
                                    pass
                        except:
                            pass
                
                # Убираем дубликаты
                recipients = list(dict.fromkeys(recipients))

                # Формируем информативное сообщение
                area_text = f"{area_m2} м²" if area_m2 else "—"
                extend_text = f" (продлевалась {extend_count} раз)" if extend_count > 0 else ""

                msg = (
                    f"⚠️ <b>Защита #{pid} истекает через 2 дня!</b>\n\n"
                    f"📦 SKU: {sku}\n"
                    f"👤 Менеджер: {manager_name}\n"
                    f"🏢 Партнёр: {partner} ({partner_city})\n"
                    f"📏 Площадь: {area_text}\n"
                    f"⏰ Истекает: {expires_at[:10]}{extend_text}\n\n"
                    f"Выберите действие:"
                )

                # Создаем инлайн кнопки
                kb = InlineKeyboardBuilder()
                kb.button(text="✅ Продлить на 10 дней", callback_data=f"extend:{pid}:10")
                kb.button(text="✅ Продлить на 30 дней", callback_data=f"extend:{pid}:30")
                kb.button(text="🔒 Закрыть защиту", callback_data=f"close_exp:{pid}")
                kb.adjust(2, 1)

                sent_count = 0
                for tid in recipients:
                    if not tid:
                        continue
                    try:
                        tg_id_int = int(tid) if isinstance(tid, (int, str)) and str(tid).isdigit() else None
                        if not tg_id_int:
                            print(f"⚠️ Некорректный tg_id для напоминания: {tid} (тип: {type(tid)})")
                            continue
                        await bot.send_message(
                            tg_id_int, 
                            msg, 
                            parse_mode="HTML",
                            reply_markup=kb.as_markup()
                        )
                        sent_count += 1
                        print(f"📩 Напоминание за 2 дня отправлено менеджеру {tg_id_int} (защита #{pid})")
                    except Exception as e:
                        print(f"⚠️ Ошибка отправки напоминания {tid}: {e}")
                        import traceback
                        traceback.print_exc()
                
                # Отмечаем, что напоминание отправлено
                if sent_count > 0:
                    cur.execute(
                        "UPDATE protections SET reminder_2days_sent = 1 WHERE id = ?",
                        (pid,)
                    )
                    conn.commit()
                    print(f"✅ Напоминание за 2 дня отправлено для защиты #{pid} ({sent_count} получателей)")

            conn.close()
        except Exception as e:
            print("❌ Ошибка в проверке истекающих защит:", e)
            import traceback
            traceback.print_exc()

        await asyncio.sleep(24 * 60 * 60)  # раз в сутки


async def auto_close_expired_protections():
    """Автоматическое закрытие защит, срок которых истёк без продления"""
    while True:
        try:
            conn = get_conn()
            cur = conn.cursor()
            now = datetime.utcnow()
            now_iso_str = now.isoformat()

            # Находим все активные защиты, срок которых уже истёк
            query = _adapt_query("""
                SELECT p.id, p.manager, p.sku, p.partner, p.partner_city, p.manager_id,
                       p.expires_at, p.auto_closed,
                       u.tg_id
                FROM protections p
                LEFT JOIN users u ON u.id = p.manager_id
                WHERE p.status = 'active' 
                  AND p.expires_at < ?
                  AND (p.auto_closed IS NULL OR p.auto_closed = 0)
            """)
            cur.execute(query, (now_iso_str,))
            expired_rows = cur.fetchall()

            closed_count = 0
            for row in expired_rows:
                pid = row["id"]
                manager_name = row["manager"] if "manager" in row.keys() else "—"
                sku = row["sku"] if "sku" in row.keys() else "—"
                partner = row["partner"] if "partner" in row.keys() else "—"
                partner_city = row["partner_city"] if "partner_city" in row.keys() else "—"
                manager_id = row["manager_id"] if "manager_id" in row.keys() else None
                tg_id = row["tg_id"] if "tg_id" in row.keys() else None
                expires_at = row["expires_at"] if "expires_at" in row.keys() else "—"

                # Закрываем защиту
                close_reason = "закрыта за бездействие"
                cur.execute("""
                    UPDATE protections 
                    SET status = 'closed', 
                        auto_closed = 1,
                        close_reason = ?,
                        closed_at = ?,
                        updated_at = ?
                    WHERE id = ?
                """, (close_reason, now_iso_str, now_iso_str, pid))
                
                # Записываем в историю
                add_history(cur, pid, "system", "close", {
                    "reason": close_reason,
                    "auto": True,
                    "expired_at": expires_at
                })
                
                conn.commit()
                closed_count += 1
                
                # Отправляем уведомление менеджеру
                if tg_id:
                    try:
                        # Пробуем разные форматы tg_id
                        tg_id_int = None
                        if isinstance(tg_id, int):
                            tg_id_int = tg_id
                        elif isinstance(tg_id, str):
                            # Убираем префикс "tg-" или "dev-" если есть
                            clean_id = tg_id.replace("tg-", "").replace("dev-", "")
                            if clean_id.isdigit():
                                tg_id_int = int(clean_id)
                            elif tg_id.isdigit():
                                tg_id_int = int(tg_id)
                        
                        if tg_id_int:
                            msg = (
                                f"🔒 <b>Защита #{pid} автоматически закрыта</b>\n\n"
                                f"📦 SKU: {sku}\n"
                                f"🏢 Партнёр: {partner} ({partner_city})\n"
                                f"⏰ Дата истечения: {expires_at[:10]}\n"
                                f"📝 Причина: {close_reason}\n\n"
                                f"Защита была закрыта автоматически, так как срок истёк и не было продления."
                            )
                            await bot.send_message(
                                tg_id_int,
                                msg,
                                parse_mode="HTML"
                            )
                            print(f"📩 Уведомление об авто-закрытии отправлено менеджеру {tg_id_int} (защита #{pid})")
                        else:
                            print(f"⚠️ Некорректный формат tg_id менеджера: {tg_id} (тип: {type(tg_id)})")
                    except Exception as e:
                        print(f"⚠️ Ошибка отправки уведомления менеджеру {tg_id}: {e}")
                        import traceback
                        traceback.print_exc()
                
                # Отправляем уведомление админам/суперадминам
                try:
                    admins = cur.execute("""
                        SELECT tg_id, full_name, first_name 
                        FROM users 
                        WHERE role IN ('admin', 'superadmin') 
                          AND tg_id IS NOT NULL 
                          AND tg_id != ''
                    """).fetchall()
                    
                    admin_msg = (
                        f"🔒 <b>Защита #{pid} автоматически закрыта за бездействие</b>\n\n"
                        f"👤 Менеджер: {manager_name}\n"
                        f"📦 SKU: {sku}\n"
                        f"🏢 Партнёр: {partner} ({partner_city})\n"
                        f"⏰ Дата истечения: {expires_at[:10]}\n"
                        f"📝 Причина: {close_reason}"
                    )
                    
                    for admin in admins:
                        admin_tg_id = admin["tg_id"] if "tg_id" in admin.keys() else None
                        if not admin_tg_id:
                            continue
                        try:
                            # Пробуем разные форматы tg_id
                            admin_tg_id_int = None
                            if isinstance(admin_tg_id, int):
                                admin_tg_id_int = admin_tg_id
                            elif isinstance(admin_tg_id, str):
                                # Убираем префикс "tg-" если есть
                                clean_id = admin_tg_id.replace("tg-", "").replace("dev-", "")
                                if clean_id.isdigit():
                                    admin_tg_id_int = int(clean_id)
                                elif admin_tg_id.isdigit():
                                    admin_tg_id_int = int(admin_tg_id)
                            
                            if admin_tg_id_int:
                                await bot.send_message(
                                    admin_tg_id_int,
                                    admin_msg,
                                    parse_mode="HTML"
                                )
                                print(f"📩 Уведомление об авто-закрытии отправлено админу {admin_tg_id_int}")
                            else:
                                print(f"⚠️ Некорректный формат tg_id админа: {admin_tg_id} (тип: {type(admin_tg_id)})")
                        except Exception as e:
                            print(f"⚠️ Ошибка отправки уведомления админу {admin_tg_id}: {e}")
                            import traceback
                            traceback.print_exc()
                except Exception as e:
                    print(f"⚠️ Ошибка при отправке уведомлений админам: {e}")
                
                print(f"✅ Защита #{pid} автоматически закрыта за бездействие")

            if closed_count > 0:
                print(f"✅ Авто-закрыто защит: {closed_count}")
            
            conn.close()
        except Exception as e:
            print("❌ Ошибка в авто-закрытии защит:", e)
            import traceback
            traceback.print_exc()

        await asyncio.sleep(6 * 60 * 60)  # проверяем каждые 6 часов

# ===== TELEGRAM BOT (единая версия) =====
from aiogram import Bot, Dispatcher, types, F
from aiogram.utils.keyboard import InlineKeyboardBuilder

TG_API = f"https://api.telegram.org/bot{BOT_TOKEN}"
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

# ===== TG helpers (получатели и сохранение сообщений) =====

def get_tg_recipients_for_manager(cur, manager_name: str) -> list[int]:
    """
    Возвращает список tg_id:
        - менеджер (users.role='manager' и first_name=manager_name)
    - его ассистенты (users.role='assistant' и manager_id = id менеджера)
    - админы той же группы (если у менеджера есть group_tag)
    """
    tg_ids: list[int] = []

    # найдём самого менеджера
    mgr = cur.execute(
        "SELECT id, tg_id, group_tag FROM users WHERE role='manager' AND first_name=?",
        (manager_name,)
    ).fetchone()

    group_tag = None
    if mgr:
        if mgr["tg_id"]:
            tg_ids.append(mgr["tg_id"])
        group_tag = mgr["group_tag"]

        # ассистенты этого менеджера
        assistants = cur.execute(
            "SELECT tg_id FROM users WHERE role='assistant' AND manager_id=?",
            (mgr["id"],)
        ).fetchall()
        for a in assistants:
            if a["tg_id"]:
                tg_ids.append(a["tg_id"])

    # админы этой же группы
    if group_tag:
        admins = cur.execute(
            "SELECT tg_id FROM users WHERE role='admin' AND group_tag=?",
            (group_tag,)
        ).fetchall()
        for a in admins:
            if a["tg_id"]:
                tg_ids.append(a["tg_id"])

    # супер-админ (ты) — на всякий случай всегда
    superadmins = cur.execute(
        "SELECT tg_id FROM users WHERE role='superadmin'"
    ).fetchall()
    for sa in superadmins:
        if sa["tg_id"]:
            tg_ids.append(sa["tg_id"])

    # уберём дубли
    return list(dict.fromkeys(tg_ids))


async def send_and_store_tg(cur, protection_id: int, text: str, reply_markup=None):
    """
    Шлёт сообщение всем причастным и сохраняет chat_id/message_id
    """
    # достаём защиту, нам нужен manager
    query = _adapt_query("SELECT manager FROM protections WHERE id=?")
    cur.execute(query, (protection_id,))
    row = cur.fetchone()
    if not row:
        return

    recipients = get_tg_recipients_for_manager(cur, row["manager"])

    for chat_id in recipients:
        try:
            msg = await bot.send_message(
                chat_id,
                text,
                parse_mode="HTML",
                reply_markup=reply_markup
            )
            # сохраняем
            insert_query = _adapt_query("INSERT INTO tg_notifications(protection_id, chat_id, message_id, created_at) VALUES (?,?,?,?)")
            cur.execute(insert_query, (protection_id, chat_id, msg.message_id, now_iso()))
        except Exception as e:
            print(f"⚠️ Ошибка отправки в чат {chat_id}: {e}")
    # транзакцию снаружи закроем



# 📨 Функция отправки уведомления админу
async def notify_admin_new_protection(p: dict):
    """
    p = {
      id, manager, partner, partner_city, sku, area_m2, object_city, address, comment
    }
    """
    pid = p["id"]
    text = (
        "🆕 <b>Новая защита на проверке</b>\n"
        f"👤 Менеджер: {p.get('manager', '—')}\n"
        f"🏢 Партнёр: {p.get('partner', '—')} ({p.get('partner_city', '—')})\n"
        f"📦 SKU: {p.get('sku', '—')}\n"
        f"📏 Площадь: {p.get('area_m2', '—')} м²\n"
        f"📍 Объект: {p.get('object_city', '—')}, {p.get('address', '—')}\n"
        f"💬 Комментарий: {p.get('comment', '—')}\n"
    )

    kb = InlineKeyboardBuilder()
    kb.button(text="✅ Одобрить", callback_data=f"approve:{pid}")
    kb.button(text="🚫 Отклонить", callback_data=f"reject:{pid}")
    kb.adjust(2)

    # открываем коннект тут, потому что мы уже в async
    conn = get_conn()
    cur = conn.cursor()

    # используем общий helper
    await send_and_store_tg(cur, pid, text, reply_markup=kb.as_markup())

    conn.commit()
    conn.close()
    print(f"✅ Уведомление по защите #{pid} отправлено всем ответственным")



        


# === Обработка кнопки "Одобрить" ===
@dp.callback_query(F.data.startswith("approve:"))
async def approve_handler(callback: types.CallbackQuery):
    pid = int(callback.data.split(":")[1])

    conn = get_conn()
    cur = conn.cursor()

    query = _adapt_query("SELECT * FROM protections WHERE id=?")
    cur.execute(query, (pid,))
    row = cur.fetchone()
    if not row:
        await callback.answer("❌ Защита не найдена", show_alert=True)
        conn.close()
        return

    r = dict(row)
    sku_display = r.get("sku") or r.get("comment") or "—"

    # апдейтим саму защиту
    cur.execute(
        "UPDATE protections SET status='active', closed_at=NULL, sku=? WHERE id=?",
        (sku_display, pid),
    )
    add_history(cur, pid, "admin", "approve", {"source": "tg", "sku": sku_display})

    # достаём все связанные tg-сообщения
    query = _adapt_query("SELECT chat_id, message_id FROM tg_notifications WHERE protection_id=?")
    cur.execute(query, (pid,))
    notif_rows = cur.fetchall()

    conn.commit()
    conn.close()

    # текст, который покажем всем
    final_text = (
        f"✅ Защита #{pid} одобрена!\n\n"
        f"👤 Менеджер: {r['manager']}\n"
        f"🏢 Партнёр: {r['partner']} ({r['partner_city']})\n"
        f"📦 SKU: {sku_display}\n"
        f"📏 Площадь: {r['area_m2']} м²"
    )

    # редактируем у всех, кому отправляли
    for n in notif_rows:
        try:
            await bot.edit_message_text(
                chat_id=n["chat_id"],
                message_id=n["message_id"],
                text=final_text,
                parse_mode="HTML",
            )
        except Exception as e:
            print(f"⚠️ Не смог обновить сообщение в чате {n['chat_id']}: {e}")

    await callback.answer("Одобрено ✅")


@dp.callback_query(F.data.startswith("reject:"))
async def reject_handler(callback: types.CallbackQuery):
    pid = int(callback.data.split(":")[1])

    conn = get_conn()
    cur = conn.cursor()

    query = _adapt_query("SELECT * FROM protections WHERE id=?")
    cur.execute(query, (pid,))
    row = cur.fetchone()
    if not row:
        await callback.answer("❌ Защита не найдена", show_alert=True)
        conn.close()
        return

    r = dict(row)

    cur.execute(
        "UPDATE protections SET status='rejected', closed_at=? WHERE id=?",
        (now_iso(), pid),
    )
    add_history(cur, pid, "admin", "reject", {"source": "tg"})

    notif_rows = cur.execute(
        "SELECT chat_id, message_id FROM tg_notifications WHERE protection_id=?",
        (pid,)
    ).fetchall()

    conn.commit()
    conn.close()

    final_text = (
        f"🚫 Защита #{pid} отклонена.\n\n"
        f"👤 Менеджер: {r['manager']}\n"
        f"🏢 Партнёр: {r['partner']} ({r['partner_city']})\n"
        f"📦 SKU: {r.get('sku') or '—'}\n"
        f"📏 Площадь: {r.get('area_m2') or '—'} м²"
    )

    for n in notif_rows:
        try:
            await bot.edit_message_text(
                chat_id=n["chat_id"],
                message_id=n["message_id"],
                text=final_text,
                parse_mode="HTML",
            )
        except Exception as e:
            print(f"⚠️ Не смог обновить сообщение в чате {n['chat_id']}: {e}")

    await callback.answer("Отклонено 🚫")


# === Обработка продления защиты при истечении ===
@dp.callback_query(F.data.startswith("extend:"))
async def extend_expiring_handler(callback: types.CallbackQuery):
    parts = callback.data.split(":")
    pid = int(parts[1])
    days = int(parts[2])
    
    conn = get_conn()
    cur = conn.cursor()
    query = _adapt_query("SELECT * FROM protections WHERE id=?")
    cur.execute(query, (pid,))
    row = cur.fetchone()
    if not row:
        await callback.answer("❌ Защита не найдена", show_alert=True)
        conn.close()
        return
    
    if row["status"] != "active":
        await callback.answer("❌ Защита не активна", show_alert=True)
        conn.close()
        return
    
    from datetime import datetime, timedelta
    new_exp = (datetime.fromisoformat(row["expires_at"].replace("Z", "")) + timedelta(days=days)).isoformat()
    cur.execute("UPDATE protections SET expires_at=? WHERE id=?", (new_exp, pid))
    add_history(cur, pid, "manager", "extend", {"days": days, "source": "tg_expiring"})
    conn.commit()
    conn.close()
    
    await callback.answer(f"✅ Защита продлена на {days} дней")
    await callback.message.edit_text(
        f"✅ <b>Защита #{pid} продлена на {days} дней</b>\n\n"
        f"📦 SKU: {row['sku'] if 'sku' in row.keys() else '—'}\n"
        f"👤 Менеджер: {row['manager']}\n"
        f"⏰ Новая дата истечения: {new_exp[:10]}",
        parse_mode="HTML"
    )


# === Обработка закрытия защиты при истечении ===
@dp.callback_query(F.data.startswith("close_exp:"))
async def close_expiring_handler(callback: types.CallbackQuery):
    pid = int(callback.data.split(":")[1])
    
    conn = get_conn()
    cur = conn.cursor()
    query = _adapt_query("SELECT * FROM protections WHERE id=?")
    cur.execute(query, (pid,))
    row = cur.fetchone()
    if not row:
        await callback.answer("❌ Защита не найдена", show_alert=True)
        conn.close()
        return
    
    cur.execute(
        "UPDATE protections SET status='archived', closed_at=? WHERE id=?",
        (now_iso(), pid)
    )
    add_history(cur, pid, "manager", "close", {"reason": "Истек срок", "source": "tg_expiring"})
    conn.commit()
    conn.close()
    
    await callback.answer("🔒 Защита закрыта")
    await callback.message.edit_text(
        f"🔒 <b>Защита #{pid} закрыта</b>\n\n"
        f"📦 SKU: {row['sku'] if 'sku' in row.keys() else '—'}\n"
        f"👤 Менеджер: {row['manager']}\n"
        f"📅 Дата закрытия: {now_iso()[:10]}",
        parse_mode="HTML"
    )


# === Обработка продления защиты админом ===
@dp.callback_query(F.data.startswith("admin_extend:"))
async def admin_extend_handler(callback: types.CallbackQuery):
    parts = callback.data.split(":")
    pid = int(parts[1])
    days = int(parts[2])
    
    conn = get_conn()
    cur = conn.cursor()
    query = _adapt_query("SELECT * FROM protections WHERE id=?")
    cur.execute(query, (pid,))
    row = cur.fetchone()
    if not row:
        await callback.answer("❌ Защита не найдена", show_alert=True)
        conn.close()
        return
    
    if row["status"] != "active":
        await callback.answer("❌ Защита не активна", show_alert=True)
        conn.close()
        return
    
    from datetime import datetime, timedelta
    new_exp = (datetime.fromisoformat(row["expires_at"].replace("Z", "")) + timedelta(days=days)).isoformat() + "Z"
    cur.execute("UPDATE protections SET expires_at=?, updated_at=? WHERE id=?", (new_exp, now_iso(), pid))
    add_history(cur, pid, "admin", "extend", {"days": days, "source": "tg_request"})
    conn.commit()
    conn.close()
    
    await callback.answer(f"✅ Защита продлена на {days} дней")
    await callback.message.edit_text(
        f"✅ <b>Защита #{pid} продлена на {days} дней</b>\n\n"
        f"📦 SKU: {row['sku'] if 'sku' in row.keys() else '—'}\n"
        f"👤 Менеджер: {row['manager']}\n"
        f"⏰ Новая дата истечения: {new_exp[:10]}",
        parse_mode="HTML"
    )


# === Обработка кастомного продления (выбор количества дней) ===
@dp.callback_query(F.data.startswith("admin_extend_custom:"))
async def admin_extend_custom_handler(callback: types.CallbackQuery):
    """Обработчик для запроса количества дней продления"""
    pid = int(callback.data.split(":")[1])
    
    conn = get_conn()
    cur = conn.cursor()
    query = _adapt_query("SELECT * FROM protections WHERE id=?")
    cur.execute(query, (pid,))
    row = cur.fetchone()
    if not row:
        await callback.answer("❌ Защита не найдена", show_alert=True)
        conn.close()
        return
    conn.close()
    
    # Создаем клавиатуру с вариантами дней
    kb = InlineKeyboardBuilder()
    kb.button(text="7 дней", callback_data=f"admin_extend:{pid}:7")
    kb.button(text="14 дней", callback_data=f"admin_extend:{pid}:14")
    kb.button(text="21 день", callback_data=f"admin_extend:{pid}:21")
    kb.button(text="45 дней", callback_data=f"admin_extend:{pid}:45")
    kb.button(text="60 дней", callback_data=f"admin_extend:{pid}:60")
    kb.button(text="90 дней", callback_data=f"admin_extend:{pid}:90")
    kb.button(text="Отмена", callback_data=f"admin_extend_cancel:{pid}")
    kb.adjust(3, 3, 1)
    
    await callback.answer()
    await callback.message.edit_text(
        f"📅 <b>Выберите количество дней для продления защиты #{pid}</b>\n\n"
        f"📦 SKU: {row['sku'] if 'sku' in row.keys() else '—'}\n"
        f"👤 Менеджер: {row['manager']}\n"
        f"⏰ Текущая дата истечения: {row['expires_at'][:10]}\n\n"
        f"Или выберите из предложенных вариантов:",
        parse_mode="HTML",
        reply_markup=kb.as_markup()
    )

@dp.callback_query(F.data.startswith("admin_extend_cancel:"))
async def admin_extend_cancel_handler(callback: types.CallbackQuery):
    """Отмена выбора количества дней"""
    await callback.answer("Отменено")

# === Обработка отклонения запроса на продление ===
@dp.callback_query(F.data.startswith("admin_reject_extend:"))
async def admin_reject_extend_handler(callback: types.CallbackQuery):
    pid = int(callback.data.split(":")[1])
    
    conn = get_conn()
    cur = conn.cursor()
    query = _adapt_query("SELECT * FROM protections WHERE id=?")
    cur.execute(query, (pid,))
    row = cur.fetchone()
    if not row:
        await callback.answer("❌ Защита не найдена", show_alert=True)
        conn.close()
        return
    
    # Запрашиваем причину отклонения
    await callback.answer()
    await callback.message.edit_text(
        f"🚫 <b>Отклонение запроса на продление защиты #{pid}</b>\n\n"
        f"📦 SKU: {row['sku'] if 'sku' in row.keys() else '—'}\n"
        f"👤 Менеджер: {row['manager']}\n"
        f"⏰ Текущая дата истечения: {row['expires_at'][:10]}\n\n"
        f"💬 <b>Причина отклонения:</b> (укажите в ответе на это сообщение)",
        parse_mode="HTML"
    )
    
    # Сохраняем состояние ожидания причины
    # В реальном приложении можно использовать FSM (Finite State Machine)
    # Для простоты - просто записываем в историю с причиной "не указана"
    add_history(cur, pid, "admin", "extend_reject", {"source": "tg_request", "reason": "не указана"})
    conn.commit()
    conn.close()

@dp.message(F.text & F.reply_to_message)
async def handle_reject_reason(message: types.Message):
    """Обработка причины отклонения из ответа на сообщение"""
    if "Отклонение запроса на продление" not in message.reply_to_message.text:
        return
    
    # Извлекаем ID защиты из текста
    import re
    match = re.search(r'#(\d+)', message.reply_to_message.text)
    if not match:
        return
    
    pid = int(match.group(1))
    reason = message.text.strip()
    
    conn = get_conn()
    cur = conn.cursor()
    query = _adapt_query("SELECT * FROM protections WHERE id=?")
    cur.execute(query, (pid,))
    row = cur.fetchone()
    if not row:
        await message.answer("❌ Защита не найдена")
        conn.close()
        return
    
    add_history(cur, pid, "admin", "extend_reject", {"source": "tg_request", "reason": reason})
    conn.commit()
    conn.close()
    
    await message.answer(
        f"✅ <b>Запрос на продление защиты #{pid} отклонен</b>\n\n"
        f"💬 Причина: {reason}",
        parse_mode="HTML"
    )


from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo

WEBAPP_URL = FRONTEND_URL

@dp.message(F.text == "/start")
async def cmd_start_with_webapp(message: types.Message):
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🚪 Войти в систему", web_app=WebAppInfo(url=WEBAPP_URL))]
        ]
    )

    await message.answer(
        "Привет 👋\n\nЭто Aquafloor Guard — система защиты проектов.\n"
        "Нажми кнопку ниже, чтобы войти в систему:",
        reply_markup=keyboard
    )

# === Команды для управления защитами ===
@dp.message(F.text.startswith("/protections"))
async def cmd_protections(message: types.Message):
    """Список активных защит"""
    try:
        conn = get_conn()
        cur = conn.cursor()
        query = _adapt_query("SELECT id, manager, sku, expires_at, partner, partner_city FROM protections WHERE status='active' ORDER BY expires_at ASC LIMIT 10")
        cur.execute(query)
        rows = cur.fetchall()
        conn.close()
        
        if not rows:
            await message.answer("📋 Активных защит нет")
            return
        
        text = "📋 <b>Активные защиты:</b>\n\n"
        for r in rows:
            pid = r.get("id") if isinstance(r, dict) else r[0]
            manager = r.get("manager", "—") if isinstance(r, dict) else r[1]
            sku = r.get("sku", "—") if isinstance(r, dict) else r[2]
            expires = r.get("expires_at", "—")[:10] if isinstance(r, dict) else (r[3][:10] if len(r) > 3 else "—")
            text += f"🆔 {pid} | {manager}\n📦 {sku}\n⏰ {expires}\n\n"
        
        await message.answer(text, parse_mode="HTML")
    except Exception as e:
        await message.answer(f"❌ Ошибка: {e}")

@dp.message(F.text.startswith("/pending"))
async def cmd_pending(message: types.Message):
    """Список защит на проверке (только для админов)"""
    try:
        # Проверяем, является ли пользователь админом
        tg_id = message.from_user.id
        conn = get_conn()
        cur = conn.cursor()
        query = _adapt_query("SELECT role FROM users WHERE tg_id=?")
        cur.execute(query, (str(tg_id),))
        user = cur.fetchone()
        
        if not user or user.get("role") not in ("admin", "superadmin") if isinstance(user, dict) else user[0] not in ("admin", "superadmin"):
            await message.answer("❌ Доступно только администраторам")
            conn.close()
            return
        
        query = _adapt_query("SELECT id, manager, sku, partner, partner_city, created_at FROM protections WHERE status='pending' ORDER BY created_at DESC LIMIT 10")
        cur.execute(query)
        rows = cur.fetchall()
        conn.close()
        
        if not rows:
            await message.answer("📋 Защит на проверке нет")
            return
        
        text = "⏳ <b>Защиты на проверке:</b>\n\n"
        for r in rows:
            pid = r.get("id") if isinstance(r, dict) else r[0]
            manager = r.get("manager", "—") if isinstance(r, dict) else r[1]
            sku = r.get("sku", "—") if isinstance(r, dict) else r[2]
            partner = r.get("partner", "—") if isinstance(r, dict) else r[3]
            text += f"🆔 {pid} | {manager}\n📦 {sku}\n🏢 {partner}\n\n"
        
        await message.answer(text, parse_mode="HTML")
    except Exception as e:
        await message.answer(f"❌ Ошибка: {e}")

@dp.message(F.text.startswith("/extend"))
async def cmd_extend(message: types.Message):
    """Продлить защиту: /extend <id> <days>"""
    try:
        parts = message.text.split()
        if len(parts) < 3:
            await message.answer("Использование: /extend <id> <days>\nПример: /extend 123 10")
            return
        
        pid = int(parts[1])
        days = int(parts[2])
        
        # Проверяем права пользователя
        tg_id = message.from_user.id
        conn = get_conn()
        cur = conn.cursor()
        query = _adapt_query("SELECT id, role FROM users WHERE tg_id=?")
        cur.execute(query, (str(tg_id),))
        user = cur.fetchone()
        
        if not user:
            await message.answer("❌ Пользователь не найден. Зарегистрируйтесь через веб-приложение.")
            conn.close()
            return
        
        user_id = user.get("id") if isinstance(user, dict) else user[0]
        user_role = user.get("role") if isinstance(user, dict) else user[1]
        
        # Получаем защиту
        query = _adapt_query("SELECT * FROM protections WHERE id=?")
        cur.execute(query, (pid,))
        row = cur.fetchone()
        
        if not row:
            await message.answer(f"❌ Защита #{pid} не найдена")
            conn.close()
            return
        
        # Проверяем права: автор или админ
        protection_manager_id = row.get("manager_id") if isinstance(row, dict) else None
        is_author = user_id == protection_manager_id
        is_admin = user_role in ("admin", "superadmin")
        
        if not is_author and not is_admin:
            await message.answer("❌ Нет прав на продление этой защиты")
            conn.close()
            return
        
        # Продлеваем
        new_exp = add_days(row.get("expires_at") if isinstance(row, dict) else row[12], days)
        extend_count = (row.get("extend_count") or 0) if isinstance(row, dict) else (row[14] or 0)
        new_count = extend_count + (1 if not is_admin else 0)
        
        update_query = _adapt_query("UPDATE protections SET expires_at=?, extend_count=? WHERE id=?")
        cur.execute(update_query, (new_exp, new_count, pid))
        add_history(cur, pid, "admin" if is_admin else "manager", "extend", {"days": days, "source": "tg"})
        conn.commit()
        conn.close()
        
        await message.answer(f"✅ Защита #{pid} продлена на {days} дней\n📅 Новая дата: {new_exp[:10]}")
        
        # Отправляем уведомление админам
        async def notify_admins():
            try:
                admin_conn = get_conn()
                admin_cur = admin_conn.cursor()
                admin_query = _adapt_query("SELECT tg_id FROM users WHERE role IN ('admin', 'superadmin') AND tg_id IS NOT NULL AND tg_id != ''")
                admin_cur.execute(admin_query)
                admins = admin_cur.fetchall()
                admin_conn.close()
                
                manager_name = row.get("manager", "—") if isinstance(row, dict) else row[1]
                sku = row.get("sku", "—") if isinstance(row, dict) else row[4]
                
                msg = (
                    f"🔄 <b>Защита продлена через бота</b>\n\n"
                    f"👤 Менеджер: {manager_name}\n"
                    f"📦 SKU: {sku}\n"
                    f"⏰ Продлено на: {days} дней\n"
                    f"📅 Новая дата: {new_exp[:10]}\n"
                    f"🆔 ID: {pid}"
                )
                
                for admin in admins:
                    admin_tg_id = admin.get("tg_id") if isinstance(admin, dict) else admin[0]
                    if admin_tg_id and str(admin_tg_id) != str(tg_id):
                        try:
                            admin_tg_id_int = int(str(admin_tg_id).replace("tg-", "").replace("dev-", ""))
                            await bot.send_message(admin_tg_id_int, msg, parse_mode="HTML")
                        except:
                            pass
            except:
                pass
        
        asyncio.create_task(notify_admins())
        
    except ValueError:
        await message.answer("❌ Неверный формат. Используйте: /extend <id> <days>")
    except Exception as e:
        await message.answer(f"❌ Ошибка: {e}")

@dp.message(F.text.startswith("/close"))
async def cmd_close(message: types.Message):
    """Закрыть защиту: /close <id> <reason>"""
    try:
        parts = message.text.split(maxsplit=2)
        if len(parts) < 2:
            await message.answer("Использование: /close <id> [причина]\nПример: /close 123 Проект завершен")
            return
        
        pid = int(parts[1])
        reason = parts[2] if len(parts) > 2 else "Закрыто через бота"
        
        # Проверяем права
        tg_id = message.from_user.id
        conn = get_conn()
        cur = conn.cursor()
        query = _adapt_query("SELECT id, role FROM users WHERE tg_id=?")
        cur.execute(query, (str(tg_id),))
        user = cur.fetchone()
        
        if not user:
            await message.answer("❌ Пользователь не найден")
            conn.close()
            return
        
        user_id = user.get("id") if isinstance(user, dict) else user[0]
        user_role = user.get("role") if isinstance(user, dict) else user[1]
        
        query = _adapt_query("SELECT * FROM protections WHERE id=?")
        cur.execute(query, (pid,))
        row = cur.fetchone()
        
        if not row:
            await message.answer(f"❌ Защита #{pid} не найдена")
            conn.close()
            return
        
        protection_manager_id = row.get("manager_id") if isinstance(row, dict) else None
        is_author = user_id == protection_manager_id
        is_admin = user_role in ("admin", "superadmin")
        
        if not is_author and not is_admin:
            await message.answer("❌ Нет прав на закрытие этой защиты")
            conn.close()
            return
        
        update_query = _adapt_query("UPDATE protections SET status='closed', closed_at=? WHERE id=?")
        cur.execute(update_query, (now_iso(), pid))
        add_history(cur, pid, "admin" if is_admin else "manager", "close", {"reason": reason, "source": "tg"})
        conn.commit()
        conn.close()
        
        await message.answer(f"✅ Защита #{pid} закрыта\n📝 Причина: {reason}")
        
    except ValueError:
        await message.answer("❌ Неверный формат. Используйте: /close <id> [причина]")
    except Exception as e:
        await message.answer(f"❌ Ошибка: {e}")

    


# === Запуск Telegram-бота в фоне ===
_bot_running = False

async def start_tg_bot():
    global _bot_running
    if _bot_running:
        print("⚠️ Telegram-бот уже запущен, пропускаем повторный запуск")
        return
    
    _bot_running = True
    print("🤖 Запуск Telegram-бота...")
    
    # Определяем, используем ли мы webhook или polling
    # Для production (на Render) используем webhook, для локальной разработки - polling
    use_webhook = os.getenv("RENDER_SERVICE_URL") or os.getenv("DATABASE_URL")
    
    if use_webhook:
        # Используем webhook для production
        webhook_url = f"{os.getenv('RENDER_SERVICE_URL', 'https://projectguard-prod-7-1.onrender.com')}/api/telegram/webhook"
        print(f"🌐 Используем webhook: {webhook_url}")
        
        try:
            # Устанавливаем webhook
            await bot.set_webhook(
                url=webhook_url,
                allowed_updates=["message", "callback_query"],
                drop_pending_updates=True
            )
            print("✅ Webhook установлен успешно")
            print("🤖 Telegram-бот запущен через webhook (inline кнопки активны)")
        except Exception as e:
            print(f"❌ Ошибка установки webhook: {e}")
            _bot_running = False
            return
    else:
        # Используем polling для локальной разработки
        print("🔄 Используем polling для локальной разработки...")
        
        # Удаляем webhook несколько раз для надежности
        for attempt in range(5):
            try:
                result = await bot.delete_webhook(drop_pending_updates=True)
                if result:
                    print(f"✅ Webhook удален (попытка {attempt + 1})")
                break
            except Exception as e:
                print(f"⚠️ Ошибка удаления webhook (попытка {attempt + 1}): {e}")
                if attempt < 4:
                    await asyncio.sleep(3)
        
        # Ждем перед запуском polling
        await asyncio.sleep(2)
        
        # Запускаем polling с обработкой конфликтов
        max_retries = 3
        retry_delay = 10
        
        for attempt in range(max_retries):
            try:
                print(f"🔄 Попытка запуска polling (попытка {attempt + 1}/{max_retries})...")
                await dp.start_polling(bot, skip_updates=True, allowed_updates=["message", "callback_query"])
                print("✅ Telegram-бот запущен через polling (inline кнопки активны)")
                break
            except Exception as e:
                error_str = str(e).lower()
                if "conflict" in error_str or "terminated by other" in error_str:
                    print(f"⚠️ Конфликт с другим экземпляром бота (попытка {attempt + 1}/{max_retries})")
                    if attempt < max_retries - 1:
                        try:
                            await bot.delete_webhook(drop_pending_updates=True)
                            print(f"⏳ Ждем {retry_delay} секунд перед следующей попыткой...")
                            await asyncio.sleep(retry_delay)
                        except:
                            await asyncio.sleep(retry_delay)
                    else:
                        print("❌ Не удалось запустить бота после всех попыток")
                        _bot_running = False
                        return
                else:
                    print(f"❌ Ошибка запуска Telegram-бота: {e}")
                    _bot_running = False
                    return


# === Webhook endpoint для Telegram ===
@app.post("/api/telegram/webhook")
async def telegram_webhook(request: Request):
    """Endpoint для получения обновлений от Telegram через webhook"""
    try:
        update_data = await request.json()
        from aiogram.types import Update
        update = Update(**update_data)
        await dp.feed_update(bot, update)
        return {"ok": True}
    except Exception as e:
        print(f"⚠️ Ошибка обработки webhook: {e}")
        return {"ok": False, "error": str(e)}

# === Подключаем users API ===
app.include_router(users_router)

# =========================
# 🔔 Telegram уведомления
# =========================

from fastapi import Body
import requests


@app.post("/api/notify")
def notify_user(data: dict):
    import requests

    chat_id = data.get("chat_id") or data.get("tg_id") or data.get("tg_username")
    message = data.get("message") or data.get("text") or ""

    print("📩 Получен запрос на уведомление:", chat_id, message)

    if not chat_id:
        raise HTTPException(status_code=400, detail="chat_id is required")
    if not message:
        raise HTTPException(status_code=400, detail="message is required")

    try:
        res = requests.post(
            f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
            json={
                "chat_id": chat_id,
                "text": message,
                "parse_mode": "HTML",
            },
        )
        print("📨 Telegram ответ:", res.text)
        res.raise_for_status()
        return {"ok": True, "response": res.json()}
    except Exception as e:
        print("❌ Ошибка уведомления:", e)
        raise HTTPException(status_code=400, detail=f"Ошибка уведомления: {e}")

from fastapi import Request

@app.get("/", tags=["root"])
def root():
    return {"ok": True, "message": "🚀 ProjectGuard backend is alive"}

