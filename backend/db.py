import os
import sqlite3
import csv
from pathlib import Path
from datetime import datetime, timedelta

# Базовая директория
BASE_DIR = Path(__file__).resolve().parent

# Пути
DB_PATH = os.getenv("DB_PATH", str(BASE_DIR / "data.sqlite3"))
DATABASE_URL = os.getenv("DATABASE_URL")  # PostgreSQL connection string
SKUS_PATH = BASE_DIR / "skus.csv"

# Определяем тип БД
USE_POSTGRES = bool(DATABASE_URL)


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
    """Подключение к БД: PostgreSQL если DATABASE_URL есть, иначе SQLite"""
    if USE_POSTGRES:
        try:
            import psycopg2
            from psycopg2.extras import RealDictCursor
            conn = psycopg2.connect(DATABASE_URL)
            conn.cursor_factory = RealDictCursor
            return conn
        except ImportError:
            print("⚠️ psycopg2 не установлен, используем SQLite")
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            return conn
        except Exception as e:
            print(f"⚠️ Ошибка подключения к PostgreSQL: {e}, используем SQLite")
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            return conn
    else:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        return conn

def _get_param_placeholder():
    """Возвращает placeholder для параметров: ? для SQLite, %s для PostgreSQL"""
    return "%s" if USE_POSTGRES else "?"

def _adapt_query(query):
    """Адаптирует SQL запрос для PostgreSQL (заменяет ? на %s)"""
    if USE_POSTGRES:
        return query.replace("?", "%s")
    return query


# === CRUD пользователи ===
def get_user_by_id(user_id: int):
    """Получить пользователя по ID"""
    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        row = cur.fetchone()
        if row:
            # Преобразуем Row в dict
            columns = [description[0] for description in cur.description]
            user_dict = dict(zip(columns, row))
            return user_dict
        return None
    except Exception as e:
        print(f"⚠️ Error in get_user_by_id({user_id}): {e}")
        return None
    finally:
        conn.close()


def get_user_by_tg_id(tg_id: int):
    conn = get_conn()
    cur = conn.cursor()
    query = _adapt_query("SELECT * FROM users WHERE tg_id = ?")
    cur.execute(query, (tg_id,))
    row = cur.fetchone()
    conn.close()
    if row:
        return dict(row) if USE_POSTGRES else dict(row)
    return None


def get_user_by_email(email: str):
    """Получить пользователя по email"""
    conn = get_conn()
    cur = conn.cursor()
    query = _adapt_query("SELECT * FROM users WHERE email = ?")
    cur.execute(query, (email,))
    row = cur.fetchone()
    conn.close()
    if row:
        return dict(row) if USE_POSTGRES else dict(row)
    return None


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
    allowed_fields = ["full_name", "phone", "position", "company", "city", "role", "is_active", "last_login", "tg_username", "first_name", "manager_id", "receive_extend_notifications", "manager_ids"]
    updates = []
    values = []
    
    for field in allowed_fields:
        if field in data:
            updates.append(f"{field} = ?")
            values.append(data[field])
    
    # Всегда обновляем updated_at
    if updates:
        updates.append("updated_at = ?")
        values.append(now_iso())
    
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


def upsert_user(data: dict):
    """
    Создать или обновить пользователя по tg_id (UPSERT логика).
    Если пользователь с таким tg_id существует - обновляет данные.
    Если нет - создает нового.
    """
    conn = get_conn()
    cur = conn.cursor()
    
    tg_id = str(data.get("tg_id", ""))
    if not tg_id:
        conn.close()
        raise ValueError("tg_id is required")
    
    # Проверяем, существует ли пользователь
    cur.execute("SELECT * FROM users WHERE tg_id = ?", (tg_id,))
    existing = cur.fetchone()
    
    now = now_iso()
    
    if existing:
        # Обновляем существующего пользователя
        user_dict = dict(existing)
        user_id = user_dict["id"]
        
        # Подготовка данных для обновления
        update_fields = []
        update_values = []
        
        allowed_update_fields = ["full_name", "phone", "position", "company", "city", "tg_username", "first_name", "is_active"]
        for field in allowed_update_fields:
            if field in data:
                update_fields.append(f"{field} = ?")
                update_values.append(data[field])
        
        # Всегда обновляем updated_at
        update_fields.append("updated_at = ?")
        update_values.append(now)
        
        # Если is_active был 0, можно снова сделать 1
        if "is_active" not in data and user_dict.get("is_active", 1) == 0:
            update_fields.append("is_active = ?")
            update_values.append(1)
        
        # Проверяем роль по телефону - если телефон соответствует суперадмину, обновляем роль
        if "phone" in data:
            import re
            phone_clean = re.sub(r'\D', '', str(data["phone"]))
            if phone_clean == "79207455960":
                # Всегда обновляем роль на superadmin, если телефон соответствует
                update_fields.append("role = ?")
                update_values.append("superadmin")
            elif "role" not in data:
                # Если роль не указана в data, но телефон не суперадмин - оставляем текущую роль
                pass
        
        if update_fields:
            update_values.append(user_id)
            query = f"UPDATE users SET {', '.join(update_fields)} WHERE id = ?"
            cur.execute(query, update_values)
            conn.commit()
        
        # Получаем обновленного пользователя
        conn.close()
        return get_user_by_id(user_id)
    else:
        # Создаем нового пользователя
        full_name = data.get("full_name", "")
        phone = data.get("phone", "")
        position = data.get("position")
        company = data.get("company")
        role = data.get("role", "user")
        is_active = data.get("is_active", 1)
        tg_username = data.get("tg_username", "")
        first_name = data.get("first_name", full_name)
        
        # Если роль не указана, определяем по телефону (суперадмин)
        if role == "user" and phone:
            import re
            phone_clean = re.sub(r'\D', '', str(phone))
            if phone_clean == "79207455960":
                role = "superadmin"
        
        try:
            cur.execute(
                """
                INSERT INTO users (
                    tg_id, tg_username, first_name, full_name, phone, position,
                    company, role, is_active, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    tg_id, tg_username, first_name, full_name, phone, position,
                    company, role, is_active, now, now
                )
            )
            conn.commit()
            user_id = cur.lastrowid
            conn.close()
            return get_user_by_id(user_id)
        except sqlite3.IntegrityError as e:
            conn.close()
            # Если все же произошла ошибка UNIQUE (например, параллельный запрос)
            # Пытаемся получить существующего пользователя
            return get_user_by_tg_id(int(tg_id) if tg_id.isdigit() else None) or get_user_by_tg_id(tg_id)


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
            tg_id TEXT UNIQUE,
            tg_username TEXT,
            first_name TEXT,
            role TEXT DEFAULT 'user',
            group_tag TEXT,
            manager_id INTEGER,
            region TEXT,
            created_at TEXT NOT NULL,
            -- Новые поля для email-регистрации
            email TEXT UNIQUE,
            password_hash TEXT,
            full_name TEXT,
            phone TEXT,
            position TEXT,
            company TEXT,
            city TEXT,
            is_active INTEGER DEFAULT 1,
            last_login TEXT,
            updated_at TEXT,
            extra TEXT,
            receive_extend_notifications INTEGER DEFAULT 0,
            manager_ids TEXT DEFAULT '[]'
        )
        """
    )

    # === Миграция: добавляем новые колонки, если их нет ===
    # Для PostgreSQL используем другой подход
    if USE_POSTGRES:
        # PostgreSQL - проверяем через information_schema
        cur.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'users'
        """)
        existing_columns = {row[0] for row in cur.fetchall()}
    else:
        # SQLite
        cur.execute("PRAGMA table_info(users)")
        existing_columns = {row[1] for row in cur.fetchall()}
    
    new_columns = {
        "email": "TEXT UNIQUE" if not USE_POSTGRES else "TEXT",
        "password_hash": "TEXT",
        "full_name": "TEXT",
        "phone": "TEXT",
        "position": "TEXT",
        "company": "TEXT",
        "city": "TEXT",
        "is_active": "INTEGER DEFAULT 1" if not USE_POSTGRES else "INTEGER DEFAULT 1",
        "last_login": "TEXT",
        "updated_at": "TEXT",
        "extra": "TEXT",
        "receive_extend_notifications": "INTEGER DEFAULT 0",
        "manager_ids": "TEXT DEFAULT '[]'"
    }
    
    # manager_id уже есть в таблице users, но проверим
    if "manager_id" not in existing_columns:
        new_columns["manager_id"] = "INTEGER" if not USE_POSTGRES else "INTEGER"
    
    for col_name, col_def in new_columns.items():
        if col_name not in existing_columns:
            try:
                if USE_POSTGRES:
                    # PostgreSQL не поддерживает UNIQUE в ALTER TABLE ADD COLUMN
                    if "UNIQUE" in col_def:
                        col_def = col_def.replace(" UNIQUE", "")
                    cur.execute(f"ALTER TABLE users ADD COLUMN {col_name} {col_def}")
                else:
                    cur.execute(f"ALTER TABLE users ADD COLUMN {col_name} {col_def}")
                conn.commit()
                print(f"✅ Added column {col_name} to users table")
            except Exception as e:
                # Колонка уже существует или другая ошибка
                print(f"⚠️ Could not add column {col_name}: {e}")
    
    # Миграция: изменяем tg_id с INTEGER на TEXT, если нужно
    # SQLite не поддерживает ALTER COLUMN напрямую, но можно проверить тип
    try:
        cur.execute("SELECT typeof(tg_id) FROM users LIMIT 1")
        result = cur.fetchone()
        # Если таблица пустая или tg_id уже TEXT - ничего не делаем
        # Если есть данные с INTEGER - нужно будет пересоздать таблицу (но это сложно)
        # Для простоты оставляем как есть, но в новых записях будем использовать TEXT
    except:
        pass

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