import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'localStorage', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'CustomEvent']) globalThis[key] = dom.window[key];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const folder = await mkdtemp(join(dirname(fileURLToPath(import.meta.url)), '.admission-'));
test.after(async () => { dom.window.close(); await rm(folder, { recursive: true, force: true }); });
const outfile = join(folder, 'harness.cjs');
await build({ stdin: { contents: `
export { default as App } from './src/App.jsx';
export { default as UsersTab } from './src/pg/admin/UsersTab.jsx';
export { api, storeAuthentication, resumeAutomaticAuthentication } from './src/api.js';
export { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
export { createElement } from 'react';
export { default as axios } from 'axios';
`, resolveDir: dirname(fileURLToPath(new URL('../package.json', import.meta.url))), loader: 'jsx' }, outfile, bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}', '__PG_BUILD__': '{}' }, logLevel: 'silent' });
const { App, UsersTab, api, storeAuthentication, resumeAutomaticAuthentication, render, screen, fireEvent, cleanup, waitFor, within, act, createElement, axios } = createRequire(import.meta.url)(outfile);
const session = { token: 'approved-token', user: { id: 7, role: 'assistant', full_name: 'Существующий сотрудник', manager_ids: '[23]', is_active: 1, access_status: 'approved' } };
const pending = { code: 'access_pending', message: 'Заявка на доступ отправлена администратору. После одобрения нажмите «Проверить доступ».' };
const response = (config, data, status = 200) => ({ data, status, statusText: '', headers: {}, config });
const fail = (config, status, detail) => Promise.reject(new axios.AxiosError('Rejected', 'ERR_BAD_RESPONSE', config, {}, response(config, { detail }, status)));
function telegram() {
  window.Telegram = { WebApp: { platform: 'macos', initData: 'signed-test-data', colorScheme: 'light', themeParams: {}, ready() {}, expand() {}, onEvent() {}, offEvent() {}, setHeaderColor() {}, setBackgroundColor() {}, BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} }, MainButton: { hide() {}, offClick() {}, onClick() {} } } };
}
function adapter(callback) { api.defaults.adapter = callback; axios.defaults.adapter = callback; }
test.beforeEach(() => { resumeAutomaticAuthentication(); storeAuthentication(session); localStorage.clear(); telegram(); });
test.afterEach(() => { cleanup(); localStorage.clear(); delete window.Telegram; });

test('Pending login has no token or data requests; manual check admits the same approved profile', async () => {
  const calls = []; let approved = false;
  adapter(config => {
    calls.push(config.url);
    if (config.url.endsWith('/api/auth/telegram-login')) {
      assert.equal(JSON.parse(config.data).init_data, 'signed-test-data');
      return approved ? Promise.resolve(response(config, session)) : fail(config, 403, pending);
    }
    if (config.url === '/api/auth/me') return Promise.resolve(response(config, { user: session.user }));
    return Promise.resolve(response(config, []));
  });
  render(createElement(App));
  await screen.findByRole('heading', { name: 'Ожидаем одобрения' });
  assert.match(screen.getByRole('status').textContent, /Заявка на доступ отправлена/);
  await act(() => new Promise(resolve => setTimeout(resolve, 40)));
  assert.equal(calls.length, 1); assert.equal(localStorage.getItem('jwt_token'), null);
  assert.equal(screen.queryByRole('button', { name: /^Выгрузка/ }), null);
  approved = true; await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Проверить доступ' })); });
  await waitFor(() => assert.equal(screen.queryByRole('heading', { name: 'Ожидаем одобрения' }), null));
  await waitFor(() => assert.ok(calls.includes('/api/protections')));
  assert.equal(localStorage.getItem('jwt_token'), session.token);
  const user = JSON.parse(localStorage.getItem('auth_user'));
  assert.equal(user.id, 7); assert.equal(user.role, 'assistant'); assert.equal(user.manager_ids, '[23]');
});

test('Existing approved session opens the August home without a new admission request', async () => {
  const calls = []; storeAuthentication(session);
  adapter(config => { calls.push(config.url); return Promise.resolve(response(config, config.url === '/api/auth/me' ? { user: session.user } : [])); });
  render(createElement(App));
  await waitFor(() => assert.ok(calls.includes('/api/protections')));
  await screen.findByRole('button', { name: 'Создать', exact: true });
  for (const name of [/^Найти/, /^Истекают/, /^Выгрузка/]) assert.ok(screen.getByRole('button', { name }));
  assert.equal(calls.some(url => url.endsWith('/api/auth/telegram-login')), false);
  assert.equal(localStorage.getItem('jwt_token'), session.token);
});

test('Rejected and blocked logins remain denied on explicit retry with no automatic loop or data requests', async () => {
  for (const code of ['access_rejected', 'access_blocked']) {
    cleanup(); storeAuthentication(session); localStorage.clear(); let calls = 0;
    adapter(config => { calls++; return fail(config, 403, { code, message: code === 'access_rejected' ? 'Заявка отклонена администратором.' : 'Доступ заблокирован администратором.' }); });
    render(createElement(App));
    await screen.findByRole('heading', { name: 'Доступ закрыт' });
    assert.equal(screen.queryByText('Ожидаем одобрения'), null);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Проверить доступ' })); });
    await waitFor(() => assert.equal(calls, 2));
    await act(() => new Promise(resolve => setTimeout(resolve, 20)));
    assert.equal(calls, 2); assert.equal(localStorage.getItem('jwt_token'), null);
  }
});

const newUser = { id: 42, full_name: 'Новый сотрудник', tg_id: '123456789', role: 'manager', is_active: 0, access_status: 'pending' };
const blockedUser = { id: 43, full_name: 'Заблокированный сотрудник', role: 'manager', is_active: 0, access_status: 'approved' };
function usersAdapter(onPost) {
  adapter(config => config.method === 'post' ? onPost(config) : Promise.resolve(response(config, config.url === '/api/admin/users' ? { users: [newUser, blockedUser] } : [])));
}

test('Admin distinguishes blocked users and chooses a role before approving via a dedicated endpoint', async () => {
  const posts = []; let changed = 0;
  usersAdapter(config => { posts.push({ url: config.url, body: JSON.parse(config.data) }); return Promise.resolve(response(config, { ok: true, user: { ...newUser, role: 'assistant', is_active: 1, access_status: 'approved' } })); });
  render(createElement(UsersTab, { role: 'admin', currentUserId: 1, onChanged: () => changed++ }));
  await screen.findByRole('button', { name: /Заявки на доступ · 1/ });
  fireEvent.click(screen.getByRole('button', { name: 'Заблокированные' }));
  assert.equal(screen.queryByRole('button', { name: /Новый сотрудник/ }), null);
  assert.ok(screen.getByRole('button', { name: /Заблокированный сотрудник/ }));
  fireEvent.click(screen.getByRole('button', { name: /Заявки на доступ · 1/ }));
  fireEvent.click(screen.getByRole('button', { name: /Новый сотрудник/ }));
  const dialog = screen.getByRole('dialog', { name: 'Новый сотрудник' });
  assert.equal(within(dialog).queryByRole('button', { name: 'Разблокировать' }), null);
  const roles = within(dialog).getByLabelText('Роль после одобрения');
  assert.equal(roles.value, 'manager'); assert.equal([...roles.options].some(option => option.value === 'superadmin'), false);
  fireEvent.change(roles, { target: { value: 'assistant' } }); assert.equal(posts.length, 0);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Одобрить доступ' }));
  await waitFor(() => assert.equal(changed, 1));
  assert.deepEqual(posts, [{ url: '/api/admin/users/42/approve', body: { role: 'assistant' } }]);
  assert.equal(screen.queryByRole('dialog'), null);
  assert.ok(screen.getByRole('button', { name: /Заявки на доступ · 0/ }));
});

test('Failed approval preserves the request and shows an error; rejecting cannot become a normal unblock', async () => {
  const posts = []; let rejectWorks = false;
  usersAdapter(config => {
    posts.push({ url: config.url, body: JSON.parse(config.data) });
    return rejectWorks ? Promise.resolve(response(config, { ok: true, user: { ...newUser, access_status: config.url.endsWith('/approve') ? 'approved' : 'rejected', is_active: config.url.endsWith('/approve') ? 1 : 0 } })) : fail(config, 409, { message: 'Заявку уже обработал другой администратор.' });
  });
  render(createElement(UsersTab, { role: 'superadmin', currentUserId: 1 }));
  fireEvent.click(await screen.findByRole('button', { name: /Новый сотрудник/ }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Одобрить доступ' })); });
  await screen.findByRole('alert'); assert.match(screen.getByRole('alert').textContent, /Заявку уже обработал/);
  assert.ok(screen.getByRole('dialog', { name: 'Новый сотрудник' }));
  rejectWorks = true; await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Отклонить заявку' })); });
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
  assert.deepEqual(posts.at(-1), { url: '/api/admin/users/42/reject', body: {} });
  fireEvent.click(screen.getByRole('button', { name: /Новый сотрудник/ }));
  const dialog = screen.getByRole('dialog', { name: 'Новый сотрудник' });
  assert.equal(within(dialog).queryByRole('button', { name: 'Одобрить доступ' }), null);
  assert.equal(within(dialog).queryByRole('button', { name: 'Разблокировать' }), null);
  assert.match(dialog.textContent, /Заявка отклонена/);
  assert.ok(within(dialog).getByRole('button', { name: 'Разрешить доступ' }));
  fireEvent.change(within(dialog).getByLabelText('Роль после одобрения'), { target: { value: 'assistant' } });
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Разрешить доступ' })); });
  assert.deepEqual(posts.at(-1), { url: '/api/admin/users/42/approve', body: { role: 'assistant' } });
  assert.equal(screen.queryByRole('dialog'), null);
});
