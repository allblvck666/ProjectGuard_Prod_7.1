# backend/auth.py
import os
from pathlib import Path
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer
from jose import jwt, JWTError
from datetime import datetime, timedelta, timezone
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
# Enable retirement only after verified re-entry is working on the new frontend.
# Default 0 accepts existing signed sessions without changing secrets or users.
AUTH_MIN_TOKEN_VERSION = int(env_get("AUTH_MIN_TOKEN_VERSION", "0"))
AUTH_TOKEN_VERSION = 1
if AUTH_MIN_TOKEN_VERSION < 0:
    raise RuntimeError("AUTH_MIN_TOKEN_VERSION must be non-negative")


def parse_legacy_token_deadline(value: str | None):
    """An omitted deadline preserves compatibility; configured dates must be UTC."""
    if not value:
        return None
    try:
        deadline = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        if deadline.tzinfo is None or deadline.utcoffset() != timedelta(0):
            raise ValueError("UTC timezone required")
    except ValueError:
        raise RuntimeError("AUTH_LEGACY_TOKENS_UNTIL must be an ISO timestamp in UTC") from None
    return deadline.astimezone(timezone.utc)


# This optional cutoff can be set after the last legacy issuer's full 30-day TTL.
# It retires the old format without shortening any legitimate existing session.
AUTH_LEGACY_TOKENS_UNTIL = parse_legacy_token_deadline(env_get("AUTH_LEGACY_TOKENS_UNTIL"))


def required_token_version():
    minimum = AUTH_MIN_TOKEN_VERSION
    if AUTH_LEGACY_TOKENS_UNTIL is not None and datetime.now(timezone.utc) >= AUTH_LEGACY_TOKENS_UNTIL:
        minimum = max(minimum, 1)
    return minimum


security = HTTPBearer(auto_error=False)


# === JWT ФУНКЦИИ ===

def create_access_token(user: dict):
    """
    Создает JWT токен для пользователя.
    user должен содержать: id, email (или tg_id для обратной совместимости), role
    """
    user_id = user.get("id")
    tg_id = user.get("tg_id")
    role = user.get("role", "user")
    
    payload = {
        "sub": str(user_id),  # Всегда user_id в sub для единообразия
        "user_id": user_id,
        "auth_version": AUTH_TOKEN_VERSION,
        "tg_id": str(tg_id) if tg_id else None,  # Добавляем tg_id в payload
        "role": role,
        "iat": datetime.utcnow(),
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
        "auth_version": AUTH_TOKEN_VERSION,
        "exp": datetime.utcnow() + timedelta(days=30)
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)
    return token


def decode_jwt(token: str):
    if not JWT_SECRET:
        raise HTTPException(status_code=503, detail="Authentication is temporarily unavailable")
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


def get_current_user(credentials=Depends(security)):
    if credentials is None or not getattr(credentials, "credentials", None):
        raise HTTPException(status_code=401, detail="No token provided")
    payload = decode_jwt(credentials.credentials)
    version = payload.get("auth_version", 0)
    minimum_version = required_token_version()
    if minimum_version > 0 and (type(version) is not int or version < minimum_version):
        raise HTTPException(status_code=401, detail="Подтвердите вход заново через Telegram или email и пароль.")
    user = None
    user_id = payload.get("user_id")
    sub = payload.get("sub")
    # Explicit internal IDs must never silently fall back to another account.
    if user_id is not None:
        try:
            user = get_user_by_id(int(user_id))
        except (ValueError, TypeError):
            pass
    elif payload.get("tg_id"):
        from backend.db import get_user_by_tg_id
        user = get_user_by_tg_id(str(payload["tg_id"]))
    elif sub:
        if "@" in str(sub):
            user = get_user_by_email(str(sub))
        else:
            try:
                user = get_user_by_id(int(sub))
            except (ValueError, TypeError):
                pass
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if user.get("is_active", 1) in (0, "0", False):
        raise HTTPException(status_code=403, detail="Ваш аккаунт заблокирован. Обратитесь к администратору.")
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
