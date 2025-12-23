import sqlite3
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from datetime import datetime, timedelta
from jose import jwt
from os import getenv

from backend.db import get_conn, now_iso, USE_POSTGRES, _adapt_query, _get_param_placeholder
from backend.auth import require_admin

router = APIRouter(prefix="/api/users", tags=["users"])


# === Модели ===
class UserCreate(BaseModel):
    tg_id: int
    tg_username: str = ""
    first_name: str = ""
    role: str = "manager"  # manager | assistant | admin


class LinkAssistant(BaseModel):
    manager_id: int
    assistant_id: int


# === Инициализация таблицы ===
def init_users_table():
    conn = get_conn()
    cur = conn.cursor()
    
    if USE_POSTGRES:
        # PostgreSQL синтаксис
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS users(
                id SERIAL PRIMARY KEY,
                tg_id INTEGER UNIQUE,
                tg_username TEXT,
                first_name TEXT,
                role TEXT,
                manager_id INTEGER,
                group_tag TEXT,
                region TEXT,
                created_at TEXT
            )
            """
        )
    else:
        # SQLite синтаксис
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS users(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tg_id INTEGER UNIQUE,
            tg_username TEXT,
            first_name TEXT,
            role TEXT,
            manager_id INTEGER,
            group_tag TEXT,
            region TEXT,
            created_at TEXT
        )
        """
    )
    conn.commit()
    conn.close()



# === Добавить пользователя ===
@router.post("/")
def add_user(data: UserCreate):
    conn = get_conn()
    cur = conn.cursor()
    
    placeholder = _get_param_placeholder()
    
    if USE_POSTGRES:
        # PostgreSQL использует ON CONFLICT
        query = f"""
            INSERT INTO users (tg_id, tg_username, first_name, role, created_at) 
            VALUES ({placeholder},{placeholder},{placeholder},{placeholder},{placeholder})
            ON CONFLICT (tg_id) DO UPDATE SET
                tg_username = EXCLUDED.tg_username,
                first_name = EXCLUDED.first_name,
                role = EXCLUDED.role,
                created_at = EXCLUDED.created_at
        """
    else:
        # SQLite использует INSERT OR REPLACE
        query = f"""
            INSERT OR REPLACE INTO users (tg_id, tg_username, first_name, role, created_at) 
            VALUES ({placeholder},{placeholder},{placeholder},{placeholder},{placeholder})
        """
    
    cur.execute(query, (data.tg_id, data.tg_username, data.first_name, data.role, now_iso()))
    conn.commit()
    conn.close()
    return {"ok": True}


# === Список пользователей ===
@router.get("/")
def list_users():
    conn = get_conn()
    cur = conn.cursor()
    query = "SELECT * FROM users ORDER BY id DESC"
    cur.execute(query)
    rows = cur.fetchall()
    conn.close()
    
    # Преобразуем Row в dict
    if USE_POSTGRES:
        users = [dict(row) for row in rows]
    else:
        users = [dict(row) for row in rows]
    
    return {"ok": True, "users": users}


# === Привязать помощника к менеджеру ===
@router.post("/link-assistant")
def link_assistant(data: LinkAssistant):
    conn = get_conn()
    cur = conn.cursor()
    placeholder = _get_param_placeholder()
    
    # Проверяем, что оба пользователя есть
    query = _adapt_query("SELECT * FROM users WHERE id=?")
    cur.execute(query, (data.manager_id,))
    mgr = cur.fetchone()
    cur.execute(query, (data.assistant_id,))
    asst = cur.fetchone()

    if not mgr or not asst:
        conn.close()
        raise HTTPException(status_code=404, detail="Manager or Assistant not found")

    query = _adapt_query(f"UPDATE users SET manager_id={placeholder} WHERE id={placeholder}")
    cur.execute(query, (data.manager_id, data.assistant_id))
    conn.commit()
    conn.close()
    return {"ok": True, "msg": "Assistant linked to manager"}


# === Получить помощников по менеджеру ===
@router.get("/assistants/{manager_id}")
def get_assistants(manager_id: int):
    conn = get_conn()
    cur = conn.cursor()
    query = _adapt_query("SELECT * FROM users WHERE manager_id=?")
    cur.execute(query, (manager_id,))
    rows = cur.fetchall()
    conn.close()
    return {"ok": True, "assistants": [dict(r) for r in rows]}


# === Обновить пользователя (роль, группа, менеджер, регион) ===
@router.patch("/{user_id}")
def update_user(user_id: int, data: dict, user=Depends(require_admin)):
    conn = get_conn()
    cur = conn.cursor()
    placeholder = _get_param_placeholder()

    query = _adapt_query("SELECT id FROM users WHERE id=?")
    cur.execute(query, (user_id,))
    exists = cur.fetchone()
    if not exists:
        conn.close()
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    # Строим UPDATE запрос динамически
    updates = []
    values = []
    for key in ["role", "group_tag", "manager_id", "region"]:
        if key in data and data[key] is not None:
            updates.append(f"{key} = {placeholder}")
            values.append(data[key])
    
    if not updates:
        conn.close()
        return {"ok": True, "message": "✅ Нет изменений для обновления"}
    
    values.append(user_id)
    query = f"UPDATE users SET {', '.join(updates)} WHERE id = {placeholder}"
    cur.execute(query, values)
    conn.commit()
    conn.close()
    return {"ok": True, "message": "✅ Пользователь обновлён"}


# === Удалить пользователя ===
@router.delete("/{user_id}")
def delete_user(user_id: int, user=Depends(require_admin)):
    conn = get_conn()
    cur = conn.cursor()
    placeholder = _get_param_placeholder()
    query = _adapt_query(f"DELETE FROM users WHERE id={placeholder}")
    cur.execute(query, (user_id,))
    conn.commit()
    conn.close()
    return {"ok": True, "message": "🗑 Пользователь удалён"}


# === Защитить список пользователей (только для админов) ===
@router.get("/", include_in_schema=False)
def list_users_admin(user=Depends(require_admin)):
    conn = get_conn()
    cur = conn.cursor()
    query = "SELECT * FROM users ORDER BY id DESC"
    cur.execute(query)
    rows = cur.fetchall()
    conn.close()
    return {"ok": True, "users": [dict(r) for r in rows]}


# === Telegram WebApp Авторизация ===
SECRET_KEY = getenv("JWT_SECRET") or getenv("SECRET_KEY") or "dev_secret"
ALGORITHM = "HS256"

@router.post("/auth/telegram")
def auth_telegram(user: dict):
    """
    Принимает объект user от Telegram WebApp
    Возвращает JWT токен
    """
    tg_id = user.get("id")
    username = user.get("username", "")
    first_name = user.get("first_name", "")

    if not tg_id:
        raise HTTPException(status_code=400, detail="Missing Telegram user ID")

    # 1️⃣ Создаём или обновляем пользователя в БД
    conn = get_conn()
    cur = conn.cursor()
    placeholder = _get_param_placeholder()
    
    if USE_POSTGRES:
        # PostgreSQL использует ON CONFLICT DO NOTHING
        query = f"""
            INSERT INTO users (tg_id, tg_username, first_name, role, created_at) 
            VALUES ({placeholder},{placeholder},{placeholder},{placeholder},{placeholder})
            ON CONFLICT (tg_id) DO NOTHING
        """
    else:
        # SQLite использует INSERT OR IGNORE
        query = f"""
            INSERT OR IGNORE INTO users (tg_id, tg_username, first_name, role, created_at) 
            VALUES ({placeholder},{placeholder},{placeholder},{placeholder},{placeholder})
        """
    
    cur.execute(query, (tg_id, username, first_name, "manager", now_iso()))
    conn.commit()
    conn.close()

    # 2️⃣ Генерируем JWT токен
    payload = {
        "sub": str(tg_id),
        "role": "manager",
        "exp": datetime.utcnow() + timedelta(days=7),
    }
    token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

    return {"ok": True, "token": token, "user": {"tg_id": tg_id, "username": username}}
