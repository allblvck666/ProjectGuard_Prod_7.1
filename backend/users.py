import sqlite3
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from datetime import datetime, timedelta
from jose import jwt
from os import getenv

from backend.db import get_conn, now_iso, USE_POSTGRES, _adapt_query, _get_param_placeholder
from backend.auth import require_admin
def _admin_user_record(row):
    # Preserve all existing admin fields while withholding credential hashes.
    return {key: value for key, value in dict(row).items() if key != "password_hash"}


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
def add_user(data: UserCreate, user=Depends(require_admin)):
    from backend.account_admin import create_account
    create_account(user["id"], data.model_dump())
    return {"ok": True, "detail": "Пользователь сохранён"}


# === Список пользователей ===
@router.get("/")
def list_users(user=Depends(require_admin)):
    conn = get_conn()
    cur = conn.cursor()
    query = "SELECT * FROM users ORDER BY id DESC"
    cur.execute(query)
    rows = cur.fetchall()
    conn.close()
    
    # Преобразуем Row в dict
    if USE_POSTGRES:
        users = [_admin_user_record(row) for row in rows]
    else:
        users = [_admin_user_record(row) for row in rows]
    
    return {"ok": True, "users": users}


# === Привязать помощника к менеджеру ===
@router.post("/link-assistant")
def link_assistant(data: LinkAssistant, user=Depends(require_admin)):
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
def get_assistants(manager_id: int, user=Depends(require_admin)):
    conn = get_conn()
    cur = conn.cursor()
    query = _adapt_query("SELECT * FROM users WHERE manager_id=?")
    cur.execute(query, (manager_id,))
    rows = cur.fetchall()
    conn.close()
    return {"ok": True, "assistants": [_admin_user_record(r) for r in rows]}


# === Обновить пользователя (роль, группа, менеджер, регион) ===
@router.patch("/{user_id}")
def update_user(user_id: int, data: dict, user=Depends(require_admin)):
    from backend.account_admin import change_account
    change_account(user["id"], user_id, {key: data[key] for key in ("role", "group_tag", "manager_id", "region") if key in data})
    return {"ok": True, "message": "Пользователь обновлён"}


# === Удалить пользователя ===
@router.delete("/{user_id}")
def delete_user(user_id: int, user=Depends(require_admin)):
    from backend.account_admin import change_account
    change_account(user["id"], user_id, delete=True)
    return {"ok": True, "message": "Доступ отключён, история пользователя сохранена"}


# === Защитить список пользователей (только для админов) ===
@router.get("/", include_in_schema=False)
def list_users_admin(user=Depends(require_admin)):
    conn = get_conn()
    cur = conn.cursor()
    query = "SELECT * FROM users ORDER BY id DESC"
    cur.execute(query)
    rows = cur.fetchall()
    conn.close()
    return {"ok": True, "users": [_admin_user_record(r) for r in rows]}


# === Telegram WebApp Авторизация ===


@router.post("/auth/telegram")
def auth_telegram(user: dict):
    from backend.auth import env_get
    from backend.telegram_identity import require_telegram_identity, resolve_verified_user, login_response
    identity = require_telegram_identity(user, env_get("BOT_TOKEN"))
    return login_response(resolve_verified_user(identity))
