// frontend/src/pg/notify.jsx
// ============================================================
// Тосты вместо alert(). В Mini App alert рисуется браузерным
// диалогом поверх Telegram и блокирует поток — вместо него
// короткое сообщение сверху, которое само уходит.
//
// Использование из любого места (в том числе вне React):
//   notify.error("Не удалось продлить защиту")
//   notify.success("Защита создана")
// ============================================================

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";
import { haptic } from "./telegram";
import "./notify.css";

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

const ICONS = { success: "checkCircle", error: "alert", info: "info" };

export function ToastHost() {
  const [list, setList] = useState(items);

  useEffect(() => {
    listeners.add(setList);
    return () => listeners.delete(setList);
  }, []);

  if (typeof document === "undefined" || list.length === 0) return null;

  return createPortal(
    <div className="pgt" role="status" aria-live="polite">
      {list.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`pgt__i pgt__i--${t.kind}`}
          onClick={() => dismiss(t.id)}
        >
          <Icon name={ICONS[t.kind]} size={16} />
          <span>{t.text}</span>
        </button>
      ))}
    </div>,
    document.body
  );
}

export default notify;
