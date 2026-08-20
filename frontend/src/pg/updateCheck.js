// frontend/src/pg/updateCheck.js
// ============================================================
// Telegram кэширует Mini App агрессивно: после деплоя человек
// может неделю сидеть на старой сборке и не понимать, почему
// починенное не починилось.
//
// При старте сверяем свой коммит с тем, что лежит на сервере, и,
// если разошлись, один раз перезагружаемся. Ключ в sessionStorage
// не даёт зациклиться, если перезагрузка не помогла.
// ============================================================

const RELOAD_KEY = "pg_reloaded_for";

// Подставляется на сборке (vite define). Локально — короткий sha.
const CURRENT = typeof __PG_BUILD__ === "string" ? __PG_BUILD__ : "";

export function currentBuild() {
  return CURRENT;
}

export function checkForUpdate() {
  if (typeof window === "undefined" || !CURRENT || CURRENT === "unknown") return;

  // Кэш-бастер в адресе: некоторые вебвью игнорируют cache: "no-store"
  const url = `/index.html?_=${Date.now()}`;

  fetch(url, { cache: "no-store" })
    .then((r) => (r.ok ? r.text() : null))
    .then((html) => {
      if (!html) return;
      const match = html.match(/name="build-commit"\s+content="([^"]+)"/);
      const latest = match?.[1];
      if (!latest || latest === CURRENT) return;

      // Уже перезагружались ради этой версии — значит перезагрузка не помогла,
      // второй раз не пробуем, иначе получится петля
      let already = null;
      try {
        already = sessionStorage.getItem(RELOAD_KEY);
      } catch {
        return;
      }
      if (already === latest) return;

      try {
        sessionStorage.setItem(RELOAD_KEY, latest);
      } catch {
        return;
      }
      window.location.reload();
    })
    .catch(() => {
      // нет сети — просто работаем на том, что загрузилось
    });
}

export default checkForUpdate;
