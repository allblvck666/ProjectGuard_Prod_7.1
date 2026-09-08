from fastapi import FastAPI, HTTPException, Body, BackgroundTasks, Depends, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional, Literal
from datetime import datetime
from pathlib import Path
from jose import jwt, JWTError
import asyncio, sqlite3, json, os, re, hashlib, hmac, secrets, time

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
DEBUG_CONFIG = env_get("DEBUG_CONFIG", "0") == "1"

ALLOW_DEV_LOGIN = env_get("ALLOW_DEV_LOGIN", "0") == "1"
TELEGRAM_WEBHOOK_SECRET = env_get("TELEGRAM_WEBHOOK_SECRET") or hmac.new(
    (BOT_TOKEN or "").encode(), b"projectguard:webhook:v1", hashlib.sha256
).hexdigest()
NOTIFY_TOKEN = env_get("NOTIFY_TOKEN")
TELEGRAM_LOGIN_REQUIRE_INIT_DATA = True  # Signature verification is mandatory.
TELEGRAM_LOGIN_MAX_AGE_SECONDS = int(env_get("TELEGRAM_LOGIN_MAX_AGE_SECONDS", "86400"))

if DEBUG_CONFIG:
    print("DEBUG .env path:", ENV_PATH)
    print("DEBUG env_file keys:", list(env_file.keys()))
    print("DEBUG BOT_TOKEN value exists:", bool(BOT_TOKEN))
    print("DEBUG SECRET_KEY exists:", bool(SECRET_KEY))
    print("DEBUG JWT_SECRET exists:", bool(JWT_SECRET))

if not BOT_TOKEN:
    raise RuntimeError("BOT_TOKEN is not set. Проверь backend/.env или переменные окружения.")

# === Локальные модули ===
from backend.db import (
    get_user_by_id,
    get_conn, init_db, now_iso, add_days, add_workdays, load_skus,
    get_user_by_email, create_user as db_create_user, update_user, get_all_users,
    get_user_by_tg_id, upsert_user, _adapt_query, USE_POSTGRES,
    workdays_until, is_workday
)
from backend.users import router as users_router, init_users_table
from backend.auth import (
    require_admin, require_auth, get_current_user, get_current_active_user,
    get_admin_user, get_superadmin_user, create_access_token
)
from backend.telegram_identity import (
    validate_init_data, validate_widget_data, require_telegram_identity,
    resolve_verified_user, bind_verified_identity, login_response, public_user,
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

def _parse_telegram_init_data(init_data: str) -> dict | None:
    return validate_init_data(init_data, BOT_TOKEN, TELEGRAM_LOGIN_MAX_AGE_SECONDS)

def _validate_telegram_init_data(init_data: str, bot_token: str, max_age_seconds: int) -> bool:
    return validate_init_data(init_data, bot_token, max_age_seconds) is not None

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

_database_ready = False
_bot_ready = False

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
def approve_pending(pid: int, user=Depends(get_admin_user), background_tasks: BackgroundTasks = None):
    conn = get_conn()
    cur = conn.cursor()
    _lock_protections(cur)
    try:
        _refresh_protection_actor(cur, user, admin=True)
    except HTTPException:
        conn.close()
        raise
    query = _adapt_query("SELECT * FROM protections WHERE id=? AND status='pending'")
    cur.execute(query, (pid,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Защита не найдена или уже обработана")

    update_query = _adapt_query("UPDATE protections SET status='active', approved_by_admin=1, expires_at=?, updated_at=? WHERE id=?")
    area = float(row.get("area_m2") or 0)
    ttl = 5 if area < 100 else 10 if area < 250 else 15 if area < 500 else 30
    cur.execute(update_query, (add_workdays(now_iso(), ttl), _protection_stamp(), pid))
    add_history(cur, pid, str(user["id"]), "approve", {"approved": True, "source": "app"})
    
    # Обновляем сообщения в Telegram
    notif_query = _adapt_query("SELECT chat_id, message_id FROM tg_notifications WHERE protection_id=?")
    cur.execute(notif_query, (pid,))
    notif_rows = cur.fetchall()
    
    # Отправляем уведомление менеджеру
    manager_name = row.get("manager", "")
    manager_id = row.get("manager_id") if "manager_id" in row.keys() else None
    
    conn.commit()
    conn.close()
    
    # Обновляем сообщения в Telegram асинхронно через BackgroundTasks
    async def update_telegram_messages():
        r = dict(row)
        sku_display = r.get("sku") or r.get("comment") or "—"
        final_text = (
            f"✅ Защита #{pid} одобрена!\n\n"
            f"👤 Менеджер: {r.get('manager', '—')}\n"
            f"🏢 Партнёр: {r.get('partner', '—')} ({r.get('partner_city', '—')})\n"
            f"📦 SKU: {sku_display}\n"
            f"📏 Площадь: {r.get('area_m2', '—')} м²"
        )
        # Обновляем исходные сообщения и дополнительно шлём "событие" в те же чаты (общий чат тоже здесь)
        sent_to: set[str] = set()
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

            try:
                chat_id = n["chat_id"]
                chat_key = str(chat_id)
                if chat_key not in sent_to:
                    sent_to.add(chat_key)
                    await bot.send_message(
                        chat_id=chat_id,
                        text=f"✅ <b>Защита #{pid} одобрена администратором</b>",
                        parse_mode="HTML",
                    )
            except Exception as e:
                print(f"⚠️ Не смог отправить уведомление в чат {n.get('chat_id')}: {e}")
        
        # Отправляем уведомление менеджеру
        if manager_name:
            try:
                conn2 = get_conn()
                cur2 = conn2.cursor()
                # Ищем менеджера по имени или manager_id
                if manager_id:
                    manager_query = _adapt_query("SELECT tg_id, full_name, first_name FROM users WHERE id=? OR full_name=? OR first_name=? LIMIT 1")
                    cur2.execute(manager_query, (manager_id, manager_name, manager_name))
                else:
                    manager_query = _adapt_query("SELECT tg_id, full_name, first_name FROM users WHERE full_name=? OR first_name=? LIMIT 1")
                    cur2.execute(manager_query, (manager_name, manager_name))
                manager_user = cur2.fetchone()
                conn2.close()
                
                if manager_user and manager_user.get("tg_id"):
                    tg_id = manager_user.get("tg_id")
                    from backend.db import normalize_tg_id
                    tg_id_clean = normalize_tg_id(tg_id)
                    
                    if tg_id_clean and tg_id_clean.isdigit():
                        try:
                            msg = (
                                f"✅ <b>Защита одобрена</b>\n\n"
                                f"Защита: <b>#{pid}</b>\n"
                                f"📦 SKU: {sku_display}\n"
                                f"⏰ Дата истечения: {r.get('expires_at', '')[:10] if r.get('expires_at') else '—'}"
                            )
                            await bot.send_message(
                                chat_id=int(tg_id_clean),
                                text=msg,
                                parse_mode="HTML"
                            )
                            print(f"✅ Уведомление об одобрении отправлено менеджеру {tg_id_clean}")
                        except Exception as e:
                            print(f"⚠️ Не удалось отправить уведомление менеджеру: {e}")
            except Exception as e:
                print(f"⚠️ Ошибка при отправке уведомления менеджеру: {e}")
    
    if background_tasks:
        background_tasks.add_task(update_telegram_messages)
    else:
        # Fallback: пытаемся запустить через asyncio, если BackgroundTasks недоступен
        try:
            import asyncio
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(update_telegram_messages())
            else:
                loop.run_until_complete(update_telegram_messages())
        except Exception as e:
            print(f"⚠️ Ошибка при обновлении сообщений в Telegram: {e}")
    
    return {"ok": True}


@app.post("/api/admin/pending/{pid}/reject")
def reject_pending(pid: int, payload: dict, user=Depends(get_admin_user), background_tasks: BackgroundTasks = None):
    reason = payload.get("reason", "").strip() or "Отклонено администратором"
    conn = get_conn()
    cur = conn.cursor()
    _lock_protections(cur)
    try:
        _refresh_protection_actor(cur, user, admin=True)
    except HTTPException:
        conn.close()
        raise
    query = _adapt_query("SELECT * FROM protections WHERE id=? AND status='pending'")
    cur.execute(query, (pid,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Защита не найдена или уже обработана")

    update_query = _adapt_query("UPDATE protections SET status='rejected', closed_at=?, admin_comment=?, updated_at=? WHERE id=?")
    cur.execute(update_query, (now_iso(), reason, _protection_stamp(), pid))
    add_history(cur, pid, str(user["id"]), "reject", {"reason": reason, "source": "app"})
    
    # Обновляем сообщения в Telegram
    notif_query = _adapt_query("SELECT chat_id, message_id FROM tg_notifications WHERE protection_id=?")
    cur.execute(notif_query, (pid,))
    notif_rows = cur.fetchall()
    
    # Отправляем уведомление менеджеру
    manager_name = row.get("manager", "")
    manager_id = row.get("manager_id") if "manager_id" in row.keys() else None
    
    conn.commit()
    conn.close()
    
    # Обновляем сообщения в Telegram асинхронно через BackgroundTasks
    async def update_telegram_messages():
        r = dict(row)
        final_text = (
            f"🚫 Защита #{pid} отклонена.\n\n"
            f"👤 Менеджер: {r.get('manager', '—')}\n"
            f"🏢 Партнёр: {r.get('partner', '—')} ({r.get('partner_city', '—')})\n"
            f"📦 SKU: {r.get('sku', '—')}\n"
            f"📏 Площадь: {r.get('area_m2', '—')} м²\n\n"
            f"💬 Причина: {reason}"
        )
        # Обновляем исходные сообщения и дополнительно шлём "событие" в те же чаты (общий чат тоже здесь)
        sent_to: set[str] = set()
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

            try:
                chat_id = n["chat_id"]
                chat_key = str(chat_id)
                if chat_key not in sent_to:
                    sent_to.add(chat_key)
                    await bot.send_message(
                        chat_id=chat_id,
                        text=f"🚫 <b>Защита #{pid} отклонена администратором</b>\nПричина: {reason}",
                        parse_mode="HTML",
                    )
            except Exception as e:
                print(f"⚠️ Не смог отправить уведомление в чат {n.get('chat_id')}: {e}")
        
        # Отправляем уведомление менеджеру
        if manager_name:
            try:
                conn2 = get_conn()
                cur2 = conn2.cursor()
                # Ищем менеджера по имени или manager_id
                if manager_id:
                    manager_query = _adapt_query("SELECT tg_id, full_name, first_name FROM users WHERE id=? OR full_name=? OR first_name=? LIMIT 1")
                    cur2.execute(manager_query, (manager_id, manager_name, manager_name))
                else:
                    manager_query = _adapt_query("SELECT tg_id, full_name, first_name FROM users WHERE full_name=? OR first_name=? LIMIT 1")
                    cur2.execute(manager_query, (manager_name, manager_name))
                manager_user = cur2.fetchone()
                conn2.close()
                
                if manager_user and manager_user.get("tg_id"):
                    tg_id = manager_user.get("tg_id")
                    from backend.db import normalize_tg_id
                    tg_id_clean = normalize_tg_id(tg_id)
                    
                    if tg_id_clean and tg_id_clean.isdigit():
                        try:
                            msg = (
                                f"🚫 <b>Защита отклонена</b>\n\n"
                                f"Защита: <b>#{pid}</b>\n"
                                f"📦 SKU: {r.get('sku', '—')}\n"
                                f"💬 Причина: {reason}"
                            )
                            await bot.send_message(
                                chat_id=int(tg_id_clean),
                                text=msg,
                                parse_mode="HTML"
                            )
                            print(f"✅ Уведомление об отклонении отправлено менеджеру {tg_id_clean}")
                        except Exception as e:
                            print(f"⚠️ Не удалось отправить уведомление менеджеру: {e}")
            except Exception as e:
                print(f"⚠️ Ошибка при отправке уведомления менеджеру: {e}")
    
    if background_tasks:
        background_tasks.add_task(update_telegram_messages)
    else:
        # Fallback: пытаемся запустить через asyncio, если BackgroundTasks недоступен
        try:
            import asyncio
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(update_telegram_messages())
            else:
                loop.run_until_complete(update_telegram_messages())
        except Exception as e:
            print(f"⚠️ Ошибка при обновлении сообщений в Telegram: {e}")
    
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
    creator_name: Optional[str] = None  # Имя создателя защиты (full_name из users)
    close_reason: Optional[str] = None  # Причина закрытия из истории
    success_doc: Optional[str] = None  # Документ 1С из истории
    delete_reason: Optional[str] = None  # Причина удаления из истории
    action_actor: Optional[str] = None  # Кто выполнил действие (close/success/delete)
    action_at: Optional[str] = None  # Когда было выполнено действие
    updated_at: Optional[str] = None
    auto_closed: bool = False
    can_edit: bool = False
    can_restore: bool = False
    restore_requires_admin: bool = False

class ProtectionUpdate(BaseModel):
    sku: Optional[str] = None
    sku_data: Optional[List[SkuItem]] = None
    area_m2: Optional[float] = None
    manager: Optional[str] = None
    client: Optional[str] = None
    partner: Optional[str] = None
    partner_city: Optional[str] = None
    last4: Optional[str] = None
    object_city: Optional[str] = None
    address: Optional[str] = None
    comment: Optional[str] = None
    expires_at: Optional[str] = None
    close_reason: Optional[str] = None
    success_doc: Optional[str] = None
    expected_updated_at: Optional[str] = None

    model_config = {"extra": "forbid"}


# Флаг для отслеживания инициализации
_initialized = False

async def _init_background():
    """Инициализация в фоне после запуска приложения"""
    global _initialized, _database_ready
    if _initialized:
        return
    _initialized = True

    # Выполняем синхронные операции в отдельном потоке
    def init_sync():
        global _database_ready
        try:
            init_db()
            init_users_table()
            _safe_migrate()
            _database_ready = True
            print("✅ База данных инициализирована")
        except Exception as e:
            _database_ready = False
            raise

    try:
        await asyncio.to_thread(init_sync)
    except Exception:
        _initialized = False
        print("Database initialization failed; service is not ready")
        return

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



def row_to_out(row, history_data: dict = None, user: dict = None, capabilities: dict = None) -> ProtectionOut:
    expires = datetime.fromisoformat(row["expires_at"].replace("Z", ""))
    # Важно: сроки защит считаем в рабочих днях (официальные выходные/праздники не уменьшают счётчик).
    days_left = workdays_until(row["expires_at"], datetime.utcnow())
    warn2d = row["status"] == "active" and 0 <= days_left <= 2
    warn_text = "⏰ Через 2 дня истекает — напомни менеджеру." if warn2d else None
    # Проверяем наличие manager_id в строке (для совместимости с SQLite и PostgreSQL)
    manager_id = row["manager_id"] if "manager_id" in row.keys() else None
    
    history_data = history_data or {}
    
    # Получаем имя создателя защиты из history_data (если передано) или делаем запрос
    creator_name = history_data.get("creator_name")
    if not creator_name and manager_id:
        try:
            conn = get_conn()
            cur = conn.cursor()
            creator_query = _adapt_query("SELECT full_name, first_name FROM users WHERE id=?")
            cur.execute(creator_query, (manager_id,))
            creator_row = cur.fetchone()
            conn.close()
            if creator_row:
                creator_name = creator_row.get("full_name") or creator_row.get("first_name") or None
        except Exception as e:
            print(f"⚠️ Ошибка получения имени создателя защиты: {e}")
    
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
        creator_name=creator_name,  # Имя создателя защиты (full_name из users)
        close_reason=history_data.get("close_reason"),
        success_doc=history_data.get("success_doc"),
        delete_reason=history_data.get("delete_reason"),
        action_actor=history_data.get("action_actor"),  # Кто выполнил действие
        action_at=history_data.get("action_at"),  # Когда было выполнено действие
        updated_at=row.get("updated_at") or row.get("created_at"),
        auto_closed=bool(row.get("auto_closed")),
        **(capabilities if capabilities is not None else _protection_capabilities(row, user)),
    )

def normalize_sku(raw: str) -> str:
    s = (raw or "").strip().upper()
    # Убираем пометки в скобках типа "(клей)/(замок)" и т.п., чтобы не смешивать реальные коды
    s = re.sub(r"\([^)]*\)", "", s)
    # Убираем пробелы/табуляции, но оставляем буквенно-цифровой код и разделители
    s = re.sub(r"\s+", "", s)
    return s

def add_history(cur, protection_id: int, actor: str, action: str, payload: dict):
    query = _adapt_query("INSERT INTO history(protection_id, at, actor, action, payload) VALUES (?,?,?,?,?)")
    cur.execute(
        query,
        (protection_id, now_iso(), actor, action, json.dumps(payload, ensure_ascii=False)),
    )

from contextlib import contextmanager
from backend.protection_rules import material_values, materials_conflict, can_manage, sku_pairs


@contextmanager
def _protection_transaction():
    conn = get_conn()
    try:
        cur = conn.cursor()
        _lock_protections(cur)
        yield conn, cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _lock_protections(cur):
    # The lock serializes conflict checks and activation across processes.
    if USE_POSTGRES:
        cur.execute("SELECT pg_advisory_xact_lock(71920260908)")
    else:
        cur.execute("BEGIN IMMEDIATE")


def _protection_stamp():
    return datetime.utcnow().isoformat(timespec="microseconds") + "Z"


def _get_protection(cur, pid):
    cur.execute(_adapt_query("SELECT * FROM protections WHERE id=?"), (pid,))
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Защита не найдена")
    return dict(row)


def _can_manage_protection(cur, row, user):
    dictionary_id = None
    if user.get("role") == "assistant":
        cur.execute(_adapt_query("SELECT id FROM managers WHERE name=?"), (row.get("manager"),))
        manager_row = cur.fetchone()
        dictionary_id = manager_row["id"] if manager_row else None
    return can_manage(user, row, dictionary_id)


def _refresh_protection_actor(cur, user, admin=False):
    cur.execute(_adapt_query("SELECT * FROM users WHERE id=?"), (user.get("id"),))
    current = cur.fetchone()
    if not current or current.get("is_active") in (False, 0, "0"):
        raise HTTPException(status_code=403, detail="Нет доступа к приложению")
    if admin and current.get("role") not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Действие доступно только администратору")
    user.update(dict(current))
    return user


def _require_protection_access(cur, row, user):
    _refresh_protection_actor(cur, user)
    if not _can_manage_protection(cur, row, user):
        raise HTTPException(status_code=403, detail="Изменять защиту может её автор, назначенный ассистент или администратор")


def _protection_capabilities(row, user):
    permissions = {"can_edit": False, "can_restore": False, "restore_requires_admin": False}
    if not user:
        return permissions
    if user.get("role") == "assistant":
        conn = get_conn()
        try:
            allowed = _can_manage_protection(conn.cursor(), dict(row), user)
        finally:
            conn.close()
    else:
        allowed = can_manage(user, dict(row))
    return _capabilities_for(row, user, allowed)


def _capabilities_for(row, user, allowed):
    permissions = {"can_edit": False, "can_restore": False, "restore_requires_admin": False}
    role = user.get("role")
    auto_expired = row.get("status") == "closed" and bool(row.get("auto_closed"))
    archive = row.get("status") in ("closed", "deleted", "success", "rejected")
    permissions["can_edit"] = allowed and (row.get("status") in ("active", "closed", "success", "rejected") or (role == "superadmin" and archive))
    permissions["restore_requires_admin"] = bool(allowed and auto_expired and role not in ("admin", "superadmin") and (row.get("extend_count") or 0) >= 2)
    permissions["can_restore"] = bool((role == "superadmin" and archive) or (allowed and auto_expired and not permissions["restore_requires_admin"]))
    return permissions


def _validate_protection_contacts(data):
    if not str(data.get("manager") or "").strip():
        raise HTTPException(status_code=400, detail="Укажите менеджера")
    last4 = str(data.get("last4") or "").strip()
    if last4 and not re.fullmatch(r"[0-9]{4}", last4):
        raise HTTPException(status_code=400, detail="Укажите последние 4 цифры телефона")


def _material_values(data, validate_limits=True):
    try:
        return material_values(data, validate_limits=validate_limits)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _conflicts(cur, display, total, exclude_id=None):
    cur.execute("SELECT * FROM protections WHERE status='active'")
    return [dict(row) for row in cur.fetchall()
            if row["id"] != exclude_id and materials_conflict(display, total, row["sku"], row["area_m2"])]


def _require_no_conflict(cur, display, total, exclude_id=None):
    conflicts = _conflicts(cur, display, total, exclude_id)
    if conflicts:
        row = conflicts[0]
        raise HTTPException(status_code=409, detail={
            "msg": "Похожая активная защита уже существует. Обратитесь к администратору.",
            "similar_protection": row,
        })


def _require_extension_days(days, user):
    if user.get("role") in ("admin", "superadmin"):
        if not 1 <= days <= 365:
            raise HTTPException(status_code=400, detail="Укажите срок от 1 до 365 рабочих дней")
    elif days not in (10, 30):
        raise HTTPException(status_code=400, detail="Доступно продление на 10 или 30 рабочих дней")


def _archive_metadata(cur, pid):
    cur.execute(_adapt_query("SELECT action, payload FROM history WHERE protection_id=? ORDER BY at DESC, id DESC"), (pid,))
    return _history_metadata(cur.fetchall())


def _history_metadata(entries):
    metadata = {}
    for entry in entries:
        data = json.loads(entry["payload"] or "{}")
        if entry["action"] == "edit":
            data = data.get("after", {})
        if "success_doc" in data:
            metadata.setdefault("success_doc", data["success_doc"])
        if "doc_1c" in data:
            metadata.setdefault("success_doc", data["doc_1c"])
        if "close_reason" in data:
            metadata.setdefault("close_reason", data["close_reason"])
        if entry["action"] == "close" and "reason" in data:
            metadata.setdefault("close_reason", data["reason"])
    return metadata


# ===== Basic =====
@app.get("/api/skus")
def get_skus():
    return SKUS

@app.get("/api/ping")
def ping():
    return {"ok": True, "time": now_iso(), "version": "2026.09.08", "commit": os.getenv("RENDER_GIT_COMMIT")}

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
    return validate_widget_data(data, BOT_TOKEN, TELEGRAM_LOGIN_MAX_AGE_SECONDS) is not None

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
    tg_id: Optional[str] = None  # Опциональное, получается через код или init_data
    full_name: str
    phone: str
    position: Optional[str] = None  # Должность
    verification_code: Optional[str] = None  # Код для получения tg_id
    init_data: Optional[str] = None  # Telegram WebApp initData для парсинга tg_id

class RequestVerificationCode(BaseModel):
    """Запрос одноразового кода для получения Telegram ID"""
    full_name: str
    phone: str

class VerifyCode(BaseModel):
    """Верификация кода и получение tg_id"""
    phone: str
    code: str


class UserLogin(BaseModel):
    # Поддержка разных форматов входа
    email: Optional[str] = None
    password: Optional[str] = None
    # Telegram данные
    telegram_id: Optional[int] = None
    init_data: Optional[str] = None
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
    receive_notifications: Optional[int] = None
    manager_ids: Optional[str] = None  # JSON массив ID менеджеров


@app.get("/api/auth/verify")
async def verify_token(user=Depends(require_auth)):
    """Проверка валидности токена"""
    return {"ok": True, "user_id": user["id"], "role": user["role"]}


@app.get("/api/auth/me")
async def get_me(user=Depends(get_current_active_user)):
    return {"ok": True, "user": public_user(user)}


# === Эндпоинты для верификации через Telegram ===
@app.post("/api/auth/request-verification-code")
async def request_verification_code(data: RequestVerificationCode):
    raise HTTPException(410, "Вход по коду заменён подтверждённым входом через Telegram. Откройте приложение кнопкой в боте.")


@app.post("/api/auth/verify-code")
async def verify_code(data: VerifyCode):
    raise HTTPException(410, "Вход по коду заменён подтверждённым входом через Telegram. Откройте приложение кнопкой в боте.")


def parse_telegram_init_data(init_data: str) -> Optional[str]:
    identity = validate_init_data(init_data, BOT_TOKEN, TELEGRAM_LOGIN_MAX_AGE_SECONDS)
    return str(identity["id"]) if identity else None

@app.post("/api/admin/clear-all-users")
def admin_clear_all_users(admin_user=Depends(get_superadmin_user)):
    """
    Очистить всех пользователей (только для superadmin).
    Удаляет всех пользователей, кроме текущего суперадмина.
    """
    conn = get_conn()
    cur = conn.cursor()
    
    # Удаляем всех пользователей, кроме текущего суперадмина
    delete_query = _adapt_query("DELETE FROM users WHERE id != ?")
    cur.execute(delete_query, (admin_user["id"],))
    deleted_count = cur.rowcount
    conn.commit()
    conn.close()
    
    return {"ok": True, "message": f"Удалено {deleted_count} пользователей. Все должны зарегистрироваться заново."}


@app.post("/api/auth/register_or_login")
async def register_or_login(data: RegisterOrLogin):
    identity = require_telegram_identity(data.model_dump(), BOT_TOKEN, TELEGRAM_LOGIN_MAX_AGE_SECONDS)
    if not data.full_name.strip() or not data.phone.strip():
        raise HTTPException(400, "Заполните имя и телефон")
    profile = {"full_name": data.full_name.strip(), "phone": re.sub(r"\D", "", data.phone),
               "position": data.position}
    return login_response(resolve_verified_user(identity, profile))


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
    
    if len(data.password.encode("utf-8")) > 72:
        raise HTTPException(400, "Пароль слишком длинный: максимум 72 байта UTF-8")

    # Проверка существования email
    existing = get_user_by_email(data.email)
    if existing:
        raise HTTPException(status_code=400, detail="User with this email already exists")
    
    # Создание пользователя
    try:
        user = db_create_user({
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
    if data.init_data:
        identity = require_telegram_identity(data.model_dump(), BOT_TOKEN, TELEGRAM_LOGIN_MAX_AGE_SECONDS)
        return login_response(resolve_verified_user(identity))
    if not data.email or not data.password:
        raise HTTPException(401, "Подтвердите вход через Telegram или используйте email и пароль.")
    user = get_user_by_email(data.email)
    try:
        valid = user and user.get("password_hash") and verify_password(data.password, user["password_hash"])
    except (ValueError, TypeError):
        valid = False
    if not valid:
        raise HTTPException(401, "Неверный email или пароль")
    if user.get("is_active", 1) in (0, "0", False):
        raise HTTPException(403, "Ваш аккаунт заблокирован. Обратитесь к администратору.")
    user = update_user(user["id"], {"last_login": now_iso()})
    return login_response(user)


@app.post("/api/auth/telegram")
async def telegram_auth(request: Request):
    data = await request.json()
    identity = require_telegram_identity(data, BOT_TOKEN, TELEGRAM_LOGIN_MAX_AGE_SECONDS, allow_widget=True)
    return login_response(resolve_verified_user(identity))


# ===== Обновление tg_id текущего пользователя =====
@app.post("/api/auth/update-tg-id")
def update_my_tg_id(data: dict = Body(...), user=Depends(get_current_user)):
    identity = require_telegram_identity(data, BOT_TOKEN, TELEGRAM_LOGIN_MAX_AGE_SECONDS)
    return bind_verified_identity(user, identity)


# ===== DEV-авторизация без проверки Telegram =====
@app.post("/api/auth/dev-login")
def dev_login(payload: dict, request: Request):
    # Development authentication must never be reachable on Render.
    if not ALLOW_DEV_LOGIN or os.getenv("RENDER") or not request.client or request.client.host not in ("127.0.0.1", "::1", "testclient"):
        raise HTTPException(404, "Not found")
    try:
        tg_id = int(payload.get("tg_id") or payload.get("id") or 0)
        if tg_id <= 0:
            raise ValueError()
    except (TypeError, ValueError):
        raise HTTPException(400, "Invalid Telegram ID")
    user = resolve_verified_user({"id": tg_id, "username": payload.get("username", ""),
                                  "first_name": payload.get("first_name", "DevUser")})
    return login_response(user)



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
    from backend.account_admin import change_account
    updated = change_account(admin_user["id"], user_id, data.model_dump(exclude_unset=True))
    return {"ok": True, "user": public_user(updated)}


@app.delete("/api/admin/users/{user_id}")
def admin_delete_user(user_id: int, hard_delete: bool = False, admin_user=Depends(get_admin_user)):
    from backend.account_admin import change_account
    change_account(admin_user["id"], user_id, delete=True, hard_delete=hard_delete)
    return {"ok": True, "message": "Пользователь удалён" if hard_delete else "Доступ отключён, профиль и история сохранены"}


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
    identity = require_telegram_identity(data, BOT_TOKEN, TELEGRAM_LOGIN_MAX_AGE_SECONDS)
    return login_response(resolve_verified_user(identity))


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
    query = _adapt_query("SELECT * FROM managers WHERE id=?")
    cur.execute(query, (mid,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Manager not found")
    old_name = row["name"]
    exists_query = _adapt_query("SELECT 1 FROM managers WHERE name=? AND id<>?")
    cur.execute(exists_query, (new_name, mid))
    exists = cur.fetchone()
    if exists:
        conn.close()
        raise HTTPException(status_code=409, detail="Менеджер с таким именем уже существует")
    update_query1 = _adapt_query("UPDATE managers SET name=? WHERE id=?")
    cur.execute(update_query1, (new_name, mid))
    update_query2 = _adapt_query("UPDATE protections SET manager=? WHERE manager=?")
    cur.execute(update_query2, (new_name, old_name))
    conn.commit()
    conn.close()
    return {"ok": True}

@app.delete("/api/admin/managers/{mid}")
def admin_delete_manager(mid: int, transfer_to: Optional[int] = None, hard_delete: bool = False, user=Depends(get_admin_user)):
    """
    Удаление менеджера.
    hard_delete=True: полностью удаляет менеджера и все связанные защиты (историю).
    hard_delete=False: удаляет менеджера, переводя защиты на другого менеджера (если указан transfer_to).
    """
    conn = get_conn()
    cur = conn.cursor()
    query = _adapt_query("SELECT * FROM managers WHERE id=?")
    cur.execute(query, (mid,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Manager not found")
    name = row["name"]
    count_query = _adapt_query("SELECT COUNT(*) AS c FROM protections WHERE manager=?")
    cur.execute(count_query, (name,))
    cnt_result = cur.fetchone()
    cnt = cnt_result["c"] if cnt_result else 0
    
    if hard_delete:
        # Полное удаление: удаляем менеджера и все связанные защиты с историей
        if cnt > 0:
            # Получаем все ID защит этого менеджера
            protections_query = _adapt_query("SELECT id FROM protections WHERE manager=?")
            cur.execute(protections_query, (name,))
            protection_ids = [r["id"] for r in cur.fetchall()]
            
            # Удаляем записи из tg_notifications для всех защит (ПЕРЕД удалением защит)
            if protection_ids:
                placeholders = ",".join(["?"] * len(protection_ids))
                tg_notifications_delete_query = _adapt_query(f"DELETE FROM tg_notifications WHERE protection_id IN ({placeholders})")
                cur.execute(tg_notifications_delete_query, protection_ids)
            
            # Удаляем историю для всех защит
            if protection_ids:
                placeholders = ",".join(["?"] * len(protection_ids))
                history_delete_query = _adapt_query(f"DELETE FROM history WHERE protection_id IN ({placeholders})")
                cur.execute(history_delete_query, protection_ids)
            
            # Удаляем все защиты этого менеджера
            protections_delete_query = _adapt_query("DELETE FROM protections WHERE manager=?")
            cur.execute(protections_delete_query, (name,))
    else:
        # Мягкое удаление: переводим защиты на другого менеджера.
        # Раньше эта ветка была вложена в if hard_delete и никогда не
        # выполнялась — менеджер удалялся, а его защиты оставались
        # привязанными к исчезнувшему имени.
        if cnt > 0:
            if not transfer_to:
                conn.close()
                raise HTTPException(status_code=400, detail="Нужно выбрать менеджера для перевода всех защит")
            query_to = _adapt_query("SELECT * FROM managers WHERE id=?")
            cur.execute(query_to, (transfer_to,))
            row_to = cur.fetchone()
            if not row_to:
                conn.close()
                raise HTTPException(status_code=404, detail="transfer_to manager not found")
            new_name = row_to["name"]
            update_query = _adapt_query("UPDATE protections SET manager=? WHERE manager=?")
            cur.execute(update_query, (new_name, name))
    
    # Удаляем менеджера
    delete_query = _adapt_query("DELETE FROM managers WHERE id=?")
    cur.execute(delete_query, (mid,))
    conn.commit()
    conn.close()
    return {"ok": True, "message": "Менеджер полностью удален" if hard_delete else "Менеджер удален"}


# === PATCH: обновление имени и Telegram-списка ===


# === Добавление пользователя (админка) ===
@app.post("/api/users/")
def admin_create_user(user: dict, admin_user=Depends(get_admin_user)):
    from backend.users import add_user, UserCreate
    from pydantic import ValidationError
    try:
        validated = UserCreate(**user)
    except ValidationError:
        raise HTTPException(422, "Некорректные данные пользователя") from None
    return add_user(validated, admin_user)


@app.get("/api/managers")
def public_managers(user=Depends(get_current_active_user)):
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
def get_user_managers(user=Depends(get_current_active_user)):
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT id, first_name AS name FROM users WHERE role='manager' ORDER BY LOWER(first_name)")
        return [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()

# ===== Проверка дублирующих защит =====
@app.post("/api/protections/check-duplicate")
def check_duplicate(data: dict, user=Depends(get_current_active_user)):
    display, total = _material_values(data)
    conn = get_conn()
    try:
        exclude_id = data.get("exclude_id")
        if exclude_id is not None:
            try:
                exclude_id = int(exclude_id)
            except (ValueError, TypeError):
                raise HTTPException(status_code=400, detail="Некорректный номер защиты")
        return _conflicts(conn.cursor(), display, total, exclude_id)
    finally:
        conn.close()

# === Утилита для сопоставления user_id с manager_id ===
def resolve_manager_for_user(cur, user_id):
    if not user_id:
        return None
    cur.execute(_adapt_query("SELECT id FROM users WHERE id=?"), (user_id,))
    row = cur.fetchone()
    return row["id"] if row else None

# ===== Создание защиты =====
@app.post("/api/protections", response_model=ProtectionOut)
def create_protection(payload: ProtectionCreate, user=Depends(get_current_active_user), background_tasks: BackgroundTasks = None):
    with _protection_transaction() as (conn, cur):
        _refresh_protection_actor(cur, user)
        created = now_iso()
        current_user_id = user["id"]
        sku_display, total_area = _material_values(payload.model_dump())
        _validate_protection_contacts(payload.model_dump())
        for row in _conflicts(cur, sku_display, total_area):
            # Получаем информацию о создателе защиты
            # Инициализируем переменную до использования
            creator_name = "—"
            manager_id = row.get("manager_id") if "manager_id" in row.keys() else None
            if manager_id:
                try:
                    creator_query = _adapt_query("SELECT full_name, first_name FROM users WHERE id=?")
                    cur.execute(creator_query, (manager_id,))
                    creator_row = cur.fetchone()
                    if creator_row:
                        creator_name = creator_row.get("full_name") or creator_row.get("first_name") or "—"
                except Exception as e:
                    print(f"⚠️ Ошибка получения имени создателя защиты: {e}")
                    creator_name = "—"

            # Отправляем уведомление всем админам и суперадминам о похожей защите (только тем, у кого включены уведомления)
            admin_query = _adapt_query("""
            SELECT tg_id, full_name, first_name
            FROM users
            WHERE role IN ('admin', 'superadmin')
              AND tg_id IS NOT NULL
              AND tg_id != ''
                  AND (receive_notifications IS NULL OR receive_notifications = 1)
                """)
            cur.execute(admin_query)
            admins = cur.fetchall()

            duplicate_msg = (
                f"⚠️ <b>Попытка создать похожую защиту</b>\n\n"
                f"<b>Существующая защита:</b>\n"
                f"👤 Менеджер: {row['manager']}\n"
                f"👤 Создатель: {creator_name}\n"
                f"🏢 Партнёр: {row['partner'] or '—'}\n"
                f"❗️Артикул: {row['sku']}\n"
                f"📏 Метраж: {int(row['area_m2']) if float(row['area_m2']).is_integer() else row['area_m2']} м²\n"
                f"⏰ Истекает: {row['expires_at'][:10]}\n\n"
                f"<b>Попытка создать:</b>\n"
                f"👤 Пользователь: {payload.manager or '—'}\n"
                f"📦 SKU: {sku_display}\n"
                f"📏 Метраж: {int(total_area) if total_area.is_integer() else total_area} м²\n\n"
                f"💬 Пользователь должен обратиться к менеджеру или попросить администратора/суперадмина пропустить эту защиту."
            )

            # Формируем полную информацию о похожей защите для передачи в модальное окно
            similar_protection_data = {
                    "id": row.get("id"),
                    "manager": row.get("manager", "—"),
                    "creator_name": creator_name,
                    "partner": row.get("partner", "—"),
                    "partner_city": row.get("partner_city", "—"),
                    "client": row.get("client", "—"),
                    "sku": row.get("sku", "—"),
                    "area_m2": row.get("area_m2"),
                    "expires_at": row.get("expires_at", "—"),
                    "object_city": row.get("object_city", "—"),
                    "address": row.get("address", "—"),
                    "last4": row.get("last4", "—"),
                    "comment": row.get("comment", "—"),
                }

            # Отправляем уведомления асинхронно через BackgroundTasks
            # Сохраняем данные в локальные переменные для использования в замыкании
            creator_name_for_notification = creator_name
            row_data = dict(row)
            sku_display_for_notification = sku_display
            total_area_for_notification = total_area
            manager_for_notification = payload.manager or "—"
            admins_for_notification = admins

            async def send_duplicate_notifications():
                sent_count = 0
                msg = (
                    f"⚠️ <b>Попытка создать похожую защиту</b>\n\n"
                    f"<b>Существующая защита:</b>\n"
                    f"👤 Менеджер: {row_data['manager']}\n"
                    f"👤 Создатель: {creator_name_for_notification}\n"
                    f"🏢 Партнёр: {row_data.get('partner', '—')}\n"
                    f"❗️Артикул: {row_data['sku']}\n"
                    f"📏 Метраж: {int(row_data['area_m2']) if float(row_data['area_m2']).is_integer() else row_data['area_m2']} м²\n"
                    f"⏰ Истекает: {row_data['expires_at'][:10]}\n\n"
                    f"<b>Попытка создать:</b>\n"
                    f"👤 Пользователь: {manager_for_notification}\n"
                    f"📦 SKU: {sku_display_for_notification}\n"
                    f"📏 Метраж: {int(total_area_for_notification) if total_area_for_notification.is_integer() else total_area_for_notification} м²\n\n"
                    f"💬 Пользователь должен обратиться к менеджеру или попросить администратора/суперадмина пропустить эту защиту."
                )
                for admin in admins_for_notification:
                    tg_id = admin["tg_id"] if "tg_id" in admin.keys() else None
                    if tg_id:
                        try:
                            tg_id_int = int(tg_id) if str(tg_id).isdigit() else None
                            if tg_id_int:
                                await bot.send_message(
                                    tg_id_int,
                                    msg,
                                    parse_mode="HTML"
                                )
                                sent_count += 1
                                print(f"📩 Уведомление о похожей защите отправлено админу {tg_id_int}")
                        except Exception as e:
                            print(f"⚠️ Ошибка отправки уведомления о похожей защите админу {tg_id}: {e}")

                if sent_count > 0:
                    print(f"✅ Уведомления о похожей защите отправлены {sent_count} админам/суперадминам")

            # Используем BackgroundTasks для отправки уведомлений
            if background_tasks:
                background_tasks.add_task(send_duplicate_notifications)
            else:
                # Fallback: пытаемся запустить через asyncio, если BackgroundTasks недоступен
                try:
                    import asyncio
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        asyncio.create_task(send_duplicate_notifications())
                    else:
                        loop.run_until_complete(send_duplicate_notifications())
                except Exception as e:
                    print(f"⚠️ Ошибка при создании задачи отправки уведомлений: {e}")

            raise HTTPException(
                    status_code=409,
                    detail={
                        "msg": (
                            "⚠️ Похожая активная защита уже существует:\n\n"
                            f"👤 Менеджер: {row['manager']}\n"
                            f"👤 Создатель: {creator_name}\n"
                            f"🏢 Партнёр: {row['partner'] or '—'}\n"
                            f"❗️Артикул: {row['sku']}\n"
                            f"📏 Метраж: {int(row['area_m2']) if float(row['area_m2']).is_integer() else row['area_m2']} м²\n"
                            f"⏰ Истекает: {row['expires_at']}\n\n"
                            "💬 Обратись к менеджеру или попроси администратора/суперадмина пропустить эту защиту."
                        ),
                        "similar_protection": similar_protection_data
                    }
                )

        # ===== TTL по суммарной площади (в рабочих днях) =====
        ttl_workdays = 5
        if total_area >= 50:
            if total_area < 100:
                ttl_workdays = 5
            elif total_area < 250:
                ttl_workdays = 10
            elif total_area < 500:
                ttl_workdays = 15
            else:
                ttl_workdays = 30

        # Используем рабочие дни (исключая выходные и праздники)
        expires = add_workdays(created, ttl_workdays)

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
            raise HTTPException(status_code=500, detail="Не удалось создать защиту: ID не получен")
    
        add_history(cur, new_id, str(user["id"]), "create", {"sku": sku_display, "area_m2": total_area, "actor_id": user["id"], "actor_role": user["role"]})

        # Получаем данные созданной защиты для уведомлений
        query = _adapt_query("SELECT * FROM protections WHERE id=?")
        cur.execute(query, (new_id,))
        row = cur.fetchone()
        row_dict = row_to_out(row).dict()
    
        # Отправляем уведомление всем пользователям о новой защите
        if background_tasks:
            background_tasks.add_task(notify_all_users_new_protection, row_dict)
        else:
            # Fallback: пытаемся запустить через asyncio, если BackgroundTasks недоступен
            try:
                import asyncio
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.create_task(notify_all_users_new_protection(row_dict))
                else:
                    loop.run_until_complete(notify_all_users_new_protection(row_dict))
            except Exception as e:
                print(f"⚠️ Ошибка при отправке уведомления всем пользователям: {e}")

        # если защита "на проверке" — уведомляем админа
        if row["status"] == "pending":
            # Используем BackgroundTasks для отправки уведомлений
            if background_tasks:
                background_tasks.add_task(notify_admin_new_protection, row_dict)
            else:
                # Fallback: пытаемся запустить через asyncio, если BackgroundTasks недоступен
                try:
                    import asyncio
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        asyncio.create_task(notify_admin_new_protection(row_dict))
                    else:
                        loop.run_until_complete(notify_admin_new_protection(row_dict))
                except Exception as e:
                    print(f"⚠️ Ошибка при отправке уведомления админу: {e}")

        result = dict(row)
    return row_to_out(result, user=user)

    # === Обновление Telegram уведомлений менеджера ===
from fastapi import Body

@app.put("/api/admin/managers/{manager_id}/telegrams")
def update_manager_telegrams(manager_id: int, body: dict = Body(...), user=Depends(get_admin_user)):
    import json
    telegrams = body.get("telegrams")

    if not isinstance(telegrams, list):
        raise HTTPException(status_code=400, detail="Поле 'telegrams' должно быть списком")

    conn = get_conn()   # ✅ вместо get_db()
    cur = conn.cursor()
    cur.execute(_adapt_query("SELECT id FROM managers WHERE id = ?"), (manager_id,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Менеджер не найден")

    update_query = _adapt_query("UPDATE managers SET telegrams = ? WHERE id = ?")
    cur.execute(update_query, (json.dumps(telegrams, ensure_ascii=False), manager_id))
    conn.commit()
    conn.close()

    return {"message": "✅ Telegram-уведомления успешно обновлены", "telegrams": telegrams}


# ===== Редактирование защиты =====
@app.put("/api/protections/{pid}", response_model=ProtectionOut)
def update_protection(pid: int, payload: ProtectionUpdate, user=Depends(get_current_active_user)):
    with _protection_transaction() as (conn, cur):
        row = _get_protection(cur, pid)
        _require_protection_access(cur, row, user)
        is_admin = user.get("role") in ("admin", "superadmin")
        if row["status"] not in ("active", "closed", "success", "rejected") and not (user.get("role") == "superadmin" and row["status"] == "deleted"):
            raise HTTPException(status_code=400, detail="Эту защиту сейчас нельзя редактировать")
        revision = row.get("updated_at") or row["created_at"]
        if payload.expected_updated_at is None:
            raise HTTPException(status_code=428, detail="Обновите карточку перед сохранением")
        if payload.expected_updated_at != revision:
            raise HTTPException(status_code=409, detail={"msg": "Защита уже изменена. Обновите карточку и повторите изменения.", "code": "stale_protection"})
        data = payload.model_dump(exclude_unset=True)
        data.pop("expected_updated_at", None)
        before = dict(row)
        before.update(_archive_metadata(cur, pid))
        merged = dict(row)
        updates = {}
        for field in ("manager", "client", "partner", "partner_city", "last4", "object_city", "address", "comment"):
            if field in data:
                updates[field] = (data[field] or "").strip()
        if "manager" in updates and not updates["manager"]:
            raise HTTPException(status_code=400, detail="Укажите менеджера")
        if "last4" in updates and updates["last4"] and not re.fullmatch(r"[0-9]{4}", updates["last4"]):
            raise HTTPException(status_code=400, detail="Укажите последние 4 цифры телефона")
        merged.update(updates)
        if any(field in data for field in ("sku", "sku_data", "area_m2")):
            material = {**merged, **{key: data[key] for key in ("sku", "sku_data", "area_m2") if key in data}}
            updates["sku"], updates["area_m2"] = _material_values(material)
            merged.update(updates)
        # Historical duplicate exceptions keep working when only contact data changes.
        material_changed = (sorted(sku_pairs(merged.get("sku"), merged.get("area_m2"))) != sorted(sku_pairs(row.get("sku"), row.get("area_m2")))
                            or float(merged.get("area_m2") or 0) != float(row.get("area_m2") or 0))
        if row["status"] == "active" and material_changed:
            _require_no_conflict(cur, merged["sku"], merged["area_m2"], pid)
        if "expires_at" in data and data["expires_at"] != row["expires_at"]:
            if not is_admin:
                raise HTTPException(status_code=403, detail="Изменить срок может только администратор")
            if row["status"] != "active":
                raise HTTPException(status_code=400, detail="Срок закрытой защиты задаётся при восстановлении")
            try:
                parsed = datetime.fromisoformat(str(data["expires_at"]).replace("Z", "+00:00"))
                if parsed.tzinfo:
                    from datetime import timezone
                    parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
                if parsed.date() < datetime.utcnow().date():
                    raise ValueError()
            except (ValueError, TypeError):
                raise HTTPException(status_code=400, detail="Укажите корректную будущую дату окончания")
            updates["expires_at"] = parsed.isoformat(timespec="seconds") + "Z"
            updates["reminder_2days_sent"] = 0
        metadata = {}
        for field in ("close_reason", "success_doc"):
            if field in data:
                value = (data[field] or "").strip()
                if row["status"] == "active" and value:
                    raise HTTPException(status_code=400, detail="Закрытие и успешное завершение выполняются отдельным действием")
                if value != (before.get(field) or ""):
                    metadata[field] = value
        if "close_reason" in metadata:
            updates["close_reason"] = metadata["close_reason"]
        if row["status"] == "success" and "success_doc" in metadata and not metadata["success_doc"]:
            raise HTTPException(status_code=400, detail="Номер документа 1С успешной защиты нельзя удалить")
        changes = {key: value for key, value in {**updates, **metadata}.items() if before.get(key) != value}
        if changes:
            updates["updated_at"] = _protection_stamp()
            columns = ", ".join(f"{key}=?" for key in updates)
            cur.execute(_adapt_query(f"UPDATE protections SET {columns} WHERE id=?"), (*updates.values(), pid))
            add_history(cur, pid, str(user["id"]), "edit", {
                "actor_id": user["id"], "actor_role": user["role"],
                "before": {key: before.get(key) for key in changes}, "after": changes,
            })
        updated = _get_protection(cur, pid)
        current_metadata = _archive_metadata(cur, pid)
    return row_to_out(updated, current_metadata, user=user)

# ===== List / Actions / Stats =====
@app.get("/api/protections", response_model=List[ProtectionOut])
def list_protections(search: str = "", manager: str = "", status: str = "", user=Depends(get_current_active_user)):
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
    
    # Получаем имена создателей для всех защит через JOIN
    creator_map = {}
    if rows:
        manager_ids = [r["manager_id"] for r in rows if "manager_id" in r.keys() and r["manager_id"]]
        if manager_ids:
            placeholders = ",".join(["?"] * len(manager_ids))
            creator_sql = _adapt_query(f"SELECT id, full_name, first_name FROM users WHERE id IN ({placeholders})")
            creator_cur = conn.cursor()
            creator_cur.execute(creator_sql, manager_ids)
            creator_rows = creator_cur.fetchall()
            for cr in creator_rows:
                creator_id = cr["id"]
                creator_name = cr.get("full_name") or cr.get("first_name") or None
                if creator_name:
                    creator_map[creator_id] = creator_name
    
    # Получаем историю для всех защит, чтобы извлечь комментарии и информацию о действиях
    protection_ids = [r["id"] for r in rows]
    history_map = {}
    history_entries = {}
    if protection_ids:
        placeholders = ",".join(["?"] * len(protection_ids))
        # Получаем все записи истории для действий close, success, delete
        history_sql = _adapt_query(f"SELECT * FROM history WHERE protection_id IN ({placeholders}) AND action IN ('close', 'success', 'delete', 'edit', 'update_closed') ORDER BY at DESC, id DESC")
        history_cur = conn.cursor()
        history_cur.execute(history_sql, protection_ids)
        history_rows = history_cur.fetchall()
        
        # Обрабатываем записи, сохраняя только последнюю для каждой защиты
        for h in history_rows:
            pid = h["protection_id"]
            history_entries.setdefault(pid, []).append(h)
            if h["action"] not in ("close", "success", "delete"):
                continue
            payload = json.loads(h["payload"] or "{}")
            action = h["action"]
            actor = h["actor"]
            at = h["at"]
            
            # Если для этой защиты уже есть запись, пропускаем (берем только последнюю)
            if pid in history_map:
                continue
            
            # Создаем новую запись для этой защиты
            history_map[pid] = {}
            
            # Получаем имя пользователя из actor, если это ID пользователя
            actor_name = actor
            if actor and str(actor).isdigit():
                # Если actor - это ID пользователя, получаем его имя
                try:
                    actor_query = _adapt_query("SELECT full_name, first_name FROM users WHERE id=?")
                    actor_cur = conn.cursor()
                    actor_cur.execute(actor_query, (int(actor),))
                    actor_row = actor_cur.fetchone()
                    if actor_row:
                        actor_name = actor_row.get("full_name") or actor_row.get("first_name") or actor
                except Exception as e:
                    print(f"⚠️ Ошибка получения имени пользователя для actor {actor}: {e}")
                    actor_name = actor
            
            # Сохраняем информацию о последнем действии
            history_map[pid]["action_actor"] = actor_name
            history_map[pid]["action_at"] = at
            
            # Сохраняем специфичные данные для каждого типа действия
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
    
    # Добавляем creator_name в history_map для передачи в row_to_out
    for r in rows:
        pid = r["id"]
        manager_id = r.get("manager_id") if "manager_id" in r.keys() else None
        if manager_id and manager_id in creator_map:
            if pid not in history_map:
                history_map[pid] = {}
            history_map[pid]["creator_name"] = creator_map[manager_id]
    
    for r in rows:
        pid = r["id"]
        if r["status"] != "active":
            history_map.setdefault(pid, {}).update(_history_metadata(history_entries.get(pid, [])))
        else:
            for field in ("close_reason", "success_doc", "delete_reason", "action_actor", "action_at"):
                history_map.get(pid, {}).pop(field, None)
    dictionary_ids = {}
    if user.get("role") == "assistant":
        cur.execute("SELECT id, name FROM managers")
        dictionary_ids = {manager["name"]: manager["id"] for manager in cur.fetchall()}
    permissions = {r["id"]: _capabilities_for(r, user, can_manage(user, dict(r), dictionary_ids.get(r["manager"]))) for r in rows}
    conn.close()
    return [row_to_out(r, history_map.get(r["id"], {}), user=user, capabilities=permissions[r["id"]]) for r in rows]

# --- история
@app.get("/api/export")
def export_protections(search: str = "", manager: str = "", status: str = "", user=Depends(get_current_active_user)):
    """Выгрузка защит таблицей. CSV с BOM — Excel открывает его как есть,
    без дополнительных библиотек в зависимостях."""
    import csv
    import io as _io
    from fastapi.responses import StreamingResponse

    conn = get_conn()
    cur = conn.cursor()

    sql = "SELECT * FROM protections WHERE 1=1"
    params: list = []
    if not status:
        sql += " AND status != 'deleted'"
    elif status == "archived":
        sql += " AND (status = 'archived' OR status = 'success' OR status = 'closed' OR status = 'deleted')"
    else:
        sql += " AND status = ?"
        params.append(status)
    if manager:
        sql += " AND manager = ?"
        params.append(manager)
    if search:
        like = f"%{search}%"
        sql += " AND (partner LIKE ? OR client LIKE ? OR sku LIKE ? OR object_city LIKE ?)"
        params.extend([like, like, like, like])
    sql += " ORDER BY created_at DESC"

    cur.execute(_adapt_query(sql), tuple(params))
    rows = cur.fetchall()
    conn.close()

    STATUS_RU = {
        "active": "Активна", "success": "Успешно", "closed": "Закрыта",
        "deleted": "Удалена", "pending": "На проверке", "rejected": "Отклонена",
    }

    buf = _io.StringIO()
    buf.write("\ufeff")  # BOM, иначе Excel показывает кириллицу кракозябрами
    writer = csv.writer(buf, delimiter=";", lineterminator="\r\n")
    writer.writerow([
        "ID", "Статус", "Менеджер", "Партнёр", "Город партнёра", "Клиент",
        "Город объекта", "Адрес", "Артикулы", "Метраж, м²", "Телефон (4 цифры)",
        "Создана", "Истекает", "Закрыта", "Продлений", "Комментарий",
    ])
    for r in rows:
        d = dict(r)
        cells = [
            d.get("id", ""),
            STATUS_RU.get(d.get("status", ""), d.get("status", "")),
            d.get("manager", ""), d.get("partner", ""), d.get("partner_city", ""),
            d.get("client", ""), d.get("object_city", ""), d.get("address", ""),
            d.get("sku", ""), d.get("area_m2", ""), d.get("last4", ""),
            (d.get("created_at") or "")[:10], (d.get("expires_at") or "")[:10],
            (d.get("closed_at") or "")[:10], d.get("extend_count", 0),
            (d.get("comment") or "").replace("\n", " "),
        ]
        writer.writerow([("'" + value) if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")) else value for value in cells])

    buf.seek(0)
    stamp = datetime.now().strftime("%Y-%m-%d")
    return StreamingResponse(
        _io.BytesIO(buf.getvalue().encode("utf-8")),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="protections-{stamp}.csv"'},
    )


@app.post("/api/export-link")
def export_link(data: dict = Body(...), user=Depends(get_current_active_user)):
    from backend.export_tickets import issue_ticket
    from urllib.parse import quote
    ticket = issue_ticket(JWT_SECRET or SECRET_KEY, user["id"], data)
    return {"path": "/api/export-download?ticket=" + quote(ticket), "expires_in": 60,
            "filename": "protections-" + datetime.utcnow().strftime("%Y-%m-%d") + ".csv"}


@app.get("/api/export-download")
def export_download(ticket: str):
    from backend.export_tickets import read_ticket
    try:
        payload = read_ticket(JWT_SECRET or SECRET_KEY, ticket)
    except ValueError:
        raise HTTPException(status_code=403, detail="Ссылка на выгрузку истекла. Создайте новую в приложении")
    user = get_user_by_id(payload["uid"])
    if not user or user.get("is_active") in (False, 0, "0"):
        raise HTTPException(status_code=403, detail="Нет доступа к выгрузке")
    filters = {key: str(payload["filters"].get(key) or "") for key in ("search", "manager", "status")}
    response = export_protections(**filters, user=user)
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@app.get("/api/history")
def history(protection_id: Optional[int] = None, user=Depends(get_current_active_user)):
    conn = get_conn()
    try:
        cur = conn.cursor()
        if protection_id:
            cur.execute(_adapt_query("SELECT * FROM history WHERE protection_id=? ORDER BY at DESC, id DESC"), (protection_id,))
        else:
            cur.execute("SELECT * FROM history ORDER BY at DESC, id DESC LIMIT 500")
        return [{**dict(row), "payload": json.loads(row["payload"] or "{}")} for row in cur.fetchall()]
    finally:
        conn.close()

# --- продление
@app.post("/api/protections/{pid}/extend", response_model=ProtectionOut)
def extend(pid: int, days: int = 10, actor: Literal["manager", "admin"] = "manager", background_tasks: BackgroundTasks = None, user=Depends(get_current_active_user)):
    # actor remains in the URL for older clients, but never grants privileges.
    _require_extension_days(days, user)
    with _protection_transaction() as (conn, cur):
        row = _get_protection(cur, pid)
        _require_protection_access(cur, row, user)
        _require_extension_days(days, user)
        if row["status"] != "active":
            raise HTTPException(status_code=400, detail="Можно продлевать только активные защиты")
        is_admin = user.get("role") in ("admin", "superadmin")
        count = row.get("extend_count") or 0
        if not is_admin and count >= 2:
            raise HTTPException(status_code=403, detail={"msg": "Превышен лимит продлений. Запросите у администратора.", "needs_admin": True})
        base = max(row["expires_at"], now_iso())
        new_exp = add_workdays(base, days)
        cur.execute(_adapt_query("UPDATE protections SET expires_at=?, extend_count=?, reminder_2days_sent=0, updated_at=? WHERE id=?"),
                    (new_exp, count + (0 if is_admin else 1), _protection_stamp(), pid))
        add_history(cur, pid, str(user["id"]), "extend", {"days": days, "workdays": True, "actor_id": user["id"], "actor_role": user["role"], "before": {"expires_at": row["expires_at"], "extend_count": count}, "after": {"expires_at": new_exp, "extend_count": count + (0 if is_admin else 1)}})
        updated = _get_protection(cur, pid)
    return row_to_out(updated, user=user)

@app.post("/api/protections/{pid}/request-extend")
def request_extend(pid: int, data: dict = Body(...), background_tasks: BackgroundTasks = None, user=Depends(get_current_active_user)):
    with _protection_transaction() as (conn, cur):
        try:
            days = int(data.get("days", 10))
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Укажите количество рабочих дней")
        if not 1 <= days <= 365:
            raise HTTPException(status_code=400, detail="Укажите срок от 1 до 365 рабочих дней")
        reason = (data.get("reason") or "").strip()
        query = _adapt_query("SELECT * FROM protections WHERE id=?")
        cur.execute(query, (pid,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Not found")

        _require_protection_access(cur, row, user)
        if row["status"] != "active" and not (row["status"] == "closed" and row.get("auto_closed")):
            raise HTTPException(status_code=409, detail="Запрос доступен для активной или автоматически закрытой защиты")
        cur.execute(_adapt_query("SELECT id FROM history WHERE protection_id=? AND action='extend_request'"), (pid,))
        if cur.fetchone():
            return {"ok": True, "already_requested": True}

        if not reason:
            reason = "не указана"

        add_history(
            cur,
            pid,
            str(user["id"]),
            "extend_request",
            {"days": days, "reason": reason, "actor_id": user["id"], "actor_role": user["role"], "restore": row["status"] == "closed"},
        )
    
        # Отправляем уведомление всем админам и суперадминам, у которых включены уведомления
        admin_query = _adapt_query("""
            SELECT id, tg_id, full_name, first_name
            FROM users
            WHERE role IN ('admin', 'superadmin')
              AND tg_id IS NOT NULL
              AND tg_id != ''
              AND (receive_notifications IS NULL OR receive_notifications = 1)
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
            
                # Нормализуем tg_id и обновляем в базе, если нужно
                from backend.db import normalize_tg_id
                normalized_tg_id = normalize_tg_id(tg_id)
                if normalized_tg_id and normalized_tg_id != str(tg_id):
                    # Обновляем tg_id в базе, если он был с префиксом
                    admin_id = admin.get("id")
                    if admin_id:
                        try:
                            update_conn = get_conn()
                            update_cur = update_conn.cursor()
                            update_query = _adapt_query("UPDATE users SET tg_id=? WHERE id=?")
                            update_cur.execute(update_query, (normalized_tg_id, admin_id))
                            update_conn.commit()
                            update_conn.close()
                            print(f"✅ Обновлен tg_id пользователя {admin_id} с {tg_id} на {normalized_tg_id}")
                            tg_id = normalized_tg_id
                        except Exception as e:
                            print(f"⚠️ Ошибка обновления tg_id для пользователя {admin_id}: {e}")
            
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
                
                    # Пробуем отправить сообщение - используем chat_id как int (правильный формат для aiogram)
                    result = None
                    try:
                        result = await bot.send_message(
                            chat_id=tg_id_int,
                            text=msg,
                            parse_mode="HTML",
                            reply_markup=kb.as_markup()
                        )
                    except Exception as send_error:
                        # Если не получилось с int, пробуем со строкой
                        error_msg = str(send_error).lower()
                        if "chat not found" in error_msg or "chat_not_found" in error_msg:
                            print(f"⚠️ Chat not found для {tg_id_int}, пробуем альтернативный способ...")
                            # Пробуем использовать строку вместо int
                            try:
                                result = await bot.send_message(
                                    chat_id=str(tg_id_int),
                                    text=msg,
                                    parse_mode="HTML",
                                    reply_markup=kb.as_markup()
                                )
                            except Exception as e2:
                                # Если и со строкой не получилось, просто пропускаем этого пользователя
                                print(f"⚠️ Не удалось отправить уведомление админу {tg_id_int} даже со строкой: {e2}")
                                result = None
                        else:
                            # Для других ошибок тоже не поднимаем исключение, просто логируем
                            print(f"⚠️ Ошибка отправки уведомления админу {tg_id_int}: {send_error}")
                            result = None
                
                    if result:
                        sent_count += 1
                        admin_name = admin["full_name"] if "full_name" in admin.keys() else (admin["first_name"] if "first_name" in admin.keys() else "Unknown")
                        print(f"✅ Уведомление о запросе продления отправлено админу {tg_id_int} ({admin_name}), message_id={result.message_id}")
                except Exception as e:
                    print(f"⚠️ Ошибка при обработке админа {tg_id}: {e}")
        
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
    
        return {"ok": True}


# --- успешная / закрытая / удаление
@app.post("/api/protections/{pid}/success", response_model=ProtectionOut)
def mark_success(pid: int, data: dict = Body(...), user=Depends(get_current_active_user)):
    doc = str((data or {}).get("doc_1c") or "").strip()
    if not doc:
        raise HTTPException(status_code=400, detail="Нужно указать номер документа из 1С")
    with _protection_transaction() as (conn, cur):
        row = _get_protection(cur, pid)
        _require_protection_access(cur, row, user)
        if row["status"] != "active":
            raise HTTPException(status_code=409, detail="Защита уже закрыта. Обновите карточку")
        cur.execute(_adapt_query("UPDATE protections SET status='success', closed_at=?, auto_closed=0, updated_at=? WHERE id=?"), (now_iso(), _protection_stamp(), pid))
        add_history(cur, pid, str(user["id"]), "success", {"doc_1c": doc, "actor_id": user["id"], "actor_role": user["role"]})
        _drop_extend_request(cur, pid)
        updated = _get_protection(cur, pid)
    return row_to_out(updated, {"success_doc": doc}, user=user)

@app.post("/api/protections/{pid}/close", response_model=ProtectionOut)
def mark_closed(pid: int, data: dict = Body(...), user=Depends(get_current_active_user)):
    reason = str((data or {}).get("reason") or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Нужно указать причину закрытия")
    with _protection_transaction() as (conn, cur):
        row = _get_protection(cur, pid)
        _require_protection_access(cur, row, user)
        if row["status"] != "active":
            raise HTTPException(status_code=409, detail="Защита уже закрыта. Обновите карточку")
        cur.execute(_adapt_query("UPDATE protections SET status='closed', closed_at=?, close_reason=?, auto_closed=0, updated_at=? WHERE id=?"), (now_iso(), reason, _protection_stamp(), pid))
        add_history(cur, pid, str(user["id"]), "close", {"reason": reason, "actor_id": user["id"], "actor_role": user["role"]})
        _drop_extend_request(cur, pid)
        updated = _get_protection(cur, pid)
    return row_to_out(updated, {"close_reason": reason}, user=user)

@app.delete("/api/protections/{pid}")
def delete_protection(pid: int, reason: Optional[str] = None, user=Depends(get_current_active_user), hard_delete: bool = False, background_tasks: BackgroundTasks = None):
    """
    Мягкое удаление: статус -> 'deleted' + запись в историю.
    Полное удаление (hard_delete=True): удаляет защиту и всю историю (только для админа/суперадмина).
    Удалить может только автор защиты (по manager_id) или админ/суперадмин.
    При удалении админом отправляется уведомление автору с причиной.
    """
    conn = get_conn()
    cur = conn.cursor()
    _lock_protections(cur)
    try:
        _refresh_protection_actor(cur, user)
    except HTTPException:
        conn.close()
        raise
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
    
    if not _can_manage_protection(cur, row, user):
        conn.close()
        raise HTTPException(
            status_code=403, 
            detail="Удалить защиту может только её автор или администратор"
        )
    
    # Полное удаление доступно только админу/суперадмину
    if hard_delete and not is_admin:
        conn.close()
        raise HTTPException(
            status_code=403,
            detail="Полное удаление доступно только администратору"
        )
    
    # Если удаляет админ - отправляем уведомление автору
    if is_admin and not is_author and protection_manager_id:
        # Получаем данные автора
        author_query = _adapt_query("SELECT tg_id, full_name, first_name FROM users WHERE id=?")
        cur.execute(author_query, (protection_manager_id,))
        author_row = cur.fetchone()
        if author_row and ("tg_id" in author_row.keys() and author_row["tg_id"]):
            reason_text = reason or "не указана"
            sku_value = row["sku"] if "sku" in row.keys() else "—"
            manager_value = row["manager"] if "manager" in row.keys() else "—"
            delete_type = "полностью удалена" if hard_delete else "удалена"
            msg = (
                f"⚠️ <b>Ваша защита была {delete_type} администратором</b>\n\n"
                f"🆔 Защита: #{pid}\n"
                f"📦 SKU: {sku_value}\n"
                f"👤 Менеджер: {manager_value}\n"
                f"💬 Причина удаления: {reason_text}\n"
            )
            
            # Отправляем уведомление асинхронно через BackgroundTasks
            async def send_delete_notification():
                try:
                    from backend.db import normalize_tg_id
                    tg_id_clean = normalize_tg_id(author_row["tg_id"])
                    if tg_id_clean and tg_id_clean.isdigit():
                        await bot.send_message(
                            int(tg_id_clean),
                            msg,
                            parse_mode="HTML"
                        )
                        print(f"📩 Уведомление об удалении защиты отправлено автору {tg_id_clean}")
                except Exception as e:
                    print(f"⚠️ Ошибка отправки уведомления автору {author_row.get('tg_id', 'unknown')}: {e}")
            
            if background_tasks:
                background_tasks.add_task(send_delete_notification)
            else:
                # Fallback: пытаемся запустить через asyncio, если BackgroundTasks недоступен
                try:
                    import asyncio
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        asyncio.create_task(send_delete_notification())
                    else:
                        loop.run_until_complete(send_delete_notification())
                except Exception as e:
                    print(f"⚠️ Не удалось отправить уведомление об удалении: {e}")
    
    if hard_delete:
        # Полное удаление: удаляем защиту и всю историю
        history_delete_query = _adapt_query("DELETE FROM history WHERE protection_id=?")
        cur.execute(history_delete_query, (pid,))
        protection_delete_query = _adapt_query("DELETE FROM protections WHERE id=?")
        cur.execute(protection_delete_query, (pid,))
    else:
        # Мягкое удаление: статус -> 'deleted'
        actor = str(user["id"])
        update_query = _adapt_query("UPDATE protections SET status='deleted', closed_at=?, updated_at=?, auto_closed=0 WHERE id=?")
        cur.execute(update_query, (now_iso(), _protection_stamp(), pid))
        add_history(cur, pid, actor, "delete", {"reason": reason or "not provided"})
    
    conn.commit()
    conn.close()
    return {"ok": True, "message": "Защита полностью удалена" if hard_delete else "Защита удалена"}


# === Восстановление закрытой/удаленной защиты (только для суперадминов) ===
@app.post("/api/admin/protections/{pid}/restore", response_model=ProtectionOut)
def restore_protection(pid: int, days: int = 10, user=Depends(get_admin_user)):
    if user.get("role") != "superadmin":
        raise HTTPException(status_code=403, detail="Восстановление вручную закрытых защит доступно только суперадмину")
    return _restore_protection(pid, days, user, allow_manual=True)


@app.post("/api/protections/{pid}/restore", response_model=ProtectionOut)
def self_restore_protection(pid: int, days: int = 10, user=Depends(get_current_active_user)):
    return _restore_protection(pid, days, user)


def _restore_protection(pid, days, user, allow_manual=False):
    _require_extension_days(days, user)
    with _protection_transaction() as (conn, cur):
        row = _get_protection(cur, pid)
        _require_protection_access(cur, row, user)
        _require_extension_days(days, user)
        if allow_manual and user.get("role") == "superadmin":
            eligible = row["status"] in ("closed", "deleted", "success", "rejected")
        else:
            eligible = row["status"] == "closed" and bool(row.get("auto_closed"))
        if not eligible:
            raise HTTPException(status_code=409, detail="Самостоятельно можно восстановить только защиту, автоматически закрытую по сроку")
        is_admin = user.get("role") in ("admin", "superadmin")
        count = row.get("extend_count") or 0
        if not is_admin and count >= 2:
            raise HTTPException(status_code=403, detail={"msg": "Два продления уже использованы. Отправьте запрос администратору на восстановление.", "needs_admin": True})
        display, area = _material_values(row, validate_limits=False)
        _require_no_conflict(cur, display, area, pid)
        new_exp = add_workdays(now_iso(), days)
        new_count = count + (0 if is_admin else 1)
        cur.execute(_adapt_query("UPDATE protections SET status='active', expires_at=?, closed_at=NULL, close_reason=NULL, auto_closed=0, reminder_2days_sent=0, extend_count=?, updated_at=? WHERE id=?"), (new_exp, new_count, _protection_stamp(), pid))
        add_history(cur, pid, str(user["id"]), "restore", {
            "actor_id": user["id"], "actor_role": user["role"], "days": days, "workdays": True,
            "previous_status": row["status"], "before": {key: row.get(key) for key in ("status", "expires_at", "closed_at", "auto_closed", "extend_count")},
            "after": {"status": "active", "expires_at": new_exp, "closed_at": None, "auto_closed": 0, "extend_count": new_count},
        })
        _drop_extend_request(cur, pid)
        updated = _get_protection(cur, pid)
    return row_to_out(updated, user=user)


# === Обновление закрытой защиты (для менеджеров - добавление причины/успеха) ===
@app.put("/api/protections/{pid}/update-closed", response_model=ProtectionOut)
def update_closed_protection(pid: int, data: dict = Body(...), user=Depends(get_current_active_user)):
    with _protection_transaction() as (conn, cur):
        row = _get_protection(cur, pid)
        _require_protection_access(cur, row, user)
        if row["status"] not in ("closed", "deleted", "success", "rejected"):
            raise HTTPException(status_code=400, detail="Обновление доступно только для закрытых защит")
        reason = str(data.get("close_reason") or "").strip()
        doc = str(data.get("success_doc") or "").strip()
        new_status = data.get("status")
        if new_status and user.get("role") not in ("admin", "superadmin"):
            raise HTTPException(status_code=403, detail="Изменить статус может только администратор")
        if new_status and new_status not in ("closed", "success", "deleted"):
            raise HTTPException(status_code=400, detail="Для восстановления используйте действие «Восстановить»")
        if new_status == "success" and not doc:
            raise HTTPException(status_code=400, detail="Укажите документ 1С")
        updates = {"updated_at": _protection_stamp()}
        if reason:
            updates["close_reason"] = reason
        if doc:
            updates.update(status="success", closed_at=now_iso(), auto_closed=0)
            add_history(cur, pid, str(user["id"]), "success", {"doc_1c": doc, "source": "archive_update", "actor_id": user["id"]})
        elif new_status:
            updates.update(status=new_status, auto_closed=0)
        columns = ", ".join(f"{key}=?" for key in updates)
        cur.execute(_adapt_query(f"UPDATE protections SET {columns} WHERE id=?"), (*updates.values(), pid))
        add_history(cur, pid, str(user["id"]), "update_closed", {"close_reason": reason, "doc_1c": doc, "actor_id": user["id"], "before": {key: row.get(key) for key in updates}, "after": updates})
        updated = _get_protection(cur, pid)
        metadata = _archive_metadata(cur, pid)
    return row_to_out(updated, metadata, user=user)


# --- админ: запросы на продление
@app.get("/api/admin/extend-requests")
def admin_extend_requests(user=Depends(get_admin_user)):
    conn = get_conn()
    cur = conn.cursor()
    query = """
        SELECT h.id as hid, h.protection_id, h.at, h.payload, h.actor,
               p.manager, p.partner, p.sku, p.expires_at, p.manager_id
        FROM history h
        JOIN protections p ON p.id = h.protection_id
        WHERE h.action='extend_request'
        ORDER BY h.at DESC
        """
    cur.execute(query)
    rows = cur.fetchall()
    out = []
    for r in rows:
        payload = json.loads(r["payload"] or "{}")
        
        # Получаем имя пользователя, который создал запрос
        user_name = "—"
        manager_id = r.get("manager_id") if "manager_id" in r.keys() else None
        actor = r.get("actor", "")
        
        # Если actor - это ID пользователя (число), ищем по ID
        if actor and actor.isdigit():
            user_query = _adapt_query("SELECT full_name, first_name FROM users WHERE id=?")
            cur.execute(user_query, (int(actor),))
            user_row = cur.fetchone()
            if user_row:
                user_name = user_row.get("full_name") or user_row.get("first_name") or "—"
        # Если actor - это "manager" и есть manager_id, ищем по manager_id
        elif actor == "manager" and manager_id:
            user_query = _adapt_query("SELECT full_name, first_name FROM users WHERE id=?")
            cur.execute(user_query, (manager_id,))
            user_row = cur.fetchone()
            if user_row:
                user_name = user_row.get("full_name") or user_row.get("first_name") or "—"
        # Если не нашли, используем имя менеджера из защиты
        if user_name == "—":
            user_name = r["manager"] or "—"
        
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
                "user_name": user_name,  # Имя пользователя, который создал запрос
            }
        )
    conn.close()
    return out



def _drop_extend_request(cur, pid: int):
    # Keep the event and its contents; only resolve the queue state.
    cur.execute(_adapt_query("UPDATE history SET action='extend_request_resolved' WHERE protection_id=? AND action='extend_request'"), (pid,))


@app.post("/api/admin/protections/{pid}/extend-any", response_model=ProtectionOut)
def admin_extend_any(pid: int, days: int = 10, user=Depends(get_admin_user), background_tasks: BackgroundTasks = None):
    # админ без лимита
    conn_check = get_conn()
    try:
        existing = _get_protection(conn_check.cursor(), pid)
    finally:
        conn_check.close()
    if existing["status"] == "closed" and existing.get("auto_closed"):
        result = _restore_protection(pid, days, user)
    else:
        result = extend(pid, days=days, actor="admin", background_tasks=background_tasks, user=user)
    
    # Отправляем уведомление менеджеру о продлении через админку
    conn = get_conn()
    cur = conn.cursor()
    _drop_extend_request(cur, pid)
    conn.commit()
    query = _adapt_query("SELECT * FROM protections WHERE id=?")
    cur.execute(query, (pid,))
    row = cur.fetchone()
    
    if row:
        manager_name = row.get("manager", "")
        manager_id = row.get("manager_id") if "manager_id" in row.keys() else None
        
        if manager_name:
            # Ищем менеджера по имени или manager_id
            if manager_id:
                manager_query = _adapt_query("SELECT tg_id, full_name, first_name FROM users WHERE id=? OR full_name=? OR first_name=? LIMIT 1")
                cur.execute(manager_query, (manager_id, manager_name, manager_name))
            else:
                manager_query = _adapt_query("SELECT tg_id, full_name, first_name FROM users WHERE full_name=? OR first_name=? LIMIT 1")
                cur.execute(manager_query, (manager_name, manager_name))
            manager_user = cur.fetchone()
            
            if manager_user and manager_user.get("tg_id"):
                tg_id = manager_user.get("tg_id")
                from backend.db import normalize_tg_id
                tg_id_clean = normalize_tg_id(tg_id)
                
                if tg_id_clean and tg_id_clean.isdigit():
                    # Отправляем уведомление асинхронно через BackgroundTasks
                    async def send_extend_notification():
                        try:
                            from datetime import datetime, timedelta
                            expires_at = row.get("expires_at", "")
                            msg = (
                                f"✅ <b>Защита продлена администратором</b>\n\n"
                                f"Защита: <b>#{pid}</b>\n"
                                f"📦 SKU: {row.get('sku', '—')}\n"
                                f"⏰ Новая дата истечения: {expires_at[:10] if expires_at else '—'}\n"
                                f"📅 Продлено на: {days} дней"
                            )
                            await bot.send_message(
                                chat_id=int(tg_id_clean),
                                text=msg,
                                parse_mode="HTML"
                            )
                            print(f"✅ Уведомление о продлении отправлено менеджеру {tg_id_clean}")
                        except Exception as e:
                            print(f"⚠️ Ошибка отправки уведомления о продлении менеджеру {tg_id_clean}: {e}")
                    
                    if background_tasks:
                        background_tasks.add_task(send_extend_notification)
                    else:
                        # Fallback: пытаемся запустить через asyncio, если BackgroundTasks недоступен
                        try:
                            import asyncio
                            loop = asyncio.get_event_loop()
                            if loop.is_running():
                                asyncio.create_task(send_extend_notification())
                            else:
                                loop.run_until_complete(send_extend_notification())
                        except Exception as e:
                            print(f"⚠️ Не удалось отправить уведомление о продлении: {e}")
    
    conn.close()
    return result


@app.post("/api/admin/protections/{pid}/reject-extend-request")
def admin_reject_extend_request(pid: int, data: dict = Body(...), user=Depends(get_admin_user)):
    """Отклонение запроса на продление с указанием причины"""
    reason = (data or {}).get("reason", "Не указана")
    
    conn = get_conn()
    cur = conn.cursor()
    
    # Получаем информацию о защите
    query = _adapt_query("SELECT * FROM protections WHERE id=?")
    cur.execute(query, (pid,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Защита не найдена")
    
    # Добавляем запись в историю об отклонении
    add_history(cur, pid, str(user["id"]), "extend_reject", {
        "source": "app",
        "reason": reason,
        "rejected_by": user.get("full_name", user.get("first_name", "Admin"))
    })
    _drop_extend_request(cur, pid)
    
    # Отправляем уведомление менеджеру в Telegram
    manager_name = row.get("manager", "")
    if manager_name:
        # Ищем менеджера по имени
        query = _adapt_query("SELECT tg_id, full_name, first_name FROM users WHERE full_name=? OR first_name=? LIMIT 1")
        cur.execute(query, (manager_name, manager_name))
        manager_user = cur.fetchone()
        
        if manager_user and manager_user.get("tg_id"):
            tg_id = manager_user.get("tg_id")
            from backend.db import normalize_tg_id
            tg_id_clean = normalize_tg_id(tg_id)
            
            if tg_id_clean and tg_id_clean.isdigit():
                try:
                    msg = (
                        f"🚫 <b>Запрос на продление отклонен</b>\n\n"
                        f"Защита: <b>#{pid}</b>\n"
                        f"📦 SKU: {row.get('sku', '—')}\n"
                        f"⏰ Текущая дата истечения: {row.get('expires_at', '')[:10]}\n\n"
                        f"💬 <b>Причина отклонения:</b>\n{reason}"
                    )
                    # Отправляем уведомление асинхронно через BackgroundTasks
                    # BackgroundTasks не поддерживает async напрямую, поэтому используем asyncio.create_task
                    async def send_reject_notification():
                        try:
                            await bot.send_message(
                                chat_id=int(tg_id_clean),
                                text=msg,
                                parse_mode="HTML"
                            )
                            print(f"✅ Уведомление об отклонении отправлено менеджеру {tg_id_clean}")
                        except Exception as e:
                            print(f"⚠️ Ошибка отправки уведомления об отклонении менеджеру {tg_id_clean}: {e}")
                    
                    # Запускаем async функцию через asyncio.create_task
                    try:
                        import asyncio
                        loop = asyncio.get_event_loop()
                        if loop.is_running():
                            asyncio.create_task(send_reject_notification())
                        else:
                            loop.run_until_complete(send_reject_notification())
                    except Exception as e:
                        print(f"⚠️ Не удалось отправить уведомление об отклонении: {e}")
                except Exception as e:
                    print(f"⚠️ Не удалось отправить уведомление менеджеру: {e}")
    
    conn.commit()
    conn.close()
    
    return {"ok": True, "message": "Запрос отклонен"}


@app.delete("/api/admin/protections/{pid}/delete-extend-request")
def admin_delete_extend_request(pid: int, user=Depends(get_admin_user)):
    """Удаление запроса на продление (без уведомления)"""
    conn = get_conn()
    cur = conn.cursor()
    
    _get_protection(cur, pid)
    _drop_extend_request(cur, pid)
    conn.commit()
    conn.close()
    
    return {"ok": True, "message": "Запрос удален"}

# ===== Stats =====
@app.get("/api/stats")
def stats(user=Depends(get_current_active_user)):
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
    query = _adapt_query("SELECT name FROM managers WHERE id=?")
    cur.execute(query, (manager_id,))
    manager_row = cur.fetchone()
    if not manager_row:
        conn.close()
        return []  # если менеджера нет — просто возвращаем пустой список

    manager_name = manager_row["name"] if isinstance(manager_row, dict) else manager_row[0]

    protections_query = _adapt_query("""
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
    """)
    cur.execute(protections_query, (manager_name,))

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
def create_pending_protection(payload: ProtectionCreate = Body(...), user=Depends(get_current_active_user), background_tasks: BackgroundTasks = None):
    with _protection_transaction() as (conn, cur):
        _refresh_protection_actor(cur, user)
        created = now_iso()

        # Получаем user_id из текущего пользователя
        current_user_id = user.get("id") if isinstance(user, dict) else None

        sku_display, total_area = _material_values(payload.model_dump())
        _validate_protection_contacts(payload.model_dump())

        # === TTL (в рабочих днях) ===
        ttl_workdays = 5
        if total_area >= 50:
            if total_area < 100:
                ttl_workdays = 5
            elif total_area < 250:
                ttl_workdays = 10
            elif total_area < 500:
                ttl_workdays = 15
            else:
                ttl_workdays = 30
        # Используем рабочие дни (исключая выходные и праздники)
        expires = add_workdays(created, ttl_workdays)

        # === Запись в базу ===
        # Строим INSERT запрос с RETURNING для PostgreSQL
        if USE_POSTGRES:
            insert_sql = """
                INSERT INTO protections(
                    manager, client, partner, partner_city, sku, area_m2, last4,
                    object_city, address, comment, status, created_at, expires_at,
                    closed_at, extend_count, auto_closed, manager_id
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, 'pending', %s, %s, NULL, 0, 0, %s)
                RETURNING id
            """
        else:
            insert_sql = _adapt_query("""
            INSERT INTO protections(
                manager, client, partner, partner_city, sku, area_m2, last4,
                object_city, address, comment, status, created_at, expires_at,
                closed_at, extend_count, auto_closed, manager_id
            ) VALUES (?,?,?,?,?,?,?,?,?,?, 'pending', ?, ?, NULL, 0, 0, ?)
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
            # без manager_id защита, созданная через экран конфликта, не попадала
            # в «Мои» — там фильтр именно по владельцу, а не по имени менеджера
            current_user_id,
        ))

        # Получаем ID в зависимости от типа БД
        if USE_POSTGRES:
            result = cur.fetchone()
            new_id = result["id"] if result else None
        else:
            new_id = cur.lastrowid
    
        if not new_id:
            raise HTTPException(status_code=500, detail="Не удалось создать защиту: ID не получен")
    
        # === Telegram уведомление админу ===
        # Получаем информацию о пользователе, который создал защиту (ДО закрытия соединения)
        user_name = "—"
        if current_user_id:
            user_query = _adapt_query("SELECT full_name, first_name FROM users WHERE id=?")
            cur.execute(user_query, (current_user_id,))
            user_row = cur.fetchone()
            if user_row:
                user_name = user_row.get("full_name") or user_row.get("first_name") or "—"
    
        add_history(cur, new_id, str(user["id"]), "create_pending", {"reason": payload.comment, "actor_id": user["id"], "actor_role": user["role"]})

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
                    "user_name": user_name,  # ✅ Добавляем имя пользователя
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
            # В выходные/праздники уведомления о "сгорании" не отправляем
            if not is_workday(datetime.utcnow()):
                await asyncio.sleep(6 * 60 * 60)
                continue

            conn = get_conn()
            cur = conn.cursor()
            now = datetime.utcnow()

            # Берём все активные защиты без отправленного напоминания и фильтруем по рабочим дням в Python,
            # чтобы корректно учитывать официальные выходные/праздники.
            query = _adapt_query("""
                SELECT p.id, p.manager, p.sku, p.expires_at, p.manager_id, p.partner, p.partner_city,
                       p.area_m2, p.extend_count, p.reminder_2days_sent,
                       u.tg_id, u.id AS user_id
                FROM protections p
                LEFT JOIN users u ON u.id = p.manager_id
                WHERE p.status='active' 
                  AND (p.reminder_2days_sent IS NULL OR p.reminder_2days_sent = 0)
            """)
            cur.execute(query)
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
                wd_left = workdays_until(expires_at, now)

                # Напоминаем, когда до истечения осталось 2 рабочих дня (и также не пропускаем 1/0,
                # если сервис был "в офлайне" или попадали выходные).
                if wd_left < 0 or wd_left > 2:
                    continue

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

                when_text = (
                    "сегодня" if wd_left == 0 else
                    "через 1 рабочий день" if wd_left == 1 else
                    "через 2 рабочих дня"
                )

                msg = (
                    f"⚠️ <b>Защита #{pid} истекает {when_text}!</b>\n\n"
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
                kb.button(text="✅ Успешно (1С)", callback_data=f"success_exp:{pid}")
                kb.button(text="🔒 Закрыть защиту", callback_data=f"close_exp:{pid}")
                kb.adjust(2, 2)

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
                        error_msg = str(e)
                        # Игнорируем ошибку "chat not found" - пользователь не начал диалог с ботом
                        if "chat not found" in error_msg.lower() or "bad request" in error_msg.lower():
                            print(f"⚠️ Пользователь {tid} не начал диалог с ботом (защита #{pid})")
                        else:
                            print(f"⚠️ Ошибка отправки напоминания {tid}: {e}")
                            import traceback
                            traceback.print_exc()
                
                # Отмечаем, что напоминание отправлено
                if sent_count > 0:
                    update_query = _adapt_query("UPDATE protections SET reminder_2days_sent = 1 WHERE id = ? AND status='active' AND expires_at=?")
                    cur.execute(update_query, (pid, expires_at))
                    conn.commit()
                    print(f"✅ Напоминание за 2 дня отправлено для защиты #{pid} ({sent_count} получателей)")

            conn.close()
        except Exception as e:
            print("❌ Ошибка в проверке истекающих защит:", e)
            import traceback
            traceback.print_exc()

        await asyncio.sleep(6 * 60 * 60)  # проверяем каждые 6 часов для более оперативных уведомлений


async def auto_close_expired_protections():
    """Автоматическое закрытие защит, срок которых истёк без продления"""
    while True:
        try:
            # В выходные/праздники авто-закрытие не выполняем (счётчик не должен "тикать")
            if not is_workday(datetime.utcnow()):
                await asyncio.sleep(6 * 60 * 60)
                continue

            conn = get_conn()
            cur = conn.cursor()
            now = datetime.utcnow()
            now_iso_str = now.isoformat()

            # Находим все активные защиты, которые уже истекли (по рабочим дням).
            # SQL сравнение по дате не подходит, т.к. официальные выходные/праздники не должны
            # приводить к закрытию "в субботу/воскресенье".
            query = _adapt_query("""
                SELECT p.id, p.manager, p.sku, p.partner, p.partner_city, p.manager_id,
                       p.expires_at, p.auto_closed,
                       u.tg_id
                FROM protections p
                LEFT JOIN users u ON u.id = p.manager_id
                WHERE p.status = 'active' 
                  AND (p.auto_closed IS NULL OR p.auto_closed = 0)
            """)
            cur.execute(query)
            candidate_rows = cur.fetchall()

            closed_count = 0
            for row in candidate_rows:
                pid = row["id"]
                manager_name = row["manager"] if "manager" in row.keys() else "—"
                sku = row["sku"] if "sku" in row.keys() else "—"
                partner = row["partner"] if "partner" in row.keys() else "—"
                partner_city = row["partner_city"] if "partner_city" in row.keys() else "—"
                manager_id = row["manager_id"] if "manager_id" in row.keys() else None
                tg_id = row["tg_id"] if "tg_id" in row.keys() else None
                expires_at = row["expires_at"] if "expires_at" in row.keys() else "—"

                if not expires_at or expires_at == "—":
                    continue

                # Истекло, если дата истечения раньше сегодняшней даты.
                # workdays_until вернёт отрицательное значение, когда protection уже "в прошлом".
                if workdays_until(expires_at, now) >= 0:
                    continue

                # Закрываем защиту
                close_reason = "за бездействие менеджера"
                update_query = _adapt_query("""
                    UPDATE protections 
                    SET status = 'closed', 
                        auto_closed = 1,
                        close_reason = ?,
                        closed_at = ?,
                        updated_at = ?
                    WHERE id = ? AND status='active' AND expires_at=? AND (auto_closed IS NULL OR auto_closed=0)
                """)
                cur.execute(update_query, (close_reason, now_iso_str, now_iso_str, pid, expires_at))
                if cur.rowcount != 1:
                    continue
                
                # Записываем в историю
                add_history(cur, pid, "system", "close", {
                    "reason": close_reason,
                    "auto": True,
                    "expired_at": expires_at
                })
                
                conn.commit()
                closed_count += 1
                
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
                    for row_recipient in recipients_rows:
                        if row_recipient["tg_id"]:
                            try:
                                recipients.append(int(row_recipient["tg_id"]))
                            except:
                                pass
                
                # Ищем пользователей, привязанных через manager_ids (JSON массив)
                import json
                query_recipients = _adapt_query("SELECT tg_id, manager_ids FROM users WHERE tg_id IS NOT NULL AND tg_id != ''")
                cur.execute(query_recipients)
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
                
                # Отправляем уведомление всем получателям (менеджеру и привязанным пользователям)
                if recipients:
                    msg = (
                        f"🔒 <b>Защита #{pid} автоматически закрыта</b>\n\n"
                        f"📦 SKU: {sku}\n"
                        f"🏢 Партнёр: {partner} ({partner_city})\n"
                        f"⏰ Дата истечения: {expires_at[:10]}\n"
                        f"📝 Причина: {close_reason}\n\n"
                        f"Защита была закрыта автоматически, так как срок истёк и не было продления."
                    )
                    
                    sent_count = 0
                    for tid in recipients:
                        if not tid:
                            continue
                        try:
                            tg_id_int = int(tid) if isinstance(tid, (int, str)) and str(tid).isdigit() else None
                            if not tg_id_int:
                                print(f"⚠️ Некорректный tg_id для уведомления об авто-закрытии: {tid} (тип: {type(tid)})")
                                continue
                            await bot.send_message(
                                tg_id_int,
                                msg,
                                parse_mode="HTML"
                            )
                            sent_count += 1
                            print(f"📩 Уведомление об авто-закрытии отправлено получателю {tg_id_int} (защита #{pid})")
                        except Exception as e:
                            error_msg = str(e)
                            # Игнорируем ошибку "chat not found" - пользователь не начал диалог с ботом
                            if "chat not found" in error_msg.lower() or "bad request" in error_msg.lower():
                                print(f"⚠️ Пользователь {tid} не начал диалог с ботом (защита #{pid})")
                            else:
                                print(f"⚠️ Ошибка отправки уведомления об авто-закрытии {tid}: {e}")
                                import traceback
                                traceback.print_exc()
                
                    if sent_count > 0:
                        print(f"✅ Уведомления об авто-закрытии отправлены {sent_count} получателям (защита #{pid})")
                
                # Отправляем уведомление админам/суперадминам (только тем, у кого включены уведомления)
                try:
                    admins = cur.execute(_adapt_query("""
                        SELECT tg_id, full_name, first_name 
                        FROM users 
                        WHERE role IN ('admin', 'superadmin') 
                          AND tg_id IS NOT NULL 
                          AND tg_id != ''
                          AND (receive_notifications IS NULL OR receive_notifications = 1)
                    """)).fetchall()
                    
                    admin_msg = (
                        f"🔒 <b>Защита #{pid} автоматически закрыта за бездействие менеджера</b>\n\n"
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
                            error_msg = str(e)
                            # Игнорируем ошибку "chat not found" - пользователь не начал диалог с ботом
                            if "chat not found" in error_msg.lower() or "bad request" in error_msg.lower():
                                print(f"⚠️ Админ {admin_tg_id} не начал диалог с ботом (защита #{pid})")
                            else:
                                print(f"⚠️ Ошибка отправки уведомления админу {admin_tg_id}: {e}")
                                import traceback
                                traceback.print_exc()
                except Exception as e:
                    print(f"⚠️ Ошибка при отправке уведомлений админам: {e}")
                
                print(f"✅ Защита #{pid} автоматически закрыта за бездействие менеджера")

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
    mgr_query = _adapt_query("SELECT id, tg_id, group_tag FROM users WHERE role='manager' AND first_name=?")
    cur.execute(mgr_query, (manager_name,))
    mgr = cur.fetchone()

    group_tag = None
    if mgr:
        if mgr["tg_id"]:
            tg_ids.append(mgr["tg_id"])
        group_tag = mgr["group_tag"]

        # ассистенты этого менеджера
        assistants_query = _adapt_query("SELECT tg_id FROM users WHERE role='assistant' AND manager_id=?")
        cur.execute(assistants_query, (mgr["id"],))
        assistants = cur.fetchall()
        for a in assistants:
            if a["tg_id"]:
                tg_ids.append(a["tg_id"])

    # админы этой же группы (только те, у кого включены уведомления)
    if group_tag:
        admins = cur.execute(
            _adapt_query("SELECT tg_id FROM users WHERE role='admin' AND group_tag=? AND (receive_notifications IS NULL OR receive_notifications = 1)"),
            (group_tag,)
        ).fetchall()
        for a in admins:
            if a["tg_id"]:
                tg_ids.append(a["tg_id"])

    # супер-админ (только те, у кого включены уведомления)
    superadmins_query = _adapt_query("SELECT tg_id FROM users WHERE role='superadmin' AND (receive_notifications IS NULL OR receive_notifications = 1)")
    cur.execute(superadmins_query)
    superadmins = cur.fetchall()
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
      id, manager, partner, partner_city, sku, area_m2, object_city, address, comment, user_name
    }
    """
    pid = p["id"]
    
    # Получаем информацию о пользователе, который просит поставить защиту
    user_name = p.get("user_name", p.get("manager", "—"))
    
    text = (
        "🆕 <b>Новая защита на проверке</b>\n"
        f"👤 <b>Пользователь:</b> {user_name}\n"
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


async def notify_all_users_new_protection(p: dict):
    """
    Отправляет уведомление всем пользователям о новой защите
    p = {
      id, manager, partner, partner_city, sku, area_m2, object_city, address, comment
    }
    """
    pid = p["id"]
    
    text = (
        "🆕 <b>Новая защита создана</b>\n"
        f"👤 Менеджер: {p.get('manager', '—')}\n"
        f"🏢 Партнёр: {p.get('partner', '—')} ({p.get('partner_city', '—')})\n"
        f"📦 SKU: {p.get('sku', '—')}\n"
        f"📏 Площадь: {p.get('area_m2', '—')} м²\n"
        f"📍 Объект: {p.get('object_city', '—')}, {p.get('address', '—')}\n"
        f"⏰ Истекает: {p.get('expires_at', '—')[:10] if p.get('expires_at') else '—'}\n"
        f"💬 Комментарий: {p.get('comment', '—')}"
    )
    
    # Получаем всех пользователей с Telegram ID
    conn = get_conn()
    cur = conn.cursor()
    
    query = _adapt_query("""
        SELECT tg_id, full_name, first_name 
        FROM users 
        WHERE tg_id IS NOT NULL 
          AND tg_id != ''
          AND (receive_notifications IS NULL OR receive_notifications = 1)
    """)
    cur.execute(query)
    users = cur.fetchall()
    conn.close()
    
    sent_count = 0
    for user in users:
        tg_id = user.get("tg_id")
        if tg_id:
            try:
                from backend.db import normalize_tg_id
                tg_id_clean = normalize_tg_id(tg_id)
                
                if tg_id_clean and tg_id_clean.isdigit():
                    await bot.send_message(
                        chat_id=int(tg_id_clean),
                        text=text,
                        parse_mode="HTML"
                    )
                    sent_count += 1
            except Exception as e:
                print(f"⚠️ Не удалось отправить уведомление пользователю {tg_id}: {e}")
    
    print(f"✅ Уведомление о новой защите #{pid} отправлено {sent_count} пользователям")

        


# === Обработка кнопки "Одобрить" ===
@dp.callback_query(F.data.startswith("approve:"))
async def approve_handler(callback: types.CallbackQuery):
    try:
        user = _telegram_actor(callback.from_user.id, admin=True)
        pid = int(callback.data.split(":")[1])
        tasks = BackgroundTasks()
        approve_pending(pid, user=user, background_tasks=tasks)
    except HTTPException as exc:
        await callback.answer(_telegram_error(exc), show_alert=True)
        return
    await callback.answer("Защита одобрена")
    await tasks()


@dp.callback_query(F.data.startswith("reject:"))
async def reject_handler(callback: types.CallbackQuery):
    try:
        _telegram_actor(callback.from_user.id, admin=True)
    except HTTPException as exc:
        await callback.answer(_telegram_error(exc), show_alert=True)
        return
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

    # Запрашиваем причину отклонения
    await callback.answer()
    await callback.message.edit_text(
        f"🚫 <b>Отклонение защиты #{pid}</b>\n\n"
        f"📦 SKU: {r.get('sku', '—')}\n"
        f"👤 Менеджер: {r.get('manager', '—')}\n"
        f"🏢 Партнёр: {r.get('partner', '—')} ({r.get('partner_city', '—')})\n\n"
        f"💬 <b>Причина отклонения:</b> (укажите в ответе на это сообщение)",
        parse_mode="HTML"
    )
    
    # НЕ обновляем статус сразу - обновим только после получения причины в handle_reply_message
    # НЕ записываем в историю сразу - запишем только после получения причины
    
    conn.close()


def _telegram_actor(tg_id, admin=False):
    user = get_user_by_tg_id(str(tg_id))
    if not user or user.get("is_active") in (False, 0, "0"):
        raise HTTPException(status_code=403, detail="Нет доступа. Откройте приложение через Telegram")
    if admin and user.get("role") not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Действие доступно только администратору")
    return dict(user)


def _telegram_error(exc):
    return str(exc.detail.get("msg", "Действие недоступно") if isinstance(exc.detail, dict) else exc.detail)


# === Обработка продления защиты при истечении ===
@dp.callback_query(F.data.startswith("extend:"))
async def extend_expiring_handler(callback: types.CallbackQuery):
    try:
        _, pid, days = callback.data.split(":")
        user = _telegram_actor(callback.from_user.id)
        result = extend(int(pid), days=int(days), user=user)
    except HTTPException as exc:
        await callback.answer(_telegram_error(exc), show_alert=True)
        return
    await callback.answer(f"Защита продлена на {days} рабочих дней")
    await callback.message.edit_text(f"✅ Защита #{pid} продлена. Новая дата: {result.expires_at[:10]}")


# === Обработка успешного завершения защиты при истечении ===
@dp.callback_query(F.data.startswith("success_exp:"))
async def success_expiring_handler(callback: types.CallbackQuery):
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
    
    if row["status"] != "active":
        await callback.answer("❌ Защита не активна", show_alert=True)
        conn.close()
        return
    
    try:
        actor = _telegram_actor(callback.from_user.id)
        _require_protection_access(cur, row, actor)
    except HTTPException as exc:
        conn.close()
        await callback.answer(_telegram_error(exc), show_alert=True)
        return

    # Запрашиваем номер документа 1С
    await callback.answer()
    await callback.message.edit_text(
        f"✅ <b>Отметить защиту #{pid} как успешную</b>\n\n"
        f"📦 SKU: {row['sku'] if 'sku' in row.keys() else '—'}\n"
        f"👤 Менеджер: {row['manager']}\n"
        f"⏰ Дата истечения: {row['expires_at'][:10]}\n\n"
        f"💬 <b>Номер документа из 1С:</b> (укажите в ответе на это сообщение)",
        parse_mode="HTML"
    )
    conn.close()

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
    
    if row["status"] != "active":
        await callback.answer("❌ Защита не активна", show_alert=True)
        conn.close()
        return
    
    try:
        actor = _telegram_actor(callback.from_user.id)
        _require_protection_access(cur, row, actor)
    except HTTPException as exc:
        conn.close()
        await callback.answer(_telegram_error(exc), show_alert=True)
        return

    # Запрашиваем причину закрытия
    await callback.answer()
    await callback.message.edit_text(
        f"🔒 <b>Закрыть защиту #{pid}</b>\n\n"
        f"📦 SKU: {row['sku'] if 'sku' in row.keys() else '—'}\n"
        f"👤 Менеджер: {row['manager']}\n"
        f"⏰ Дата истечения: {row['expires_at'][:10]}\n\n"
        f"💬 <b>Причина закрытия:</b> (укажите в ответе на это сообщение)",
        parse_mode="HTML"
    )
    conn.close()


# === Обработка продления защиты админом ===
@dp.callback_query(F.data.startswith("admin_extend:"))
async def admin_extend_handler(callback: types.CallbackQuery):
    try:
        _, pid, days = callback.data.split(":")
        user = _telegram_actor(callback.from_user.id, admin=True)
        tasks = BackgroundTasks()
        result = admin_extend_any(int(pid), days=int(days), user=user, background_tasks=tasks)
    except HTTPException as exc:
        await callback.answer(_telegram_error(exc), show_alert=True)
        return
    await callback.answer(f"Защита продлена на {days} рабочих дней")
    await callback.message.edit_text(f"✅ Защита #{pid} продлена. Новая дата: {result.expires_at[:10]}")
    await tasks()


# === Обработка кастомного продления (выбор количества дней) ===
@dp.callback_query(F.data.startswith("admin_extend_custom:"))
async def admin_extend_custom_handler(callback: types.CallbackQuery):
    try:
        _telegram_actor(callback.from_user.id, admin=True)
    except HTTPException as exc:
        await callback.answer(_telegram_error(exc), show_alert=True)
        return
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
    try:
        _telegram_actor(callback.from_user.id, admin=True)
    except HTTPException as exc:
        await callback.answer(_telegram_error(exc), show_alert=True)
        return
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
    
    # НЕ удаляем запрос сразу - удалим только после получения причины в handle_reply_message
    # НЕ записываем в историю сразу - запишем только после получения причины
    
    conn.close()

# ===== ЗАЩИТА БОТА ОТ СПАМА И НЕАВТОРИЗОВАННЫХ ПОЛЬЗОВАТЕЛЕЙ =====

# Список запрещенных слов и фраз (спам, реклама, казино и т.д.)
SPAM_KEYWORDS = [
    "казино", "casino", "ставки", "bet", "играть", "выиграть", "приз",
    "реклама", "advert", "рекламирую", "продвижение", "seo",
    "криптовалюта", "bitcoin", "crypto", "майнинг",
    "заработок", "деньги быстро", "быстрый заработок",
    "кредит", "займ", "микрозайм", "деньги под",
    "рассылка", "массовая рассылка", "спам",
    "купить подписчиков", "накрутка", "боты",
    "взлом", "hack", "взломать", "взломаю",
    "продам", "купить", "продать", "скидка", "акция",
    "http://", "https://", "www.", ".ru", ".com",
    "telegram.me", "t.me/", "@", "канал", "группа"
]

# Список разрешенных команд (не фильтруются)
ALLOWED_COMMANDS = ["/start", "/protections", "/pending", "/extend", "/close", "/help"]

def is_spam_message(text: str) -> bool:
    """Проверяет, является ли сообщение спамом"""
    if not text:
        return False
    
    text_lower = text.lower()
    
    # Проверяем на запрещенные слова
    for keyword in SPAM_KEYWORDS:
        if keyword in text_lower:
            return True
    
    # Проверяем на множественные ссылки
    link_count = text_lower.count("http://") + text_lower.count("https://") + text_lower.count("www.")
    if link_count > 1:
        return True
    
    # Проверяем на множественные упоминания каналов/групп
    if text_lower.count("t.me/") > 1 or text_lower.count("@") > 2:
        return True
    
    return False

def is_authorized_user(tg_id: int) -> bool:
    """Проверяет, авторизован ли пользователь (есть ли в базе)"""
    try:
        conn = get_conn()
        cur = conn.cursor()
        query = _adapt_query("SELECT id FROM users WHERE tg_id=?")
        cur.execute(query, (str(tg_id),))
        user = cur.fetchone()
        conn.close()
        return user is not None
    except Exception as e:
        print(f"⚠️ Ошибка проверки авторизации пользователя {tg_id}: {e}")
        return False

def log_suspicious_activity(tg_id: int, username: str, text: str, reason: str):
    """Логирует подозрительную активность и отправляет уведомление админу"""
    log_msg = (
        f"🚨 ПОДОЗРИТЕЛЬНАЯ АКТИВНОСТЬ\n"
        f"Пользователь: {tg_id} (@{username})\n"
        f"Причина: {reason}\n"
        f"Сообщение: {text[:200]}\n"
        f"Время: {now_iso()}"
    )
    print(log_msg)
    
    # Отправляем уведомление админу в Telegram
    try:
        conn = get_conn()
        cur = conn.cursor()
        # Получаем всех админов
        query = _adapt_query("SELECT tg_id FROM users WHERE role IN ('admin', 'superadmin') AND tg_id IS NOT NULL AND tg_id != ''")
        cur.execute(query)
        admins = cur.fetchall()
        conn.close()
        
        alert_text = (
            f"🚨 <b>Подозрительная активность в боте</b>\n\n"
            f"👤 Пользователь: {tg_id} (@{username})\n"
            f"⚠️ Причина: {reason}\n"
            f"💬 Сообщение: {text[:150]}\n"
            f"⏰ Время: {now_iso()}"
        )
        
        for admin in admins:
            tg_id_admin = admin.get("tg_id")
            if tg_id_admin:
                try:
                    from backend.db import normalize_tg_id
                    tg_id_clean = normalize_tg_id(tg_id_admin)
                    if tg_id_clean and tg_id_clean.isdigit():
                        # Используем asyncio для отправки
                        import asyncio
                        try:
                            loop = asyncio.get_event_loop()
                            if loop.is_running():
                                asyncio.create_task(bot.send_message(
                                    chat_id=int(tg_id_clean),
                                    text=alert_text,
                                    parse_mode="HTML"
                                ))
                            else:
                                loop.run_until_complete(bot.send_message(
                                    chat_id=int(tg_id_clean),
                                    text=alert_text,
                                    parse_mode="HTML"
                                ))
                        except Exception as e:
                            print(f"⚠️ Ошибка отправки уведомления админу {tg_id_clean}: {e}")
                except Exception as e:
                    print(f"⚠️ Ошибка обработки tg_id админа: {e}")
    except Exception as e:
        print(f"⚠️ Ошибка при отправке уведомления админу: {e}")

# Middleware для защиты от спама (проверяет все сообщения перед обработкой)
@dp.message.middleware()
async def spam_protection_middleware(handler, event, data):
    """Middleware для защиты от спама и неавторизованных пользователей"""
    # Проверяем, что это текстовое сообщение
    if not hasattr(event, 'text') or not event.text:
        # Не текстовые сообщения пропускаем
        return await handler(event, data)
    
    tg_id = event.from_user.id
    username = event.from_user.username or "без username"
    text = event.text
    
    # Проверяем, является ли это командой
    if text.startswith("/"):
        command = text.split()[0] if text.split() else ""
        if command in ALLOWED_COMMANDS:
            # Разрешенные команды пропускаем дальше
            return await handler(event, data)
        else:
            # Неизвестная команда - блокируем
            await event.answer("❌ Неизвестная команда. Используйте /start для начала работы.")
            log_suspicious_activity(tg_id, username, text, "Неизвестная команда")
            return  # Блокируем обработку
    
    # Проверяем авторизацию (кроме команды /start)
    if not is_authorized_user(tg_id):
        await event.answer(
            "❌ Вы не авторизованы в системе.\n\n"
            "Используйте команду /start для регистрации."
        )
        log_suspicious_activity(tg_id, username, text, "Неавторизованный пользователь")
        return  # Блокируем обработку
    
    # Проверяем на спам
    if is_spam_message(text):
        await event.answer(
            "❌ Ваше сообщение содержит запрещенный контент (реклама, спам).\n\n"
            "Если это ошибка, обратитесь к администратору."
        )
        log_suspicious_activity(tg_id, username, text, "Спам/реклама")
        return  # Блокируем обработку
    
    # Если сообщение не является ответом на другое сообщение, блокируем его
    # (разрешены только ответы на сообщения бота и команды)
    if not hasattr(event, 'reply_to_message') or not event.reply_to_message:
        await event.answer(
            "❌ Я обрабатываю только команды и ответы на мои сообщения.\n\n"
            "Используйте команды:\n"
            "/start - начало работы\n"
            "/protections - список защит\n"
            "/pending - защиты на проверке\n"
            "/extend - продлить защиту\n"
            "/close - закрыть защиту"
        )
        log_suspicious_activity(tg_id, username, text, "Неразрешенное сообщение")
        return  # Блокируем обработку
    
    # Если все проверки пройдены - пропускаем дальше
    return await handler(event, data)


@dp.message(F.text & F.reply_to_message)
async def handle_reply_message(message: types.Message):
    reply = message.reply_to_message
    if not reply or not reply.from_user or reply.from_user.id != bot.id:
        return
    reply_text = reply.text or ""
    match = re.search(r"#(\d+)", reply_text)
    if not match:
        return
    pid = int(match.group(1))
    text = (message.text or "").strip()
    tasks = BackgroundTasks()
    try:
        if "Отклонение запроса на продление" in reply_text:
            user = _telegram_actor(message.from_user.id, admin=True)
            if not text:
                raise HTTPException(400, "Укажите причину отклонения")
            admin_reject_extend_request(pid, {"reason": text}, user=user)
            result_text = f"Запрос на продление защиты #{pid} отклонён"
        elif "Отклонение защиты" in reply_text:
            user = _telegram_actor(message.from_user.id, admin=True)
            if not text:
                raise HTTPException(400, "Укажите причину отклонения")
            reject_pending(pid, {"reason": text}, user=user, background_tasks=tasks)
            result_text = f"Защита #{pid} отклонена"
        elif "Отметить защиту" in reply_text and "успешн" in reply_text:
            user = _telegram_actor(message.from_user.id)
            mark_success(pid, {"doc_1c": text}, user=user)
            result_text = f"Защита #{pid} отмечена как успешная"
        elif "Закрыть защиту" in reply_text:
            user = _telegram_actor(message.from_user.id)
            mark_closed(pid, {"reason": text}, user=user)
            result_text = f"Защита #{pid} закрыта"
        else:
            return
    except HTTPException as exc:
        await message.answer(_telegram_error(exc))
        return
    await message.answer(result_text)
    await tasks()


from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo

# URL для Telegram WebApp - должен быть HTTPS и доступен публично
WEBAPP_URL = FRONTEND_URL
print(f"🌐 WebApp URL: {WEBAPP_URL}")

@dp.message(F.text == "/start")
async def cmd_start_with_webapp(message: types.Message):
    # Команда /start разрешена для всех (проверка в middleware)
    """
    Команда /start - обновляет данные пользователя и показывает кнопку для входа в WebApp.
    Telegram ID теперь получается автоматически из WebApp, коды верификации не нужны.
    """
    tg_id = message.from_user.id
    username = message.from_user.username or ""
    first_name = message.from_user.first_name or ""
    
    try:
        resolve_verified_user({"id": tg_id, "username": username, "first_name": first_name})
    except HTTPException as exc:
        await message.answer(_telegram_error(exc))
        return

    # Проверяем, что URL правильный (должен быть HTTPS)
    webapp_url = WEBAPP_URL
    if not webapp_url.startswith("https://"):
        print(f"⚠️ ВНИМАНИЕ: WebApp URL должен быть HTTPS! Текущий URL: {webapp_url}")
        # Пробуем исправить
        if webapp_url.startswith("http://"):
            webapp_url = webapp_url.replace("http://", "https://")
        else:
            webapp_url = f"https://{webapp_url}"
        print(f"✅ Исправленный URL: {webapp_url}")
    
    print(f"🌐 Отправка кнопки WebApp с URL: {webapp_url}")
    
    try:
        keyboard = InlineKeyboardMarkup(
            inline_keyboard=[
                [InlineKeyboardButton(text="🚪 Войти в систему", web_app=WebAppInfo(url=webapp_url))]
            ]
        )

        instruction_text = (
            "👋 <b>Добро пожаловать в Aquafloor Guard!</b>\n\n"
            "📋 <b>Инструкция по использованию:</b>\n\n"
            "🛡️ <b>Как ставится защита:</b>\n"
            "• Минимальная площадь: <b>50 м²</b> (защита менее 50 м² запрещена)\n"
            "• От 50 до 100 м² — срок защиты: <b>5 дней</b>\n"
            "• От 100 до 250 м² — срок защиты: <b>10 дней</b>\n"
            "• От 250 до 500 м² — срок защиты: <b>15 дней</b>\n"
            "• От 500 м² и более — срок защиты: <b>30 дней</b>\n\n"
            "⏰ <b>Что происходит за 2 дня до истечения:</b>\n"
            "• Вы получите уведомление в Telegram\n"
            "• В уведомлении будут доступны кнопки:\n"
            "  ✅ Продлить на 10 дней\n"
            "  ✅ Продлить на 30 дней\n"
            "  ✅ Успешно (1С) — отметить как успешную с указанием номера документа из 1С\n"
            "  🔒 Закрыть защиту — закрыть с указанием причины\n\n"
            "💡 <b>Важно:</b>\n"
            "• Если защита истекает без действий, она автоматически закрывается\n"
            "• Менеджер может продлить защиту максимум 2 раза\n"
            "• Для дополнительных продлений обратитесь к администратору\n\n"
            "🚪 Нажмите кнопку ниже, чтобы войти в систему.\n"
            "Ваш Telegram ID определяется автоматически при входе."
        )

        await message.answer(
            instruction_text,
            reply_markup=keyboard,
            parse_mode="HTML"
        )
        print(f"✅ Кнопка WebApp отправлена пользователю {tg_id}")
    except Exception as e:
        print(f"❌ Ошибка создания кнопки WebApp: {e}")
        await message.answer(
            f"❌ Ошибка создания кнопки входа.\n\n"
            f"URL: {webapp_url}\n"
            f"Ошибка: {str(e)}\n\n"
            f"Попробуйте открыть приложение по ссылке:\n{webapp_url}"
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
    try:
        parts = message.text.split()
        if len(parts) != 3:
            raise ValueError()
        user = _telegram_actor(message.from_user.id)
        result = extend(int(parts[1]), days=int(parts[2]), user=user)
        await message.answer(f"✅ Защита #{result.id} продлена на {parts[2]} рабочих дней. Новая дата: {result.expires_at[:10]}")
    except ValueError:
        await message.answer("Использование: /extend <id> <days>. Доступно 10 или 30 рабочих дней.")
    except HTTPException as exc:
        await message.answer(_telegram_error(exc))

@dp.message(F.text.startswith("/close"))
async def cmd_close(message: types.Message):
    try:
        parts = message.text.split(maxsplit=2)
        if len(parts) < 2:
            raise ValueError()
        user = _telegram_actor(message.from_user.id)
        reason = parts[2] if len(parts) > 2 else "Закрыто через бота"
        result = mark_closed(int(parts[1]), {"reason": reason}, user=user)
        await message.answer(f"✅ Защита #{result.id} закрыта. Причина: {reason}")
    except ValueError:
        await message.answer("Использование: /close <id> [причина]")
    except HTTPException as exc:
        await message.answer(_telegram_error(exc))

    


# === Запуск Telegram-бота в фоне ===
_bot_running = False

async def start_tg_bot():
    global _bot_running, _bot_ready
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
            webhook_kwargs = {
                "url": webhook_url,
                "allowed_updates": ["message", "callback_query"],
                "drop_pending_updates": False,
            }
            if TELEGRAM_WEBHOOK_SECRET:
                webhook_kwargs["secret_token"] = TELEGRAM_WEBHOOK_SECRET
            for attempt in range(3):
                try:
                    await bot.set_webhook(**webhook_kwargs)
                    _bot_ready = True
                    break
                except Exception:
                    if attempt == 2:
                        raise
                    await asyncio.sleep(2 ** (attempt + 1))
            print("✅ Webhook установлен успешно")
            print("🤖 Telegram-бот запущен через webhook (inline кнопки активны)")
        except Exception as e:
            print(f"❌ Ошибка установки webhook: {e}")
            _bot_running = False
            _bot_ready = False
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
    secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
    if not hmac.compare_digest(secret, TELEGRAM_WEBHOOK_SECRET):
        raise HTTPException(403, "Invalid webhook secret")
    from aiogram.types import Update
    try:
        update = Update(**await request.json())
    except (ValueError, TypeError):
        raise HTTPException(400, "Invalid Telegram update") from None
    await dp.feed_update(bot, update)
    return {"ok": True}

# === Подключаем users API ===
app.include_router(users_router)

# =========================
# 🔔 Telegram уведомления
# =========================

from fastapi import Body
import requests


@app.post("/api/notify")
def notify_user(data: dict, request: Request):
    if not NOTIFY_TOKEN:
        raise HTTPException(503, "Notification integration is not configured")
    token = request.headers.get("X-Notify-Token") or request.headers.get("Authorization", "")
    if token.startswith("Bearer "):
        token = token[7:].strip()
    if not hmac.compare_digest(token, NOTIFY_TOKEN):
        raise HTTPException(403, "Invalid notify token")
    chat_id = data.get("chat_id") or data.get("tg_id") or data.get("tg_username")
    message = data.get("message") or data.get("text") or ""
    if not chat_id or not message:
        raise HTTPException(400, "chat_id and message are required")
    try:
        res = requests.post(f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
                            json={"chat_id": chat_id, "text": message, "parse_mode": "HTML"}, timeout=15)
        res.raise_for_status()
        return {"ok": True, "response": res.json()}
    except requests.RequestException:
        raise HTTPException(502, "Не удалось отправить уведомление") from None

from fastapi import Request

@app.get("/", tags=["root"])
def root():
    return {"ok": True, "message": "🚀 ProjectGuard backend is alive"}


@app.get("/api/ready")
def readiness():
    if not _database_ready or ((os.getenv("RENDER_SERVICE_URL") or os.getenv("DATABASE_URL")) and not _bot_ready):
        raise HTTPException(503, "Service initialization is not complete")
    conn = None
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("SELECT id, role, is_active, manager_ids FROM users LIMIT 0")
        cur.execute("SELECT id, auto_closed, updated_at, reminder_2days_sent FROM protections LIMIT 0")
        cur.execute("SELECT id, protection_id, actor, payload FROM history LIMIT 0")
    except Exception:
        raise HTTPException(503, "Database is unavailable") from None
    finally:
        if conn is not None:
            conn.close()
    return {"ok": True, "version": "2026.09.08", "commit": os.getenv("RENDER_GIT_COMMIT")}
