"""Admission regression tests use fake identities and disposable database schemas only."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
import hashlib
import hmac
from threading import Barrier
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
import uuid

import pytest
from fastapi.testclient import TestClient
from jose import jwt

from backend.tests.test_auth_security import database, client, seed_user, signed_init, BOT_TOKEN, SECRET
from backend import auth, db, main


LOGIN_ALIASES = (
    '/api/auth/telegram-login', '/api/auth/telegram', '/api/auth/login',
    '/api/auth/register_or_login', '/api/users/auth/telegram',
)
PRESERVED = ('id', 'role', 'is_active', 'manager_id', 'manager_ids',
             'group_tag', 'region', 'receive_notifications', 'receive_extend_notifications', 'created_at')


def login_payload(tg_id=123456789):
    return {'init_data': signed_init(tg_id), 'full_name': 'Requested Name', 'phone': '70000000001',
            'tg_id': str(tg_id), 'role': 'superadmin', 'is_active': 1, 'access_status': 'approved'}


def bearer(user, *, legacy=False):
    payload = {'user_id': user['id'], 'role': 'superadmin', 'exp': datetime.utcnow() + timedelta(days=1)}
    if not legacy:
        payload['auth_version'] = 1
    return {'Authorization': 'Bearer ' + jwt.encode(payload, SECRET, algorithm='HS256')}


def all_users():
    conn = db.get_conn()
    try:
        return [dict(row) for row in conn.cursor().execute('SELECT * FROM users ORDER BY id').fetchall()]
    finally:
        conn.close()


def set_admission(user_id, status, *, active=0):
    conn = db.get_conn()
    try:
        conn.cursor().execute(db._adapt_query('UPDATE users SET access_status=?, is_active=? WHERE id=?'), (status, active, user_id))
        conn.commit()
    finally:
        conn.close()


def pending_request(client, tg_id=123456789):
    response = client.post(LOGIN_ALIASES[0], json=login_payload(tg_id))
    assert response.status_code == 403, response.text
    assert response.json()['detail']['code'] == 'access_pending'
    assert 'token' not in response.json()
    return db.get_user_by_tg_id(str(tg_id))


def fake_message(tg_id=123456789, text='/start'):
    return SimpleNamespace(from_user=SimpleNamespace(id=tg_id, username='local_test', first_name='Test'),
                           text=text, answer=AsyncMock(), reply=AsyncMock())


def test_all_signed_aliases_create_exactly_one_pending_request_without_jwt(client):
    for path in LOGIN_ALIASES * 2:
        response = client.post(path, json=login_payload())
        assert response.status_code == 403, (path, response.text)
        assert response.json()['detail']['code'] == 'access_pending'
        assert 'token' not in response.json()
    rows = all_users()
    assert len(rows) == 1
    assert rows[0]['tg_id'] == '123456789'
    assert rows[0]['role'] == 'manager'
    assert rows[0]['is_active'] == 0
    assert rows[0]['access_status'] == 'pending'


def test_valid_widget_first_login_also_requires_admission(client):
    import time
    payload = {'id': 123456789, 'first_name': 'Widget', 'auth_date': str(int(time.time()))}
    check = '\n'.join(f'{key}={value}' for key, value in sorted(payload.items()))
    payload['hash'] = hmac.new(hashlib.sha256(BOT_TOKEN.encode()).digest(), check.encode(), hashlib.sha256).hexdigest()
    response = client.post('/api/auth/telegram', json=payload)
    assert response.status_code == 403, response.text
    assert response.json()['detail']['code'] == 'access_pending'
    assert 'token' not in response.json()
    assert all_users()[0]['access_status'] == 'pending'


@pytest.mark.parametrize('active', [0, 1])
def test_existing_accounts_keep_access_state_ids_roles_and_bindings_on_every_alias(client, active):
    original = seed_user(role='assistant', is_active=active, manager_id=23, manager_ids='[23,29]', receive_notifications=0)
    old_headers = bearer(original, legacy=True)
    for path in LOGIN_ALIASES:
        response = client.post(path, json=login_payload())
        assert response.status_code == (200 if active else 403), (path, response.text)
        if active:
            assert response.json()['user']['id'] == original['id']
            assert response.json()['user']['role'] == 'assistant'
        else:
            assert 'token' not in response.json()
        current = db.get_user_by_id(original['id'])
        assert current['access_status'] == 'approved'
        assert {key: current[key] for key in PRESERVED} == {key: original[key] for key in PRESERVED}
    assert len(all_users()) == 1
    assert client.get('/api/auth/me', headers=old_headers).status_code == (200 if active else 403)


def test_public_email_registration_cannot_create_any_account(client):
    response = client.post('/api/auth/register', json={'email': 'new@example.invalid', 'password': 'test-password', 'full_name': 'Test',
                                                     'role': 'superadmin', 'is_active': 1, 'access_status': 'approved'})
    assert response.status_code == 403, response.text
    assert 'token' not in response.json()
    assert all_users() == []


@pytest.mark.parametrize('status', ['pending', 'rejected'])
def test_pending_or_rejected_password_account_cannot_issue_session(client, status):
    user = db.create_user({'email': 'waiting@example.invalid', 'password_hash': main.get_password_hash('local-password'), 'role': 'admin', 'is_active': 1})
    set_admission(user['id'], status, active=1)
    response = client.post('/api/auth/login', json={'email': 'waiting@example.invalid', 'password': 'local-password'})
    assert response.status_code == 403
    assert response.json()['detail']['code'] == 'access_' + status
    assert 'token' not in response.json()


@pytest.mark.parametrize('status', ['pending', 'rejected'])
@pytest.mark.parametrize('legacy', [False, True])
def test_unapproved_status_blocks_direct_signed_jwt_even_if_active_flag_is_one(client, status, legacy):
    user = seed_user(role='superadmin')
    set_admission(user['id'], status, active=1)
    headers = bearer(user, legacy=legacy)
    for method, path in (
        ('GET', '/api/auth/me'), ('GET', '/api/auth/verify'), ('GET', '/api/protections'),
        ('GET', '/api/history'), ('GET', '/api/stats'), ('GET', '/api/export'),
        ('POST', '/api/export-link'), ('GET', '/api/admin/users'), ('GET', '/api/users/'),
        ('POST', '/api/admin/clear-all-users'),
    ):
        response = client.request(method, path, headers=headers, json={} if method == 'POST' else None)
        assert response.status_code == 403, (path, response.text)
        assert response.json()['detail']['code'] == 'access_' + status
    assert len(all_users()) == 1


def test_previously_issued_export_ticket_rechecks_admission_status(client):
    from backend.export_tickets import issue_ticket
    user = seed_user()
    ticket = issue_ticket(main.JWT_SECRET or main.SECRET_KEY, user['id'], {})
    set_admission(user['id'], 'pending', active=1)
    assert client.get('/api/export-download', params={'ticket': ticket}).status_code == 403


def test_admin_approval_activates_same_pending_row_with_chosen_role(client):
    owner = seed_user(tg_id='987654321', role='superadmin')
    requested = pending_request(client)
    db.update_user(requested['id'], {'manager_id': 21, 'manager_ids': '[21,28]', 'receive_notifications': 0})
    before = db.get_user_by_id(requested['id'])
    response = client.post(f'/api/admin/users/{requested["id"]}/approve', json={'role': 'assistant'}, headers=bearer(owner))
    assert response.status_code == 200, response.text
    current = db.get_user_by_id(requested['id'])
    assert current['access_status'] == 'approved' and current['is_active'] == 1 and current['role'] == 'assistant'
    for field in ('id', 'tg_id', 'created_at', 'manager_id', 'manager_ids', 'receive_notifications'):
        assert current[field] == before[field]
    response = client.post(LOGIN_ALIASES[0], json=login_payload())
    assert response.status_code == 200
    assert response.json()['user']['id'] == requested['id']
    assert response.json()['user']['role'] == 'assistant'
    assert client.get('/api/auth/me', headers={'Authorization': 'Bearer ' + response.json()['token']}).status_code == 200
    assert client.post(f'/api/admin/users/{requested["id"]}/approve', json={'role': 'superadmin'}, headers=bearer(owner)).status_code == 409
    assert db.get_user_by_id(requested['id'])['role'] == 'assistant'
    assert len(all_users()) == 2


def test_rejection_is_idempotent_and_cannot_be_undone_by_login_or_profile_patch(client):
    owner = seed_user(tg_id='987654321', role='superadmin')
    requested = pending_request(client)
    path = f'/api/admin/users/{requested["id"]}'
    for _ in range(2):
        assert client.post(path + '/reject', headers=bearer(owner)).status_code == 200
    for alias in LOGIN_ALIASES:
        response = client.post(alias, json=login_payload())
        assert response.status_code == 403
        assert response.json()['detail']['code'] == 'access_rejected'
        assert 'token' not in response.json()
    response = client.patch(path, json={'is_active': 1, 'role': 'admin', 'access_status': 'approved'}, headers=bearer(owner))
    assert response.status_code == 409
    current = db.get_user_by_id(requested['id'])
    assert current['access_status'] == 'rejected' and current['is_active'] == 0 and current['role'] == 'manager'
    assert len(all_users()) == 2
    # Only an explicit admin decision can recover an accidental rejection.
    response = client.post(path + '/approve', json={'role': 'assistant'}, headers=bearer(owner))
    assert response.status_code == 200, response.text
    current = db.get_user_by_id(requested['id'])
    assert current['access_status'] == 'approved' and current['is_active'] == 1 and current['role'] == 'assistant'
    assert len(all_users()) == 2


def test_pending_patch_and_legacy_admin_create_cannot_bypass_approval(client):
    owner = seed_user(tg_id='987654321', role='superadmin')
    requested = pending_request(client)
    for method, path in [('PATCH', f'/api/admin/users/{requested["id"]}'), ('PATCH', f'/api/users/{requested["id"]}')]:
        response = client.request(method, path, json={'is_active': 1, 'role': 'admin', 'access_status': 'approved'}, headers=bearer(owner))
        assert response.status_code == 409, (path, response.text)
    for path in ('/api/users/', '/api/users'):
        response = client.post(path, json={'tg_id': 123456789, 'role': 'admin'}, headers=bearer(owner))
        assert response.status_code == 409, (path, response.text)
    assert db.get_user_by_id(requested['id'])['access_status'] == 'pending'
    assert db.get_user_by_id(requested['id'])['is_active'] == 0


def test_admission_decisions_preserve_admin_hierarchy_and_last_owner(client):
    owner = seed_user(tg_id='987654321', role='superadmin')
    administrator = seed_user(tg_id='987654322', role='admin')
    manager = seed_user(tg_id='987654323', role='manager')
    requested = pending_request(client)
    path = f'/api/admin/users/{requested["id"]}'
    assert client.post(path + '/approve', json={'role': 'manager'}, headers=bearer(manager)).status_code == 403
    assert client.post(path + '/reject', headers=bearer(manager)).status_code == 403
    assert client.post(path + '/approve', json={'role': 'superadmin'}, headers=bearer(administrator)).status_code == 403
    assert client.post(path + '/approve', json={'role': 'administrator'}, headers=bearer(owner)).status_code == 400
    assert db.get_user_by_id(requested['id'])['access_status'] == 'pending'
    assert client.post(f'/api/admin/users/{owner["id"]}/reject', headers=bearer(owner)).status_code in (400, 409)
    assert client.post(f'/api/admin/users/{owner["id"]}/reject', headers=bearer(administrator)).status_code in (403, 409)
    assert db.get_user_by_id(owner['id'])['is_active'] == 1


def test_existing_blocked_profile_uses_existing_admin_unblock_flow(client):
    owner = seed_user(tg_id='987654321', role='superadmin')
    blocked = seed_user(role='assistant', is_active=0, manager_ids='[21,28]')
    path = f'/api/admin/users/{blocked["id"]}'
    assert client.post(path + '/approve', json={'role': 'manager'}, headers=bearer(owner)).status_code == 409
    assert db.get_user_by_id(blocked['id'])['is_active'] == 0
    response = client.patch(path, json={'is_active': 1}, headers=bearer(owner))
    assert response.status_code == 200, response.text
    current = db.get_user_by_id(blocked['id'])
    assert current['access_status'] == 'approved' and current['is_active'] == 1
    assert current['role'] == 'assistant' and current['manager_ids'] == '[21,28]'


def test_concurrent_owner_changes_cannot_disable_last_admitted_owner(client):
    first = seed_user(tg_id='987654321', role='superadmin')
    second = seed_user(tg_id='987654322', role='superadmin')
    barrier = Barrier(2)
    def disable(pair):
        actor, target = pair
        barrier.wait(timeout=10)
        return TestClient(main.app).patch(f'/api/admin/users/{target["id"]}', json={'is_active': 0}, headers=bearer(actor)).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(disable, [(first, second), (second, first)]))
    assert sorted(results) == [200, 403]
    owners = [user for user in all_users() if user['role'] == 'superadmin' and user['access_status'] == 'approved' and user['is_active'] == 1]
    assert len(owners) == 1


def test_parallel_first_logins_and_approval_do_not_duplicate_or_reset_request(client):
    owner = seed_user(tg_id='987654321', role='superadmin')
    barrier = Barrier(len(LOGIN_ALIASES))
    def request(alias):
        barrier.wait(timeout=10)
        return TestClient(main.app).post(alias, json=login_payload()).status_code
    with ThreadPoolExecutor(max_workers=len(LOGIN_ALIASES)) as pool:
        assert list(pool.map(request, LOGIN_ALIASES)) == [403] * len(LOGIN_ALIASES)
    requested = db.get_user_by_tg_id('123456789')
    assert len(all_users()) == 2
    barrier = Barrier(2)
    def approve():
        barrier.wait(timeout=10)
        return TestClient(main.app).post(f'/api/admin/users/{requested["id"]}/approve', json={'role': 'assistant'}, headers=bearer(owner)).status_code
    def login_again():
        barrier.wait(timeout=10)
        return TestClient(main.app).post(LOGIN_ALIASES[0], json=login_payload()).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        approval = pool.submit(approve)
        another_login = pool.submit(login_again)
        assert approval.result(timeout=15) == 200
        assert another_login.result(timeout=15) in (200, 403)
    current = db.get_user_by_id(requested['id'])
    assert current['access_status'] == 'approved' and current['is_active'] == 1 and current['role'] == 'assistant'
    assert len(all_users()) == 2


def test_bot_start_submits_once_and_never_approves_request(client):
    for _ in range(2):
        message = fake_message()
        asyncio.run(main.cmd_start_with_webapp(message))
        message.answer.assert_awaited()
    current = all_users()
    assert len(current) == 1
    assert current[0]['access_status'] == 'pending' and current[0]['is_active'] == 0
    pending_request(client)
    assert all_users()[0]['id'] == current[0]['id']
    assert len(all_users()) == 1


@pytest.mark.parametrize('command', ['/protections', '/pending', '/extend 1 10', '/close 1 reason'])
def test_bot_middleware_blocks_unapproved_commands_before_handler(database, command):
    user = seed_user(role='superadmin')
    set_admission(user['id'], 'pending', active=1)
    handler = AsyncMock()
    message = fake_message(text=command)
    asyncio.run(main.spam_protection_middleware(handler, message, {}))
    handler.assert_not_awaited()
    message.answer.assert_awaited()


def test_pending_callback_cannot_approve_protection_even_with_admin_role(database, monkeypatch):
    user = seed_user(role='superadmin')
    set_admission(user['id'], 'pending', active=1)
    approve = Mock()
    monkeypatch.setattr(main, 'approve_pending', approve)
    callback = SimpleNamespace(from_user=SimpleNamespace(id=123456789), data='approve:1', answer=AsyncMock())
    asyncio.run(main.approve_handler(callback))
    approve.assert_not_called()
    callback.answer.assert_awaited()


def test_callback_middleware_rejects_before_any_protection_handler(database):
    user = seed_user(role='superadmin')
    set_admission(user['id'], 'rejected', active=1)
    handler = AsyncMock()
    callback = SimpleNamespace(from_user=SimpleNamespace(id=123456789), data='success_exp:1', answer=AsyncMock())
    asyncio.run(main.admission_callback_middleware(handler, callback, {}))
    handler.assert_not_awaited()
    callback.answer.assert_awaited_once()
    assert callback.answer.call_args.kwargs['show_alert'] is True


def test_notification_broadcast_recipients_are_approved_active_only(database, monkeypatch):
    approved = seed_user(tg_id='123456780', role='manager', receive_notifications=1)
    for index, (status, active) in enumerate((('approved', 0), ('pending', 1), ('rejected', 1))):
        user = seed_user(tg_id=str(123456781 + index), role='superadmin', receive_notifications=1)
        set_admission(user['id'], status, active=active)
    muted = seed_user(tg_id='123456789', role='manager', receive_notifications=0)
    bot = SimpleNamespace(send_message=AsyncMock())
    monkeypatch.setattr(main, 'bot', bot)
    asyncio.run(main.notify_all_users_new_protection({'id': 1, 'manager': 'Fixture manager', 'sku': 'FAKE-SKU'}))
    assert [call.kwargs['chat_id'] for call in bot.send_message.await_args_list] == [int(approved['tg_id'])]
    assert db.get_user_by_id(muted['id'])['is_active'] == 1


def test_manager_notification_links_exclude_unapproved_or_blocked_accounts(database):
    manager = seed_user(tg_id='123456780', role='manager', first_name='Managed')
    expected = {manager['tg_id']}
    conn = db.get_conn()
    try:
        conn.cursor().execute(db._adapt_query('UPDATE users SET group_tag=? WHERE id=?'), ('fixture-group', manager['id']))
        conn.commit()
    finally:
        conn.close()
    next_id = 123456781
    for role in ('assistant', 'admin', 'superadmin'):
        for status, active in (('approved', 1), ('approved', 0), ('pending', 1), ('rejected', 1)):
            user = seed_user(tg_id=str(next_id), role=role, manager_id=manager['id'], receive_notifications=1)
            next_id += 1
            set_admission(user['id'], status, active=active)
            conn = db.get_conn()
            try:
                conn.cursor().execute(db._adapt_query('UPDATE users SET group_tag=? WHERE id=?'), ('fixture-group', user['id']))
                conn.commit()
            finally:
                conn.close()
            if status == 'approved' and active:
                expected.add(user['tg_id'])
    conn = db.get_conn()
    try:
        assert set(map(str, main.get_tg_recipients_for_manager(conn.cursor(), 'Managed'))) == expected
    finally:
        conn.close()


def test_rerun_migration_does_not_approve_pending_or_rejected_rows(database):
    for index, status in enumerate(('approved', 'pending', 'rejected')):
        user = seed_user(tg_id=str(123456780 + index), role='assistant', manager_ids='[81]')
        set_admission(user['id'], status, active=0)
    before = all_users()
    db.init_db()
    db.init_db()
    assert all_users() == before


def test_old_populated_schema_migration_preserves_every_existing_field_and_history(client):
    for index, role in enumerate(('superadmin', 'admin', 'manager', 'assistant', 'user')):
        seed_user(tg_id=str(123456780 + index), role=role, is_active=0 if role == 'user' else 1,
                  manager_id=81, manager_ids='[81,82]', receive_notifications=index % 2)
    author_id = all_users()[0]['id']
    conn = db.get_conn()
    try:
        cur = conn.cursor()
        cur.execute('ALTER TABLE users DROP COLUMN access_status')
        cur.execute(db._adapt_query('INSERT INTO protections(manager, manager_id, status, created_at, expires_at) VALUES(?,?,?,?,?)'),
                    ('Fixture manager', author_id, 'closed', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'))
        cur.execute("SELECT id FROM protections")
        pid = cur.fetchone()['id']
        cur.execute(db._adapt_query('INSERT INTO history(protection_id, at, actor, action, payload) VALUES(?,?,?,?,?)'),
                    (pid, '2026-01-01T00:00:00Z', str(author_id), 'create', '{}'))
        conn.commit()
        before = [dict(row) for row in cur.execute('SELECT * FROM users ORDER BY id').fetchall()]
        history_before = [dict(row) for row in cur.execute('SELECT * FROM history ORDER BY id').fetchall()]
        protections_before = [dict(row) for row in cur.execute('SELECT * FROM protections ORDER BY id').fetchall()]
    finally:
        conn.close()
    for _ in range(2):
        db.init_db()
        after = all_users()
        assert all(row['access_status'] == 'approved' for row in after)
        assert [{key: row[key] for key in before[0]} for row in after] == before
    conn = db.get_conn()
    try:
        assert [dict(row) for row in conn.cursor().execute('SELECT * FROM history ORDER BY id').fetchall()] == history_before
        assert [dict(row) for row in conn.cursor().execute('SELECT * FROM protections ORDER BY id').fetchall()] == protections_before
    finally:
        conn.close()
    for user in before:
        response = client.get('/api/auth/me', headers=bearer(user, legacy=True))
        assert response.status_code == (200 if user['is_active'] else 403)
        if user['is_active']:
            assert response.json()['user']['id'] == user['id']
            assert response.json()['user']['role'] == user['role']


def test_migration_failure_keeps_startup_unready_without_workers(client, monkeypatch):
    user = seed_user()
    conn = db.get_conn()
    conn.cursor().execute('ALTER TABLE users DROP COLUMN access_status')
    conn.commit()
    conn.close()
    original = db.get_conn
    class Cursor:
        def __init__(self, cursor): self.cursor = cursor
        def __getattr__(self, key): return getattr(self.cursor, key)
        def execute(self, sql, *args, **kwargs):
            if 'ALTER TABLE USERS ADD COLUMN ACCESS_STATUS' in ' '.join(str(sql).upper().split()):
                raise db.sqlite3.OperationalError('synthetic access migration denied')
            return self.cursor.execute(sql, *args, **kwargs)
    class Connection:
        def __init__(self, connection): self.connection = connection
        def __getattr__(self, key): return getattr(self.connection, key)
        def cursor(self, *args, **kwargs): return Cursor(self.connection.cursor(*args, **kwargs))
    monkeypatch.setattr(db, 'get_conn', lambda: Connection(original()))
    with pytest.raises(Exception, match='synthetic access migration denied'):
        db.init_db()
    monkeypatch.setattr(main, '_initialized', False)
    monkeypatch.setattr(main, '_database_ready', False)
    create_task = Mock()
    monkeypatch.setattr(main.asyncio, 'create_task', create_task)
    asyncio.run(main._init_background())
    assert main._database_ready is False and main._initialized is False
    create_task.assert_not_called()
    assert client.get('/api/ready').status_code == 503
    assert client.get('/api/auth/me', headers=bearer(user, legacy=True)).status_code == 503


def test_postgres_migration_ignores_same_table_in_other_schema(database):
    if database != 'postgres':
        pytest.skip('PostgreSQL schema isolation only')
    from psycopg2 import sql
    name = 'unrelated_admission_' + uuid.uuid4().hex
    conn = db.get_conn()
    try:
        cur = conn.cursor()
        cur.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(name)))
        cur.execute(sql.SQL('CREATE TABLE {}.users (access_status TEXT)').format(sql.Identifier(name)))
        cur.execute('ALTER TABLE users DROP COLUMN access_status')
        conn.commit()
        db.init_db()
        assert 'access_status' in [column[0] for column in conn.cursor().execute('SELECT * FROM users LIMIT 0').description]
    finally:
        conn.rollback()
        conn.cursor().execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(name)))
        conn.commit()
        conn.close()
