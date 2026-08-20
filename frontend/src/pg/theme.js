// frontend/src/pg/theme.js
// ============================================================
// Тема нового UI. Источник правды тот же, что у старых экранов:
//   1) ручной выбор пользователя (localStorage "theme")
//   2) Telegram themeParams / colorScheme
//   3) тёмная по умолчанию
// Результат вешается как data-pg-theme на <html>, палитра —
// в tokens.css. Старый слой продолжает жить на body.light-theme,
// так что оба слоя всегда показывают одну и ту же тему.
// ============================================================

const ATTR = "data-pg-theme";

function getStoredTheme() {
  try {
    const saved = localStorage.getItem("theme");
    return saved === "light" || saved === "dark" ? saved : null;
  } catch {
    return null;
  }
}

function isTelegramLight(tg) {
  if (!tg) return false;
  if (tg.colorScheme === "light") return true;
  const bg = tg.themeParams?.bg_color;
  if (typeof bg !== "string") return false;
  // themeParams приходит как #rrggbb — светлым считаем всё с высокой яркостью
  const hex = bg.trim().replace("#", "");
  if (hex.length !== 6) return false;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return false;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}

export function resolvePgTheme() {
  const saved = getStoredTheme();
  if (saved) return saved;
  const tg = typeof window !== "undefined" ? window.Telegram?.WebApp : null;
  return isTelegramLight(tg) ? "light" : "dark";
}

export function applyPgTheme(theme) {
  if (typeof document === "undefined") return "dark";
  const next = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute(ATTR, next);
  return next;
}

export function initPgTheme() {
  if (typeof window === "undefined") return () => {};

  const sync = (event) => {
    const forced = event?.detail?.theme;
    applyPgTheme(forced === "light" || forced === "dark" ? forced : resolvePgTheme());
  };

  sync();

  // Старый слой шлёт эти события при ручном переключении и при синке с Telegram
  window.addEventListener("app-theme-sync", sync);
  window.addEventListener("app-theme-change", sync);

  const tg = window.Telegram?.WebApp;
  tg?.onEvent?.("themeChanged", sync);

  return () => {
    window.removeEventListener("app-theme-sync", sync);
    window.removeEventListener("app-theme-change", sync);
    tg?.offEvent?.("themeChanged", sync);
  };
}
