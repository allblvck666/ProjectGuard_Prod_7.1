// frontend/src/pg/TabBar.jsx
// ============================================================
// Нижняя панель разделов — как в Wallet и других Mini App.
// Видна только на корневых экранах; на вложенных (карточка защиты,
// создание, админка) прячется, и назад ведёт кнопка Telegram.
// ============================================================

import { Icon } from "./icons";
import { haptic } from "./telegram";
import "./tabbar.css";

export const TABBAR_ROUTES = ["home", "active", "archive", "more"];

const TABS = [
  { route: "home", label: "Главная", icon: "grid" },
  { route: "active", label: "Защиты", icon: "shield" },
  { route: "archive", label: "Архив", icon: "archive" },
  { route: "more", label: "Ещё", icon: "settings" },
];

export default function TabBar({ active, onChange, badges = {} }) {
  return (
    <nav className="pg-tabbar" role="tablist" aria-label="Разделы">
      {TABS.map((t) => {
        const selected = active === t.route;
        const badge = badges[t.route];
        return (
          <button
            key={t.route}
            type="button"
            role="tab"
            aria-selected={selected}
            className="pg-tabbar__i"
            onClick={() => {
              if (selected) return;
              haptic("select");
              onChange(t.route);
            }}
          >
            <span className="pg-tabbar__ic">
              <Icon name={t.icon} size={21} />
              {badge > 0 && <span className="pg-tabbar__badge pg-num">{badge}</span>}
            </span>
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}
