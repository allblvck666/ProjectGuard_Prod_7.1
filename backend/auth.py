# backend/auth.py
from fastapi import Header, HTTPException, Depends
from jose import jwt, JWTError

SECRET_KEY = "SUPER_SECRET_KEY"  # ДОЛЖЕН совпадать с тем, где ты создаёшь токен
ALGORITHM = "HS256"

def get_current_user(authorization: str = Header(default=None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid auth header")

    token = authorization.split(" ", 1)[1]

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError as e:
        print("JWT decode error:", e)
        raise HTTPException(status_code=401, detail="Invalid token")

    # payload = { "tg_id": 426188469, "role": "manager" / "superadmin", ... }
    return payload

SUPERADMINS = {426188469}  # твой tg_id

def superadmin_required(user: dict = Depends(get_current_user)):
    if user.get("tg_id") not in SUPERADMINS and user.get("role") != "superadmin":
        # тут 403, чтобы отличать "нет токена" от "нет прав"
        raise HTTPException(status_code=403, detail="Forbidden")
    return user
