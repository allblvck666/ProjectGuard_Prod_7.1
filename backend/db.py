import os
import sqlite3
import csv
from pathlib import Path
from datetime import datetime, timedelta

# Базовая директория
BASE_DIR = Path(__file__).resolve().parent

# Пути
DB_PATH = os.getenv("DB_PATH", str(BASE_DIR / "data.sqlite3"))
SKUS_PATH = BASE_DIR / "skus.csv"


# === CSV загрузка ===
def load_skus():
    items = []
    if not SKUS_PATH.exists():
        return items

    with open(SKUS_PATH, newline="", encoding="utf-8-sig") as f:
        try:
            reader = csv.DictReader(f)
            for row in reader:
                sku = (row.get("Артикулы") or "").strip()
                if not sku:
                    continue
                collection = (row.get("Коллекция") or "").strip()
                type_ = (row.get("Тип (клей/замок)") or "").strip().lower()
                if type_ not in ("клей", "замок"):
                    continue
                items.append(
                    {
                        "sku": sku,
                        "collection": collection,
                        "type": type_,
                    }
                )
            if items:
                items.sort(key=lambda x: (x["sku"], x["collection"], x["type"]))
                return items
        except Exception:
            pass

        f.seek(0)
        rows = list(csv.reader(f))
        if not rows:
            return items

        maxw = max(len(r) for r in rows)
        norm = []
        for r in rows:
            r = list(r)
            if len(r) < maxw:
                r.extend([""] * (maxw - len(r)))
            norm.append(r)

        collections = [c.strip() for c in norm[0]]
        raw_types = [t.strip() for t in norm[1]]

        def normalize_type(t):
            tl = t.lower()
            if "кле" in tl:
                return "клей"
            if "зам" in tl:
                return "замок"
            return t.strip()

        types = [normalize_type(t) for t in raw_types]

        seen = set()
        for row in norm[2:]:
            for col, cell in enumerate(row):
                sku = cell.strip()
                if not sku:
                    continue
                coll = collections[col]
                tp = types[col]
                key = (sku, coll, tp)
                if key in seen:
                    continue
                seen.add(key)
                items.append(
                    {
                        "sku": sku,
                        "collection": coll,
                        "type": tp,
                    }
                )

    items.sort(key=lambda x: (x["sku"], x["collection"], x["type"]))
    return items


# === DB подключение ===
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# === CRUD пользователи ===
def get_user_by_id(user_id: int):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def get_user_by_tg_id(tg_id: int):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM users WHERE tg_id = ?", (tg_id,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def get_user_by_email(email: str):
    """Получить пользователя по email"""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM users WHERE email = ?", (email,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def create_user(data: dict):
    """Создать нового пользователя"""
    conn = get_conn()
    cur = conn.cursor()
    
    # Подготовка данных
    email = data.get("email")
    password_hash = data.get("password_hash")
    full_name = data.get("full_name", "")
    phone = data.get("phone", "")
    company = data.get("company", "")
    city = data.get("city", "")
    role = data.get("role", "manager")
    is_active = data.get("is_active", 1)
    created_at = data.get("created_at", now_iso())
    
    # Telegram поля (опционально)
    tg_id = data.get("tg_id")
    tg_username = data.get("tg_username", "")
    first_name = data.get("first_name", "")
    
    try:
        cur.execute(
            """
            INSERT INTO users (
                email, password_hash, full_name, phone, company, city,
                role, is_active, created_at,
                tg_id, tg_username, first_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                email, password_hash, full_name, phone, company, city,
                role, is_active, created_at,
                tg_id, tg_username, first_name
            )
        )
        conn.commit()
        user_id = cur.lastrowid
        conn.close()
        return get_user_by_id(user_id)
    except sqlite3.IntegrityError as e:
        conn.close()
        raise ValueError(f"User with email {email} already exists") from e


def update_user(user_id: int, data: dict):
    """Обновить данные пользователя"""
    conn = get_conn()
    cur = conn.cursor()
    
    # Разрешенные поля для обновления
    allowed_fields = ["full_name", "phone", "company", "city", "role", "is_active", "last_login"]
    updates = []
    values = []
    
    for field in allowed_fields:
        if field in data:
            updates.append(f"{field} = ?")
            values.append(data[field])
    
    if not updates:
        conn.close()
        return get_user_by_id(user_id)
    
    values.append(user_id)
    query = f"UPDATE users SET {', '.join(updates)} WHERE id = ?"
    
    cur.execute(query, values)
    conn.commit()
    conn.close()
    return get_user_by_id(user_id)


def get_all_users():
    """Получить всех пользователей (для админки)"""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM users ORDER BY created_at DESC")
    rows = cur.fetchall()
    conn.close()
    return [dict(row) for row in rows]


# === Инициализация таблиц ===
def init_db():
    conn = get_conn()
    cur = conn.cursor()

    # === Protections ===
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS protections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            manager TEXT NOT NULL,
            client TEXT,
            partner TEXT,
            partner_city TEXT,
            sku TEXT,
            area_m2 REAL,
            last4 TEXT,
            object_city TEXT,
            address TEXT,
            comment TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            closed_at TEXT,
            -- новые поля, которые использует main.py
            extend_count INTEGER DEFAULT 0,
            auto_closed INTEGER DEFAULT 0,
            updated_at TEXT,
            approved_by_admin INTEGER DEFAULT 0,
            admin_comment TEXT,
            manager_id INTEGER
        )
        """
    )

    # === Users ===
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tg_id INTEGER UNIQUE,
            tg_username TEXT,
            first_name TEXT,
            role TEXT DEFAULT 'manager',
            group_tag TEXT,
            manager_id INTEGER,
            region TEXT,
            created_at TEXT NOT NULL,
            -- Новые поля для email-регистрации
            email TEXT UNIQUE,
            password_hash TEXT,
            full_name TEXT,
            phone TEXT,
            company TEXT,
            city TEXT,
            is_active INTEGER DEFAULT 1,
            last_login TEXT
        )
        """
    )

    # === Миграция: добавляем новые колонки, если их нет ===
    cur.execute("PRAGMA table_info(users)")
    existing_columns = {row[1] for row in cur.fetchall()}
    
    new_columns = {
        "email": "TEXT UNIQUE",
        "password_hash": "TEXT",
        "full_name": "TEXT",
        "phone": "TEXT",
        "company": "TEXT",
        "city": "TEXT",
        "is_active": "INTEGER DEFAULT 1",
        "last_login": "TEXT"
    }
    
    for col_name, col_def in new_columns.items():
        if col_name not in existing_columns:
            try:
                cur.execute(f"ALTER TABLE users ADD COLUMN {col_name} {col_def}")
                print(f"✅ Added column {col_name} to users table")
            except sqlite3.OperationalError as e:
                # Колонка уже существует или другая ошибка
                print(f"⚠️ Could not add column {col_name}: {e}")
    
    # Убираем NOT NULL с tg_id, если он был обязательным (для email-пользователей)
    # Это уже сделано в CREATE TABLE выше (tg_id INTEGER UNIQUE без NOT NULL)

    # === Managers ===
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS managers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            telegrams TEXT DEFAULT '[]',
            created_at TEXT
        )
        """
    )

    # === History (для add_history и /api/history) ===
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            protection_id INTEGER NOT NULL,
            at TEXT NOT NULL,
            actor TEXT NOT NULL,
            action TEXT NOT NULL,
            payload TEXT,
            FOREIGN KEY (protection_id) REFERENCES protections (id)
        )
        """
    )

    # === Telegram notifications (tg_notifications) ===
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS tg_notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            protection_id INTEGER NOT NULL,
            chat_id INTEGER NOT NULL,
            message_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (protection_id) REFERENCES protections (id)
        )
        """
    )

    conn.commit()
    conn.close()


# === Вспомогательные ===
def now_iso():
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def add_days(dt_iso, days: int):
    dt = datetime.fromisoformat(dt_iso.replace("Z", ""))
    return (dt + timedelta(days=days)).isoformat(timespec="seconds") + "Z"