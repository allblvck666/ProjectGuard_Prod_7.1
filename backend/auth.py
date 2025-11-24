# backend/auth.py
import os
from pathlib import Path
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer
from jose import jwt, JWTError
from datetime import datetime, timedelta
from backend.db import get_user_by_id

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

def create_jwt(user_id: int):
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

def require_auth(credentials=Depends(security)):
    """
    Проверяет валидность токена и возвращает пользователя (любая роль)
    """
    token = credentials.credentials
    if not token:
        print("⚠️ No token provided in Authorization header")
        raise HTTPException(status_code=401, detail="No token provided")
    
    try:
        payload = decode_jwt(token)
    except HTTPException as e:
        print(f"⚠️ JWT decode failed in require_auth: {e.detail}")
        raise
    
    # Поддерживаем оба формата: "sub" (из main.py) и "user_id" (из create_jwt)
    user_id = payload.get("user_id") or payload.get("sub")
    if not user_id:
        print("⚠️ JWT payload missing user_id and sub:", list(payload.keys()))
        raise HTTPException(status_code=401, detail="Invalid token: missing user_id")
    
    user_id = int(user_id) if isinstance(user_id, str) else user_id
    
    user = get_user_by_id(user_id)
    
    if not user:
        print(f"⚠️ User not found for user_id: {user_id}, payload keys: {list(payload.keys())}")
        raise HTTPException(status_code=401, detail="User not found")

    return user


# === ADMIN CHECK ===

def require_admin(credentials=Depends(security)):
    """
    Проверяет, что у пользователя роль admin или superadmin
    """
    token = credentials.credentials
    if not token:
        print("⚠️ No token provided in Authorization header")
        raise HTTPException(status_code=401, detail="No token provided")
    
    try:
        payload = decode_jwt(token)
    except HTTPException as e:
        print(f"⚠️ JWT decode failed in require_admin: {e.detail}")
        raise
    
    # Поддерживаем оба формата: "sub" (из main.py) и "user_id" (из create_jwt)
    user_id = payload.get("user_id") or payload.get("sub")
    if not user_id:
        print("⚠️ JWT payload missing user_id and sub:", list(payload.keys()))
        raise HTTPException(status_code=401, detail="Invalid token: missing user_id")
    
    user_id = int(user_id) if isinstance(user_id, str) else user_id
    
    user = get_user_by_id(user_id)
    
    if not user:
        print(f"⚠️ User not found for user_id: {user_id}, payload keys: {list(payload.keys())}")
        raise HTTPException(status_code=401, detail="User not found")

    if user["role"] not in ("admin", "superadmin"):
        print(f"⚠️ Access denied for user_id {user_id}, role: {user['role']}")
        raise HTTPException(status_code=403, detail="Access denied")

    return user