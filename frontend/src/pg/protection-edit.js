const DETAIL_FIELDS = ["manager", "partner", "partner_city", "client", "last4", "object_city", "address"];

export function parseProtectionSkus(value) {
  return String(value || "").split(/;|\s\+\s/).map((part) => part.trim()).filter(Boolean).map((part) => {
    const areaMatch = part.match(/\s*[—–-]\s*([\d.,]+)\s*м[²2]\s*$/i);
    const label = areaMatch ? part.slice(0, areaMatch.index).trim() : part;
    const typed = label.match(/^(.+?)\s*\(([^)]*)\)\s*$/);
    return { sku: (typed?.[1] || label).trim(), type: (typed?.[2] || "").trim(), area: areaMatch ? areaMatch[1].replace(",", ".") : "" };
  });
}

export function localDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (v) => String(v).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function protectionEditDetails(item) {
  const values = Object.fromEntries(DETAIL_FIELDS.map((key) => [key, String(item[key] ?? "")]));
  return { ...values, expires_at: localDateTime(item.expires_at), close_reason: item.close_reason || "", success_doc: item.success_doc || "" };
}

export function editProblem({ selected, perSkuMode, unified, details }) {
  if (details) {
    if (!String(details.manager || "").trim()) return "Выберите менеджера";
    if (details.last4 && !/^\d{4}$/.test(String(details.last4))) return "Укажите последние 4 цифры телефона";
  }
  if (!selected?.length) return "Добавьте хотя бы один артикул";
  if (selected.some((s) => !String(s.sku || "").trim())) return "Укажите артикул";
  if (perSkuMode && selected.some((s) => !Number.isFinite(Number(s.area)) || Number(s.area) <= 0)) return "Укажите положительный метраж для каждого артикула";
  const total = perSkuMode ? selected.reduce((sum, s) => sum + Number(s.area), 0) : Number(unified);
  if (!Number.isFinite(total) || total <= 0) return "Укажите метраж";
  if (total < 50) return "Защита ставится от 50 м²";
  return null;
}

export function buildEditPayload({ item, details, selected, perSkuMode, unified, comment, isAdmin }) {
  const payload = Object.fromEntries(DETAIL_FIELDS.map((key) => [key, String(details[key] ?? "").trim()]));
  payload.sku_data = selected.map((s) => ({ sku: s.sku, type: s.type, ...(perSkuMode ? { area: Number(s.area) } : {}) }));
  payload.area_m2 = perSkuMode ? selected.reduce((sum, s) => sum + Number(s.area), 0) : Number(unified);
  payload.comment = comment;
  payload.expected_updated_at = item.updated_at || item.created_at;
  if (isAdmin && item.status === "active" && details.expires_at !== localDateTime(item.expires_at)) {
    const date = new Date(details.expires_at);
    if (!details.expires_at || Number.isNaN(date.getTime())) throw new Error("Укажите корректный срок защиты");
    payload.expires_at = date.toISOString();
  }
  if (item.status !== "active") {
    for (const key of ["close_reason", "success_doc"]) if (details[key] !== (item[key] || "")) payload[key] = details[key].trim();
  }
  return payload;
}

export function protectionError(error, fallback) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (detail?.code === "stale_protection") return "Защиту уже изменил другой сотрудник. Ваши правки сохранены в форме. Обновите данные и проверьте их перед сохранением.";
  if (detail?.similar_protection) return `${detail.msg || "Найдена похожая активная защита"} №${detail.similar_protection.id}. Обратитесь к администратору для проверки.`;
  return detail?.msg || detail?.message || error?.userMessage || fallback;
}

export function hasEditChanges({ item, details, selected, perSkuMode, unified, comment }) {
  if (!item) return false;
  if (JSON.stringify(details) !== JSON.stringify(protectionEditDetails(item))) return true;
  const original = parseProtectionSkus(item.sku);
  const originalPerSku = original.some((row) => Number(row.area) > 0);
  return perSkuMode !== originalPerSku || JSON.stringify(selected) !== JSON.stringify(original)
    || (!perSkuMode && Number(unified) !== Number(item.area_m2)) || comment !== (item.comment || "");
}
