// frontend/src/pg/dicts.js
// ============================================================
// Справочники (менеджеры, артикулы) кэшируются в localStorage на
// 5 минут. Если админ переименовал менеджера, в форме создания
// защиты до конца этого окна висело старое имя.
//
// После любой правки справочника зовём invalidateDicts(): кэш
// сбрасывается, App перечитывает списки сразу.
// ============================================================

export const DICTS_EVENT = "pg:dicts-changed";

const KEYS = ["cached_managers", "cached_skus"];

export function invalidateDicts() {
  try {
    KEYS.forEach((k) => localStorage.removeItem(k));
  } catch {
    // приватный режим — кэша и так нет
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(DICTS_EVENT));
  }
}

export function onDictsChanged(handler) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(DICTS_EVENT, handler);
  return () => window.removeEventListener(DICTS_EVENT, handler);
}
