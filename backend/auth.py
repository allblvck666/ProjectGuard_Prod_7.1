# backend/auth.py
from os import getenv
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer
from jose import jwt, JWTError
from datetime import datetime, timedelta
from backend.db import get_user_by_id

JWT_SECRET = getenv("JWT_SECRET") or getenv("SECRET_KEY") or "dev_secret"
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
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        return payload
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


# === ADMIN CHECK ===

def require_admin(credentials=Depends(security)):
    """
    Проверяет, что у пользователя роль admin или superadmin
    """
    token = credentials.credentials
    payload = decode_jwt(token)

    user_id = payload.get("user_id")
    user = get_user_by_id(user_id)

    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    if user["role"] not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Access denied")

    return user