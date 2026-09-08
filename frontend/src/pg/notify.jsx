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
import { currentNotifications, subscribeNotifications, notify } from "./notification-store";
import "./notify.css";

const ICONS = { success: "checkCircle", error: "alert", info: "info" };

export function ToastHost() {
  const [list, setList] = useState(currentNotifications);

  useEffect(() => {
    return subscribeNotifications(setList);
  }, []);

  if (typeof document === "undefined" || list.length === 0) return null;

  return createPortal(
    <div className="pgt" role="status" aria-live="polite">
      {list.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`pgt__i pgt__i--${t.kind}`}
          onClick={() => notify.dismiss(t.id)}
        >
          <Icon name={ICONS[t.kind]} size={16} />
          <span>{t.text}</span>
        </button>
      ))}
    </div>,
    document.body
  );
}
