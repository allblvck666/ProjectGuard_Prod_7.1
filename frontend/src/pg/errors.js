// frontend/src/pg/errors.js
// ============================================================
// Единый разбор ошибки запроса.
//
// api.js подставляет свой userMessage, но для 403 и 409 он общий
// («Конфликт данных…»), тогда как сервер присылает точную причину
// в detail («Менеджер с таким именем уже существует»). Точное
// сообщение полезнее, поэтому detail идёт первым.
// ============================================================

export function errText(e, fallback = "Не удалось выполнить действие") {
  const detail = e?.response?.data?.detail;

  if (typeof detail === "string" && detail.trim()) return detail.trim();
  if (detail && typeof detail === "object" && typeof detail.msg === "string") {
    return detail.msg;
  }
  if (typeof e?.userMessage === "string" && e.userMessage.trim()) {
    return e.userMessage.trim();
  }
  return fallback;
}

export default errText;
