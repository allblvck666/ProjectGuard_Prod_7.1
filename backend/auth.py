# backend/auth.py
import os
from pathlib import Path
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer
from jose import jwt, JWTError
from datetime import datetime, timedelta
from backend.db import get_user_by_id, get_user_by_email

# ИСПОЛЬЗУЕМ ТОТ ЖЕ СПОСОБ ПОЛУЧЕНИЯ СЕКРЕТА, ЧТО И В main.py
# Копируем логику env_get() из main.py для точного совпадения
BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"

def load_env_file(path: Path) -> dict:
    data = {}
    if path.exists():
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

# Используем ТОЧНО ТАК ЖЕ, как в main.py
SECRET_KEY = env_get("SECRET_KEY")
JWT_SECRET = env_get("JWT_SECRET") or SECRET_KEY
JWT_ALG = "HS256"

# Логируем для отладки (только на проде)
if os.environ.get("RENDER"):
    print("DEBUG auth.py: SECRET_KEY exists:", bool(SECRET_KEY))
    print("DEBUG auth.py: JWT_SECRET exists:", bool(JWT_SECRET))
    if JWT_SECRET:
        print("DEBUG auth.py: JWT_SECRET length:", len(JWT_SECRET), "start:", JWT_SECRET[:10] + "...")

security = HTTPBearer()


# === JWT ФУНКЦИИ ===

def create_access_token(user: dict):
    """
    Создает JWT токен для пользователя.
    user должен содержать: id, email (или tg_id для обратной совместимости), role
    """
    user_id = user.get("id")
    email = user.get("email")
    tg_id = user.get("tg_id")
    role = user.get("role", "user")
    
    # Для обратной совместимости: если нет email, используем tg_id или user_id
    sub = email or str(tg_id) if tg_id else str(user_id)
    
    payload = {
        "sub": str(user_id),  # Всегда user_id в sub для единообразия
        "user_id": user_id,
        "tg_id": str(tg_id) if tg_id else None,  # Добавляем tg_id в payload
        "role": role,
        "exp": datetime.utcnow() + timedelta(days=30)
    }
    # Убираем None значения из payload
    payload = {k: v for k, v in payload.items() if v is not None}
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)
    return token


def create_jwt(user_id: int):
    """Старая функция для обратной совместимости"""
    payload = {
        "user_id": user_id,
        "exp": datetime.utcnow() + timedelta(days=30)
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)
    return token


def decode_jwt(token: str):
    try:
        # Пробуем декодировать с текущим секретом
        if not JWT_SECRET:
            print("⚠️ JWT_SECRET is None or empty!")
            raise HTTPException(status_code=500, detail="JWT secret not configured")
        
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        return payload
    except JWTError as e:
        # Логируем для отладки
        print(f"⚠️ JWT decode error: {e}")
        print(f"⚠️ JWT_SECRET exists: {bool(JWT_SECRET)}")
        if JWT_SECRET:
            print(f"⚠️ JWT_SECRET length: {len(JWT_SECRET)}, start: {JWT_SECRET[:10]}...")
        raise HTTPException(status_code=401, detail="Invalid token")


# === AUTH CHECK ===

def get_current_user(credentials=Depends(security)):
    """
    Проверяет валидность токена и возвращает пользователя (любая роль).
    Поддерживает поиск по user_id или email (из sub).
    """
    token = credentials.credentials
    if not token:
        print("⚠️ No token provided in Authorization header")
        raise HTTPException(status_code=401, detail="No token provided")
    
    try:
        payload = decode_jwt(token)
    except HTTPException as e:
        print(f"⚠️ JWT decode failed in get_current_user: {e.detail}")
        raise
    
    # Поддерживаем оба формата: user_id напрямую или через sub
    user_id = payload.get("user_id")
    sub = payload.get("sub")
    tg_id = payload.get("tg_id")
    
    user = None
    
    # Сначала пробуем по user_id
    if user_id:
        try:
            user_id_int = int(user_id) if isinstance(user_id, str) else user_id
            user = get_user_by_id(user_id_int)
            if user:
                print(f"✅ User found by user_id: {user_id_int}")
        except (ValueError, TypeError) as e:
            print(f"⚠️ Error converting user_id {user_id}: {e}")
            pass
    
    # Если не нашли по user_id, пробуем по tg_id из payload
    if not user and tg_id:
        from backend.db import get_user_by_tg_id
        user = get_user_by_tg_id(tg_id)
    
    # Если не нашли, пробуем по sub (может быть email или user_id)
    if not user and sub:
        # Пробуем как email
        if "@" in str(sub):
            user = get_user_by_email(str(sub))
        else:
            # Пробуем как user_id (старые токены)
            try:
                user_id_int = int(sub)
                user = get_user_by_id(user_id_int)
            except (ValueError, TypeError):
                pass
    
    if not user:
        print(f"⚠️ User not found. user_id={user_id}, sub={sub}, tg_id={tg_id}, payload keys: {list(payload.keys())}")
        # Пробуем найти пользователя по tg_id, если он есть в payload
        if tg_id:
            from backend.db import get_user_by_tg_id
            user = get_user_by_tg_id(tg_id)
            if user:
                print(f"✅ User found by tg_id: {tg_id}")
        
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
    
    # Проверяем is_active
    is_active = user.get("is_active", 1)
    if is_active == 0:
        print(f"⚠️ User {user.get('id')} is inactive")
        raise HTTPException(status_code=401, detail="User is inactive")
    
    return user


def get_current_active_user(credentials=Depends(security)):
    """Алиас для get_current_user (для ясности)"""
    return get_current_user(credentials)


def require_auth(credentials=Depends(security)):
    """Старая функция для обратной совместимости"""
    return get_current_user(credentials)


# === ADMIN CHECK ===

def get_admin_user(credentials=Depends(security)):
    """
    Проверяет, что у пользователя роль admin или superadmin
    """
    user = get_current_user(credentials)
    
    if user["role"] not in ("admin", "superadmin"):
        print(f"⚠️ Access denied for user_id {user.get('id')}, role: {user['role']}")
        raise HTTPException(status_code=403, detail="Access denied")
    
    return user


def get_superadmin_user(credentials=Depends(security)):
    """
    Проверяет, что у пользователя роль superadmin
    """
    user = get_current_user(credentials)
    
    if user["role"] != "superadmin":
        print(f"⚠️ Access denied for user_id {user.get('id')}, role: {user['role']}")
        raise HTTPException(status_code=403, detail="Superadmin access required")
    
    return user


def require_admin(credentials=Depends(security)):
    """Старая функция для обратной совместимости"""
    return get_admin_user(credentials)