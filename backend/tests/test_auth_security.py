"""Real HTTP auth integration against isolated SQLite and optional local PostgreSQL.

Run with PROJECTGUARD_TEST_PG_DSN pointing ONLY to a disposable local PostgreSQL
server to exercise its real cursor adapter. Every PG test gets a temporary schema.
"""
import hashlib
import hmac
import json
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import pytest
from fastapi.testclient import TestClient
from jose import jwt

os.environ.setdefault("BOT_TOKEN", "123456:local-test-token-not-real")
os.environ.setdefault("JWT_SECRET", "local-test-signing-key-not-production")
from backend import auth, db, main, users
from backend.telegram_identity import validate_init_data, validate_widget_data

BOT_TOKEN = "123456:local-test-token-not-real"
SECRET = "local-test-signing-key-not-production"


def signed_init(tg_id=123456789, *, age=0, token=BOT_TOKEN, extra=None):
    data = {"auth_date": str(int(time.time())-age), "query_id": "test-session",
            "user": json.dumps({"id": tg_id, "first_name": "Verified", "last_name": "Person", "username": "verified_user"}, separators=(",", ":"))}
    data.update(extra or {})
    check = "\n".join(f"{key}={value}" for key, value in sorted(data.items()))
    secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    data["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return urlencode(data)


@pytest.fixture(params=["sqlite", "postgres"])
def database(request, tmp_path, monkeypatch):
    is_pg = request.param == "postgres"
    root = None
    schema = None
    if is_pg:
        dsn = os.environ.get("PROJECTGUARD_TEST_PG_DSN")
        if not dsn:
            pytest.skip("Optional disposable PostgreSQL DSN not configured")
        import psycopg2
        root = psycopg2.connect(dsn)
        root.autocommit = True
        schema = "auth_test_" + uuid.uuid4().hex
        from psycopg2 import sql
        with root.cursor() as cursor:
            cursor.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
        from psycopg2.extensions import make_dsn
        monkeypatch.setattr(db, "DATABASE_URL", make_dsn(dsn, options=f"-c search_path={schema}"))
    else:
        monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "auth.sqlite3"))
    for module in (db, main, users):
        monkeypatch.setattr(module, "USE_POSTGRES", is_pg)
    monkeypatch.setattr(main, "BOT_TOKEN", BOT_TOKEN)
    monkeypatch.setattr(auth, "JWT_SECRET", SECRET)
    monkeypatch.setattr(auth, "AUTH_MIN_TOKEN_VERSION", 0)
    monkeypatch.setattr(auth, "AUTH_LEGACY_TOKENS_UNTIL", None)
    monkeypatch.setenv("BOT_TOKEN", BOT_TOKEN)
    monkeypatch.setattr(main, "ALLOW_DEV_LOGIN", False)
    db.init_db()
    try:
        yield request.param
    finally:
        if root:
            with root.cursor() as cursor:
                cursor.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
            root.close()


@pytest.fixture
def client(database):
    # Without entering the context manager, background bot/startup tasks never run.
    return TestClient(main.app)


def seed_user(tg_id="123456789", role="admin", **extra):
    result = db.create_user({"tg_id": tg_id, "role": role, "first_name": "Original", "full_name": "Original Name", "is_active": 1})
    if extra:
        result = db.update_user(result["id"], extra)
    return result


def test_mini_app_signature_uses_telegram_hmac_and_rejects_tampering():
    data = signed_init()
    assert validate_init_data(data, BOT_TOKEN)["id"] == 123456789
    assert validate_init_data(data + "&user=forged", BOT_TOKEN) is None
    assert validate_init_data(data.replace("test-session", "tampered"), BOT_TOKEN) is None
    assert validate_init_data(signed_init(age=86401), BOT_TOKEN) is None
    assert validate_init_data(signed_init(age=-61), BOT_TOKEN) is None
    assert validate_init_data(signed_init(extra={"auth_date": ""}), BOT_TOKEN) is None
    assert validate_init_data(signed_init(token="different-bot"), BOT_TOKEN) is None


def test_widget_protocol_is_separate_fresh_and_does_not_mutate_input():
    data = {"id": 123456789, "first_name": "Widget", "auth_date": str(int(time.time()))}
    check = "\n".join(f"{key}={value}" for key, value in sorted(data.items()))
    data["hash"] = hmac.new(hashlib.sha256(BOT_TOKEN.encode()).digest(), check.encode(), hashlib.sha256).hexdigest()
    original = dict(data)
    assert validate_widget_data(data, BOT_TOKEN)["id"] == 123456789
    assert data == original
    assert validate_widget_data({**data, "hash": "dev-mode"}, BOT_TOKEN) is None


@pytest.mark.parametrize("path,payload", [
    ("/api/auth/login", {"telegram_id": 123456789}),
    ("/api/auth/login", {"full_name": "Original Name", "phone": "79207455960"}),
    ("/api/auth/telegram", {"id": 123456789, "hash": "dev-mode"}),
    ("/api/auth/telegram-login", {"tg_id": 123456789}),
    ("/api/auth/register_or_login", {"tg_id": "123456789", "full_name": "Claimed", "phone": "79207455960"}),
    ("/api/users/auth/telegram", {"id": 123456789}),
    ("/api/auth/dev-login", {"id": 123456789, "role": "superadmin"}),
])
def test_public_login_routes_reject_unverified_identity(client, path, payload):
    seed_user(role="superadmin")
    response = client.post(path, json=payload)
    assert response.status_code in (401, 404), response.text
    assert "token" not in response.json()


def test_signed_login_preserves_original_account_permissions_and_bindings(client):
    original = seed_user(role="admin", manager_id=73, manager_ids='[73,81]', receive_notifications=0)
    response = client.post("/api/auth/telegram-login", json={"init_data": signed_init(), "tg_id": 999, "role": "superadmin"})
    assert response.status_code == 200, response.text
    result = response.json()
    current = db.get_user_by_id(original["id"])
    for field in ("id", "role", "is_active", "manager_id", "manager_ids", "receive_notifications", "full_name", "created_at"):
        assert current[field] == original[field]
    assert result["user"]["id"] == original["id"]
    assert result["user"]["role"] == "admin"
    assert current["first_name"] == "Verified"
    assert "password_hash" not in result["user"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {result['token']}"})
    assert me.status_code == 200 and me.json()["user"]["manager_ids"] == '[73,81]'


def test_new_verified_account_never_gets_privilege_from_claimed_phone_or_id(client):
    response = client.post("/api/auth/register_or_login", json={"init_data": signed_init(426188469), "full_name": "New Name", "phone": "79207455960", "role": "superadmin"})
    assert response.status_code == 200, response.text
    assert response.json()["user"]["role"] == "manager"


def test_blocked_account_is_not_reactivated(client):
    original = seed_user(role="assistant", is_active=0)
    response = client.post("/api/auth/telegram-login", json={"init_data": signed_init()})
    assert response.status_code == 403
    assert db.get_user_by_id(original["id"])["is_active"] == 0


def test_legacy_prefix_keeps_same_account_and_old_token(client):
    original = seed_user(tg_id="dev-123456789", role="assistant", manager_ids='[22]')
    old_token = jwt.encode({"user_id": original["id"], "sub": str(original["id"]), "tg_id": "dev-123456789", "role": "manager", "exp": datetime.utcnow()+timedelta(days=1)}, SECRET, algorithm="HS256")
    response = client.post("/api/auth/telegram-login", json={"init_data": signed_init()})
    assert response.status_code == 200, response.text
    assert response.json()["user"]["id"] == original["id"]
    assert db.get_user_by_id(original["id"])["tg_id"] == "123456789"
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {old_token}"})
    assert me.status_code == 200 and me.json()["user"]["role"] == "assistant"


def test_ambiguous_legacy_identity_is_not_merged(client):
    a = seed_user(tg_id="dev-123456789", role="admin")
    b = seed_user(tg_id="123456789", role="assistant")
    response = client.post("/api/auth/telegram-login", json={"init_data": signed_init()})
    assert response.status_code == 409
    assert db.get_user_by_id(a["id"])["tg_id"] == "dev-123456789"
    assert db.get_user_by_id(b["id"])["role"] == "assistant"


def test_existing_jwt_uses_persisted_role_and_blocks_inactive_account(client):
    user = seed_user(role="assistant")
    token = auth.create_access_token({**user, "role": "superadmin"})
    header = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/auth/me", headers=header).json()["user"]["role"] == "assistant"
    assert client.get("/api/admin/users", headers=header).status_code == 403
    db.update_user(user["id"], {"is_active": 0})
    assert client.get("/api/auth/me", headers=header).status_code == 403


def test_bare_rebinding_is_rejected_and_verified_binding_checks_other_accounts(client):
    user = seed_user(tg_id=None)
    header = {"Authorization": f"Bearer {auth.create_access_token(user)}"}
    assert client.post("/api/auth/update-tg-id", headers=header, json={"tg_id": "123456789"}).status_code == 401
    response = client.post("/api/auth/update-tg-id", headers=header, json={"init_data": signed_init()})
    assert response.status_code == 200, response.text
    assert db.get_user_by_id(user["id"])["tg_id"] == "123456789"


@pytest.mark.parametrize("existing_tg_id", ["123456789", "dev-123456789"])
def test_admin_create_duplicate_cannot_replace_existing_account(client, existing_tg_id):
    actor = seed_user(tg_id="987654321", role="superadmin")
    existing = seed_user(tg_id=existing_tg_id, role="assistant", manager_ids='[19]')
    header = {"Authorization": f"Bearer {auth.create_access_token(actor)}"}
    response = client.post("/api/users/", json={"tg_id": 123456789, "role": "manager"}, headers=header)
    assert response.status_code == 409, response.text
    assert db.get_user_by_id(existing["id"])["role"] == "assistant"
    assert db.get_user_by_id(existing["id"])["manager_ids"] == '[19]'


def test_email_registration_password_login_and_id_are_valid(client):
    response = client.post("/api/auth/register", json={"email": "auth-test@example.invalid", "password": "local-test-password", "full_name": "Email Test"})
    assert response.status_code == 200, response.text
    user_id = response.json()["user"]["id"]
    response = client.post("/api/auth/login", json={"email": "auth-test@example.invalid", "password": "local-test-password"})
    assert response.status_code == 200 and response.json()["user"]["id"] == user_id
    assert client.post("/api/auth/login", json={"email": "auth-test@example.invalid", "password": "wrong"}).status_code == 401


def test_real_cursor_supports_chaining_mapping_and_indexed_rows(database):
    conn = db.get_conn()
    try:
        cursor = conn.cursor()
        rows = cursor.execute("SELECT 7 AS value UNION ALL SELECT 8 AS value").fetchall()
        assert rows[0]["value"] == rows[0][0] == 7
        assert dict(rows[1]) == {"value": 8}
        assert cursor.execute("SELECT 9 AS value").fetchone()[0] == 9
        assert cursor.execute("SELECT 10 AS value").fetchmany(1)[0]["value"] == 10
    finally:
        conn.close()


def test_configured_postgres_failure_never_falls_back_to_an_empty_sqlite(monkeypatch):
    import psycopg2
    monkeypatch.setattr(db, "USE_POSTGRES", True)
    monkeypatch.setattr(psycopg2, "connect", lambda *args, **kwargs: (_ for _ in ()).throw(psycopg2.OperationalError("Local test outage")))
    monkeypatch.setattr(db.sqlite3, "connect", lambda *args, **kwargs: pytest.fail("Must not create fallback SQLite"))
    with pytest.raises(psycopg2.OperationalError):
        db.get_conn()


def test_simultaneous_first_verified_logins_create_one_account(database):
    from concurrent.futures import ThreadPoolExecutor
    from backend.telegram_identity import resolve_verified_user
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(resolve_verified_user, [{"id": 55555555, "first_name": "Same"}] * 2))
    assert results[0]["id"] == results[1]["id"]
    assert results[0]["role"] == results[1]["role"] == "manager"


@pytest.mark.parametrize('change', [{'is_active': 0}, {'role': 'manager'}])
def test_normal_admin_cannot_disable_or_demote_superadmin(client, change):
    administrator = seed_user(tg_id='11111111', role='admin')
    owner = seed_user(tg_id='22222222', role='superadmin')
    header = {'Authorization': 'Bearer ' + auth.create_access_token(administrator)}
    response = client.patch(f'/api/admin/users/{owner["id"]}', headers=header, json=change)
    assert response.status_code in (400, 403), response.text
    unchanged = db.get_user_by_id(owner['id'])
    assert unchanged['role'] == 'superadmin' and unchanged['is_active'] == 1


@pytest.mark.parametrize('change', [{'role': 'administrator'}, {'is_active': 2}])
def test_admin_cannot_store_an_unknown_role_or_activity_flag(client, change):
    administrator = seed_user(tg_id='11111111', role='superadmin')
    target = seed_user(tg_id='22222222', role='manager')
    header = {'Authorization': 'Bearer ' + auth.create_access_token(administrator)}
    response = client.patch(f'/api/admin/users/{target["id"]}', headers=header, json=change)
    assert response.status_code in (400, 422), response.text
    unchanged = db.get_user_by_id(target['id'])
    assert unchanged['role'] == 'manager' and unchanged['is_active'] == 1


@pytest.mark.parametrize('change', [{'is_active': 0}, {'role': 'manager'}])
def test_two_owners_cannot_remove_each_others_access_concurrently(database, change):
    from concurrent.futures import ThreadPoolExecutor
    from fastapi import HTTPException
    from backend.account_admin import change_account
    owner_a = seed_user(tg_id='11111111', role='superadmin')
    owner_b = seed_user(tg_id='22222222', role='superadmin')
    def attempt(pair):
        try:
            change_account(pair[0], pair[1], change)
            return 200
        except HTTPException as error:
            return error.status_code
    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(attempt, [(owner_a['id'], owner_b['id']), (owner_b['id'], owner_a['id'])]))
    assert sorted(outcomes) == [200, 403]
    conn = db.get_conn()
    try:
        assert conn.cursor().execute("SELECT COUNT(*) AS count FROM users WHERE role='superadmin' AND COALESCE(is_active,1)<>0").fetchone()['count'] == 1
    finally:
        conn.close()


def test_hard_delete_cannot_orphan_protections_and_soft_delete_retains_ids(client):
    actor = seed_user(tg_id='11111111', role='superadmin')
    author = seed_user(tg_id='22222222', role='manager')
    conn = db.get_conn()
    try:
        cur = conn.cursor()
        cur.execute(db._adapt_query("INSERT INTO protections(manager,manager_id,created_at,expires_at,status) VALUES(?,?,?,?,?)"),
                    ('Owner',author['id'],db.now_iso(),db.now_iso(),'closed'))
        conn.commit()
    finally:
        conn.close()
    header = {'Authorization': 'Bearer ' + auth.create_access_token(actor)}
    path = f'/api/admin/users/{author["id"]}'
    assert client.delete(path+'?hard_delete=true',headers=header).status_code == 409
    assert db.get_user_by_id(author['id'])['is_active'] == 1
    assert client.delete(path,headers=header).status_code == 200
    assert db.get_user_by_id(author['id'])['is_active'] == 0
    conn = db.get_conn()
    try:
        assert conn.cursor().execute('SELECT manager_id FROM protections').fetchone()['manager_id'] == author['id']
    finally:
        conn.close()


def test_legacy_session_retirement_is_opt_in_and_signed_reentry_keeps_account(client, monkeypatch):
    original = seed_user(role="assistant", manager_id=17, manager_ids='[17,21]')
    old_token = jwt.encode({"user_id": original["id"], "sub": str(original["id"]),
                            "role": "superadmin", "exp": datetime.utcnow()+timedelta(days=1)}, SECRET, algorithm="HS256")
    old_headers = {"Authorization": "Bearer " + old_token}
    # The rollout default preserves sessions minted before this release.
    assert auth.AUTH_MIN_TOKEN_VERSION == 0
    assert client.get("/api/auth/me", headers=old_headers).status_code == 200
    monkeypatch.setattr(auth, "AUTH_MIN_TOKEN_VERSION", 1)
    assert client.get("/api/auth/me", headers=old_headers).status_code == 401
    # The frontend responds to that 401 with this verified Telegram request.
    response = client.post("/api/auth/telegram-login", json={"init_data": signed_init()})
    assert response.status_code == 200, response.text
    token = response.json()["token"]
    assert jwt.decode(token, SECRET, algorithms=["HS256"])["auth_version"] == 1
    me = client.get("/api/auth/me", headers={"Authorization": "Bearer " + token})
    assert me.status_code == 200
    for field in ("id", "role", "is_active", "manager_id", "manager_ids"):
        assert me.json()["user"][field] == original[field]
    assert me.json()["user"]["role"] == "assistant"
    # Disabling the flag remains an immediate rollback without key rotation.
    monkeypatch.setattr(auth, "AUTH_MIN_TOKEN_VERSION", 0)
    assert client.get("/api/auth/me", headers=old_headers).status_code == 200


def test_compatibility_token_issuer_also_uses_current_auth_version(client, monkeypatch):
    user = seed_user(role="admin")
    monkeypatch.setattr(auth, "AUTH_MIN_TOKEN_VERSION", 1)
    token = auth.create_jwt(user["id"])
    assert jwt.decode(token, SECRET, algorithms=["HS256"])["auth_version"] == 1
    response = client.get("/api/auth/me", headers={"Authorization": "Bearer " + token})
    assert response.status_code == 200
    assert response.json()["user"]["id"] == user["id"]
    assert response.json()["user"]["role"] == "admin"


@pytest.mark.parametrize("value", [None, ""])
def test_legacy_deadline_is_optional(value):
    assert auth.parse_legacy_token_deadline(value) is None


@pytest.mark.parametrize("value", ["2026-10-08T15:58:32Z", "2026-10-08T15:58:32+00:00"])
def test_legacy_deadline_parses_explicit_utc(value):
    assert auth.parse_legacy_token_deadline(value) == datetime(2026, 10, 8, 15, 58, 32, tzinfo=timezone.utc)


@pytest.mark.parametrize("value", ["not-a-date", "2026-10-08", "2026-10-08T15:58:32", "2026-10-08T18:58:32+03:00", "   "])
def test_invalid_legacy_deadline_fails_configuration(value):
    with pytest.raises(RuntimeError, match="AUTH_LEGACY_TOKENS_UNTIL"):
        auth.parse_legacy_token_deadline(value)


def freeze_auth_time(monkeypatch, current):
    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return current.astimezone(tz) if tz else current.replace(tzinfo=None)

        @classmethod
        def utcnow(cls):
            return current.replace(tzinfo=None)

    monkeypatch.setattr(auth, "datetime", FrozenDateTime)


@pytest.mark.parametrize("offset_us,legacy_status", [(-1, 200), (0, 401), (1, 401)])
def test_legacy_deadline_http_boundary_preserves_versioned_account(client, monkeypatch, offset_us, legacy_status):
    original = seed_user(role="assistant", manager_id=17, manager_ids='[17,21]')
    deadline = datetime.now(timezone.utc) + timedelta(hours=1)
    # Keep JWT expiry valid independently of the deadline, including exactly at it.
    legacy = jwt.encode({"user_id": original["id"], "role": "superadmin", "exp": deadline + timedelta(days=1)}, SECRET, algorithm="HS256")
    current = auth.create_access_token(original)
    monkeypatch.setattr(auth, "AUTH_LEGACY_TOKENS_UNTIL", deadline)
    freeze_auth_time(monkeypatch, deadline + timedelta(microseconds=offset_us))
    response = client.get("/api/auth/me", headers={"Authorization": "Bearer " + legacy})
    assert response.status_code == legacy_status
    response = client.get("/api/auth/me", headers={"Authorization": "Bearer " + current})
    assert response.status_code == 200
    for field in ("id", "role", "is_active", "manager_id", "manager_ids"):
        assert response.json()["user"][field] == original[field]


@pytest.mark.parametrize("minimum,offset_us,legacy_status,current_status", [
    (0, -1, 200, 200), (1, -1, 401, 200), (2, -1, 401, 401), (2, 0, 401, 401),
])
def test_explicit_minimum_version_overrides_deadline(client, monkeypatch, minimum, offset_us, legacy_status, current_status):
    original = seed_user()
    deadline = datetime.now(timezone.utc) + timedelta(hours=1)
    legacy = jwt.encode({"user_id": original["id"], "exp": deadline + timedelta(days=1)}, SECRET, algorithm="HS256")
    current = auth.create_access_token(original)
    monkeypatch.setattr(auth, "AUTH_MIN_TOKEN_VERSION", minimum)
    monkeypatch.setattr(auth, "AUTH_LEGACY_TOKENS_UNTIL", deadline)
    freeze_auth_time(monkeypatch, deadline + timedelta(microseconds=offset_us))
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer " + legacy}).status_code == legacy_status
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer " + current}).status_code == current_status


def test_verified_reentry_after_legacy_deadline_keeps_id_and_permissions(client, monkeypatch):
    original = seed_user(role="assistant", manager_id=17, manager_ids='[17,21]')
    deadline = datetime.now(timezone.utc)
    legacy = jwt.encode({"user_id": original["id"], "role": "superadmin", "exp": deadline + timedelta(days=1)}, SECRET, algorithm="HS256")
    monkeypatch.setattr(auth, "AUTH_LEGACY_TOKENS_UNTIL", deadline)
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer " + legacy}).status_code == 401
    response = client.post("/api/auth/telegram-login", json={"init_data": signed_init()})
    assert response.status_code == 200
    token = response.json()["token"]
    assert jwt.decode(token, SECRET, algorithms=["HS256"])["auth_version"] == 1
    response = client.get("/api/auth/me", headers={"Authorization": "Bearer " + token})
    assert response.status_code == 200
    for field in ("id", "role", "is_active", "manager_id", "manager_ids"):
        assert response.json()["user"][field] == original[field]
