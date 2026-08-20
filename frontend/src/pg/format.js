// frontend/src/pg/format.js
// Форматирование данных для нового UI. Только представление:
// поля берём из тех же ответов API, что и старые экраны.

/* ---------- артикулы ---------- */

// Бэкенд хранит артикулы одной строкой:
//   "AF3510QV (Ёлка) + AF6052 (Планка)"                     — единый метраж
//   "AF7001N (Планка) — 180 м²; AF6052 (Планка) — 140 м²"   — метраж по артикулам
export function parseSkuCodes(sku) {
  if (!sku) return [];
  return String(sku)
    .split(/\s\+\s|;\s*/)
    .map((part) => part.split(" — ")[0].split(" (")[0].trim())
    .filter(Boolean);
}

// Компактный вид для карточки списка: "AF6052 +1"
export function skuShort(sku) {
  const codes = parseSkuCodes(sku);
  if (codes.length === 0) return "—";
  if (codes.length === 1) return codes[0];
  return `${codes[0]} +${codes.length - 1}`;
}

/* ---------- числа ---------- */

export function fmtNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const rounded = Math.round(n * 10) / 10;
  return rounded.toLocaleString("ru-RU");
}

export function fmtArea(value) {
  if (value == null || value === "") return "—";
  return `${fmtNumber(value)} м²`;
}

export function plural(n, one, few, many) {
  const abs = Math.abs(Math.trunc(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/* ---------- даты ---------- */

function toDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDateShort(value) {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

export function fmtDate(value) {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function fmtDateTime(value) {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/* ---------- статус защиты ---------- */

// Порог «истекает»: янтарь за 2 дня и меньше — как в правилах уведомлений
export const EXPIRING_DAYS = 2;

export function statusKind(item) {
  const status = item?.status;
  if (status === "success") return "success";
  if (status === "deleted") return "deleted";
  if (status && status !== "active" && status !== "pending") return "closed";
  const left = Number(item?.days_left);
  if (Number.isFinite(left) && left <= EXPIRING_DAYS) return "expiring";
  return "active";
}

const BADGES = {
  active: { tone: "success", label: "Активна" },
  expiring: { tone: "warning", label: "Истекает" },
  success: { tone: "accent", label: "Успешно" },
  closed: { tone: "danger", label: "Закрыта" },
  deleted: { tone: "danger", label: "Удалена" },
};

export function statusBadge(item) {
  return BADGES[statusKind(item)] || BADGES.active;
}

/* ---------- остаток срока ---------- */

export function daysLeftText(item) {
  const left = Number(item?.days_left);
  if (!Number.isFinite(left)) return "—";
  if (left <= 0) return "истекла";
  return `${left} ${plural(left, "день", "дня", "дней")}`;
}

// Доля оставшегося срока (0–100) для полосы burn-down
export function remainingPercent(item) {
  const created = toDate(item?.created_at);
  const expires = toDate(item?.expires_at);
  const left = Number(item?.days_left);

  if (created && expires && expires > created) {
    const total = expires - created;
    const rest = expires - Date.now();
    return Math.max(0, Math.min(100, (rest / total) * 100));
  }
  if (Number.isFinite(left)) return Math.max(0, Math.min(100, (left / 30) * 100));
  return 0;
}

export function trackTone(item) {
  const left = Number(item?.days_left);
  if (!Number.isFinite(left)) return undefined;
  if (left <= 1) return "danger";
  if (left <= EXPIRING_DAYS) return "warning";
  return undefined;
}

/* ---------- прочее ---------- */

// Телефон показываем замаскированным — в базе и так только последние 4 цифры
export function maskPhone(last4) {
  const digits = String(last4 || "").replace(/\D/g, "").slice(-4);
  if (!digits) return "—";
  return `•••• ${digits}`;
}

// В карточке списка место дорогое: «Дмитрий Журавлев» → «Дмитрий Ж.»
export function shortName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[1][0].toUpperCase()}.`;
}

// /api/managers отдаёт объекты {id, name}, а App нормализует их в {id, first_name}
export function managerName(m) {
  if (!m) return "";
  if (typeof m === "string") return m;
  return m.first_name || m.name || m.username || "";
}

export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}
