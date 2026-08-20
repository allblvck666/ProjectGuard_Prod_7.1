// frontend/src/pg/flags.js
// ============================================================
// Флаги нового UI. Старые экраны остаются на месте, новые
// живут рядом и включаются флагом:
//   ?ui-list=new  / ?ui-list=old
//   ?ui=new       — включить сразу все новые экраны
// Значение запоминается в localStorage, поэтому после перехода
// по прямой ссылке флаг переживает перезагрузку Mini App.
// Читать/менять руками: window.__pgFlags()
// ============================================================

const STORAGE_KEY = "pg_ui_flags";
const CHANGE_EVENT = "pg-flags-change";

// Все известные флаги и их значения по умолчанию.
// Редизайн включён по умолчанию; старые экраны остаются на месте и
// возвращаются флагом — целиком (?ui=old) или по одному (?ui-list=old).
export const FLAG_DEFAULTS = {
  "ui-list": "new",     // Этап 2 — список активных защит
  "ui-detail": "new",   // Этап 3 — карточка защиты
  "ui-create": "new",   // Этап 4 — создание + конфликт
  "ui-nav": "new",      // Этап 5 — нативная навигация Telegram
  "ui-archive": "new",  // Этап 6 — архив защит
  "ui-admin": "new",    // Этап 6 — админка и статистика
  "ui-kit": "off",      // витрина дизайн-системы (для проверки)
};

const FLAG_NAMES = Object.keys(FLAG_DEFAULTS);

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStored(next) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // приватный режим / переполнение — флаг просто не переживёт перезагрузку
  }
}

function normalize(name, value) {
  if (value == null) return null;
  const v = String(value).trim().toLowerCase();
  if (name === "ui-kit") {
    if (v === "1" || v === "on" || v === "true" || v === "new") return "on";
    if (v === "0" || v === "off" || v === "false" || v === "old") return "off";
    return null;
  }
  if (v === "new" || v === "1" || v === "on" || v === "true") return "new";
  if (v === "old" || v === "0" || v === "off" || v === "false") return "old";
  return null;
}

// Текущее состояние: дефолты ← localStorage ← query-параметры.
let state = { ...FLAG_DEFAULTS };

function readQuery() {
  if (typeof window === "undefined") return {};
  const out = {};
  let params;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return out;
  }

  // ?ui=new — общий выключатель для всех экранов сразу
  const all = normalize("ui-list", params.get("ui"));
  if (all) {
    FLAG_NAMES.forEach((name) => {
      if (name !== "ui-kit") out[name] = all;
    });
  }

  FLAG_NAMES.forEach((name) => {
    const value = normalize(name, params.get(name));
    if (value) out[name] = value;
  });
  return out;
}

export function initFlags() {
  if (typeof window === "undefined") return { ...state };

  const stored = readStored();
  const query = readQuery();
  const next = { ...FLAG_DEFAULTS };

  FLAG_NAMES.forEach((name) => {
    const fromStore = normalize(name, stored[name]);
    if (fromStore) next[name] = fromStore;
    if (query[name]) next[name] = query[name];
  });

  state = next;
  if (Object.keys(query).length > 0) writeStored(state);

  // Отладочный доступ: window.__pgFlags()
  // Хелперы вешаем и на функцию, и на снимок — чтобы работали обе записи:
  // window.__pgFlags.set(...) и window.__pgFlags().set(...)
  const api = () => {
    const snapshot = { ...state };
    Object.defineProperty(snapshot, "set", { value: setFlag, enumerable: false });
    Object.defineProperty(snapshot, "reset", { value: resetFlags, enumerable: false });
    return snapshot;
  };
  api.get = (name) => state[name];
  api.set = (name, value) => setFlag(name, value);
  api.reset = () => resetFlags();
  api.defaults = { ...FLAG_DEFAULTS };
  window.__pgFlags = api;

  return { ...state };
}

export function getFlags() {
  return { ...state };
}

export function getFlag(name) {
  return state[name] ?? FLAG_DEFAULTS[name];
}

export function isNew(name) {
  const value = getFlag(name);
  return value === "new" || value === "on";
}

export function setFlag(name, value) {
  if (!FLAG_NAMES.includes(name)) return getFlags();
  const normalized = normalize(name, value);
  if (!normalized) return getFlags();

  state = { ...state, [name]: normalized };
  writeStored(state);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: getFlags() }));
  }
  return getFlags();
}

export function resetFlags() {
  state = { ...FLAG_DEFAULTS };
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: getFlags() }));
  }
  return getFlags();
}

export function onFlagsChange(handler) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

export { CHANGE_EVENT as FLAGS_CHANGE_EVENT };
