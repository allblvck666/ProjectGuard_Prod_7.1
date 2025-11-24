# backend/auth.py
import os
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer
from jose import jwt, JWTError
from datetime import datetime, timedelta
from backend.db import get_user_by_id

# Используем тот же способ получения секрета, что и в main.py
# Сначала системные переменные (os.environ), потом .env файл
# Это должно совпадать с env_get() из main.py
JWT_SECRET = os.environ.get("JWT_SECRET") or os.environ.get("SECRET_KEY")
SECRET_KEY = os.environ.get("SECRET_KEY")
# Используем JWT_SECRET или SECRET_KEY (как в main.py)
JWT_SECRET = JWT_SECRET or SECRET_KEY
JWT_ALG = "HS256"

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
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        return payload
    except JWTError as e:
        # Логируем для отладки
        print(f"⚠️ JWT decode error: {e}")
        print(f"⚠️ JWT_SECRET exists: {bool(JWT_SECRET)}")
        raise HTTPException(status_code=401, detail="Invalid token")


# === ADMIN CHECK ===

def require_admin(credentials=Depends(security)):
    """
    Проверяет, что у пользователя роль admin или superadmin
    """
    token = credentials.credentials
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