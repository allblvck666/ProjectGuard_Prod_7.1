import sqlite3
import csv
from pathlib import Path
from datetime import datetime, timedelta
from typing import List, Dict, Any

# Пути
DB_PATH = Path(__file__).resolve().parent / "data.sqlite3"
SKUS_PATH = Path(__file__).resolve().parent / "skus.csv"


# === CSV загрузка ===
def load_skus() -> list[dict]:
    """
    Загружает артикулы из skus.csv.
    Поддерживает два формата:
    1) С заголовками: Артикулы, Коллекция, Тип (клей/замок)
    2) Матрица: первая строка — коллекции, вторая — типы, далее — артикулы по ячейкам
    """
    items: list[dict] = []
    if not SKUS_PATH.exists():
        return items

    with open(SKUS_PATH, newline="", encoding="utf-8-sig") as f:
        # --- Пытаемся прочитать как DictReader ---
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
                    {"sku": sku, "collection": collection, "type": type_}
                )
            if items:
                items.sort(key=lambda x: (x["sku"], x["collection"], x["type"]))
                return items
        except Exception:
            # Падаем во второй режим, если формат другой
            pass

        # --- Фолбэк: матричный формат ---
        f.seek(0)
        rows = list(csv.reader(f))
        if not rows:
            return items

        maxw = max(len(r) for r in rows)
        norm: list[list[str]] = []
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

        seen: set[tuple[str, str, str]] = set()
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
                items.append({"sku": sku, "collection": coll, "type": tp})

    items.sort(key=lambda x: (x["sku"], x["collection"], x["type"]))
    return items


# === DB подключение ===
def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# === Вспомогательные ===
def now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def add_days(dt_iso: str, days: int) -> str:
    dt = datetime.fromisoformat(dt_iso.replace("Z", ""))
    return (dt + timedelta(days=days)).isoformat(timespec="seconds") + "Z"


# === CRUD пользователи ===
def get_user_by_id(user_id: int) -> Dict[str, Any] | None:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def get_user_by_tg_id(tg_id: int) -> Dict[str, Any] | None:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM users WHERE tg_id = ?", (tg_id,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def ensure_superadmin() -> None:
    """
    Гарантирует наличие супер-админа (ты).
    """
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) AS c FROM users")
    row = cur.fetchone()
    count = row["c"] if row else 0

    if count == 0:
        cur.execute(
            """
            INSERT INTO users (tg_id, tg_username, first_name, role, group_tag, region, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                426188469,
                "messiah",
                "Dmitry",
                "superadmin",
                "hq",
                "Москва",
                now_iso(),
            ),
        )
        conn.commit()

    conn.close()


# === Инициализация таблиц ===
def init_db() -> None:
    conn = get_conn()
    cur = conn.cursor()

    # Protections
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
            extend_count INTEGER NOT NULL DEFAULT 0,
            auto_closed INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT,
            manager_id INTEGER
        )
        """
    )

    # Users
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tg_id INTEGER UNIQUE NOT NULL,
            tg_username TEXT,
            first_name TEXT,
            role TEXT DEFAULT 'manager',
            group_tag TEXT,
            region TEXT,
            manager_id INTEGER,
            created_at TEXT NOT NULL
        )
        """
    )

    # Managers (для админки)
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS managers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            created_at TEXT NOT NULL,
            telegrams TEXT NOT NULL DEFAULT '[]'
        )
        """
    )

    # History (лог действий)
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

    # Telegram notifications (чтобы обновлять сообщения)
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
