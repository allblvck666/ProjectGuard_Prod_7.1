# backend/main.py
from fastapi import (
    FastAPI,
    HTTPException,
    Body,
    Depends,
    Header,
    Request,
    BackgroundTasks,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from typing import List, Optional, Literal
from datetime import datetime, timedelta
from pathlib import Path
from jose import jwt, JWTError
import asyncio
import json
import os
import re
import sqlite3
import csv

from backend.db import (
    get_conn,
    init_db,
    now_iso,
    add_days,
    load_skus,
    ensure_superadmin,
)

# =========================
#   JWT / AUTH
# =========================

SECRET_KEY = os.getenv("SECRET_KEY", "Messiah_Secret_2025")
ALGORITHM = "HS256"

BOT_TOKEN = os.getenv("BOT_TOKEN", "8256079955:AAGrghwannJh_tub3Av460PRKLV0nGR_cc8")
WEBAPP_URL = os.getenv(
    "WEBAPP_URL", "https://projectguard-frontend-prod-7-1.onrender.com"
)

DB_PATH = Path(__file__).resolve().parent / "data.sqlite3"


def create_token(user_id: int, role: str) -> str:
    payload = {
        "sub": str(user_id),
        "role": role,
        "exp": datetime.utcnow() + timedelta(days=60),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(token: str = Header(None)):
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return {
            "id": int(payload.get("sub", 0)),
            "role": payload.get("role", "manager"),
        }
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def require_admin(user=Depends(get_current_user)):
    if user["role"] not in ("admin", "superadmin"):
        raise HTTPException(
            status_code=403, detail="Access denied: admin/superadmin only"
        )
    return user


# =========================
#   APP + CORS
# =========================

app = FastAPI(title="ProjectGuard API", version="7.1")
SKUS = load_skus()

origins = [
    "https://projectguard-frontend-prod-7-1.onrender.com",
    "https://web.telegram.org",
    "https://web.telegram.org/a",
    "https://web.telegram.org/k",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================
#   MODELS
# =========================

class SkuItem(BaseModel):
    sku: str
    type: str
    area: Optional[float] = None


class ProtectionCreate(BaseModel):
    manager: str
    client: str = ""
    partner: str = ""
    partner_city: str = ""
    sku: str = ""
    sku_data: Optional[List[SkuItem]] = None
    area_m2: Optional[float] = None
    last4: str = ""
    object_city: str = ""
    address: str = ""
    comment: str = ""


class ProtectionOut(BaseModel):
    id: int
    manager: str
    client: str
    partner: str
    partner_city: str
    sku: str
    area_m2: Optional[float]
    last4: str
    object_city: str
    address: str
    comment: str
    status: str
    created_at: str
    expires_at: str
    closed_at: Optional[str]
    days_left: int
    warn2d: Optional[bool] = None
    warn_text: Optional[str] = None
    extend_count: Optional[int] = 0


class ProtectionUpdate(BaseModel):
    sku: Optional[str] = ""
    sku_data: Optional[List[SkuItem]] = None
    area_m2: Optional[float] = None
    comment: Optional[str] = None
    manager: Optional[str] = None


class ManagerCreate(BaseModel):
    name: str


class ManagerUpdate(BaseModel):
    name: str


# =========================
#   HELPERS
# =========================

def normalize_sku(raw: str) -> str:
    return re.sub(r"[\(\)а-яА-Я\s]+", "", raw or "").strip()


def add_history(cur, protection_id: int, actor: str, action: str, payload: dict):
    cur.execute(
        "INSERT INTO history(protection_id, at, actor, action, payload) VALUES (?,?,?,?,?)",
        (protection_id, now_iso(), actor, action, json.dumps(payload, ensure_ascii=False)),
    )


def row_to_out(row) -> ProtectionOut:
    expires = datetime.fromisoformat(row["expires_at"].replace("Z", ""))
    days_left = (expires - datetime.utcnow()).days
    warn2d = row["status"] == "active" and days_left <= 2
    warn_text = "⏰ Через 2 дня истекает — напомни менеджеру." if warn2d else None
    return ProtectionOut(
        id=row["id"],
        manager=row["manager"],
        client=row["client"] or "",
        partner=row["partner"] or "",
        partner_city=row["partner_city"] or "",
        sku=row["sku"] or "",
        area_m2=row["area_m2"],
        last4=row["last4"] or "",
        object_city=row["object_city"] or "",
        address=row["address"] or "",
        comment=row["comment"] or "",
        status=row["status"],
        created_at=row["created_at"],
        expires_at=row["expires_at"],
        closed_at=row["closed_at"],
        days_left=days_left,
        warn2d=warn2d,
        warn_text=warn_text,
        extend_count=row["extend_count"] if "extend_count" in row.keys() else 0,
    )


def resolve_manager_for_user(cur, user_id: Optional[int]):
    if not user_id:
        return None
    row = cur.execute("SELECT id FROM users WHERE id=?", (user_id,)).fetchone()
    return row["id"] if row else None


# =========================
#   STARTUP / MIGRATION
# =========================

def _safe_migrate():
    print("⚙️ DB auto-migrate…")
    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute("ALTER TABLE protections ADD COLUMN extend_count INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    try:
        cur.execute("ALTER TABLE protections ADD COLUMN auto_closed INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    try:
        cur.execute("ALTER TABLE protections ADD COLUMN updated_at TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        cur.execute("ALTER TABLE protections ADD COLUMN manager_id INTEGER")
    except sqlite3.OperationalError:
        pass
    try:
        cur.execute("ALTER TABLE users ADD COLUMN group_tag TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        cur.execute("ALTER TABLE users ADD COLUMN manager_id INTEGER")
    except sqlite3.OperationalError:
        pass
    try:
        cur.execute("ALTER TABLE users ADD COLUMN region TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        cur.execute("ALTER TABLE managers ADD COLUMN telegrams TEXT DEFAULT '[]'")
    except sqlite3.OperationalError:
        pass
    conn.commit()
    conn.close()
    print("✅ DB migration done")


@app.on_event("startup")
async def on_startup():
    init_db()
    ensure_superadmin()
    _safe_migrate()
    # запуск фоновой проверки истекающих защит и бота — по возможности
    try:
        asyncio.get_event_loop().create_task(check_expiring_protections())
        asyncio.get_event_loop().create_task(start_tg_bot())
    except Exception as e:
        print("⚠️ Telegram background tasks not started:", e)


# =========================
#   BASIC / PING / SKUS
# =========================

@app.get("/api/ping")
def ping():
    return {"ok": True, "time": now_iso()}


@app.get("/api/skus")
def get_skus():
    return SKUS


# =========================
#   AUTH
# =========================

import hashlib
import hmac

def verify_telegram_auth(data: dict) -> bool:
    check_hash = data.pop("hash", None)
    data_check = "\n".join([f"{k}={v}" for k, v in sorted(data.items())])
    secret_key = hashlib.sha256(BOT_TOKEN.encode()).digest()
    h = hmac.new(secret_key, data_check.encode(), hashlib.sha256).hexdigest()
    return h == check_hash


@app.post("/api/auth/telegram-login")
async def telegram_login(request: Request):
    """
    Упрощённый логин для WebApp: просто принимаем tg_id, username, first_name.
    Без проверки hash, т.к. на фронте ты дергаешь этот эндпоинт напрямую.
    """
    data = await request.json()
    tg_id = int(data.get("tg_id") or 0)
    if not tg_id:
        raise HTTPException(status_code=400, detail="tg_id is required")

    username = data.get("username") or ""
    first_name = data.get("first_name") or "User"
    role = "superadmin" if tg_id == 426188469 else "manager"

    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO users (tg_id, tg_username, first_name, role, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(tg_id) DO UPDATE SET
            tg_username=excluded.tg_username,
            first_name=excluded.first_name,
            role=excluded.role
        """,
        (tg_id, username, first_name, role, now_iso()),
    )
    conn.commit()
    user = cur.execute("SELECT * FROM users WHERE tg_id=?", (tg_id,)).fetchone()
    conn.close()

    token = create_token(user["id"], user["role"])
    return {"ok": True, "token": token, "role": user["role"], "user": dict(user)}


@app.post("/api/auth/dev-login")
def dev_login(payload: dict = Body(...)):
    """
    DEV-логин для тестов из браузера (кнопка DEV LOGIN).
    """
    tg_id = int(payload.get("tg_id") or payload.get("id") or 0)
    if not tg_id:
        raise HTTPException(status_code=400, detail="tg_id is required")

    username = payload.get("username") or ""
    first_name = payload.get("first_name") or "DevUser"
    role = payload.get("role") or "manager"

    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO users (tg_id, tg_username, first_name, role, created_at)
        VALUES (?,?,?,?,?)
        ON CONFLICT(tg_id) DO UPDATE SET
            tg_username=excluded.tg_username,
            first_name=excluded.first_name,
            role=excluded.role
        """,
        (tg_id, username, first_name, role, now_iso()),
    )
    conn.commit()
    user = cur.execute("SELECT * FROM users WHERE tg_id=?", (tg_id,)).fetchone()
    conn.close()

    token = create_token(user["id"], user["role"])
    return {"ok": True, "token": token, "role": user["role"], "user": dict(user)}


# =========================
#   PROTECTIONS
# =========================

@app.post("/api/protections", response_model=ProtectionOut)
def create_protection(payload: ProtectionCreate):
    conn = get_conn()
    cur = conn.cursor()
    created = now_iso()

    skus_in: List[SkuItem] = payload.sku_data or []
    has_per_sku_areas = any((it.area is not None) for it in skus_in)

    if skus_in:
        if has_per_sku_areas:
            parts = []
            total_area = 0.0
            for it in skus_in:
                a = float(it.area or 0)
                total_area += a
                parts.append(f"{it.sku} ({it.type}) — {int(a) if a.is_integer() else a} м²")
            sku_display = "; ".join(parts)
        else:
            total_area = float(payload.area_m2 or 0)
            parts = [f"{it.sku} ({it.type})" for it in skus_in]
            sku_display = " + ".join(parts)
    else:
        sku_display = (payload.sku or "").strip()
        total_area = float(payload.area_m2 or 0)

    if total_area < 50:
        conn.close()
        raise HTTPException(status_code=400, detail="⚠️ Защита ставится от 50 м²")

    # проверка дублей ±10% по SKU и метражу
    pairs = []
    if skus_in:
        if has_per_sku_areas:
            for it in skus_in:
                if it.area and it.area > 0:
                    pairs.append((normalize_sku(it.sku), float(it.area)))
        else:
            for it in skus_in:
                pairs.append((normalize_sku(it.sku), total_area))
    else:
        if sku_display and total_area > 0:
            pairs.append((normalize_sku(sku_display), total_area))

    cur.execute(
        """
        SELECT manager, partner, sku, area_m2, expires_at
        FROM protections
        WHERE status='active'
        """
    )
    active_rows = cur.fetchall()

    for sku_code, area_x in pairs:
        if not sku_code or area_x <= 0:
            continue
        min_a = area_x * 0.9
        max_a = area_x * 1.1
        for row in active_rows:
            if not row["area_m2"]:
                continue
            if normalize_sku(row["sku"]) != sku_code:
                continue
            if min_a <= float(row["area_m2"]) <= max_a:
                conn.close()
                raise HTTPException(
                    status_code=409,
                    detail={
                        "msg": (
                            "⚠️ Похожая активная защита уже существует:\n"
                            f"👤 Менеджер: {row['manager']}\n"
                            f"🏢 Партнёр: {row['partner'] or '—'}\n"
                            f"❗️Артикул: {row['sku']}\n"
                            f"📏 Метраж: {int(row['area_m2']) if float(row['area_m2']).is_integer() else row['area_m2']} м²\n"
                            f"⏰ Истекает: {row['expires_at']}\n\n"
                            "💬 Обратись к коллеге, прежде чем ставить новую защиту."
                        )
                    },
                )

    ttl_days = 5
    if total_area < 100:
        ttl_days = 5
    elif total_area < 250:
        ttl_days = 10
    elif total_area < 500:
        ttl_days = 15
    else:
        ttl_days = 30

    expires = add_days(created, ttl_days)

    manager_id = resolve_manager_for_user(cur, None)

    cur.execute(
        """
        INSERT INTO protections(
            manager, client, partner, partner_city, sku, area_m2,
            last4, object_city, address, comment, status,
            created_at, expires_at, closed_at, extend_count, auto_closed, manager_id
        )
        VALUES (?,?,?,?,?,?,?,?,?,?, 'active', ?, ?, NULL, 0, 0, ?)
        """,
        (
            (payload.manager or "").strip(),
            (payload.client or "").strip(),
            (payload.partner or "").strip(),
            (payload.partner_city or "").strip(),
            sku_display,
            total_area if total_area > 0 else None,
            (payload.last4 or "").strip(),
            (payload.object_city or "").strip(),
            (payload.address or "").strip(),
            (payload.comment or "").strip(),
            created,
            expires,
            manager_id,
        ),
    )

    new_id = cur.lastrowid
    add_history(cur, new_id, "manager", "create", {"sku": sku_display, "area_m2": total_area})
    conn.commit()
    row = cur.execute("SELECT * FROM protections WHERE id=?", (new_id,)).fetchone()
    conn.close()
    return row_to_out(row)


@app.get("/api/protections", response_model=List[ProtectionOut])
def list_protections(search: str = "", manager: str = "", status: str = ""):
    sql = "SELECT * FROM protections WHERE 1=1"
    params: list = []

    if not status:
        sql += " AND status != 'deleted'"
    if search:
        s = f"%{search.lower()}%"
        sql += """
            AND (
                LOWER(manager) LIKE ? OR LOWER(client) LIKE ? OR LOWER(partner) LIKE ?
                OR LOWER(partner_city) LIKE ? OR LOWER(sku) LIKE ? OR LOWER(last4) LIKE ?
                OR LOWER(object_city) LIKE ? OR LOWER(address) LIKE ?
            )
        """
        params += [s] * 8
    if manager:
        sql += " AND manager = ?"
        params.append(manager)
    if status:
        sql += " AND status = ?"
        params.append(status)

    sql += " ORDER BY created_at DESC"

    conn = get_conn()
    rows = conn.cursor().execute(sql, params).fetchall()
    conn.close()
    return [row_to_out(r) for r in rows]


@app.get("/api/history")
def history(protection_id: Optional[int] = None):
    conn = get_conn()
    cur = conn.cursor()
    if protection_id:
        rows = cur.execute(
            "SELECT * FROM history WHERE protection_id=? ORDER BY at DESC",
            (protection_id,),
        ).fetchall()
    else:
        rows = cur.execute(
            "SELECT * FROM history ORDER BY at DESC LIMIT 500"
        ).fetchall()
    out = []
    for r in rows:
        out.append(
            {
                "id": r["id"],
                "protection_id": r["protection_id"],
                "at": r["at"],
                "actor": r["actor"],
                "action": r["action"],
                "payload": json.loads(r["payload"] or "{}"),
            }
        )
    conn.close()
    return out


@app.post("/api/protections/{pid}/extend", response_model=ProtectionOut)
def extend(pid: int, days: int = 10, actor: Literal["manager", "admin"] = "manager"):
    conn = get_conn()
    cur = conn.cursor()
    row = cur.execute("SELECT * FROM protections WHERE id=?", (pid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Not found")
    if row["status"] != "active":
        conn.close()
        raise HTTPException(
            status_code=400, detail="Можно продлевать только активные защиты"
        )

    extend_count = row["extend_count"] or 0
    if actor == "manager" and extend_count >= 2:
        add_history(
            cur,
            pid,
            "manager",
            "extend_denied_limit",
            {"current_extend_count": extend_count},
        )
        conn.commit()
        conn.close()
        raise HTTPException(
            status_code=403,
            detail={
                "msg": "Превышен лимит продлений менеджером. Запросите у администратора.",
                "needs_admin": True,
            },
        )

    new_exp = add_days(row["expires_at"], days)
    new_count = extend_count + (1 if actor == "manager" else 0)
    cur.execute(
        "UPDATE protections SET expires_at=?, extend_count=? WHERE id=?",
        (new_exp, new_count, pid),
    )
    add_history(cur, pid, actor, "extend", {"days": days})
    conn.commit()
    row = cur.execute("SELECT * FROM protections WHERE id=?", (pid,)).fetchone()
    conn.close()
    return row_to_out(row)


@app.post("/api/protections/{pid}/request-extend")
def request_extend(pid: int, data: dict = Body(...)):
    days = data.get("days", 5)
    reason = (data.get("reason") or "").strip() or "не указана"
    conn = get_conn()
    cur = conn.cursor()
    row = cur.execute("SELECT * FROM protections WHERE id=?", (pid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Not found")

    add_history(
        cur,
        pid,
        "manager",
        "extend_request",
        {"days": days, "reason": reason},
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.post("/api/protections/{pid}/success", response_model=ProtectionOut)
def mark_success(pid: int, data: dict = Body(...)):
    doc_1c = (data or {}).get("doc_1c", "").strip()
    if not doc_1c:
        raise HTTPException(
            status_code=400, detail="Нужно указать номер документа из 1С"
        )
    conn = get_conn()
    cur = conn.cursor()
    row = cur.execute("SELECT * FROM protections WHERE id=?", (pid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Not found")
    cur.execute(
        "UPDATE protections SET status='success', closed_at=? WHERE id=?",
        (now_iso(), pid),
    )
    add_history(cur, pid, "manager", "success", {"doc_1c": doc_1c})
    conn.commit()
    row = cur.execute("SELECT * FROM protections WHERE id=?", (pid,)).fetchone()
    conn.close()
    return row_to_out(row)


@app.post("/api/protections/{pid}/close", response_model=ProtectionOut)
def mark_closed(pid: int, data: dict = Body(...)):
    reason = (data or {}).get("reason", "").strip()
    if not reason:
        raise HTTPException(
            status_code=400, detail="Нужно указать причину закрытия"
        )
    conn = get_conn()
    cur = conn.cursor()
    row = cur.execute("SELECT * FROM protections WHERE id=?", (pid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Not found")
    cur.execute(
        "UPDATE protections SET status='closed', closed_at=? WHERE id=?",
        (now_iso(), pid),
    )
    add_history(cur, pid, "manager", "close", {"reason": reason})
    conn.commit()
    row = cur.execute("SELECT * FROM protections WHERE id=?", (pid,)).fetchone()
    conn.close()
    return row_to_out(row)


@app.delete("/api/protections/{pid}")
def delete_protection(pid: int, reason: Optional[str] = None):
    conn = get_conn()
    cur = conn.cursor()
    row = cur.execute("SELECT * FROM protections WHERE id=?", (pid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Not found")
    cur.execute(
        "UPDATE protections SET status='deleted', closed_at=? WHERE id=?",
        (now_iso(), pid),
    )
    add_history(cur, pid, "manager", "delete", {"reason": reason or "not provided"})
    conn.commit()
    conn.close()
    return {"ok": True}


# =========================
#   ADMIN: EXTEND-REQUESTS
# =========================

@app.get("/api/admin/extend-requests")
def admin_extend_requests(user=Depends(require_admin)):
    conn = get_conn()
    cur = conn.cursor()
    rows = cur.execute(
        """
        SELECT h.id as hid, h.protection_id, h.at, h.payload,
               p.manager, p.partner, p.sku, p.expires_at
        FROM history h
        JOIN protections p ON p.id = h.protection_id
        WHERE h.action='extend_request'
        ORDER BY h.at DESC
        """
    ).fetchall()
    out = []
    for r in rows:
        payload = json.loads(r["payload"] or "{}")
        out.append(
            {
                "history_id": r["hid"],
                "protection_id": r["protection_id"],
                "requested_at": r["at"],
                "days": payload.get("days", 0),
                "reason": payload.get("reason", "—"),
                "manager": r["manager"],
                "partner": r["partner"],
                "sku": r["sku"],
                "expires_at": r["expires_at"],
            }
        )
    conn.close()
    return out


@app.post("/api/admin/protections/{pid}/extend-any", response_model=ProtectionOut)
def admin_extend_any(pid: int, days: int = 10, user=Depends(require_admin)):
    return extend(pid, days=days, actor="admin")


# =========================
#   MANAGERS (ADMIN + PUBLIC)
# =========================

@app.get("/api/admin/managers")
def admin_list_managers(user=Depends(require_admin)):
    conn = get_conn()
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    rows = cur.execute(
        """
        SELECT
            m.id, m.name, m.telegrams,
            IFNULL(t.total,0) AS total,
            IFNULL(t.active,0) AS active,
            IFNULL(t.success,0) AS success,
            IFNULL(t.closed,0) AS closed
        FROM managers m
        LEFT JOIN (
            SELECT manager,
                   COUNT(*) AS total,
                   SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active,
                   SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success,
                   SUM(CASE WHEN status='closed' THEN 1 ELSE 0 END) AS closed
            FROM protections
            GROUP BY manager
        ) t ON t.manager = m.name
        ORDER BY m.name COLLATE NOCASE
        """
    ).fetchall()

    managers = []
    for r in rows:
        try:
            telegrams = json.loads(r["telegrams"]) if r["telegrams"] else []
        except Exception:
            telegrams = []
        managers.append(
            {
                "id": r["id"],
                "name": r["name"],
                "total": r["total"],
                "active": r["active"],
                "success": r["success"],
                "closed": r["closed"],
                "telegrams": telegrams,
            }
        )
    conn.close()
    return managers


@app.post("/api/admin/managers")
def admin_add_manager(data: ManagerCreate, user=Depends(require_admin)):
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Имя не может быть пустым")
    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO managers(name, created_at) VALUES (?,?)", (name, now_iso())
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(status_code=409, detail="Менеджер с таким именем уже существует")
    conn.close()
    return {"ok": True}


@app.patch("/api/admin/managers/{mid}")
def admin_rename_manager(mid: int, data: ManagerUpdate, user=Depends(require_admin)):
    new_name = (data.name or "").strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="Имя не может быть пустым")
    conn = get_conn()
    cur = conn.cursor()
    row = cur.execute("SELECT * FROM managers WHERE id=?", (mid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Manager not found")
    old_name = row["name"]
    exists = cur.execute(
        "SELECT 1 FROM managers WHERE name=? AND id<>?", (new_name, mid)
    ).fetchone()
    if exists:
        conn.close()
        raise HTTPException(status_code=409, detail="Менеджер с таким именем уже существует")
    cur.execute("UPDATE managers SET name=? WHERE id=?", (new_name, mid))
    cur.execute("UPDATE protections SET manager=? WHERE manager=?", (new_name, old_name))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/admin/managers/{mid}")
def admin_delete_manager(
    mid: int, transfer_to: Optional[int] = None, user=Depends(require_admin)
):
    conn = get_conn()
    cur = conn.cursor()
    row = cur.execute("SELECT * FROM managers WHERE id=?", (mid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Manager not found")
    name = row["name"]
    cnt = (
        cur.execute("SELECT COUNT(*) AS c FROM protections WHERE manager=?", (name,))
        .fetchone()["c"]
        or 0
    )
    if cnt > 0:
        if not transfer_to:
            conn.close()
            raise HTTPException(
                status_code=400,
                detail="Нужно выбрать менеджера для перевода всех защит",
            )
        row_to = cur.execute(
            "SELECT * FROM managers WHERE id=?", (transfer_to,)
        ).fetchone()
        if not row_to:
            conn.close()
            raise HTTPException(status_code=404, detail="transfer_to manager not found")
        new_name = row_to["name"]
        cur.execute("UPDATE protections SET manager=? WHERE manager=?", (new_name, name))
    cur.execute("DELETE FROM managers WHERE id=?", (mid,))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.put("/api/admin/managers/{manager_id}/telegrams")
def update_manager_telegrams(manager_id: int, body: dict = Body(...), user=Depends(require_admin)):
    telegrams = body.get("telegrams")
    if not isinstance(telegrams, list):
        raise HTTPException(status_code=400, detail="Поле 'telegrams' должно быть списком")

    conn = get_conn()
    cur = conn.cursor()
    row = cur.execute("SELECT id FROM managers WHERE id=?", (manager_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Менеджер не найден")

    cur.execute(
        "UPDATE managers SET telegrams=? WHERE id=?",
        (json.dumps(telegrams, ensure_ascii=False), manager_id),
    )
    conn.commit()
    conn.close()
    return {"message": "✅ Telegram-уведомления успешно обновлены", "telegrams": telegrams}


@app.get("/api/managers")
def public_managers():
    conn = get_conn()
    cur = conn.cursor()
    rows = cur.execute("SELECT id, name FROM managers ORDER BY name COLLATE NOCASE").fetchall()
    conn.close()
    return [{"id": r["id"], "name": r["name"]} for r in rows]


@app.get("/api/admin/manager-protections")
def admin_manager_protections(manager_id: int, user=Depends(require_admin)):
    conn = get_conn()
    cur = conn.cursor()
    manager_row = cur.execute("SELECT name FROM managers WHERE id=?", (manager_id,)).fetchone()
    if not manager_row:
        conn.close()
        return []

    manager_name = manager_row["name"]
    cur.execute(
        """
        SELECT id, partner, partner_city, client, object_city, address,
               sku, area_m2, status, expires_at, comment
        FROM protections
        WHERE manager=?
        ORDER BY
            CASE status
                WHEN 'active' THEN 1
                WHEN 'success' THEN 2
                WHEN 'closed' THEN 3
                WHEN 'deleted' THEN 4
                ELSE 5
            END,
            id DESC
        """,
        (manager_name,),
    )
    rows = cur.fetchall()
    conn.close()
    return [
        {
            "id": r["id"],
            "partner": r["partner"],
            "partner_city": r["partner_city"],
            "client": r["client"],
            "object_city": r["object_city"],
            "address": r["address"],
            "sku": r["sku"],
            "area_m2": r["area_m2"],
            "status": r["status"],
            "expires_at": r["expires_at"],
            "comment": r["comment"],
        }
        for r in rows
    ]


# =========================
#   USERS (ADMIN)
# =========================

@app.get("/api/users")
def get_users(user=Depends(require_admin)):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, tg_id, tg_username, first_name, role,
               group_tag, manager_id, region, created_at
        FROM users
        ORDER BY id ASC
        """
    )
    rows = [dict(zip([c[0] for c in cur.description], r)) for r in cur.fetchall()]
    conn.close()
    return rows


@app.patch("/api/users/{user_id}")
def update_user(user_id: int, data: dict, user=Depends(require_admin)):
    conn = get_conn()
    cur = conn.cursor()
    fields = []
    values = []
    for key in ["role", "group_tag", "manager_id", "region"]:
        if key in data:
            fields.append(f"{key} = ?")
            values.append(data[key])
    if not fields:
        raise HTTPException(status_code=400, detail="Нет полей для обновления")
    values.append(user_id)
    cur.execute(f"UPDATE users SET {', '.join(fields)} WHERE id = ?", values)
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/users/{user_id}")
def delete_user(user_id: int, user=Depends(require_admin)):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


@app.get("/api/user-managers")
def get_user_managers():
    conn = get_conn()
    cur = conn.cursor()
    rows = cur.execute(
        """
        SELECT id, first_name AS name
        FROM users
        WHERE role='manager'
        ORDER BY first_name COLLATE NOCASE
        """
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# =========================
#   STATS / EXPORT
# =========================

@app.get("/api/stats")
def stats():
    conn = get_conn()
    cur = conn.cursor()
    rows = cur.execute(
        """
        SELECT
            manager,
            COUNT(*) AS total,
            SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active_cnt,
            SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success_cnt,
            SUM(CASE WHEN status='closed' THEN 1 ELSE 0 END) AS closed_cnt,
            ROUND(SUM(CASE WHEN status='active' THEN area_m2 ELSE 0 END), 1) AS active_area,
            ROUND(SUM(CASE WHEN status='success' THEN area_m2 ELSE 0 END), 1) AS success_area,
            ROUND(SUM(CASE WHEN status='closed' THEN area_m2 ELSE 0 END), 1) AS closed_area
        FROM protections
        WHERE status != 'deleted'
        GROUP BY manager
        """
    ).fetchall()
    conn.close()

    out = []
    for r in rows:
        total = r["total"] or 0
        success = r["success_cnt"] or 0
        rate = round((success / total * 100) if total else 0)
        out.append(
            {
                "manager": r["manager"],
                "total": total,
                "active": r["active_cnt"] or 0,
                "success": success,
                "closed": r["closed_cnt"] or 0,
                "success_rate": rate,
                "active_area": r["active_area"] or 0,
                "success_area": r["success_area"] or 0,
                "closed_area": r["closed_area"] or 0,
            }
        )
    return out


@app.get("/api/export")
def export_protections(search: str = "", manager: str = "", status: str = ""):
    """
    Простой экспорт в CSV (откроется и в Excel/Numbers/Google Sheets).
    """
    sql = "SELECT * FROM protections WHERE 1=1"
    params = []

    if not status:
        sql += " AND status != 'deleted'"
    if search:
        s = f"%{search.lower()}%"
        sql += """
            AND (
                LOWER(manager) LIKE ? OR LOWER(client) LIKE ? OR LOWER(partner) LIKE ?
                OR LOWER(partner_city) LIKE ? OR LOWER(sku) LIKE ? OR LOWER(last4) LIKE ?
                OR LOWER(object_city) LIKE ? OR LOWER(address) LIKE ?
            )
        """
        params += [s] * 8
    if manager:
        sql += " AND manager = ?"
        params.append(manager)
    if status:
        sql += " AND status = ?"
        params.append(status)

    sql += " ORDER BY created_at DESC"

    conn = get_conn()
    rows = conn.cursor().execute(sql, params).fetchall()
    conn.close()

    output = [["ID", "Менеджер", "Клиент", "Партнёр", "Город партнёра", "SKU", "м²",
               "Последние 4 цифры", "Город объекта", "Адрес", "Комментарий",
               "Статус", "Создано", "Истекает", "Закрыта"]]
    for r in rows:
        output.append(
            [
                r["id"],
                r["manager"],
                r["client"],
                r["partner"],
                r["partner_city"],
                r["sku"],
                r["area_m2"],
                r["last4"],
                r["object_city"],
                r["address"],
                r["comment"],
                r["status"],
                r["created_at"],
                r["expires_at"],
                r["closed_at"],
            ]
        )

    import io

    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";")
    for row in output:
        writer.writerow(row)
    data = buf.getvalue().encode("utf-8-sig")

    filename = f"projectguard_export_{datetime.utcnow().date()}.csv"
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"'
    }
    return Response(content=data, media_type="text/csv", headers=headers)


# =========================
#   TELEGRAM: уведомления и бот
# =========================

from aiogram import Bot, Dispatcher, types, F
from aiogram.utils.keyboard import InlineKeyboardBuilder
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()


def get_tg_recipients_for_manager(cur, manager_name: str) -> list[int]:
    tg_ids: list[int] = []

    mgr = cur.execute(
        "SELECT id, tg_id, group_tag FROM users WHERE role='manager' AND first_name=?",
        (manager_name,),
    ).fetchone()

    group_tag = None
    if mgr:
        if mgr["tg_id"]:
            tg_ids.append(mgr["tg_id"])
        group_tag = mgr["group_tag"]

        assistants = cur.execute(
            "SELECT tg_id FROM users WHERE role='assistant' AND manager_id=?",
            (mgr["id"],),
        ).fetchall()
        for a in assistants:
            if a["tg_id"]:
                tg_ids.append(a["tg_id"])

    if group_tag:
        admins = cur.execute(
            "SELECT tg_id FROM users WHERE role='admin' AND group_tag=?",
            (group_tag,),
        ).fetchall()
        for a in admins:
            if a["tg_id"]:
                tg_ids.append(a["tg_id"])

    superadmins = cur.execute(
        "SELECT tg_id FROM users WHERE role='superadmin'"
    ).fetchall()
    for sa in superadmins:
        if sa["tg_id"]:
            tg_ids.append(sa["tg_id"])

    return list(dict.fromkeys(tg_ids))


async def send_and_store_tg(cur, protection_id: int, text: str, reply_markup=None):
    row = cur.execute(
        "SELECT manager FROM protections WHERE id=?", (protection_id,)
    ).fetchone()
    if not row:
        return
    recipients = get_tg_recipients_for_manager(cur, row["manager"])
    for chat_id in recipients:
        try:
            msg = await bot.send_message(
                chat_id, text, parse_mode="HTML", reply_markup=reply_markup
            )
            cur.execute(
                """
                INSERT INTO tg_notifications(protection_id, chat_id, message_id, created_at)
                VALUES (?,?,?,?)
                """,
                (protection_id, chat_id, msg.message_id, now_iso()),
            )
        except Exception as e:
            print(f"⚠️ Ошибка отправки в чат {chat_id}: {e}")


async def notify_admin_new_protection(p: dict):
    pid = p["id"]
    text = (
        "🆕 <b>Новая защита на проверке</b>\n"
        f"👤 Менеджер: {p.get('manager', '—')}\n"
        f"🏢 Партнёр: {p.get('partner', '—')} ({p.get('partner_city', '—')})\n"
        f"📦 SKU: {p.get('sku', '—')}\n"
        f"📏 Площадь: {p.get('area_m2', '—')} м²\n"
        f"📍 Объект: {p.get('object_city', '—')}, {p.get('address', '—')}\n"
        f"💬 Комментарий: {p.get('comment', '—')}\n"
    )

    kb = InlineKeyboardBuilder()
    kb.button(text="✅ Одобрить", callback_data=f"approve:{pid}")
    kb.button(text="🚫 Отклонить", callback_data=f"reject:{pid}")
    kb.adjust(2)

    conn = get_conn()
    cur = conn.cursor()
    await send_and_store_tg(cur, pid, text, reply_markup=kb.as_markup())
    conn.commit()
    conn.close()
    print(f"✅ Уведомление по защите #{pid} отправлено всем ответственным")


@dp.callback_query(F.data.startswith("approve:"))
async def approve_handler(callback: types.CallbackQuery):
    pid = int(callback.data.split(":")[1])

    conn = get_conn()
    cur = conn.cursor()
    row = cur.execute("SELECT * FROM protections WHERE id=?", (pid,)).fetchone()
    if not row:
        await callback.answer("❌ Защита не найдена", show_alert=True)
        conn.close()
        return

    r = dict(row)
    sku_display = r.get("sku") or r.get("comment") or "—"

    cur.execute(
        "UPDATE protections SET status='active', closed_at=NULL, sku=? WHERE id=?",
        (sku_display, pid),
    )
    add_history(cur, pid, "admin", "approve", {"source": "tg", "sku": sku_display})

    notif_rows = cur.execute(
        "SELECT chat_id, message_id FROM tg_notifications WHERE protection_id=?",
        (pid,),
    ).fetchall()
    conn.commit()
    conn.close()

    final_text = (
        f"✅ Защита #{pid} одобрена!\n\n"
        f"👤 Менеджер: {r['manager']}\n"
        f"🏢 Партнёр: {r['partner']} ({r['partner_city']})\n"
        f"📦 SKU: {sku_display}\n"
        f"📏 Площадь: {r['area_m2']} м²"
    )

    for n in notif_rows:
        try:
            await bot.edit_message_text(
                chat_id=n["chat_id"],
                message_id=n["message_id"],
                text=final_text,
                parse_mode="HTML",
            )
        except Exception as e:
            print(f"⚠️ Не смог обновить сообщение в чате {n['chat_id']}: {e}")

    await callback.answer("Одобрено ✅")


@dp.callback_query(F.data.startswith("reject:"))
async def reject_handler(callback: types.CallbackQuery):
    pid = int(callback.data.split(":")[1])

    conn = get_conn()
    cur = conn.cursor()
    row = cur.execute("SELECT * FROM protections WHERE id=?", (pid,)).fetchone()
    if not row:
        await callback.answer("❌ Защита не найдена", show_alert=True)
        conn.close()
        return

    r = dict(row)
    cur.execute(
        "UPDATE protections SET status='rejected', closed_at=? WHERE id=?",
        (now_iso(), pid),
    )
    add_history(cur, pid, "admin", "reject", {"source": "tg"})

    notif_rows = cur.execute(
        "SELECT chat_id, message_id FROM tg_notifications WHERE protection_id=?",
        (pid,),
    ).fetchall()
    conn.commit()
    conn.close()

    final_text = (
        f"🚫 Защита #{pid} отклонена.\n\n"
        f"👤 Менеджер: {r['manager']}\n"
        f"🏢 Партнёр: {r['partner']} ({r['partner_city']})\n"
        f"📦 SKU: {r.get('sku') or '—'}\n"
        f"📏 Площадь: {r.get('area_m2') or '—'} м²"
    )

    for n in notif_rows:
        try:
            await bot.edit_message_text(
                chat_id=n["chat_id"],
                message_id=n["message_id"],
                text=final_text,
                parse_mode="HTML",
            )
        except Exception as e:
            print(f"⚠️ Не смог обновить сообщение в чате {n['chat_id']}: {e}")

    await callback.answer("Отклонено 🚫")


@dp.message(F.text == "/start")
async def cmd_start_with_webapp(message: types.Message):
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="🚪 Войти в систему", web_app=WebAppInfo(url=WEBAPP_URL)
                )
            ]
        ]
    )
    await message.answer(
        "Привет 👋\n\nЭто Aquafloor Guard — система защиты проектов.\n"
        "Нажми кнопку ниже, чтобы войти в систему:",
        reply_markup=keyboard,
    )


async def check_expiring_protections():
    while True:
        try:
            conn = get_conn()
            cur = conn.cursor()
            now = datetime.utcnow()
            two_days = (now + timedelta(days=2)).isoformat()

            rows = cur.execute(
                """
                SELECT p.id, p.manager, p.sku, p.expires_at, u.tg_id, u.id AS user_id
                FROM protections p
                LEFT JOIN users u ON u.first_name = p.manager
                WHERE p.status='active' AND p.expires_at <= ?
                """,
                (two_days,),
            ).fetchall()

            for r in rows:
                manager_name = r["manager"]
                sku = r["sku"]
                pid = r["id"]
                expires_at = r["expires_at"]
                tg_id = r["tg_id"]

                assistants = cur.execute(
                    "SELECT tg_id FROM users WHERE manager_id=? AND role='assistant'",
                    (r["user_id"],),
                ).fetchall()

                msg = (
                    f"⚠️ Защита #{pid} ({sku}) у менеджера {manager_name}\n"
                    f"⏰ Истекает {expires_at[:10]} — осталось 2 дня!"
                )

                recipients = [tg_id] + [a["tg_id"] for a in assistants if a["tg_id"]]
                for tid in recipients:
                    try:
                        await bot.send_message(tid, msg)
                        print(f"📩 Напоминание отправлено {tid}")
                    except Exception as e:
                        print(f"⚠️ Ошибка отправки напоминания {tid}: {e}")

            conn.close()
        except Exception as e:
            print("❌ Ошибка в проверке истекающих защит:", e)

        await asyncio.sleep(24 * 60 * 60)


async def start_tg_bot():
    print("🤖 Telegram bot polling start")
    try:
        await dp.start_polling(bot)
    except Exception as e:
        print(f"Ошибка запуска Telegram-бота: {e}")


# ===== root для быстрой проверки =====

@app.get("/", tags=["root"])
def root():
    return {"ok": True, "message": "🚀 ProjectGuard backend is alive"}
