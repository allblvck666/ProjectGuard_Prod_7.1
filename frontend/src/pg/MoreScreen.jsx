// frontend/src/pg/MoreScreen.jsx
// ============================================================
// Раздел «Ещё»: то, что нужно раз в неделю, а не раз в час —
// статистика, админка, настройки, тема, выгрузка, выход.
// Главная от этого стала короче.
// ============================================================

import { useEffect, useState } from "react";
import { Badge, Button, Icon, Segment, Sheet } from "./ui";
import { initials } from "./format";
import { applyPgTheme, resolvePgTheme } from "./theme";
import { BACK_PRIORITY, useBackButton, useDisableVerticalSwipes } from "./telegram";
import "./more.css";

const ROLE_LABEL = {
  superadmin: "Суперадмин",
  admin: "Админ",
  manager: "Менеджер",
  assistant: "Ассистент",
};

const THEME_OPTIONS = [
  { value: "auto", label: "Как в Telegram" },
  { value: "dark", label: "Тёмная", icon: "moon" },
  { value: "light", label: "Светлая", icon: "sun" },
];

function readThemeChoice() {
  try {
    const saved = localStorage.getItem("theme");
    return saved === "light" || saved === "dark" ? saved : "auto";
  } catch {
    return "auto";
  }
}

export default function MoreScreen({ auth, onStats, onAdmin, onSettings, onExport, onLogout }) {
  const [theme, setTheme] = useState(readThemeChoice);
  const [logoutOpen, setLogoutOpen] = useState(false);

  const user = auth?.user || {};
  const role = auth?.role || user.role || "";
  const name = user.full_name || user.first_name || "Пользователь";
  const isAdmin = role === "admin" || role === "superadmin";

  // «Ещё» — корневой раздел, нативная кнопка «Назад» здесь не нужна
  useBackButton(() => {}, false, BACK_PRIORITY.screen);
  useDisableVerticalSwipes(true);

  useEffect(() => {
    // Тему могли переключить с другого экрана
    const sync = () => setTheme(readThemeChoice());
    window.addEventListener("app-theme-sync", sync);
    return () => window.removeEventListener("app-theme-sync", sync);
  }, []);

  const chooseTheme = (next) => {
    setTheme(next);
    try {
      if (next === "auto") localStorage.removeItem("theme");
      else localStorage.setItem("theme", next);
    } catch {
      // приватный режим — тема не переживёт перезапуск
    }
    // Старый слой слушает это событие и красит body; новый — data-pg-theme
    window.dispatchEvent(
      new CustomEvent("app-theme-change", {
        detail: next === "auto" ? {} : { theme: next },
      })
    );
    if (next === "auto") applyPgTheme(resolvePgTheme());
  };

  const sections = [
    {
      title: "Работа",
      items: [
        { icon: "chart", label: "Статистика", hint: "Конверсия по менеджерам", onClick: onStats },
        ...(isAdmin
          ? [{ icon: "crown", label: "Админка", hint: "Люди, заявки, запросы", onClick: onAdmin }]
          : []),
        { icon: "download", label: "Выгрузка в XLSX", hint: "Все защиты за период", onClick: onExport },
      ],
    },
    {
      title: "Приложение",
      items: [
        { icon: "settings", label: "Настройки", hint: "Профиль и параметры", onClick: onSettings },
      ],
    },
  ];

  return (
    <div className="pgm">
      <div className="pgm__scroll">
        <header className="pgm-profile">
          <div className="pgm-profile__ava">{initials(name)}</div>
          <div className="pgm-profile__t">
            <div className="pgm-profile__n">{name}</div>
            <div className="pgm-profile__r">
              {isAdmin && <Icon name="crown" size={12} />}
              {ROLE_LABEL[role] || "—"}
            </div>
          </div>
          {user.tg_id && (
            <Badge plain className="pg-num">id {user.tg_id}</Badge>
          )}
        </header>

        {sections.map((sect) => (
          <section className="pgm-sect" key={sect.title}>
            <div className="pgm-sect__h">{sect.title}</div>
            <div className="pgm-menu">
              {sect.items.map((m) => (
                <button key={m.label} type="button" className="pgm-menu__i" onClick={m.onClick}>
                  <span className="pgm-menu__ic"><Icon name={m.icon} size={18} /></span>
                  <span className="pgm-menu__t">
                    <b>{m.label}</b>
                    <i>{m.hint}</i>
                  </span>
                  <Icon name="chevronRight" size={16} />
                </button>
              ))}
            </div>
          </section>
        ))}

        <section className="pgm-sect">
          <div className="pgm-sect__h">Тема</div>
          <Segment value={theme} onChange={chooseTheme} options={THEME_OPTIONS} />
          <div className="pgm-note">
            <Icon name="info" size={13} />
            «Как в Telegram» — тема приложения следует настройкам клиента.
          </div>
        </section>

        <section className="pgm-sect">
          <Button variant="secondary" block icon="logout" onClick={() => setLogoutOpen(true)}>
            Выйти
          </Button>
        </section>

        <div className="pgm-credit">Messiah Studio</div>
        <div className="pgm__pad" />
      </div>

      <Sheet
        open={logoutOpen}
        title="Выйти из аккаунта?"
        onClose={() => setLogoutOpen(false)}
        actions={
          <>
            <Button variant="danger" block icon="logout" onClick={onLogout}>Выйти</Button>
            <Button variant="ghost" block onClick={() => setLogoutOpen(false)}>Отмена</Button>
          </>
        }
      >
        <div className="pg-sheet__text">Придётся войти заново — через Telegram или по логину.</div>
      </Sheet>
    </div>
  );
}
