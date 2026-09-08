"""Synthetic DB regression tests; never start Telegram or touch production data."""
import asyncio
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, AsyncMock

from backend.protection_rules import material_values, materials_conflict, can_manage
from backend.export_tickets import issue_ticket, read_ticket


class MaterialRulesTests(unittest.TestCase):
    def test_single_and_multiple_legacy_area_strings(self):
        self.assertTrue(materials_conflict('AF1 (клей)', 100, 'AF1 (клей) — 100 м²', 100))
        self.assertTrue(materials_conflict('AF1 (клей) — 180 м²; AF2 (замок) — 140 м²', 320, 'AF2 (замок) — 150 м²', 150))
        self.assertFalse(materials_conflict('AF1 (клей) — 180 м²; AF2 (замок) — 140 м²', 320, 'AF2 (замок) — 320 м²', 320))
        self.assertFalse(materials_conflict('AF1 (клей)', 100, 'AF2 (клей)', 100))

    def test_tolerance_uses_matching_sku_area(self):
        self.assertTrue(materials_conflict('A (клей)', 110, 'A (замок)', 100))
        self.assertTrue(materials_conflict('A (клей) — 50 м²; A (замок) — 50 м²',100,'A (клей)',100))
        self.assertFalse(materials_conflict('A (клей)', 111, 'A (замок)', 100))

    def test_invalid_numbers_and_partial_per_sku_areas(self):
        for area in (0, -1, 49, float('nan'), float('inf')):
            with self.assertRaises(ValueError):
                material_values({'sku': 'A', 'area_m2': area})
        with self.assertRaises(ValueError):
            material_values({'sku':'A (клей) — 100 м²','area_m2':600})
        with self.assertRaises(ValueError):
            material_values({'sku_data': [{'sku':'A','area':100},{'sku':'B','area':None}]})

    def test_sku_limit_duplicates_and_split_areas(self):
        four=[{'sku':f'A{i}','type':'клей'} for i in range(4)]
        for data in ({'sku_data':four,'area_m2':100},{'sku':'A + B + C + D','area_m2':100},{'sku_data':[{'sku':'A','type':'клей','area':50},{'sku':'a','type':'Клей','area':50}]},{'sku':'A (клей) — 50 м²; a (Клей) — 50 м²','area_m2':100}):
            with self.assertRaises(ValueError):
                material_values(data)
        # Two legitimate types of the same material still count together for conflicts.
        display,total=material_values({'sku_data':[{'sku':'A','type':'клей','area':50},{'sku':'A','type':'замок','area':50}]})
        self.assertTrue(materials_conflict(display,total,'A',100))
        # Existing archived rows remain readable/restorable even if old clients stored more rows.
        self.assertEqual(material_values({'sku':'A + B + C + D','area_m2':100},validate_limits=False)[1],100)

    def test_directory_ids_never_confused_with_author_user_ids(self):
        row = {'manager_id':42}
        assistant = {'id':3, 'role':'assistant', 'manager_ids':'[42]'}
        self.assertFalse(can_manage(assistant, row, dictionary_manager_id=7))
        self.assertTrue(can_manage(assistant, row, dictionary_manager_id=42))
        self.assertTrue(can_manage({**assistant, 'manager_id':42}, row, dictionary_manager_id=7))
        self.assertFalse(can_manage({'id':4, 'role':'manager', 'manager_ids':'[7]'}, row, dictionary_manager_id=7))

    def test_export_ticket_scope_tamper_expiry(self):
        ticket = issue_ticket('synthetic-test-secret', 1, {'status':'active'}, now=100)
        self.assertEqual(read_ticket('synthetic-test-secret', ticket, now=101)['uid'], 1)
        self.assertEqual(ticket.count('.'), 1)  # cannot be a session JWT
        for value, now in ((ticket+'a',101),(ticket,160)):
            with self.assertRaises(ValueError):
                read_ticket('synthetic-test-secret', value, now=now)


class ProtectionIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Test runner must explicitly select a disposable local database.
        if os.environ.get('DATABASE_URL'):
            if 'projectguard_test' not in os.environ['DATABASE_URL']:
                raise RuntimeError('Refusing to run tests against a non-test PostgreSQL database')
        os.environ.setdefault('BOT_TOKEN', '123456789:synthetic_test_bot_token_abcdefghijklmnopqrstuvwxyz')
        os.environ.setdefault('JWT_SECRET', 'synthetic-test-secret-never-use-in-production')
        os.environ.setdefault('SECRET_KEY', os.environ['JWT_SECRET'])
        from backend import main, db
        cls.main, cls.db = main, db
        from fastapi.testclient import TestClient
        cls.TestClient = TestClient

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='pg-protection-test-')
        self.db_path_patch = patch.object(self.db, 'DB_PATH', str(Path(self.temp.name)/'test.sqlite3'))
        self.db_path_patch.start()
        self.db.init_db()
        conn = self.db.get_conn(); cur = conn.cursor()
        if self.db.USE_POSTGRES:
            cur.execute('TRUNCATE protections, history, users, managers RESTART IDENTITY CASCADE')
        self.users = {
            1: {'id':1,'role':'manager','tg_id':'900001','first_name':'Owner','is_active':1,'manager_ids':'[]'},
            2: {'id':2,'role':'manager','tg_id':'900002','first_name':'Other','is_active':1,'manager_ids':'[]'},
            3: {'id':3,'role':'admin','tg_id':'900003','first_name':'Admin','is_active':1,'manager_ids':'[]'},
            4: {'id':4,'role':'assistant','tg_id':'900004','first_name':'Assistant','is_active':1,'manager_ids':'[7]'},
            5: {'id':5,'role':'superadmin','tg_id':'900005','first_name':'OwnerAdmin','is_active':1,'manager_ids':'[]'},
        }
        for user in self.users.values():
            cur.execute(self.db._adapt_query('INSERT INTO users(id,tg_id,first_name,role,is_active,manager_ids,created_at,receive_notifications) VALUES(?,?,?,?,?,?,?,0)'), (*tuple(user[k] for k in ('id','tg_id','first_name','role','is_active','manager_ids')), self.db.now_iso()))
        cur.execute(self.db._adapt_query('INSERT INTO managers(id,name) VALUES(?,?)'), (7,'Manager directory'))
        conn.commit();conn.close()
        self.bot_patch = patch.object(self.main.bot, "send_message", new=AsyncMock())
        self.bot_patch.start()
        self.main.app.dependency_overrides.clear()
        # No context manager: FastAPI startup never runs, so no bot/network tasks.
        self.client = self.TestClient(self.main.app)

    def tearDown(self):
        self.client.close()
        self.bot_patch.stop()
        self.main.app.dependency_overrides.clear()
        self.db_path_patch.stop();self.temp.cleanup()

    def auth(self, uid=1):
        self.main.app.dependency_overrides[self.main.get_current_active_user] = lambda:self.users[uid]

    def create(self, sku='AF1', area=100, uid=1, per=False):
        payload = self.main.ProtectionCreate(manager='Manager directory', client='Client', partner='Partner', partner_city='Moscow', object_city='Moscow', address='Street', last4='1234', comment='Original', sku_data=[{'sku':sku,'type':'клей','area':area if per else None}], area_m2=None if per else area)
        return self.main.create_protection(payload, user=self.users[uid], background_tasks=self.main.BackgroundTasks())

    def change_db(self, pid, **changes):
        conn=self.db.get_conn();cur=conn.cursor()
        columns=', '.join(key+'=?' for key in changes)
        cur.execute(self.db._adapt_query(f'UPDATE protections SET {columns} WHERE id=?'), (*changes.values(),pid))
        conn.commit();conn.close()

    def row(self,pid):
        conn=self.db.get_conn()
        try:return self.main._get_protection(conn.cursor(),pid)
        finally:conn.close()

    def history(self,pid):
        return self.main.history(pid,user=self.users[1])

    def test_unauthenticated_reads_and_mutations_denied(self):
        for url in ('/api/protections','/api/history','/api/stats','/api/export','/api/user-managers'):
            self.assertIn(self.client.get(url).status_code,(401,403),url)
        for method,url,payload in [('POST','/api/protections/1/extend?actor=admin',{}),('POST','/api/protections/1/close',{'reason':'x'}),('POST','/api/protections/1/success',{'doc_1c':'x'}),('POST','/api/protections/1/restore',{}),('PUT','/api/protections/1',{'comment':'x'}),('PUT','/api/admin/managers/1/telegrams',{'telegrams':[]})]:
            self.assertIn(self.client.request(method,url,json=payload).status_code,(401,403),url)

    def test_full_edit_preserves_author_creation_and_deadline_with_audit(self):
        initial=self.create();self.auth()
        payload={'expected_updated_at':initial.updated_at,'manager':'New manager','client':'New client','partner':'New partner','partner_city':'Kazan','object_city':'Perm','address':'New address','last4':'9876','comment':'New comment','sku_data':[{'sku':'AF2','type':'замок','area':350},{'sku':'AF3','type':'клей','area':300}]}
        response=self.client.put(f'/api/protections/{initial.id}',json=payload)
        self.assertEqual(response.status_code,200,response.text)
        updated=response.json()
        self.assertEqual((updated['id'],updated['manager_id'],updated['created_at'],updated['expires_at']),(initial.id,1,initial.created_at,initial.expires_at))
        for field in ('manager','client','partner','partner_city','object_city','address','last4','comment'):
            self.assertEqual(updated[field],payload[field])
        self.assertEqual(updated['area_m2'],650)
        event=next(e for e in self.history(initial.id) if e['action']=='edit')
        self.assertEqual(event['actor'],'1');self.assertEqual(event['payload']['before']['client'],'Client');self.assertEqual(event['payload']['after']['client'],'New client')
        self.assertNotEqual(initial.updated_at,updated['updated_at'])

    def test_foreign_edit_and_author_reassignment_denied(self):
        item=self.create();self.auth(2)
        self.assertEqual(self.client.put(f'/api/protections/{item.id}',json={'comment':'bad','expected_updated_at':item.updated_at}).status_code,403)
        self.auth(1)
        self.assertEqual(self.client.put(f'/api/protections/{item.id}',json={'manager_id':2,'expected_updated_at':item.updated_at}).status_code,422)
        self.assertEqual(self.row(item.id)['manager_id'],1)

    def test_concurrent_edit_detects_extension_and_preserves_data(self):
        item=self.create();self.auth()
        extended=self.main.extend(item.id,user=self.users[1])
        response=self.client.put(f'/api/protections/{item.id}',json={'expected_updated_at':item.updated_at,'comment':'stale'})
        self.assertEqual(response.status_code,409,response.text)
        self.assertEqual(response.json()['detail']['code'],'stale_protection')
        self.assertEqual(self.row(item.id)['comment'],'Original')
        self.assertEqual(self.row(item.id)['expires_at'],extended.expires_at)

    def test_duplicate_precheck_create_edit_and_minimum(self):
        item=self.create(per=True);other=self.create(sku='AF2');self.auth()
        payload={'manager':'Manager directory','sku_data':[{'sku':'AF1','type':'замок','area':100}]}
        found=self.client.post('/api/protections/check-duplicate',json=payload)
        self.assertEqual(found.status_code,200,found.text);self.assertEqual(found.json()[0]['id'],item.id)
        self.assertEqual(self.client.post('/api/protections',json=payload).status_code,409)
        self.assertEqual(self.client.put(f'/api/protections/{other.id}',json={**payload,'expected_updated_at':other.updated_at}).status_code,409)
        self.assertEqual(self.client.put(f'/api/protections/{item.id}',json={'area_m2':1,'sku':'AF1','expected_updated_at':item.updated_at}).status_code,400)
        response=self.client.put(f'/api/protections/{item.id}',json={'comment':'Self is excluded','expected_updated_at':item.updated_at})
        self.assertEqual(response.status_code,200,response.text)

    def test_role_spoof_and_extension_limit(self):
        item=self.create();self.change_db(item.id,extend_count=2);self.auth()
        response=self.client.post(f'/api/protections/{item.id}/extend?actor=admin&days=30')
        self.assertEqual(response.status_code,403,response.text)
        self.assertEqual(self.row(item.id)['extend_count'],2)
        self.assertEqual(self.client.post(f'/api/protections/{item.id}/extend?days=-10').status_code,400)
        self.auth(2);self.assertEqual(self.client.post(f'/api/protections/{item.id}/extend').status_code,403)
        self.auth(3);self.assertEqual(self.client.post(f'/api/protections/{item.id}/extend?days=10').status_code,200)
        self.assertEqual(self.row(item.id)['extend_count'],2)

    def test_restore_same_id_history_fresh_deadline_flags_and_quota(self):
        item=self.create();self.change_db(item.id,status='closed',auto_closed=1,reminder_2days_sent=1,expires_at='2020-01-01T00:00:00Z',closed_at='2020-01-02T00:00:00Z',close_reason='expired')
        self.auth()
        response=self.client.post(f'/api/protections/{item.id}/restore?days=30')
        self.assertEqual(response.status_code,200,response.text)
        row=self.row(item.id)
        self.assertEqual((row['id'],row['manager_id'],row['created_at']),(item.id,1,item.created_at))
        self.assertEqual((row['status'],row['auto_closed'],row['reminder_2days_sent'],row['extend_count']),('active',0,0,1))
        self.assertIsNone(row['closed_at']);self.assertIsNone(row['close_reason'])
        self.assertGreater(row['expires_at'],self.db.now_iso())
        self.assertEqual({e['action'] for e in self.history(item.id)},{'create','restore'})
        self.assertEqual(self.client.post(f'/api/protections/{item.id}/restore').status_code,409)

    def test_restore_quota_conflict_manual_close_and_foreign_access(self):
        item=self.create();self.change_db(item.id,status='closed',auto_closed=1,extend_count=2);self.auth()
        self.assertEqual(self.client.post(f'/api/protections/{item.id}/restore').status_code,403)
        self.change_db(item.id,extend_count=0);other=self.create()
        self.assertEqual(self.client.post(f'/api/protections/{item.id}/restore').status_code,409)
        self.change_db(other.id,status='closed',auto_closed=0)
        self.assertEqual(self.client.post(f'/api/protections/{other.id}/restore').status_code,409)
        self.auth(2);self.assertEqual(self.client.post(f'/api/protections/{item.id}/restore').status_code,403)

    def test_assistant_directory_permissions_and_archive_capabilities(self):
        item=self.create();self.auth(4)
        data=self.client.get('/api/protections').json()
        self.assertTrue(data[0]['can_edit'])
        self.assertEqual(self.client.put(f'/api/protections/{item.id}',json={'expected_updated_at':item.updated_at,'comment':'Assistant edit'}).status_code,200)
        self.change_db(item.id,status='closed',auto_closed=1,extend_count=2)
        data=self.client.get('/api/protections').json()[0]
        self.assertFalse(data['can_restore']);self.assertTrue(data['restore_requires_admin'])

    def test_request_restore_then_admin_approval_keeps_request_history(self):
        item=self.create();self.change_db(item.id,status='closed',auto_closed=1,extend_count=2);self.auth()
        request=self.client.post(f'/api/protections/{item.id}/request-extend',json={'days':10,'reason':'Missed deadline'})
        # Prevent any real notification HTTP: seeded users receive no notifications below.
        self.assertEqual(request.status_code,200,request.text)
        duplicate=self.main.request_extend(item.id,{'days':10},user=self.users[1],background_tasks=self.main.BackgroundTasks())
        self.assertTrue(duplicate['already_requested'])
        restored=self.main.admin_extend_any(item.id,user=self.users[3],background_tasks=self.main.BackgroundTasks())
        self.assertEqual(restored.status,'active');self.assertEqual(restored.extend_count,2)
        actions=[event['action'] for event in self.history(item.id)]
        self.assertIn('extend_request_resolved',actions);self.assertIn('restore',actions);self.assertNotIn('extend_request',actions)

    def test_close_success_state_and_archive_metadata(self):
        item=self.create();self.auth(2)
        self.assertEqual(self.client.post(f'/api/protections/{item.id}/close',json={'reason':'bad'}).status_code,403)
        self.auth(1)
        closed=self.client.post(f'/api/protections/{item.id}/close',json={'reason':'Finished'}).json()
        self.assertFalse(closed['auto_closed'])
        self.assertEqual(self.client.post(f'/api/protections/{item.id}/success',json={'doc_1c':'X'}).status_code,409)
        result=self.client.put(f'/api/protections/{item.id}',json={'expected_updated_at':closed['updated_at'],'partner':'Corrected','close_reason':'Corrected reason'})
        self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(self.client.get('/api/protections').json()[0]['close_reason'],'Corrected reason')
        self.assertEqual(self.row(item.id)['status'],'closed')

    def test_ttl_boundaries_and_weekend_calendar(self):
        for index,(area,days) in enumerate(((50,5),(99,5),(100,10),(249,10),(250,15),(499,15),(500,30))):
            item=self.create(sku=f"TTL{index}",area=area)
            self.assertEqual(item.expires_at,self.db.add_workdays(item.created_at,days))
        self.assertEqual(self.db.add_workdays('2026-09-04T12:00:00Z',1),'2026-09-07T12:00:00Z')

    def test_pending_create_approval_preserves_author_and_refreshes_deadline(self):
        self.create()
        payload=self.main.ProtectionCreate(manager='Manager directory',sku_data=[{'sku':'AF1','type':'клей','area':100}],last4='1234')
        pending=self.main.create_pending_protection(payload,user=self.users[1],background_tasks=self.main.BackgroundTasks())
        pid=pending['id'];self.change_db(pid,expires_at='2020-01-01T00:00:00Z')
        self.assertEqual(self.row(pid)['manager_id'],1)
        self.main.approve_pending(pid,user=self.users[3],background_tasks=self.main.BackgroundTasks())
        self.assertEqual(self.row(pid)['status'],'active')
        self.assertGreater(self.row(pid)['expires_at'],self.db.now_iso())
        self.assertEqual(self.row(pid)['approved_by_admin'],1)

    def test_two_simultaneous_creates_cannot_skip_conflict(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        from fastapi import HTTPException
        barrier=Barrier(2)
        def attempt():
            barrier.wait()
            try:
                self.create()
                return 200
            except HTTPException as exc:
                return exc.status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes=list(pool.map(lambda _:attempt(),range(2)))
        self.assertEqual(sorted(outcomes),[200,409])

    def test_two_simultaneous_edits_detect_stale_revision(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        from fastapi import HTTPException
        initial=self.create();barrier=Barrier(2)
        def attempt(text):
            barrier.wait()
            try:
                self.main.update_protection(initial.id,self.main.ProtectionUpdate(expected_updated_at=initial.updated_at,comment=text),user=self.users[1])
                return 200
            except HTTPException as exc:
                return exc.status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes=list(pool.map(attempt,('A','B')))
        self.assertEqual(sorted(outcomes),[200,409])
        self.assertEqual(len([entry for entry in self.history(initial.id) if entry['action']=='edit']),1)

    def test_restored_protection_is_reminded_and_auto_closed_again(self):
        item=self.create();self.change_db(item.id,status='closed',auto_closed=1,reminder_2days_sent=1,expires_at='2020-01-01T00:00:00Z')
        self.main.self_restore_protection(item.id,user=self.users[1])
        async def one_pass(worker):
            with patch.object(self.main,'is_workday',return_value=True),patch.object(self.main.asyncio,'sleep',new=AsyncMock(side_effect=asyncio.CancelledError)):
                with self.assertRaises(asyncio.CancelledError):
                    await worker()
        self.change_db(item.id,expires_at=self.db.add_workdays(self.db.now_iso(),1))
        asyncio.run(one_pass(self.main.check_expiring_protections))
        self.assertEqual(self.row(item.id)['reminder_2days_sent'],1)
        self.change_db(item.id,expires_at='2020-01-01T00:00:00Z')
        asyncio.run(one_pass(self.main.auto_close_expired_protections))
        self.assertEqual((self.row(item.id)['status'],self.row(item.id)['auto_closed']),('closed',1))
        self.assertEqual(len([event for event in self.history(item.id) if event['action']=='restore']),1)
        self.assertEqual(len([event for event in self.history(item.id) if event['action']=='close']),1)

    def test_auto_close_loses_race_to_extension_without_closing_new_deadline(self):
        item=self.create();self.change_db(item.id,expires_at='2020-01-01T00:00:00Z')
        raced=False
        def expiry_check(value, now):
            nonlocal raced
            if not raced:
                raced=True
                self.main.extend(item.id,user=self.users[1])
                return -1
            return self.db.workdays_until(value,now)
        async def run():
            with patch.object(self.main,'is_workday',return_value=True),patch.object(self.main,'workdays_until',side_effect=expiry_check),patch.object(self.main.asyncio,'sleep',new=AsyncMock(side_effect=asyncio.CancelledError)):
                with self.assertRaises(asyncio.CancelledError):
                    await self.main.auto_close_expired_protections()
        asyncio.run(run())
        self.assertTrue(raced);self.assertEqual(self.row(item.id)['status'],'active')
        self.assertNotIn('close',[entry['action'] for entry in self.history(item.id)])

    def test_reminder_race_does_not_mark_extended_deadline_as_reminded(self):
        item=self.create();self.change_db(item.id,expires_at=self.db.add_workdays(self.db.now_iso(),1))
        async def send_and_extend(*args,**kwargs):
            self.main.extend(item.id,user=self.users[1])
            return True
        async def run():
            with patch.object(self.main,'is_workday',return_value=True),patch.object(self.main.bot,'send_message',new=AsyncMock(side_effect=send_and_extend)),patch.object(self.main.asyncio,'sleep',new=AsyncMock(side_effect=asyncio.CancelledError)):
                with self.assertRaises(asyncio.CancelledError):
                    await self.main.check_expiring_protections()
        asyncio.run(run())
        self.assertEqual(self.row(item.id)['extend_count'],1)
        self.assertEqual(self.row(item.id)['reminder_2days_sent'],0)

    def test_historical_optional_empty_fields_and_admin_deadline(self):
        item=self.create();self.change_db(item.id,client=None,partner=None,partner_city=None,last4=None,object_city=None,address=None,comment=None)
        self.auth();listed=self.client.get('/api/protections').json()[0]
        self.assertEqual(listed['client'],'')
        rejected=self.client.put(f'/api/protections/{item.id}',json={'expected_updated_at':listed['updated_at'],'expires_at':'2031-01-01T00:00:00Z'})
        self.assertEqual(rejected.status_code,403)
        self.auth(3)
        response=self.client.put(f'/api/protections/{item.id}',json={'expected_updated_at':listed['updated_at'],'expires_at':'2031-01-01T00:00:00Z','client':'Filled'})
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['client'],'Filled')
        self.assertEqual(self.row(item.id)['expires_at'],'2031-01-01T00:00:00Z')

    def test_existing_admin_duplicate_survives_contact_edit_and_reserialization(self):
        original=self.create(per=True)
        other=self.create(sku='AF2',per=True)
        self.change_db(other.id,sku='AF1 (клей) — 100.0 м²',approved_by_admin=1)
        self.auth()
        response=self.client.put(f'/api/protections/{other.id}',json={'expected_updated_at':other.updated_at,'sku_data':[{'sku':'AF1','type':'клей','area':100}],'area_m2':100,'comment':'Changed contact context'})
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(self.row(original.id)['status'],'active')
        self.assertEqual(self.row(other.id)['approved_by_admin'],1)

    def test_actor_refresh_blocks_deleted_or_blocked_stale_identity(self):
        from fastapi import HTTPException
        item=self.create()
        conn=self.db.get_conn();cur=conn.cursor();cur.execute(self.db._adapt_query('UPDATE users SET is_active=0 WHERE id=?'),(1,));conn.commit();conn.close()
        with self.assertRaises(HTTPException) as blocked:
            self.main.extend(item.id,user=self.users[1])
        self.assertEqual(blocked.exception.status_code,403)
        conn=self.db.get_conn();cur=conn.cursor();cur.execute(self.db._adapt_query('DELETE FROM users WHERE id=?'),(1,));conn.commit();conn.close()
        with self.assertRaises(HTTPException) as deleted:
            self.create(sku='AF2')
        self.assertEqual(deleted.exception.status_code,403)
        payload=self.main.ProtectionCreate(manager='Manager directory',sku='AF2',area_m2=100)
        with self.assertRaises(HTTPException):
            self.main.create_pending_protection(payload,user=self.users[1],background_tasks=self.main.BackgroundTasks())

    def test_actor_refresh_removes_stale_admin_extension_privilege(self):
        from fastapi import HTTPException
        item=self.create(uid=3)
        self.change_db(item.id,extend_count=2)
        conn=self.db.get_conn();cur=conn.cursor();cur.execute(self.db._adapt_query('UPDATE users SET role=? WHERE id=?'),('manager',3));conn.commit();conn.close()
        with self.assertRaises(HTTPException) as stale:
            self.main.extend(item.id,days=365,user=self.users[3])
        self.assertEqual(stale.exception.status_code,400)
        self.assertEqual(self.row(item.id)['extend_count'],2)

    def test_export_scope_and_blocked_user(self):
        item=self.create();self.auth()
        response=self.client.post('/api/export-link',json={'status':'active'})
        self.assertEqual(response.status_code,200,response.text)
        path=response.json()['path'];self.main.app.dependency_overrides.clear()
        csv=self.client.get(path);self.assertEqual(csv.status_code,200,csv.text)
        self.assertIn('AF1',csv.text)
        conn=self.db.get_conn();cur=conn.cursor();cur.execute(self.db._adapt_query('UPDATE users SET is_active=0 WHERE id=?'),(1,));conn.commit();conn.close()
        self.assertEqual(self.client.get(path).status_code,403)


if __name__ == '__main__':
    unittest.main()
