"""Read-only access inventory. DATABASE_URL is read from the service environment.

Prints aggregate counts and a fingerprint, never credentials, names, phones or IDs.
Run before and after deployment; keep output with the private deployment record.
This is an inventory, not a database backup or an account migration.
"""
import hashlib
import json
import os
import re
from collections import Counter
from datetime import datetime, timezone

import psycopg2
from psycopg2.extras import RealDictCursor


def canonical_id(value):
    value = str(value or "").strip()
    value = re.sub(r"^(?:dev-|tg-)", "", value)
    return str(int(value)) if value.isdigit() and int(value) > 0 else None


def inventory(conn):
    conn.set_session(readonly=True, isolation_level="REPEATABLE READ")
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM users ORDER BY id")
        users = cur.fetchall()
        active = [u for u in users if u.get("is_active") not in (0, False, "0")]
        identities = Counter(canonical_id(u.get("tg_id")) for u in users)
        identities.pop(None, None)
        access_fields = ("id", "tg_id", "role", "is_active", "manager_id", "manager_ids",
                         "group_tag", "region", "receive_notifications", "receive_extend_notifications")
        access = [{k: u.get(k) for k in access_fields} for u in users]
        # A verified legacy tg-/dev- prefix correction preserves the same identity.
        for item in access:
            item["tg_id"] = canonical_id(item["tg_id"]) or item["tg_id"]
        cur.execute("SELECT status, COUNT(*) AS count FROM protections GROUP BY status ORDER BY status")
        protections = {r["status"]: r["count"] for r in cur.fetchall()}
        cur.execute("SELECT COUNT(*) AS count FROM history")
        history_count = cur.fetchone()["count"]
        cur.execute("SELECT COUNT(*) AS count FROM protections p LEFT JOIN users u ON p.manager_id=u.id WHERE p.manager_id IS NOT NULL AND u.id IS NULL")
        orphaned_authors = cur.fetchone()["count"]
        missing = sum(canonical_id(u.get("tg_id")) is None for u in active)
        password_fallback = sum(canonical_id(u.get("tg_id")) is None and bool(u.get("email") and u.get("password_hash")) for u in active)
        unsupported_id_format = sum(
            canonical_id(u.get("tg_id")) is not None
            and str(u.get("tg_id")) not in (
                canonical_id(u["tg_id"]), "tg-" + canonical_id(u["tg_id"]), "dev-" + canonical_id(u["tg_id"]))
            for u in active)
        phone_like_id = sum(
            bool(canonical_id(u.get("tg_id")))
            and canonical_id(u["tg_id"]) == re.sub(r"\D", "", str(u.get("phone") or ""))
            for u in active)
        return {
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "users": len(users), "active_users": len(active),
            "roles": dict(Counter(u.get("role") for u in users)),
            "active_without_telegram_id": missing,
            "of_those_with_password_login": password_fallback,
            "active_unsupported_telegram_id_format": unsupported_id_format,
            "active_telegram_id_matches_phone": phone_like_id,
            "canonical_id_collisions": sum(n > 1 for n in identities.values()),
            "orphaned_protection_authors": orphaned_authors,
            "access_fingerprint_sha256": hashlib.sha256(json.dumps(access, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest(),
            "protections_by_status": protections, "history_rows": history_count,
            "needs_access_review": missing > 0 or unsupported_id_format > 0 or phone_like_id > 0 or any(n > 1 for n in identities.values()),
        }


if __name__ == "__main__":
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL must be set in the service environment; do not paste credentials into chat.")
    with psycopg2.connect(url) as connection:
        print(json.dumps(inventory(connection), ensure_ascii=False, indent=2))
