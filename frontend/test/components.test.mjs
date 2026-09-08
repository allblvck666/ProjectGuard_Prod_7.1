import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const folder = await mkdtemp(join(tmpdir(), 'pg-ui-components-'));
const outfile = join(folder, 'components.cjs');
await build({ stdin:{ contents:`export { createElement } from 'react'; export { renderToStaticMarkup } from 'react-dom/server'; export { default as HomeScreen } from './src/pg/HomeScreen.jsx'; export { default as ProtectionDetail } from './src/pg/ProtectionDetail.jsx'; export { default as ActionSheets } from './src/pg/ActionSheets.jsx';`, resolveDir:dirname(fileURLToPath(new URL('../package.json',import.meta.url))), loader:'jsx' }, outfile, bundle:true, platform:'node', format:'cjs', jsx:'automatic', loader:{'.css':'empty'}, define:{'import.meta.env':'{}','__PG_BUILD__':'{}'}, logLevel:'silent' });
globalThis.window = { location:{hostname:'localhost',search:''}, addEventListener(){}, removeEventListener(){} };
globalThis.localStorage = { getItem(){return null;}, setItem(){}, removeItem(){} };
const { createElement, renderToStaticMarkup, HomeScreen, ProtectionDetail, ActionSheets } = createRequire(import.meta.url)(outfile);
const render = (component,props) => renderToStaticMarkup(createElement(component,props));
const manager = { role:'manager', user:{id:12,first_name:'Ирина',role:'manager'} };
const base = { id:7,manager_id:12,manager:'Ирина',partner:'Дилер',client:'Клиент',sku:'AF1 (Клей)',area_m2:100,status:'active',created_at:'2026-08-21T10:00:00Z',expires_at:'2026-09-30T10:00:00Z',days_left:2,extend_count:0,last4:'1234' };
const props = { item:base,auth:manager,onBack(){},act(){},openEditModal(){},restoreProtection(){} };

test('August home keeps all four quick actions before attention and recent sections', () => {
  const html=render(HomeScreen,{auth:manager,items:[base],loading:false,load(){},onCreate(){},onList(){},onExport(){},onLogout(){}});
  const start=html.indexOf('pgh-qa');
  assert.ok(start>0);
  const actions=['Создать','Найти','Истекают','Выгрузка'].map((text)=>html.indexOf(text,start));
  assert.ok(actions.every((position,index)=>position>start && (!index||position>actions[index-1])));
  assert.ok(actions[3]<html.indexOf('pgh-sect',start));
  assert.equal((html.match(/class="pgh-qa__i(?: |")/g)||[]).length,4);
});

test('Managers see edit/renew only for protections they may manage', () => {
  const own=render(ProtectionDetail,props);
  assert.match(own,/Редактировать/); assert.match(own,/Продлить срок/);
  const other=render(ProtectionDetail,{...props,item:{...base,manager_id:44,can_edit:false}});
  assert.doesNotMatch(other,/>Редактировать</); assert.doesNotMatch(other,/>Продлить срок</);
  assert.match(other,/назначенный помощник/);
});

test('Assigned assistants receive same actions from server permission flag', () => {
  const html=render(ProtectionDetail,{...props,auth:{role:'assistant',user:{id:42,role:'assistant'}},item:{...base,can_edit:true}});
  assert.match(html,/>Редактировать</); assert.match(html,/>Продлить срок</); assert.match(html,/>Удалить</);
});

test('Self restore appears only when permitted; quota requests and superadmin restore stay distinct', () => {
  const closed={...base,status:'closed',auto_closed:1,can_edit:true,can_restore:true};
  assert.match(render(ProtectionDetail,{...props,item:closed}),/>Восстановить защиту</);
  assert.match(render(ProtectionDetail,{...props,item:{...closed,can_restore:false,restore_requires_admin:true}}),/>Запросить восстановление</);
  assert.doesNotMatch(render(ProtectionDetail,{...props,item:{...closed,can_restore:false,auto_closed:0}}),/>Восстановить защиту</);
  assert.doesNotMatch(render(ProtectionDetail,{...props,item:{...closed,can_edit:false,can_restore:false}}),/>Редактировать данные</);
});

test('Edit sheet exposes all project fields and admin-only deadline control', () => {
  const noop=()=>{};
  const edit={ editModal:{open:true,id:base.id,item:base},setEditModal:noop,editSelectedSkus:[{sku:'AF1',type:'Клей'}],setEditSelectedSkus:noop,editPerSkuMode:false,setEditPerSkuMode:noop,editAreaUnified:100,setEditAreaUnified:noop,editComment:'',setEditComment:noop,editDetails:{manager:'Ирина',partner:'Дилер',partner_city:'Москва',client:'Клиент',last4:'1234',object_city:'Казань',address:'',expires_at:'2026-09-30T10:00'},setEditDetails:noop,submitEdit:noop,skus:[],managers:[],auth:manager };
  const html=render(ActionSheets,edit);
  for(const label of ['Менеджер','Партнёр (дилер)','Город партнёра','Клиент','Последние 4 цифры телефона','Город объекта','Адрес объекта','Артикулы','Комментарий']) assert.ok(html.includes(label),label);
  assert.doesNotMatch(html,/type="datetime-local"/);
  assert.match(render(ActionSheets,{...edit,auth:{role:'admin'}}),/type="datetime-local"/);
});

test.after(async()=>{ await rm(folder,{recursive:true,force:true}); });
