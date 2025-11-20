# backend/db.py
import sqlite3
import csv
from pathlib import Path
from datetime import datetime, timedelta

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "data.sqlite3"
SKUS_PATH = BASE_DIR / "skus.csv"


# === Время ===
def now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def add_days(dt_iso: str, days: int) -> str:
    dt = datetime.fromisoformat(dt_iso.replace("Z", ""))
    return (dt + timedelta(days=days)).isoformat(timespec="seconds") + "Z"


# === Подключение к БД ===
def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# === Загрузка SKU из CSV ===
def load_skus():
    items = []
    if not SKUS_PATH.exists():
        return items

    with open(SKUS_PATH, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames and "Артикулы" in reader.fieldnames:
            # «новый» формат: строки
            for row in reader:
                sku = (row.get("Артикулы") or "").strip()
                if not sku:
                    continue
                collection = (row.get("Коллекция") or "").strip()
                type_raw = (row.get("Тип (клей/замок)") or "").strip().lower()
                if "кле" in type_raw:
                    type_ = "клей"
                elif "зам" in type_raw:
                    type_ = "замок"
                else:
                    continue
                items.append(
                    {
                        "sku": sku,
                        "collection": collection,
                        "type": type_,
                    }
                )
        else:
            # «старый» формат: матрица
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

            def normalize_type(t: str) -> str:
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


# === Инициализация БД ===
def init_db():
    conn = get_conn()
    cur = conn.cursor()

    # protections
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
            manager_id INTEGER
        )
        """
    )

    # users
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tg_id INTEGER UNIQUE NOT NULL,
            tg_username TEXT,
            first_name TEXT,
            role TEXT DEFAULT 'manager',
            group_tag TEXT,
            manager_id INTEGER,
            region TEXT,
            created_at TEXT NOT NULL
        )
        """
    )

    # managers
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS managers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            telegrams TEXT DEFAULT '[]',
            created_at TEXT NOT NULL
        )
        """
    )

    # history
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            protection_id INTEGER NOT NULL,
            at TEXT NOT NULL,
            actor TEXT NOT NULL,
            action TEXT NOT NULL,
            payload TEXT
        )
        """
    )

    # tg_notifications для связи с телеграм-сообщениями
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS tg_notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            protection_id INTEGER NOT NULL,
            chat_id INTEGER NOT NULL,
            message_id INTEGER NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )

    conn.commit()
    conn.close()


# === CRUD по пользователям (для auth / админки) ===
def get_user_by_id(user_id: int):
    conn = get_conn()
    cur = conn.cursor()
    row = cur.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def get_user_by_tg_id(tg_id: int):
    conn = get_conn()
    cur = conn.cursor()
    row = cur.execute("SELECT * FROM users WHERE tg_id = ?", (tg_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def ensure_superadmin():
    """
    Если в таблице users пусто — создаём тебя как superadmin.
    """
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) AS c FROM users")
    count = cur.fetchone()["c"]
    if count == 0:
        cur.execute(
            """
            INSERT INTO users (tg_id, tg_username, first_name, role, created_at, region)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (426188469, "messiah", "Dmitry", "superadmin", now_iso(), "Москва"),
        )
        conn.commit()
    conn.close()
