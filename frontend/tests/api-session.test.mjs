import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import axios from 'axios';
import { pathToFileURL } from 'node:url';

let sequence = 0;
async function setup(adapter) {
  const storage = new Map([['jwt_token', 'old-token'], ['auth_user', JSON.stringify({id: 7, role: 'assistant'})]]);
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  };
  globalThis.window = new EventTarget();
  window.location = {hostname: 'localhost'};
  window.Telegram = {WebApp: {initData: 'signed-test-data'}};
  axios.defaults.adapter = adapter;
  let source = await readFile(new URL('../src/api.js', import.meta.url), 'utf8');
  const axiosUrl = pathToFileURL(new URL('../node_modules/axios/index.js', import.meta.url).pathname).href;
  source = source.replace('from "axios"', `from ${JSON.stringify(axiosUrl)}`).replaceAll('import.meta.env', '({VITE_API_URL:"http://localhost:8000"})');
  source += `\n// Fresh isolated module ${sequence++}`;
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  module.api.defaults.adapter = adapter;
  return {...module, storage};
}
const response = (config, data, status=200) => ({data, status, statusText: '', headers: {}, config});
const fail = (config, status, detail='Rejected') => Promise.reject(new axios.AxiosError(detail, 'ERR_BAD_RESPONSE', config, {}, response(config, {detail}, status)));
const session = {ok: true, token: 'verified-token', user: {id: 7, role: 'assistant', manager_ids:'[23]'}};

test('uncertain network errors and 5xx never repeat a mutation', async () => {
  for (const status of [500, null]) {
    let calls=0;
    const {api} = await setup(config => {
      calls++;
      return status ? fail(config, status) : Promise.reject(new axios.AxiosError('Network Error', 'ERR_NETWORK', config));
    });
    await assert.rejects(api.post('/api/protections', {sku:'TEST'}));
    assert.equal(calls,1);
  }
});

test('a failed read retries once', async () => {
  let calls=0;
  const {api} = await setup(config => ++calls===1 ? fail(config,500) : Promise.resolve(response(config,{ok:true})));
  const result=await api.get('/api/protections');
  assert.equal(result.data.ok,true);
  assert.equal(calls,2);
});

test('parallel expired requests perform one verified login and preserve role/id', async () => {
  let logins=0;
  const {api,storage}=await setup(async config => {
    if (config.url.endsWith('/api/auth/telegram-login')) {
      logins++;
      assert.deepEqual(JSON.parse(config.data), {init_data:'signed-test-data'});
      await new Promise(resolve=>setTimeout(resolve,10));
      return response(config,session);
    }
    if (config.headers.Authorization!=='Bearer verified-token') return fail(config,401);
    return response(config,{ok:true});
  });
  await Promise.all([api.get('/api/protections'),api.get('/api/auth/me'),api.get('/api/stats')]);
  assert.equal(logins,1);
  assert.equal(storage.get('jwt_token'),'verified-token');
  assert.equal(JSON.parse(storage.get('auth_user')).role,'assistant');
  assert.equal(JSON.parse(storage.get('auth_user')).id,7);
});

test('a validation conflict after successful recovery does not clear the account', async () => {
  let mutations=0;
  let expired=0;
  const {api,storage}=await setup(config => {
    if (config.url.endsWith('/api/auth/telegram-login')) return Promise.resolve(response(config,session));
    mutations++;
    return fail(config,mutations===1?401:409);
  });
  window.addEventListener('auth:expired',()=>expired++);
  await assert.rejects(api.post('/api/protections',{sku:'TEST'}), error=>error.response.status===409);
  assert.equal(mutations,2);
  assert.equal(expired,0);
  assert.equal(storage.get('jwt_token'),'verified-token');
});

test('temporary recovery failures leave the existing token and account', async () => {
  const {api,storage}=await setup(config => config.url.endsWith('/api/auth/telegram-login') ? fail(config,503) : fail(config,401));
  await assert.rejects(api.get('/api/auth/me'));
  assert.equal(storage.get('jwt_token'),'old-token');
  assert.equal(JSON.parse(storage.get('auth_user')).id,7);
});

test('manual logout cancels an in-flight login and stops automatic recovery', async () => {
  let complete;
  const {authenticateTelegram,storage}=await setup(config=>new Promise(resolve=>{complete=()=>resolve(response(config,session));}));
  const login=authenticateTelegram();
  await new Promise(resolve=>setTimeout(resolve,0));
  window.dispatchEvent(new CustomEvent('auth:logout'));
  storage.delete('jwt_token');
  complete();
  await assert.rejects(login);
  assert.equal(storage.has('jwt_token'),false);
  await assert.rejects(authenticateTelegram());
});

test('signed login includes legacy display fields for rolling deployment', async () => {
  const {authenticateTelegram}=await setup(config=>{
    assert.deepEqual(JSON.parse(config.data), {init_data:'signed-test-data',tg_id:123456789,username:'verified_user',first_name:'Verified'});
    return Promise.resolve(response(config,session));
  });
  window.Telegram.WebApp.initDataUnsafe={user:{id:123456789,username:'verified_user',first_name:'Verified'}};
  await authenticateTelegram();
});


test('an expired unapproved session clears cached access and propagates the pending state without retrying the protected request', async () => {
  const calls = [];
  const pending = { code: 'access_pending', message: 'Заявка ожидает одобрения.' };
  const { api, storage, getAuthenticationIssue } = await setup(config => {
    calls.push(config.url);
    return config.url.endsWith('/api/auth/telegram-login') ? fail(config, 403, pending) : fail(config, 401);
  });
  let denied;
  window.addEventListener('auth:denied', event => { denied = event.detail; });
  await assert.rejects(api.get('/api/protections'), error => error.response.status === 403 && error.response.data.detail.code === 'access_pending');
  assert.deepEqual(calls, ['/api/protections', 'http://localhost:8000/api/auth/telegram-login']);
  assert.equal(storage.has('jwt_token'), false);
  assert.equal(storage.has('auth_user'), false);
  assert.equal(getAuthenticationIssue().code, 'access_pending');
  assert.equal(denied.code, 'access_pending');
});
