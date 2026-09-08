import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildEditPayload, editProblem, localDateTime, parseProtectionSkus, protectionEditDetails, protectionError } from '../src/pg/protection-edit.js';

const item = { id: 7, manager_id: 12, manager: 'Ирина', partner: 'Дилер', partner_city: 'Москва', client: 'Клиент', last4: '0123', object_city: 'Казань', address: 'Дом 1', status: 'active', sku: 'AF1 (Клей) + AF2 (Замок)', area_m2: 120, created_at: '2026-08-21T10:00:00Z', updated_at: '2026-09-01T11:00:00.123Z', expires_at: '2026-09-30T10:00:33Z', comment: 'Текст' };
const edit = (overrides = {}) => ({ item, details: protectionEditDetails(item), selected: parseProtectionSkus(item.sku), perSkuMode: false, unified: 120, comment: item.comment, isAdmin: false, ...overrides });

test('Legacy, typed, unified and per-SKU records retain materials when opened for edit', () => {
  assert.deepEqual(parseProtectionSkus(item.sku), [{ sku:'AF1', type:'Клей', area:'' }, { sku:'AF2', type:'Замок', area:'' }]);
  assert.deepEqual(parseProtectionSkus('AF1 (Клей) — 180,5 м²; AF2 — 140 м²'), [{ sku:'AF1', type:'Клей', area:'180.5' }, { sku:'AF2', type:'', area:'140' }]);
  assert.deepEqual(parseProtectionSkus('AF-123'), [{ sku:'AF-123', type:'', area:'' }]);
});

test('Full edit preserves author, deadline, status and original revision unless explicitly changed by admin', () => {
  const values = edit({ details: { ...protectionEditDetails(item), client: 'Новый клиент', last4:'0001', manager:'Олег' } });
  const payload = buildEditPayload(values);
  assert.equal(payload.client, 'Новый клиент'); assert.equal(payload.last4, '0001'); assert.equal(payload.manager, 'Олег');
  assert.equal(payload.expected_updated_at, item.updated_at);
  for (const key of ['id','manager_id','status','expires_at','created_at','extend_count']) assert.ok(!(key in payload), key);
  assert.equal(payload.area_m2, 120);
  assert.ok(payload.sku_data.every((s) => !('area' in s)));
  const admin = buildEditPayload(edit({ isAdmin:true }));
  assert.ok(!('expires_at' in admin), 'Opening a timestamp with seconds must not silently truncate/renew it');
});

test('Explicit admin deadline changes are ISO timestamps; managers cannot send them', () => {
  const values = edit({ isAdmin:true, details:{ ...protectionEditDetails(item), expires_at:'2026-10-01T12:30' } });
  assert.equal(buildEditPayload(values).expires_at, new Date('2026-10-01T12:30').toISOString());
  assert.ok(!('expires_at' in buildEditPayload({ ...values, isAdmin:false })));
  assert.throws(() => buildEditPayload({ ...values, details:{ ...values.details, expires_at:'' } }), /корректный/);
  assert.equal(localDateTime('invalid'), '');
});

test('Per-SKU area is preserved and invalid/minimum values stop saving', () => {
  const selected = parseProtectionSkus('AF1 (Клей) — 50 м²; AF2 (Замок) — 80 м²');
  const values = edit({ selected, perSkuMode:true });
  assert.equal(buildEditPayload(values).area_m2,130);
  assert.deepEqual(buildEditPayload(values).sku_data.map((s) => s.area), [50,80]);
  assert.equal(editProblem({ selected, perSkuMode:true, details:values.details }), null);
  assert.match(editProblem({ selected:[{sku:'AF1',area:-50},{sku:'AF2',area:150}], perSkuMode:true }), /положительный/);
  assert.match(editProblem({ selected, perSkuMode:false, unified:'Infinity' }), /метраж/);
  assert.match(editProblem({ selected, perSkuMode:false, unified:49 }), /50/);
  assert.match(editProblem({ selected, unified:50, details:{...values.details,last4:'123'} }), /4 цифры/);
});

test('Archive metadata changes do not change lifecycle status, and old records use created_at revision', () => {
  const archived = { ...item, status:'closed', updated_at:null, close_reason:'Автоматически', success_doc:'' };
  const values = edit({ item:archived, isAdmin:true, details:{ ...protectionEditDetails(archived), close_reason:'Уточнено', success_doc:'СЧ-17' } });
  const payload = buildEditPayload(values);
  assert.equal(payload.close_reason,'Уточнено'); assert.equal(payload.success_doc,'СЧ-17');
  assert.equal(payload.expected_updated_at, archived.created_at);
  assert.ok(!('status' in payload)); assert.ok(!('expires_at' in payload));
});

test('Stale revisions and duplicate responses remain actionable messages', () => {
  assert.match(protectionError({ response:{data:{detail:{code:'stale_protection'}}}},'fallback'), /другой сотрудник/);
  assert.match(protectionError({ response:{data:{detail:{msg:'Есть дубль',similar_protection:{id:42}}}}},'fallback'), /№42/);
});

test('Light text, button and status colors meet 4.5:1 contrast', async () => {
  const css = await readFile(new URL('../src/pg/tokens.css', import.meta.url),'utf8');
  const block = css.split('[data-pg-theme="light"] {')[1].split('color-scheme: light;')[0];
  const colors = Object.fromEntries([...block.matchAll(/--pg-([\w-]+):\s*(#[\da-f]{6});/g)].map((m) => [m[1],m[2]]));
  const luminance = (hex) => [1,3,5].map((i) => parseInt(hex.slice(i,i+2),16)/255).map((v) => v<=0.04045 ? v/12.92 : ((v+0.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
  const ratio = (a,b) => { const [x,y]=[luminance(a),luminance(b)].sort((c,d)=>d-c); return (x+0.05)/(y+0.05); };
  for (const [fg,bg] of [['text','surface'],['text-2','bg'],['hint','surface'],['success','success-bg'],['warning','warning-bg'],['danger','danger-bg'],['accent','accent-bg']]) assert.ok(ratio(colors[fg],colors[bg])>=4.5,`${fg}/${bg}: ${ratio(colors[fg],colors[bg])}`);
  assert.ok(ratio('#ffffff',colors.accent)>=4.5);
});

test('Historical blank contacts remain editable without inventing personal data', () => {
  const legacy = { ...item, client:"", last4:"", partner:"", partner_city:"", object_city:"" };
  const values = edit({ item:legacy, details:protectionEditDetails(legacy) });
  assert.equal(editProblem({ selected:values.selected, perSkuMode:false, unified:100, details:values.details }),null);
  assert.equal(buildEditPayload(values).last4,"");
});

test('Owner can correct archived completion metadata without changing status', () => {
  const archived = { ...item, status:"success", success_doc:"СЧ-1" };
  const payload = buildEditPayload(edit({ item:archived, details:{...protectionEditDetails(archived),success_doc:"СЧ-2"},isAdmin:false }));
  assert.equal(payload.success_doc,"СЧ-2"); assert.ok(!("status" in payload)); assert.ok(!("expires_at" in payload));
});
