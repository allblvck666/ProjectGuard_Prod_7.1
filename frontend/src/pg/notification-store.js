import { haptic } from "./telegram";

const LIFETIME = 4000;
const MAX_VISIBLE = 3;

let items = [];
let seq = 0;
const listeners = new Set();

function emit() {
  listeners.forEach((fn) => fn([...items]));
}

function dismiss(id) {
  items = items.filter((t) => t.id !== id);
  emit();
}

function push(kind, message) {
  // FastAPI отдаёт detail либо строкой, либо объектом {msg: "..."}
  const text =
    typeof message === "string"
      ? message
      : message && typeof message === "object" && typeof message.msg === "string"
        ? message.msg
        : String(message ?? "");
  if (!text.trim()) return null;

  // Одинаковые сообщения подряд не дублируем
  const last = items[items.length - 1];
  if (last && last.kind === kind && last.text === text) return last.id;

  const id = ++seq;
  items = [...items, { id, kind, text }].slice(-MAX_VISIBLE);
  emit();
  haptic(kind === "error" ? "error" : kind === "success" ? "success" : "impact");
  setTimeout(() => dismiss(id), LIFETIME);
  return id;
}

export const notify = {
  success: (message) => push("success", message),
  error: (message) => push("error", message),
  info: (message) => push("info", message),
  dismiss,
};


export const currentNotifications = () => items;
export function subscribeNotifications(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export default notify;
