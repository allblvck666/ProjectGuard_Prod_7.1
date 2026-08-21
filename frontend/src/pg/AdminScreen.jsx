// frontend/src/pg/AdminScreen.jsx
// ============================================================
// Этап 6 — админка (флаг ?ui-admin=new).
// Те же разделы и те же запросы, что у старой панели: меняется
// только слой представления. Каждая вкладка грузит свои данные сама.
// ============================================================

import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Badge, Button, Icon, LoadingState, Sheet } from "./ui";
import { initials } from "./format";
import { BACK_PRIORITY, haptic, isTelegramApp, useBackButton } from "./telegram";
import { api } from "../api";
import "./admin.css";

const PulseTab = lazy(() => import("./admin/PulseTab.jsx"));
const UsersTab = lazy(() => import("./admin/UsersTab.jsx"));
const ManagersTab = lazy(() => import("./admin/ManagersTab.jsx"));
const RequestsTab = lazy(() => import("./admin/RequestsTab.jsx"));
const PendingTab = lazy(() => import("./admin/PendingTab.jsx"));

const TABS = [
  { value: "pulse", label: "Пульс", icon: "pulse" },
  { value: "users", label: "Пользователи", icon: "users" },
  { value: "managers", label: "Менеджеры", icon: "user" },
  { value: "requests", label: "Запросы", icon: "hourglass" },
  { value: "pending", label: "Заявки", icon: "file" },
];

const ROLE_LABEL = {
  superadmin: "Суперадмин",
  admin: "Админ",
  manager: "Менеджер",
  assistant: "Ассистент",
};

export default function AdminScreen({ auth, onBack }) {
  const [tab, setTab] = useState("pulse");
  const [counts, setCounts] = useState({ requests: 0, pending: 0 });
  const [logoutOpen, setLogoutOpen] = useState(false);

  const user = auth?.user || {};
  const role = auth?.role || user.role || "";
  const name = user.full_name || user.first_name || "Администратор";

  useBackButton(onBack, true, BACK_PRIORITY.screen);

  // Счётчики в навигации: сколько ждёт решения.
  // Пересчитываем и после действий во вкладках — иначе бейдж «Заявки 5»
  // висел, когда в очереди уже пусто.
  const [countsTick, setCountsTick] = useState(0);
  const refreshCounts = useCallback(() => setCountsTick((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [req, pend] = await Promise.all([
        api.get("/api/admin/extend-requests").catch(() => ({ data: [] })),
        api
          .get("/api/protections", { params: { status: "pending" } })
          .catch(() => ({ data: [] })),
      ]);
      if (!alive) return;
      setCounts({
        requests: Array.isArray(req.data) ? req.data.length : 0,
        pending: Array.isArray(pend.data)
          ? pend.data.filter((p) => p.status === "pending").length
          : 0,
      });
    };
    load();
    return () => {
      alive = false;
    };
  }, [tab, countsTick]);

  // Старый дашборд умел переключать вкладки событием — сохраняем поведение
  useEffect(() => {
    const onSwitch = (e) => {
      if (e.detail && typeof e.detail === "string") setTab(e.detail);
    };
    window.addEventListener("admin:switch-tab", onSwitch);
    return () => window.removeEventListener("admin:switch-tab", onSwitch);
  }, []);

  const logout = () => {
    // Чистит и ставит отметку выхода сам App — иначе автологин Telegram
    // тут же возвращал бы того же пользователя
    window.dispatchEvent(new CustomEvent("auth:logout"));
  };

  return (
    <div className="pga">
      {!isTelegramApp() && (
        <div className="pga__fallback">
          <Button variant="ghost" size="sm" icon="chevronLeft" onClick={onBack}>
            Назад
          </Button>
        </div>
      )}

      <div className="pga__stuck">
        <div className="pga-profile">
          <div className="pga-profile__ava">{initials(name)}</div>
          <div className="pga-profile__t">
            <div className="pga-profile__n">{name}</div>
            <div className="pga-profile__r">
              <Icon name="crown" size={12} />
              {ROLE_LABEL[role] || role || "—"}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon="logout"
            onClick={() => setLogoutOpen(true)}
            aria-label="Выйти"
          />
        </div>

        <div className="pga-tabs" role="tablist">
          {TABS.map((t) => {
            const count = counts[t.value];
            return (
              <button
                key={t.value}
                type="button"
                role="tab"
                className="pga-tab"
                aria-selected={tab === t.value}
                onClick={() => {
                  setTab(t.value);
                  haptic("select");
                }}
              >
                <Icon name={t.icon} size={15} />
                {t.label}
                {count > 0 && <span className="pga-tab__badge pg-num">{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="pga__scroll">
        <Suspense fallback={<div className="pga__pad-top"><LoadingState rows={3} /></div>}>
          {tab === "pulse" && <PulseTab />}
          {tab === "users" && <UsersTab role={role} currentUserId={user.id} />}
          {tab === "managers" && <ManagersTab />}
          {tab === "requests" && <RequestsTab onChanged={refreshCounts} />}
          {tab === "pending" && <PendingTab onChanged={refreshCounts} />}
        </Suspense>
        <div className="pga__pad" />
      </div>

      <Sheet
        open={logoutOpen}
        title="Выйти из аккаунта?"
        onClose={() => setLogoutOpen(false)}
        actions={
          <>
            <Button variant="danger" block icon="logout" onClick={logout}>
              Выйти
            </Button>
            <Button variant="ghost" block onClick={() => setLogoutOpen(false)}>
              Отмена
            </Button>
          </>
        }
      >
        <div className="pg-sheet__text">
          Придётся войти заново — через Telegram или по логину.
        </div>
      </Sheet>
    </div>
  );
}

export { ROLE_LABEL };
export const AdminBadge = Badge;
