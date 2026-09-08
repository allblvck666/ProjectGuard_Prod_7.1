import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {url:'http://localhost/'});
for (const key of ['window','document','localStorage','HTMLElement','Node','Event','MouseEvent','CustomEvent']) globalThis[key]=dom.window[key];
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const folder=await mkdtemp(join(dirname(fileURLToPath(import.meta.url)),'.interaction-'));
const outfile=join(folder,'harness.cjs');
await build({stdin:{contents:`
import React, { useEffect, useState } from 'react';
import ActionSheets from './src/pg/ActionSheets.jsx';
import ProtectionDetail from './src/pg/ProtectionDetail.jsx';
import { api } from './src/api.js';
import MoreScreen from './src/pg/MoreScreen.jsx';
import TabBar from './src/pg/TabBar.jsx';
import { initPgTheme } from './src/pg/theme.js';
import { buildEditPayload, parseProtectionSkus, protectionEditDetails } from './src/pg/protection-edit.js';
export { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
export { createElement } from 'react';
api.get = async () => ({data:[]});
export function EditorHarness({item,onSave,isAdmin=false}) {
  const [editModal,setEditModal]=useState({open:true,id:item.id,item});
  const [editSelectedSkus,setEditSelectedSkus]=useState(parseProtectionSkus(item.sku));
  const [editPerSkuMode,setEditPerSkuMode]=useState(false);
  const [editAreaUnified,setEditAreaUnified]=useState(item.area_m2);
  const [editComment,setEditComment]=useState(item.comment||'');
  const [editDetails,setEditDetails]=useState(protectionEditDetails(item));
  return <ActionSheets {...{editModal,setEditModal,editSelectedSkus,setEditSelectedSkus,editPerSkuMode,setEditPerSkuMode,editAreaUnified,setEditAreaUnified,editComment,setEditComment,editDetails,setEditDetails}} managers={[{name:'Ирина'},{name:'Олег'}]} skus={[{sku:'AF1',type:'Клей'},{sku:'AF2',type:'Замок'}]} auth={{role:isAdmin?'admin':'manager'}} submitEdit={()=>onSave(buildEditPayload({item,details:editDetails,selected:editSelectedSkus,perSkuMode:editPerSkuMode,unified:editAreaUnified,comment:editComment,isAdmin}))} />;
}
export function ThemeHarness() {
  useEffect(initPgTheme, []);
  return <><MoreScreen auth={{user:{first_name:'Ирина'},role:'manager'}} onStats={()=>{}} onExport={()=>{}} onLogout={()=>{}} /><TabBar active="home" onChange={()=>{}} /></>;
}
export function LayerHarness({item,onAction}) {
  const [editing,setEditing] = useState(false);
  return <><div className="pgh"><ProtectionDetail item={item} auth={{role:'manager',user:{id:12}}} onBack={()=>{}} act={onAction} openEditModal={()=>setEditing(true)} restoreProtection={()=>{}} />{editing && <EditorHarness item={item} onSave={()=>{}} />}</div><TabBar active="home" onChange={()=>{}} /></>;
}
export function RestoreHarness({item,onRestore,onRequest}) {
 return <ProtectionDetail item={item} auth={{role:'manager',user:{id:12,role:'manager'}}} onBack={()=>{}} act={()=>{}} openEditModal={()=>{}} restoreProtection={onRestore} sheets={{setExtendRequestModal:onRequest}} />;
}
`,resolveDir:dirname(fileURLToPath(new URL('../package.json',import.meta.url))),loader:'jsx'},outfile,bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty'},define:{'import.meta.env':'{}','__PG_BUILD__':'{}'},logLevel:'silent'});
const {render,screen,fireEvent,cleanup,waitFor,createElement,EditorHarness,RestoreHarness,ThemeHarness,LayerHarness}=createRequire(import.meta.url)(outfile);
const item={id:7,manager_id:12,manager:'Ирина',partner:'Дилер',partner_city:'Москва',client:'Клиент',last4:'0123',object_city:'Казань',address:'Дом 1',status:'active',sku:'AF1 (Клей)',area_m2:100,created_at:'2026-08-21T10:00:00Z',updated_at:'2026-09-01T11:00:00.123Z',expires_at:'2026-09-30T10:00:33Z',comment:'До правок',extend_count:0,can_edit:true};
test.afterEach(() => { cleanup(); delete window.Telegram; document.documentElement.removeAttribute('data-pg-theme'); document.documentElement.style.colorScheme=''; document.body.classList.remove('light-theme'); localStorage.removeItem('theme'); document.head.innerHTML=''; });
test.after(async()=>{dom.window.close();await rm(folder,{recursive:true,force:true});});

test('Editing real controls sends all changed details, material area and original revision without renewal',()=>{
 const saved=[];
 render(createElement(EditorHarness,{item,onSave:(payload)=>saved.push(payload)}));
 const change=(label,value)=>fireEvent.change(screen.getByLabelText(label),{target:{value}});
 change(/Менеджер/,'Олег'); change(/Партнёр \(дилер\)/,'Новый дилер'); change(/Город партнёра/,'Тула'); change(/^Клиент/,'Новый клиент'); change(/Последние 4/,'0007'); change(/Город объекта/,'Пермь'); change(/Адрес объекта/,'Улица 8'); change(/Единый метраж/,'150'); change(/Комментарий/,'Новая информация');
 fireEvent.click(screen.getByRole('button',{name:'Сохранить',exact:true}));
 assert.equal(saved.length,1);
 assert.deepEqual(Object.fromEntries(['manager','partner','partner_city','client','last4','object_city','address','area_m2','comment'].map((key)=>[key,saved[0][key]])),{manager:'Олег',partner:'Новый дилер',partner_city:'Тула',client:'Новый клиент',last4:'0007',object_city:'Пермь',address:'Улица 8',area_m2:150,comment:'Новая информация'});
 assert.equal(saved[0].expected_updated_at,item.updated_at); assert.ok(!('expires_at' in saved[0])); assert.ok(!('status' in saved[0])); assert.ok(!('manager_id' in saved[0]));
});

test('Cancelling prompts before discarding and returning retains unsaved field values',()=>{
 const saved=[]; render(createElement(EditorHarness,{item,onSave:(p)=>saved.push(p)}));
 fireEvent.change(screen.getByLabelText(/Комментарий/),{target:{value:'Не потерять черновик'}});
 fireEvent.click(screen.getByRole('button',{name:'Отмена',exact:true}));
 assert.ok(screen.getByText('Отменить изменения?'));
 fireEvent.click(screen.getByRole('button',{name:'Продолжить редактирование'}));
 assert.equal(screen.getByLabelText(/Комментарий/).value,'Не потерять черновик');
 fireEvent.click(screen.getByRole('button',{name:'Отмена',exact:true}));
 fireEvent.click(screen.getByRole('button',{name:'Отменить изменения',exact:true}));
 assert.equal(screen.queryByText('Редактировать защиту'),null); assert.equal(saved.length,0);
});

test('Restore confirmation chooses30workingdays and preserves record identity',async()=>{
 const restored=[];
 render(createElement(RestoreHarness,{item:{...item,status:'closed',auto_closed:1,can_restore:true},onRestore:async(...args)=>{restored.push(args);return true;},onRequest(){}}));
 fireEvent.click(screen.getByRole('button',{name:'Восстановить защиту',exact:true}));
 fireEvent.click(screen.getByRole('tab',{name:'30 рабочих дней'}));
 assert.ok(screen.getByText(/использует одно из двух продлений/));
 const buttons=screen.getAllByRole('button',{name:'Восстановить защиту',exact:true});fireEvent.click(buttons.at(-1));
 await waitFor(()=>assert.equal(restored.length,1));
 assert.deepEqual(restored[0],[item.id,30,false]);
});

test('Spent restoration quota opens admin request instead of restoring directly',async()=>{
 const requests=[]; const restored=[];
 render(createElement(RestoreHarness,{item:{...item,status:'closed',auto_closed:1,can_restore:false,restore_requires_admin:true,extend_count:2},onRestore:async(...args)=>restored.push(args),onRequest:(value)=>requests.push(value)}));
 fireEvent.click(screen.getByRole('button',{name:'Запросить восстановление'}));
 fireEvent.click(screen.getByRole('tab',{name:'30 рабочих дней'}));
 fireEvent.click(screen.getByRole('button',{name:'Перейти к запросу'}));
 await waitFor(()=>assert.equal(requests.length,1));
 assert.equal(requests[0].id,item.id);assert.equal(requests[0].days,30);assert.equal(requests[0].open,true);assert.equal(restored.length,0);
});

test('Material selection keeps type, per-SKU amounts and removal consistent',()=>{
 const saved=[];render(createElement(EditorHarness,{item,onSave:(p)=>saved.push(p)}));
 fireEvent.click(screen.getByRole('tab',{name:'По артикулам'}));
 fireEvent.change(screen.getByLabelText('Метраж для AF1'),{target:{value:'50'}});
 fireEvent.change(screen.getByPlaceholderText('Введите артикул'),{target:{value:'AF2'}});
 fireEvent.keyDown(screen.getByRole('button',{name:/AF2.*Замок/}),{key:'Enter'});
 fireEvent.change(screen.getByLabelText('Метраж для AF2'),{target:{value:'80'}});
 fireEvent.click(screen.getByRole('button',{name:'Сохранить',exact:true}));
 assert.equal(saved[0].area_m2,130);assert.deepEqual(saved[0].sku_data,[{sku:'AF1',type:'Клей',area:50},{sku:'AF2',type:'Замок',area:80}]);
 fireEvent.click(screen.getByRole('button',{name:/^Убрать AF1/}));
 fireEvent.click(screen.getByRole('button',{name:'Сохранить',exact:true}));
 assert.equal(saved[1].area_m2,80);assert.deepEqual(saved[1].sku_data,[{sku:'AF2',type:'Замок',area:80}]);
});


function nativeTelegramMock() {
  const events=new Map();
  const mb={visible:false,handlers:new Set(),setText(){},setParams(){},disable(){},enable(){},showProgress(){},hideProgress(){},show(){this.visible=true;},hide(){this.visible=false;},onClick(fn){this.handlers.add(fn);},offClick(fn){this.handlers.delete(fn);}};
  const tg={platform:'macos',colorScheme:'dark',themeParams:{bg_color:'#17212b',text_color:'#ffffff'},MainButton:mb,BackButton:{onClick(){},offClick(){},show(){},hide(){}},onEvent(name,fn){if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},offEvent(name,fn){events.get(name)?.delete(fn);}};
  window.Telegram={WebApp:tg};
  return {mb,emit:(name)=>events.get(name)?.forEach((fn)=>fn())};
}

async function installThemeCss() {
  const style=document.createElement('style');
  style.textContent=await readFile(new URL('../src/App.css',import.meta.url),'utf8')+await readFile(new URL('../src/pg/tokens.css',import.meta.url),'utf8')+await readFile(new URL('../src/pg/tabbar.css',import.meta.url),'utf8');
  document.head.appendChild(style);
  document.documentElement.style.setProperty('--tg-theme-bg-color','#17212b');
  document.documentElement.style.setProperty('--tg-theme-text-color','#ffffff');
}

test('Explicit light choice stays coherent across CSS layers inside dark Telegram and later theme events',async()=>{
  const {emit}=nativeTelegramMock();
  await installThemeCss();
  render(createElement(ThemeHarness));
  assert.equal(document.documentElement.dataset.pgTheme,'dark');
  fireEvent.click(screen.getByRole('tab',{name:'Светлая'}));
  assert.equal(document.documentElement.dataset.pgTheme,'light');
  assert.equal(document.body.classList.contains('light-theme'),true);
  assert.equal(document.documentElement.style.colorScheme,'light');
  assert.equal(window.getComputedStyle(document.documentElement).getPropertyValue('--pg-hint').trim(),'#536176');
  assert.equal(window.getComputedStyle(document.documentElement).getPropertyValue('--pg-text').trim(),'#172033');
  emit('themeChanged');
  await waitFor(()=>assert.equal(document.documentElement.dataset.pgTheme,'light'));
  assert.equal(document.body.classList.contains('light-theme'),true);
  assert.equal(window.getComputedStyle(document.documentElement).getPropertyValue('--pg-surface').trim(),'#ffffff');
});

test('Edit is an opaque body overlay above tabs and blocks both visible and queued native renew actions',async()=>{
  const {mb}=nativeTelegramMock();
  await installThemeCss();
  localStorage.setItem('theme','light');document.documentElement.dataset.pgTheme='light';document.body.classList.add('light-theme');
  const actions=[];
  const appRoot=document.createElement('div');appRoot.id='root';document.body.appendChild(appRoot);
  render(createElement(LayerHarness,{item,onAction:(...args)=>actions.push(args)}),{container:appRoot});
  assert.equal(window.getComputedStyle(appRoot).position,'relative');
  assert.ok(Number(window.getComputedStyle(appRoot).zIndex)>0,'App content must be above the legacy decorative body layers at z=0');
  await waitFor(()=>assert.equal(mb.visible,true));
  const queuedClick=[...mb.handlers][0];
  fireEvent.click(screen.getByRole('button',{name:'Редактировать',exact:true}));
  const dialog=screen.getByRole('dialog',{name:'Редактировать защиту'});
  assert.equal(dialog.closest('.pg-overlay-root').parentElement,document.body);
  assert.equal(document.querySelector('.pgd').parentElement,document.body);
  assert.ok(Number(window.getComputedStyle(dialog.closest('.pg-overlay-root')).zIndex)>Number(window.getComputedStyle(document.querySelector('.pg-tabbar')).zIndex));
  assert.equal(window.getComputedStyle(dialog).backgroundColor,'rgb(255, 255, 255)');
  assert.equal(mb.visible,false);assert.equal(mb.handlers.size,0);
  queuedClick();assert.equal(actions.length,0);
  fireEvent.change(screen.getByLabelText(/Комментарий/),{target:{value:'Несохранённое'}});
  fireEvent.click(screen.getByRole('button',{name:'Отмена',exact:true}));
  assert.ok(screen.getByRole('dialog',{name:'Отменить изменения?'}));assert.equal(mb.visible,false);
  queuedClick();assert.equal(actions.length,0);
  fireEvent.click(screen.getByRole('button',{name:'Отменить изменения',exact:true}));
  await waitFor(()=>assert.equal(mb.visible,true));
  [...mb.handlers][0]();assert.deepEqual(actions,[[item.id,'extend']]);
});
