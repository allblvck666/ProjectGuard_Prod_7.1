import os
import sqlite3
import csv
from pathlib import Path
from datetime import datetime, timedelta, date
from typing import Set

# Базовая директория
BASE_DIR = Path(__file__).resolve().parent

# Загрузка переменных окружения из .env файла (для локальной разработки)
try:
    from dotenv import load_dotenv
    try:
        load_dotenv(BASE_DIR / ".env")
    except (PermissionError, FileNotFoundError, OSError):
        # Файл недоступен или не существует - это нормально на Render
        pass
except ImportError:
    # python-dotenv не установлен, используем только системные переменные окружения
    pass

# Пути
DB_PATH = os.getenv("DB_PATH", str(BASE_DIR / "data.sqlite3"))
DATABASE_URL = os.getenv("DATABASE_URL")  # PostgreSQL connection string
SKUS_PATH = BASE_DIR / "skus.csv"

# Определяем тип БД - проверяем и наличие DATABASE_URL, и возможность использовать psycopg2
def _can_use_postgres():
    """Проверяет, можем ли мы использовать PostgreSQL"""
    if not DATABASE_URL:
        return False
    try:
        import psycopg2
        return True
    except ImportError:
        return False

USE_POSTGRES = _can_use_postgres()


class HybridRow(dict):
    """
    Совместимый контейнер строки SQLite:
    - поддерживает доступ по имени поля: row["field"], row.get("field")
    - поддерживает доступ по индексу: row[0] (для legacy-кода)
    """
    def __init__(self, values_by_name: dict, columns: list[str]):
        super().__init__(values_by_name)
        self._columns = columns

    def __getitem__(self, key):
        if isinstance(key, int):
            try:
                key = self._columns[key]
            except IndexError as exc:
                raise KeyError(key) from exc
        return super().__getitem__(key)


def _sqlite_hybrid_row_factory(cursor, row):
    columns = [col[0] for col in cursor.description]
    values_by_name = {columns[idx]: row[idx] for idx in range(len(columns))}
    return HybridRow(values_by_name, columns)


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
            conn.row_factory = _sqlite_hybrid_row_factory
            return conn
        except Exception as e:
            print(f"⚠️ Ошибка подключения к PostgreSQL: {e}, используем SQLite")
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = _sqlite_hybrid_row_factory
            return conn
    else:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = _sqlite_hybrid_row_factory
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
        query = _adapt_query("SELECT * FROM users WHERE id = ?")
        cur.execute(query, (user_id,))
        row = cur.fetchone()
        if row:
            # Преобразуем Row в dict
            if USE_POSTGRES:
                return dict(row)
            else:
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
        query = _adapt_query("""
            INSERT INTO users (
                email, password_hash, full_name, phone, company, city,
                role, is_active, created_at,
                tg_id, tg_username, first_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """)
        cur.execute(
            query,
            (
                email, password_hash, full_name, phone, company, city,
                role, is_active, created_at,
                tg_id, tg_username, first_name
            )
        )
        conn.commit()
        if USE_POSTGRES:
            # PostgreSQL возвращает ID через RETURNING или cur.fetchone()
            cur.execute(_adapt_query("SELECT id FROM users WHERE email = ? ORDER BY id DESC LIMIT 1"), (email,))
            row = cur.fetchone()
            user_id = row["id"] if row else None
        else:
            user_id = cur.lastrowid
        conn.close()
        return get_user_by_id(user_id) if user_id else None
    except Exception as e:
        conn.close()
        # Обработка ошибок для PostgreSQL и SQLite
        error_str = str(e).lower()
        if "unique" in error_str or "duplicate" in error_str or "already exists" in error_str:
            raise ValueError(f"User with email {email} already exists") from e
        raise


def update_user(user_id: int, data: dict):
    """Обновить данные пользователя"""
    conn = get_conn()
    cur = conn.cursor()
    
    # Разрешенные поля для обновления
    allowed_fields = ["full_name", "phone", "position", "company", "city", "role", "is_active", "last_login", "tg_username", "first_name", "manager_id", "receive_extend_notifications", "manager_ids"]
    updates = []
    values = []
    
    placeholder = _get_param_placeholder()
    
    for field in allowed_fields:
        if field in data:
            updates.append(f"{field} = {placeholder}")
            values.append(data[field])
    
    # Всегда обновляем updated_at
    if updates:
        updates.append(f"updated_at = {placeholder}")
        values.append(now_iso())
    
    if not updates:
        conn.close()
        return get_user_by_id(user_id)
    
    values.append(user_id)
    query = f"UPDATE users SET {', '.join(updates)} WHERE id = {placeholder}"
    
    cur.execute(query, values)
    conn.commit()
    conn.close()
    return get_user_by_id(user_id)


def get_all_users():
    """Получить всех пользователей (для админки)"""
    conn = get_conn()
    cur = conn.cursor()
    query = _adapt_query("SELECT * FROM users ORDER BY created_at DESC")
    cur.execute(query)
    rows = cur.fetchall()
    conn.close()
    return [dict(row) for row in rows]


def normalize_tg_id(tg_id):
    """
    Нормализует tg_id, убирая префиксы 'dev-', 'tg-' и оставляя только числовой ID.
    """
    if not tg_id:
        return None
    tg_id_str = str(tg_id).strip()
    # Убираем префиксы
    tg_id_str = tg_id_str.replace("dev-", "").replace("tg-", "").strip()
    # Проверяем, что осталось число
    if tg_id_str.isdigit():
        return tg_id_str
    # Если не число, возвращаем как есть (на случай, если это уже нормализованный ID)
    return tg_id_str if tg_id_str else None

def upsert_user(data: dict):
    """
    Создать или обновить пользователя по tg_id (UPSERT логика).
    Если пользователь с таким tg_id существует - обновляет данные.
    Если нет - создает нового.
    """
    conn = get_conn()
    cur = conn.cursor()
    
    # Нормализуем tg_id перед использованием
    tg_id_raw = data.get("tg_id", "")
    tg_id = normalize_tg_id(tg_id_raw)
    if not tg_id:
        conn.close()
        raise ValueError("tg_id is required")
    
    # Проверяем, существует ли пользователь по нормализованному tg_id
    # Также ищем пользователей со старым форматом (с префиксами)
    query = _adapt_query("SELECT * FROM users WHERE tg_id = ? OR tg_id = ? OR tg_id = ?")
    cur.execute(query, (tg_id, f"dev-{tg_id}", f"tg-{tg_id}"))
    existing = cur.fetchone()
    
    # Если нашли пользователя со старым форматом, обновляем его tg_id
    if existing:
        existing_dict = dict(existing)
        existing_tg_id = existing_dict.get("tg_id")
        existing_id = existing_dict.get("id")
        if existing_tg_id and existing_tg_id != tg_id:
            # Обновляем tg_id на нормализованный
            update_query = _adapt_query("UPDATE users SET tg_id = ? WHERE id = ?")
            cur.execute(update_query, (tg_id, existing_id))
            conn.commit()
            # Перечитываем пользователя по нормализованному tg_id
            query = _adapt_query("SELECT * FROM users WHERE tg_id = ?")
            cur.execute(query, (tg_id,))
            existing = cur.fetchone()
        # Если tg_id уже нормализованный, existing остается как есть
    
    now = now_iso()
    
    if existing:
        # Обновляем существующего пользователя
        user_dict = dict(existing)
        user_id = user_dict["id"]
        
        # Подготовка данных для обновления
        update_fields = []
        update_values = []
        
        placeholder = _get_param_placeholder()
        allowed_update_fields = ["full_name", "phone", "position", "company", "city", "tg_username", "first_name", "is_active"]
        for field in allowed_update_fields:
            if field in data:
                update_fields.append(f"{field} = {placeholder}")
                update_values.append(data[field])
        
        # Всегда обновляем updated_at
        update_fields.append(f"updated_at = {placeholder}")
        update_values.append(now)
        
        # Если is_active был 0, можно снова сделать 1 (при повторной регистрации)
        # Если в data явно указан is_active=1, активируем пользователя
        if "is_active" in data and data["is_active"] == 1:
            update_fields.append(f"is_active = {placeholder}")
            update_values.append(1)
        elif "is_active" not in data and user_dict.get("is_active", 1) == 0:
            # Если пользователь был удален (is_active=0), но при регистрации не указан is_active,
            # активируем его автоматически (повторная регистрация)
            update_fields.append(f"is_active = {placeholder}")
            update_values.append(1)
        
        # Проверяем роль по телефону - если телефон соответствует суперадмину, обновляем роль
        if "phone" in data:
            import re
            phone_clean = re.sub(r'\D', '', str(data["phone"]))
            if phone_clean == "79207455960":
                # Всегда обновляем роль на superadmin, если телефон соответствует
                update_fields.append(f"role = {placeholder}")
                update_values.append("superadmin")
            elif "role" not in data:
                # Если роль не указана в data, но телефон не суперадмин - оставляем текущую роль
                pass
        
        if update_fields:
            update_values.append(user_id)
            placeholder = _get_param_placeholder()
            query = f"UPDATE users SET {', '.join(update_fields)} WHERE id = {placeholder}"
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
        
        # Определяем роль по телефону (суперадмин) - проверяем всегда, если телефон указан
        if phone:
            import re
            phone_clean = re.sub(r'\D', '', str(phone))
            if phone_clean == "79207455960":
                role = "superadmin"
            elif role == "user":
                # Если роль не указана явно и телефон не суперадмин, оставляем user
                pass
        
        try:
            query = _adapt_query("""
                INSERT INTO users (
                    tg_id, tg_username, first_name, full_name, phone, position,
                    company, role, is_active, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """)
            cur.execute(
                query,
                (
                    tg_id, tg_username, first_name, full_name, phone, position,
                    company, role, is_active, now, now
                )
            )
            conn.commit()
            if USE_POSTGRES:
                # PostgreSQL возвращает ID через RETURNING или cur.fetchone()
                cur.execute(_adapt_query("SELECT id FROM users WHERE tg_id = ? ORDER BY id DESC LIMIT 1"), (tg_id,))
                row = cur.fetchone()
                user_id = row["id"] if row else None
            else:
                user_id = cur.lastrowid
            conn.close()
            return get_user_by_id(user_id) if user_id else None
        except Exception as e:
            conn.close()
            # Обработка ошибок для PostgreSQL и SQLite
            error_str = str(e).lower()
            if "unique" in error_str or "duplicate" in error_str or "already exists" in error_str:
                # Если все же произошла ошибка UNIQUE (например, параллельный запрос)
                # Пытаемся получить существующего пользователя
                return get_user_by_tg_id(int(tg_id) if tg_id.isdigit() else None) or get_user_by_tg_id(tg_id)
            raise


# === Инициализация таблиц ===
def init_db():
    conn = get_conn()
    cur = conn.cursor()

    # === Protections ===
    if USE_POSTGRES:
        # PostgreSQL синтаксис
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS protections (
                id SERIAL PRIMARY KEY,
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
                extend_count INTEGER DEFAULT 0,
                auto_closed INTEGER DEFAULT 0,
                updated_at TEXT,
                approved_by_admin INTEGER DEFAULT 0,
                admin_comment TEXT,
                manager_id INTEGER,
                reminder_2days_sent INTEGER DEFAULT 0,
                close_reason TEXT
            )
            """
        )
    else:
        # SQLite синтаксис
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
                extend_count INTEGER DEFAULT 0,
                auto_closed INTEGER DEFAULT 0,
                updated_at TEXT,
                approved_by_admin INTEGER DEFAULT 0,
                admin_comment TEXT,
                manager_id INTEGER,
                reminder_2days_sent INTEGER DEFAULT 0,
                close_reason TEXT
            )
            """
        )

    # === Users ===
    if USE_POSTGRES:
        # PostgreSQL синтаксис
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                tg_id TEXT UNIQUE,
                tg_username TEXT,
                first_name TEXT,
                role TEXT DEFAULT 'user',
                group_tag TEXT,
                manager_id INTEGER,
                region TEXT,
                created_at TEXT NOT NULL,
                email TEXT,
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
                receive_notifications INTEGER DEFAULT 1,
                manager_ids TEXT DEFAULT '[]'
            )
            """
        )
        # Создаем уникальный индекс для email, если его нет
        try:
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email) WHERE email IS NOT NULL")
        except:
            pass
    else:
        # SQLite синтаксис
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
                receive_notifications INTEGER DEFAULT 1,
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
        existing_columns = {row["column_name"] if isinstance(row, dict) else row[0] for row in cur.fetchall()}
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
        "receive_notifications": "INTEGER DEFAULT 1",  # Новая колонка для настройки уведомлений
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
        if USE_POSTGRES:
            # PostgreSQL - проверяем тип колонки
            cur.execute("""
                SELECT data_type 
                FROM information_schema.columns 
                WHERE table_name = 'users' AND column_name = 'tg_id'
            """)
            result = cur.fetchone()
        else:
            # SQLite
            cur.execute("SELECT typeof(tg_id) FROM users LIMIT 1")
            result = cur.fetchone()
        # Если таблица пустая или tg_id уже TEXT - ничего не делаем
        # Если есть данные с INTEGER - нужно будет пересоздать таблицу (но это сложно)
        # Для простоты оставляем как есть, но в новых записях будем использовать TEXT
    except:
        pass

    # === Managers ===
    if USE_POSTGRES:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS managers (
                id SERIAL PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                telegrams TEXT DEFAULT '[]',
                created_at TEXT
            )
            """
        )
    else:
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
    if USE_POSTGRES:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS history (
                id SERIAL PRIMARY KEY,
                protection_id INTEGER NOT NULL,
                at TEXT NOT NULL,
                actor TEXT NOT NULL,
                action TEXT NOT NULL,
                payload TEXT,
                FOREIGN KEY (protection_id) REFERENCES protections (id)
            )
            """
        )
    else:
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
    if USE_POSTGRES:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS tg_notifications (
                id SERIAL PRIMARY KEY,
                protection_id INTEGER NOT NULL,
                chat_id INTEGER NOT NULL,
                message_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (protection_id) REFERENCES protections (id)
            )
            """
        )
    else:
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

    # === Verification codes (verification_codes) ===
    if USE_POSTGRES:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS verification_codes (
                id SERIAL PRIMARY KEY,
                phone TEXT NOT NULL,
                code TEXT NOT NULL,
                full_name TEXT,
                tg_id TEXT,
                expires_at TEXT NOT NULL,
                used INTEGER DEFAULT 0,
                created_at TEXT NOT NULL
            )
            """
        )
    else:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS verification_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT NOT NULL,
                code TEXT NOT NULL,
                full_name TEXT,
                tg_id TEXT,
                expires_at TEXT NOT NULL,
                used INTEGER DEFAULT 0,
                created_at TEXT NOT NULL
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


# === Рабочие дни (исключая выходные и праздники) ===
def _as_date(dt: datetime | date) -> date:
    return dt if isinstance(dt, date) and not isinstance(dt, datetime) else dt.date()

def _observed_shift(d: date) -> date | None:
    """
    РФ: если нерабочий праздничный день выпадает на выходной, выходной переносится
    на ближайший следующий рабочий день (упрощение, но соответствует базовому правилу).
    """
    if d.weekday() == 5:  # Saturday
        return d + timedelta(days=2)
    if d.weekday() == 6:  # Sunday
        return d + timedelta(days=1)
    return None

def get_russian_holidays(year: int) -> Set[date]:
    """
    Возвращает множество дат нерабочих праздничных дней РФ для указанного года (date).

    Основа: ст. 112 ТК РФ.
    Дополнительно учитываем переносы выходных в 2026 году (постановление Правительства РФ
    от 24.09.2025 № 1466): 3 января -> 9 января (2026), 4 января -> 31 декабря (2025).
    """
    holidays: Set[date] = set()

    base: list[date] = []
    # 1–6 и 8 января — Новогодние каникулы; 7 января — Рождество
    base.extend(date(year, 1, d) for d in (1, 2, 3, 4, 5, 6, 7, 8))
    base.append(date(year, 2, 23))
    base.append(date(year, 3, 8))
    base.append(date(year, 5, 1))
    base.append(date(year, 5, 9))
    base.append(date(year, 6, 12))
    base.append(date(year, 11, 4))

    holidays.update(base)

    # Переносы выходных по базовому правилу (если праздник выпал на субботу/воскресенье)
    # Добавляем "наблюдаемый" день отдыха.
    for d in base:
        shifted = _observed_shift(d)
        if shifted:
            holidays.add(shifted)

    # Специальные переносы по постановлению №1466 (важно для расчёта рабочих дней)
    if year == 2026:
        holidays.add(date(2026, 1, 9))  # перенос с 03.01.2026
    if year == 2025:
        holidays.add(date(2025, 12, 31))  # перенос с 04.01.2026

    return holidays


def is_workday(dt: datetime | date, holidays: Set[date] | None = None) -> bool:
    """
    Проверяет, является ли день рабочим.
    Выходные: суббота (5) и воскресенье (6).
    """
    d = _as_date(dt)

    # Суббота и воскресенье - выходные
    if d.weekday() >= 5:  # 5 = суббота, 6 = воскресенье
        return False
    
    # Проверяем праздники
    if holidays is None:
        holidays = get_russian_holidays(d.year)
        # Если январь, также учитываем переносы/каникулы предыдущего года (например 31.12)
        if d.month == 1:
            holidays = holidays.union(get_russian_holidays(d.year - 1))
    
    # Проверяем, является ли дата праздником
    if d in holidays:
        return False
    
    return True


def add_workdays(dt_iso: str, workdays: int) -> str:
    """
    Добавляет указанное количество рабочих дней к дате.
    Исключает выходные (суббота, воскресенье) и российские праздники.
    
    Args:
        dt_iso: Дата в формате ISO (например, "2024-01-15T10:30:00Z")
        workdays: Количество рабочих дней для добавления
    
    Returns:
        Новая дата в формате ISO
    """
    dt = datetime.fromisoformat(dt_iso.replace("Z", ""))
    
    all_holidays = get_russian_holidays(dt.year).union(get_russian_holidays(dt.year + 1))
    
    # Если начальная дата - выходной или праздник, начинаем со следующего рабочего дня
    # (но не пропускаем дни, просто начинаем отсчет с первого рабочего дня)
    start_dt = dt
    
    # Добавляем рабочие дни
    added_days = 0
    current_dt = start_dt
    
    while added_days < workdays:
        current_dt += timedelta(days=1)
        # Обновляем праздники, если перешли на следующий год
        if current_dt.year != (dt.year):
            all_holidays = get_russian_holidays(current_dt.year).union(get_russian_holidays(current_dt.year + 1))
        
        if is_workday(current_dt, all_holidays):
            added_days += 1
    
    return current_dt.isoformat(timespec="seconds") + "Z"


def workdays_until(expires_iso: str, from_dt: datetime | None = None) -> int:
    """
    Сколько рабочих дней осталось до даты истечения (включая день истечения, исключая сегодня).

    Пример: сегодня Пн, истекает Ср -> 2 (Вт, Ср).
    Если истекает сегодня -> 0.
    Если уже истекло -> отрицательное число (календарная разница по дням).
    """
    if from_dt is None:
        from_dt = datetime.utcnow()

    start = _as_date(from_dt)
    expires = _as_date(datetime.fromisoformat(expires_iso.replace("Z", "")))

    if expires <= start:
        return (expires - start).days

    holidays = get_russian_holidays(start.year).union(get_russian_holidays(start.year + 1))
    days = 0
    d = start + timedelta(days=1)
    while d <= expires:
        if is_workday(d, holidays):
            days += 1
        d += timedelta(days=1)
    return days
