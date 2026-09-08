"""Administrative account mutations preserve identity and at least one active owner."""
import json
from contextlib import contextmanager

from fastapi import HTTPException
from backend import db
from backend.access_control import has_account_access

ROLES = ('user', 'manager', 'assistant', 'admin', 'superadmin')
FIELDS = ('full_name', 'phone', 'position', 'company', 'city', 'role', 'is_active',
          'manager_id', 'manager_ids', 'group_tag', 'region',
          'receive_notifications', 'receive_extend_notifications')


def _active(user):
    return has_account_access(user)


def _clean_changes(data):
    changes = {key: data[key] for key in FIELDS if key in data and data[key] is not None}
    if 'role' in changes and changes['role'] not in ROLES:
        raise HTTPException(400, 'Неизвестная роль')
    for field in ('is_active', 'receive_notifications', 'receive_extend_notifications'):
        if field in changes and changes[field] not in (0, 1):
            raise HTTPException(400, 'Допустимые значения переключателя: 0 или 1')
    if 'manager_ids' in changes:
        try:
            parsed = json.loads(changes['manager_ids']) if isinstance(changes['manager_ids'], str) else changes['manager_ids']
            if not isinstance(parsed, list):
                raise ValueError()
            non_null = [value for value in parsed if value not in (None, '')]
            if any(isinstance(value, bool) or not isinstance(value, int) or value <= 0 for value in non_null):
                raise ValueError()
            if len(non_null) != len(set(non_null)):
                raise HTTPException(400, 'Нельзя выбрать одного менеджера дважды')
            result = parsed[:3]
            result += [None] * (3 - len(result))
            changes['manager_ids'] = json.dumps(result, ensure_ascii=False)
        except (ValueError, TypeError):
            raise HTTPException(400, 'manager_ids должен быть массивом номеров менеджеров') from None
    return changes


@contextmanager
def _authorized_change(actor_id):
    conn = db.get_conn()
    cur = conn.cursor()
    try:
        if db.USE_POSTGRES:
            cur.execute('SELECT pg_advisory_xact_lock(-71920260908)')
        else:
            cur.execute('BEGIN IMMEDIATE')
        cur.execute(db._adapt_query('SELECT * FROM users WHERE id=?'), (actor_id,))
        actor = cur.fetchone()
        # Recheck after serialization, so two owners cannot disable each other.
        if not _active(actor) or actor.get('role') not in ('admin', 'superadmin'):
            raise HTTPException(403, 'Доступ администратора больше не активен')
        yield conn, cur, dict(actor)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def change_account(actor_id, target_id, data=None, *, delete=False, hard_delete=False):
    changes = _clean_changes(data or {})
    with _authorized_change(actor_id) as (conn, cur, actor):
        cur.execute(db._adapt_query('SELECT * FROM users WHERE id=?'), (target_id,))
        target = cur.fetchone()
        if not target:
            raise HTTPException(404, 'Пользователь не найден')
        target = dict(target)
        if not delete and target.get('access_status') != 'approved':
            raise HTTPException(409, 'Для заявки на доступ используйте отдельное действие одобрения или отклонения.')
        if target_id == actor_id and (delete or 'role' in changes or 'is_active' in changes):
            raise HTTPException(400, 'Нельзя изменить собственную роль или отключить свой профиль')
        if target['role'] == 'superadmin' and actor['role'] != 'superadmin':
            raise HTTPException(403, 'Изменять профиль главного администратора может только главный администратор')
        if changes.get('role') == 'superadmin' and actor['role'] != 'superadmin':
            raise HTTPException(403, 'Назначать главного администратора может только главный администратор')
        removes_owner = delete or changes.get('role', target['role']) != 'superadmin' or changes.get('is_active', target.get('is_active', 1)) == 0
        if target['role'] == 'superadmin' and _active(target) and removes_owner:
            cur.execute("SELECT COUNT(*) AS count FROM users WHERE role='superadmin' AND access_status='approved' AND COALESCE(is_active,1)<>0")
            if cur.fetchone()['count'] <= 1:
                raise HTTPException(400, 'Нельзя отключить или понизить последнего главного администратора')
        if delete and hard_delete:
            if db.USE_POSTGRES:
                # Match the protection creation lock before checking references.
                cur.execute('SELECT pg_advisory_xact_lock(71920260908)')
            for sql, value in (
                ('SELECT id FROM protections WHERE manager_id=? LIMIT 1', target_id),
                ('SELECT id FROM history WHERE actor=? LIMIT 1', str(target_id)),
                ('SELECT id FROM users WHERE manager_id=? LIMIT 1', target_id),
            ):
                cur.execute(db._adapt_query(sql), (value,))
                if cur.fetchone():
                    raise HTTPException(409, 'У пользователя есть защиты, история или привязки. Отключите доступ вместо полного удаления, чтобы сохранить данные.')
            cur.execute(db._adapt_query('DELETE FROM users WHERE id=?'), (target_id,))
            return None
        if delete:
            changes = {'is_active': 0}
        if changes:
            changes['updated_at'] = db.now_iso()
            sql = 'UPDATE users SET ' + ', '.join(f'{key}=?' for key in changes) + ' WHERE id=?'
            cur.execute(db._adapt_query(sql), (*changes.values(), target_id))
        cur.execute(db._adapt_query('SELECT * FROM users WHERE id=?'), (target_id,))
        return dict(cur.fetchone())


def create_account(actor_id, data):
    role = data.get('role') or 'manager'
    if role not in ROLES:
        raise HTTPException(400, 'Неизвестная роль')
    tg_id = str(data['tg_id'])
    if not tg_id.isdigit() or int(tg_id) <= 0:
        raise HTTPException(400, 'Укажите корректный Telegram ID')
    with _authorized_change(actor_id) as (conn, cur, actor):
        if role == 'superadmin' and actor['role'] != 'superadmin':
            raise HTTPException(403, 'Недостаточно прав для назначения этой роли')
        if db.USE_POSTGRES:
            cur.execute('SELECT pg_advisory_xact_lock(%s)', (int(tg_id),))
        cur.execute(db._adapt_query('SELECT id FROM users WHERE CAST(tg_id AS TEXT) IN (?, ?, ?)'), (tg_id, f'dev-{tg_id}', f'tg-{tg_id}'))
        if cur.fetchone():
            raise HTTPException(409, 'Пользователь уже существует. Измените его через редактирование профиля.')
        cur.execute(db._adapt_query("INSERT INTO users(tg_id,tg_username,first_name,role,is_active,access_status,created_at) VALUES(?,?,?,?,1,'approved',?)"),
                    (tg_id, data.get('tg_username', ''), data.get('first_name', ''), role, db.now_iso()))


def link_account_assistant(actor_id, manager_id, assistant_id):
    with _authorized_change(actor_id) as (conn, cur, actor):
        cur.execute(db._adapt_query('SELECT * FROM users WHERE id=?'), (manager_id,))
        manager = cur.fetchone()
        cur.execute(db._adapt_query('SELECT * FROM users WHERE id=?'), (assistant_id,))
        assistant = cur.fetchone()
        if not manager or not assistant:
            raise HTTPException(404, 'Менеджер или ассистент не найден')
        if manager.get('access_status') != 'approved' or assistant.get('access_status') != 'approved':
            raise HTTPException(409, 'Сначала рассмотрите заявку пользователя на доступ.')
        if assistant.get('role') == 'superadmin' and actor['role'] != 'superadmin':
            raise HTTPException(403, 'Изменять профиль главного администратора может только главный администратор')
        cur.execute(db._adapt_query('UPDATE users SET manager_id=?, updated_at=? WHERE id=?'),
                    (manager_id, db.now_iso(), assistant_id))


def review_application(actor_id, target_id, *, approve, role='manager'):
    """Only an explicit serialized admin decision admits a first-time user."""
    if approve and role not in ROLES:
        raise HTTPException(400, 'Неизвестная роль')
    with _authorized_change(actor_id) as (conn, cur, actor):
        cur.execute(db._adapt_query('SELECT * FROM users WHERE id=?'), (target_id,))
        target = cur.fetchone()
        if not target:
            raise HTTPException(404, 'Пользователь не найден')
        target = dict(target)
        if target_id == actor_id:
            raise HTTPException(400, 'Нельзя рассматривать собственную заявку')
        if target.get('role') == 'superadmin' and actor['role'] != 'superadmin':
            raise HTTPException(403, 'Недостаточно прав для изменения этого профиля')
        if approve and role == 'superadmin' and actor['role'] != 'superadmin':
            raise HTTPException(403, 'Назначать главного администратора может только главный администратор')
        if not approve and target.get('access_status') == 'rejected':
            return target
        if target.get('access_status') not in (('pending', 'rejected') if approve else ('pending',)):
            raise HTTPException(409, 'Заявка уже рассмотрена. Обновите список пользователей.')
        if approve:
            sql = "UPDATE users SET access_status='approved', is_active=1, role=?, updated_at=? WHERE id=? AND access_status IN ('pending', 'rejected')"
            params = (role, db.now_iso(), target_id)
        else:
            sql = "UPDATE users SET access_status='rejected', is_active=0, updated_at=? WHERE id=? AND access_status='pending'"
            params = (db.now_iso(), target_id)
        cur.execute(db._adapt_query(sql), params)
        cur.execute(db._adapt_query('SELECT * FROM users WHERE id=?'), (target_id,))
        return dict(cur.fetchone())
