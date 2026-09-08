"""Verified Telegram identity; login never changes privileges or account ownership."""
import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl

from fastapi import HTTPException
from backend import db
from backend.auth import create_access_token


def _fresh(auth_date, max_age_seconds, now=None):
    try:
        age = int(time.time() if now is None else now) - int(auth_date)
        return -60 <= age <= max_age_seconds
    except (TypeError, ValueError, OverflowError):
        return False


def validate_init_data(init_data, bot_token, max_age_seconds=86400, *, now=None):
    """Validate the Mini App protocol (different from Telegram Login Widget)."""
    if not isinstance(init_data, str) or not init_data or not bot_token:
        return None
    try:
        pairs = parse_qsl(init_data, keep_blank_values=True, strict_parsing=True)
        params = dict(pairs)
        if len(params) != len(pairs):
            return None
        received_hash = params.pop("hash", "")
        if not isinstance(received_hash, str) or len(received_hash) != 64:
            return None
        check = "\n".join(f"{key}={value}" for key, value in sorted(params.items()))
        secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
        expected = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, received_hash):
            return None
        if not _fresh(params.get("auth_date"), max_age_seconds, now):
            return None
        user = json.loads(params["user"])
        if not isinstance(user, dict) or isinstance(user.get("id"), bool):
            return None
        if not isinstance(user.get("id"), int) or not 0 < user["id"] < 2**63:
            return None
        return user
    except (KeyError, ValueError, TypeError, OverflowError):
        return None


def validate_widget_data(data, bot_token, max_age_seconds=86400, *, now=None):
    if not isinstance(data, dict) or not bot_token:
        return None
    received_hash = data.get("hash")
    if not isinstance(received_hash, str) or len(received_hash) != 64:
        return None
    check = "\n".join(f"{key}={value}" for key, value in sorted(data.items()) if key != "hash")
    secret = hashlib.sha256(bot_token.encode()).digest()
    expected = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received_hash):
        return None
    if not _fresh(data.get("auth_date"), max_age_seconds, now):
        return None
    try:
        tg_id = int(data["id"])
        if isinstance(data["id"], bool) or not 0 < tg_id < 2**63:
            return None
    except (KeyError, ValueError, TypeError, OverflowError):
        return None
    return {**data, "id": tg_id}


def require_telegram_identity(data, bot_token, max_age_seconds=86400, *, allow_widget=False):
    if not isinstance(data, dict):
        raise HTTPException(400, "Некорректные данные входа")
    init_data = data.get("init_data") or data.get("initData")
    identity = validate_init_data(init_data, bot_token, max_age_seconds)
    if identity is None and not init_data and allow_widget:
        identity = validate_widget_data(data, bot_token, max_age_seconds)
    if identity is None:
        raise HTTPException(401, "Откройте приложение заново через Telegram для подтверждения входа.")
    return identity


def public_user(user):
    fields = ("id", "tg_id", "tg_username", "first_name", "email", "role", "phone", "position",
              "company", "city", "manager_id", "manager_ids", "is_active", "receive_notifications",
              "receive_extend_notifications")
    result = {key: user.get(key) for key in fields if key in user}
    result["full_name"] = user.get("full_name") or user.get("first_name") or ""
    return result


def login_response(user):
    if user.get("is_active", 1) in (0, "0", False):
        raise HTTPException(403, "Ваш аккаунт заблокирован. Обратитесь к администратору.")
    return {"ok": True, "token": create_access_token(user), "user": public_user(user)}


def resolve_verified_user(identity, profile=None):
    """Match only verified Telegram ID, keeping the existing row and its permissions.

    Legacy dev-/tg- prefixes can be canonicalized only when exactly one row matches.
    Names and phone numbers are profile data, never identity or role evidence.
    """
    tg_id = str(identity["id"])
    conn = db.get_conn()
    cur = conn.cursor()
    try:
        if db.USE_POSTGRES:
            # Serializes two first logins for one Telegram identity without schema changes.
            cur.execute("SELECT pg_advisory_xact_lock(%s)", (int(tg_id),))
        else:
            cur.execute("BEGIN IMMEDIATE")
        cur.execute(db._adapt_query(
            "SELECT * FROM users WHERE CAST(tg_id AS TEXT) IN (?, ?, ?) ORDER BY id"
        ), (tg_id, f"dev-{tg_id}", f"tg-{tg_id}"))
        matches = [dict(row) for row in cur.fetchall()]
        if len(matches) > 1:
            raise HTTPException(409, "Найдено несколько профилей Telegram. Администратор должен проверить привязку; данные сохранены.")
        now = db.now_iso()
        if matches:
            user = matches[0]
            if user.get("is_active", 1) in (0, "0", False):
                raise HTTPException(403, "Ваш аккаунт заблокирован. Обратитесь к администратору.")
            updates = {"tg_id": tg_id, "tg_username": identity.get("username", ""),
                       "first_name": identity.get("first_name", ""), "last_login": now}
            if not user.get("full_name"):
                updates["full_name"] = " ".join(filter(None, [identity.get("first_name"), identity.get("last_name")]))
            # Explicit registration may edit profile, but never role, activity or bindings.
            for key in ("full_name", "phone", "position"):
                if profile and key in profile and profile[key] is not None:
                    updates[key] = profile[key]
            sql = "UPDATE users SET " + ", ".join(f"{key}=?" for key in updates) + " WHERE id=?"
            cur.execute(db._adapt_query(sql), (*updates.values(), user["id"]))
            user.update(updates)
        else:
            full_name = " ".join(filter(None, [identity.get("first_name"), identity.get("last_name")]))
            values = (tg_id, identity.get("username", ""), identity.get("first_name", ""),
                      (profile or {}).get("full_name") or full_name, (profile or {}).get("phone", ""),
                      (profile or {}).get("position"), now, now)
            sql = db._adapt_query("""INSERT INTO users
                (tg_id, tg_username, first_name, full_name, phone, position, role, is_active, created_at, last_login)
                VALUES (?, ?, ?, ?, ?, ?, 'manager', 1, ?, ?)""")
            if db.USE_POSTGRES:
                sql += " RETURNING id"
            cur.execute(sql, values)
            user_id = cur.fetchone()["id"] if db.USE_POSTGRES else cur.lastrowid
            cur.execute(db._adapt_query("SELECT * FROM users WHERE id=?"), (user_id,))
            user = dict(cur.fetchone())
        conn.commit()
        return user
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def bind_verified_identity(current_user, identity):
    """An authenticated account can link only an identity proved by Telegram."""
    tg_id = str(identity["id"])
    conn = db.get_conn()
    cur = conn.cursor()
    try:
        if db.USE_POSTGRES:
            cur.execute("SELECT pg_advisory_xact_lock(%s)", (int(tg_id),))
        else:
            cur.execute("BEGIN IMMEDIATE")
        cur.execute(db._adapt_query("SELECT id FROM users WHERE CAST(tg_id AS TEXT) IN (?, ?, ?) AND id<>?"),
                    (tg_id, f"dev-{tg_id}", f"tg-{tg_id}", current_user["id"]))
        if cur.fetchone():
            raise HTTPException(409, "Этот Telegram уже связан с другим профилем.")
        cur.execute(db._adapt_query("UPDATE users SET tg_id=? WHERE id=?"), (tg_id, current_user["id"]))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return {"ok": True, "message": "Telegram подтверждён и привязан к вашему профилю"}
