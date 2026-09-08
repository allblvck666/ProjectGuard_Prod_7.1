import pytest

from backend.tests.test_auth_security import database, seed_user
from backend import db
from scripts.access_preflight import inventory


def snapshot():
    connection = db.get_conn()
    try:
        return inventory(connection)
    finally:
        connection.close()


def test_preflight_detects_permission_changes_without_disclosing_personal_data(database):
    if database != "postgres":
        pytest.skip("Production inventory uses PostgreSQL")
    user = seed_user(role="assistant", manager_id=73, manager_ids='[3,5]')
    before = snapshot()
    assert before["needs_access_review"] is False
    db.update_user(user["id"], {"full_name": "New display name", "first_name": "New"})
    assert snapshot()["access_fingerprint_sha256"] == before["access_fingerprint_sha256"]
    db.update_user(user["id"], {"role": "admin"})
    assert snapshot()["access_fingerprint_sha256"] != before["access_fingerprint_sha256"]
    assert str(user["tg_id"]) not in str(before)
    assert "Original Name" not in str(before)


def test_preflight_flags_accounts_that_cannot_safely_recover(database):
    if database != "postgres":
        pytest.skip("Production inventory uses PostgreSQL")
    seed_user(tg_id="00123456789")
    report = snapshot()
    assert report["active_unsupported_telegram_id_format"] == 1
    assert report["needs_access_review"] is True
