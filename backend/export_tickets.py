"""Short-lived export capabilities, intentionally incompatible with session JWTs."""
import base64
import hashlib
import hmac
import json
import time


def _key(secret):
    return hmac.new(secret.encode(), b"ProjectGuard CSV download v1", hashlib.sha256).digest()


def issue_ticket(secret, user_id, filters, now=None):
    payload = {"purpose": "csv-export", "uid": int(user_id), "exp": int(time.time() if now is None else now) + 60,
               "filters": {key: str(filters.get(key) or "")[:200] for key in ("search", "manager", "status")}}
    body = base64.urlsafe_b64encode(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()).rstrip(b"=")
    signature = hmac.new(_key(secret), body, hashlib.sha256).hexdigest()
    return body.decode() + "." + signature


def read_ticket(secret, ticket, now=None):
    if not isinstance(ticket, str) or len(ticket) > 4000:
        raise ValueError("Invalid export ticket")
    try:
        body, signature = ticket.split(".")
        expected = hmac.new(_key(secret), body.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError()
        payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        current = int(time.time() if now is None else now)
        if payload["purpose"] != "csv-export" or not current < payload["exp"] <= current + 60:
            raise ValueError()
        if not isinstance(payload["uid"], int) or payload["uid"] <= 0 or not isinstance(payload["filters"], dict):
            raise ValueError()
        return payload
    except (ValueError, TypeError, KeyError, UnicodeError):
        raise ValueError("Invalid or expired export ticket") from None
