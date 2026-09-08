"""Webhook and bot entry points use the same preserved accounts as the app."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from backend.tests.test_auth_security import database, client, seed_user
from backend import db, main


def test_forged_webhook_never_reaches_dispatcher(client, monkeypatch):
    feed = AsyncMock()
    monkeypatch.setattr(main.dp, "feed_update", feed)
    response = client.post("/api/telegram/webhook", json={"update_id": 1})
    assert response.status_code == 403
    feed.assert_not_awaited()
    response = client.post("/api/telegram/webhook", json={"update_id": 1},
                           headers={"X-Telegram-Bot-Api-Secret-Token": main.TELEGRAM_WEBHOOK_SECRET})
    assert response.status_code == 200
    feed.assert_awaited_once()


def test_start_reuses_legacy_account_without_role_or_binding_changes(database):
    original = seed_user(tg_id="tg-123456789", role="assistant", manager_id=45, manager_ids='[2,7]')
    message = SimpleNamespace(from_user=SimpleNamespace(id=123456789, username="current", first_name="Current"), answer=AsyncMock())
    asyncio.run(main.cmd_start_with_webapp(message))
    current = db.get_user_by_id(original["id"])
    for field in ("id", "role", "is_active", "manager_id", "manager_ids"):
        assert current[field] == original[field]
    assert current["tg_id"] == "123456789"
    conn = db.get_conn()
    try:
        assert conn.cursor().execute("SELECT COUNT(*) AS count FROM users").fetchone()["count"] == 1
    finally:
        conn.close()
    assert message.answer.await_count == 1


def test_bot_start_does_not_reactivate_blocked_user(database):
    original = seed_user(is_active=0)
    message = SimpleNamespace(from_user=SimpleNamespace(id=123456789, username="current", first_name="Current"), answer=AsyncMock())
    asyncio.run(main.cmd_start_with_webapp(message))
    assert db.get_user_by_id(original["id"])["is_active"] == 0
    assert message.answer.call_args.kwargs.get("reply_markup") is None


def test_manager_cannot_approve_by_telegram_callback(database):
    seed_user(role="manager")
    callback = SimpleNamespace(from_user=SimpleNamespace(id=123456789), data="approve:999", answer=AsyncMock())
    asyncio.run(main.approve_handler(callback))
    assert callback.answer.call_args.kwargs["show_alert"] is True
    assert "администратору" in callback.answer.call_args.args[0]


def test_fake_reply_prompt_cannot_change_protection(database, monkeypatch):
    close = AsyncMock()
    monkeypatch.setattr(main, "mark_closed", close)
    message = SimpleNamespace(reply_to_message=SimpleNamespace(from_user=SimpleNamespace(id=777), text="Закрыть защиту #1"),
                              from_user=SimpleNamespace(id=123456789), text="Причина", answer=AsyncMock())
    asyncio.run(main.handle_reply_message(message))
    close.assert_not_called()
    message.answer.assert_not_awaited()


def test_bot_deploy_preserves_pending_updates_and_configures_secret(monkeypatch):
    fake_bot = SimpleNamespace(set_webhook=AsyncMock())
    monkeypatch.setattr(main, "bot", fake_bot)
    monkeypatch.setattr(main, "_bot_running", False)
    monkeypatch.setattr(main, "_bot_ready", False)
    monkeypatch.setenv("RENDER_SERVICE_URL", "https://example.invalid")
    asyncio.run(main.start_tg_bot())
    assert fake_bot.set_webhook.call_args.kwargs["drop_pending_updates"] is False
    assert fake_bot.set_webhook.call_args.kwargs["secret_token"] == main.TELEGRAM_WEBHOOK_SECRET
    assert main._bot_ready is True


def test_reply_to_success_prompt_routes_to_authorized_mutation(database, monkeypatch):
    user = seed_user(role="manager")
    success = Mock()
    monkeypatch.setattr(main, "mark_success", success)
    message = SimpleNamespace(reply_to_message=SimpleNamespace(from_user=SimpleNamespace(id=main.bot.id), text="Отметить защиту #42 как успешную"),
                              from_user=SimpleNamespace(id=123456789), text="DOC-42", answer=AsyncMock())
    asyncio.run(main.handle_reply_message(message))
    assert success.call_args.args == (42, {"doc_1c": "DOC-42"})
    assert success.call_args.kwargs["user"]["id"] == user["id"]
    message.answer.assert_awaited_once()


def test_readiness_waits_for_database_and_webhook(client, monkeypatch):
    monkeypatch.setenv("RENDER_SERVICE_URL", "https://example.invalid")
    monkeypatch.setattr(main, "_database_ready", False)
    monkeypatch.setattr(main, "_bot_ready", False)
    assert client.get("/api/ready").status_code == 503
    main._safe_migrate()
    monkeypatch.setattr(main, "_database_ready", True)
    assert client.get("/api/ready").status_code == 503
    monkeypatch.setattr(main, "_bot_ready", True)
    assert client.get("/api/ready").status_code == 200


def test_failed_database_initialization_does_not_start_workers(monkeypatch):
    monkeypatch.setattr(main, "_initialized", False)
    monkeypatch.setattr(main, "_database_ready", False)
    monkeypatch.setattr(main, "init_db", Mock(side_effect=RuntimeError("synthetic database failure")))
    create = Mock()
    monkeypatch.setattr(main.asyncio, "create_task", create)
    asyncio.run(main._init_background())
    assert main._database_ready is False
    assert main._initialized is False
    create.assert_not_called()


def test_webhook_registration_retries_before_becoming_ready(monkeypatch):
    fake_bot = SimpleNamespace(set_webhook=AsyncMock(side_effect=[RuntimeError("temporary failure"), True]))
    monkeypatch.setattr(main, "bot", fake_bot)
    monkeypatch.setattr(main, "_bot_running", False)
    monkeypatch.setattr(main, "_bot_ready", False)
    monkeypatch.setenv("RENDER_SERVICE_URL", "https://example.invalid")
    monkeypatch.setattr(main.asyncio, "sleep", AsyncMock())
    asyncio.run(main.start_tg_bot())
    assert fake_bot.set_webhook.await_count == 2
    assert main._bot_ready is True


def test_unconfigured_notification_bridge_rejects_without_network(client, monkeypatch):
    monkeypatch.setattr(main, "NOTIFY_TOKEN", None)
    response = client.post("/api/notify", json={"chat_id": 1, "message": "test"})
    assert response.status_code == 503
