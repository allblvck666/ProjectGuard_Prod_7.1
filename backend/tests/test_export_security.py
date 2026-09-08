"""A download capability must never authenticate as its account's session."""
from backend.tests.test_auth_security import database, client, seed_user
from backend import auth, db, main


def test_export_link_requires_authenticated_account(client):
    assert client.post('/api/export-link', json={}).status_code == 401
    assert client.get('/api/export').status_code == 401
    assert client.get('/api/export-download', params={'ticket': 'forged'}).status_code == 403


def test_export_ticket_cannot_authenticate_as_jwt_and_jwt_cannot_download(client):
    user = seed_user(role='admin')
    jwt_token = auth.create_access_token(user)
    response = client.post('/api/export-link', json={'manager': 'Assigned', 'status': 'active'},
                           headers={'Authorization': 'Bearer ' + jwt_token})
    assert response.status_code == 200, response.text
    path = response.json()['path']
    from urllib.parse import urlparse, parse_qs
    ticket = parse_qs(urlparse(path).query)['ticket'][0]
    assert client.get('/api/auth/me', headers={'Authorization': 'Bearer ' + ticket}).status_code == 401
    assert client.get('/api/admin/users', headers={'Authorization': 'Bearer ' + ticket}).status_code == 401
    assert client.get('/api/export-download', params={'ticket': jwt_token}).status_code == 403
    download = client.get(path)
    assert download.status_code == 200, download.text
    assert download.headers['Cache-Control'] == 'private, no-store'
    assert download.headers['Referrer-Policy'] == 'no-referrer'
    assert 'text/csv' in download.headers['Content-Type']
    db.update_user(user['id'], {'is_active': 0})
    assert client.get(path).status_code == 403


def test_export_ticket_expires_after_one_minute_and_rejects_tampering(client, monkeypatch):
    from backend.export_tickets import issue_ticket
    import backend.export_tickets as tickets
    user = seed_user()
    base_time = 1788888888
    monkeypatch.setattr(tickets.time, 'time', lambda: base_time)
    ticket = issue_ticket(main.JWT_SECRET or main.SECRET_KEY, user['id'], {})
    assert client.get('/api/export-download', params={'ticket': ticket}).status_code == 200
    assert client.get('/api/export-download', params={'ticket': ticket + 'x'}).status_code == 403
    monkeypatch.setattr(tickets.time, 'time', lambda: base_time + 60)
    assert client.get('/api/export-download', params={'ticket': ticket}).status_code == 403
