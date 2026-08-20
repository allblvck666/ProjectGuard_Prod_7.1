// frontend/src/pg/HomeScreen.jsx
// ============================================================
// Главная (флаг ?ui-home=new).
// Вместо шести одинаковых плиток — цифра, ради которой сюда заходят,
// быстрые действия и то, что требует внимания прямо сейчас.
// Данные те же: App уже грузит защиты для этого маршрута.
// ============================================================

import { useMemo, useState } from "react";
import { Badge, Button, EmptyState, Icon, LoadingState, Sheet, Skeleton } from "./ui";
import ProtectionCard from "./ProtectionCard";
import ProtectionDetail from "./ProtectionDetail";
import ActionSheets from "./ActionSheets";
import { EXPIRING_DAYS, fmtArea, fmtNumber, initials, plural } from "./format";
import { usePullToRefresh } from "./usePullToRefresh";
import { BACK_PRIORITY, useBackButton, useDisableVerticalSwipes } from "./telegram";
import "./home.css";

const ROLE_LABEL = {
  superadmin: "Суперадмин",
  admin: "Админ",
  manager: "Менеджер",
  assistant: "Ассистент",
};

const PREVIEW = 3; // сколько карточек показываем в секции

export default function HomeScreen({
  auth, items, loading, load,
  onCreate, onList, onExport, onLogout,
  newDetail, detailId, setDetailId, act, openEditModal, restoreProtection, sheets,
}) {
  const [logoutOpen, setLogoutOpen] = useState(false);

  const user = auth?.user || {};
  const role = auth?.role || user.role || "";
  const name = user.full_name || user.first_name || "Пользователь";

  useBackButton(() => {}, false, BACK_PRIORITY.screen);
  useDisableVerticalSwipes(true);
  const { scrollRef, pull, refreshing, dragging, ready } = usePullToRefresh(load);

  const active = useMemo(
    () => (Array.isArray(items) ? items : []).filter((it) => it.status === "active"),
    [items]
  );

  const summary = useMemo(() => {
    const area = active.reduce((sum, it) => sum + (Number(it.area_m2) || 0), 0);
    const expiring = active.filter((it) => Number(it.days_left) <= EXPIRING_DAYS);
    return { count: active.length, area, expiring };
  }, [active]);

  const recent = useMemo(
    () =>
      [...active]
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .slice(0, PREVIEW),
    [active]
  );

  const detailItem = useMemo(
    () => (detailId == null ? null : active.find((it) => it.id === detailId) || null),
    [active, detailId]
  );

  const attention = summary.expiring
    .slice()
    .sort((a, b) => (Number(a.days_left) || 0) - (Number(b.days_left) || 0))
    .slice(0, PREVIEW);

  const openItem = (item) => {
    if (newDetail) setDetailId(item.id);
    else onList();
  };

  const firstLoad = loading && active.length === 0;

  return (
    <div className="pgh">
      <div className="pgh__scroll" ref={scrollRef}>
        <div
          className="pg-ptr"
          style={{ height: pull, transition: dragging ? "none" : "height 200ms ease" }}
          aria-hidden={pull === 0}
        >
          <span className="pg-ptr__in" style={{ opacity: Math.min(1, pull / 40) }}>
            <Icon
              name="refresh"
              size={15}
              className={refreshing ? "pg-spin" : ""}
              style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }}
            />
            {refreshing ? "Обновляем…" : ready ? "Отпустите, чтобы обновить" : "Потяните вниз"}
          </span>
        </div>

        {/* ---- кто вошёл ---- */}
        <header className="pgh-user">
          <div className="pgh-user__ava">{initials(name)}</div>
          <div className="pgh-user__t">
            <div className="pgh-user__n">{name}</div>
            <div className="pgh-user__r">{ROLE_LABEL[role] || "—"}</div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon="logout"
            onClick={() => setLogoutOpen(true)}
            aria-label="Выйти"
          />
        </header>

        {/* ---- главная цифра ---- */}
        <div className="pgh-hero">
          <div className="pgh-hero__label">Активных защит</div>
          {firstLoad ? (
            <div className="pgh-hero__skeleton">
              <Skeleton height={52} width={110} radius={12} />
            </div>
          ) : (
            <div className="pgh-hero__value pg-num">{fmtNumber(summary.count)}</div>
          )}
          <div className="pgh-hero__sub">
            <Badge plain className="pg-num">{fmtArea(summary.area)} под защитой</Badge>
            {summary.expiring.length > 0 && (
              <Badge tone="warning" className="pg-num">
                {summary.expiring.length}{" "}
                {plural(summary.expiring.length, "истекает", "истекают", "истекают")}
              </Badge>
            )}
          </div>
        </div>

        {/* ---- быстрые действия ---- */}
        <div className="pgh-qa">
          <button type="button" className="pgh-qa__i pgh-qa__i--primary" onClick={onCreate}>
            <span className="pgh-qa__ic"><Icon name="plus" size={19} /></span>
            Создать
          </button>
          <button type="button" className="pgh-qa__i" onClick={() => onList()}>
            <span className="pgh-qa__ic"><Icon name="search" size={19} /></span>
            Найти
          </button>
          <button
            type="button"
            className="pgh-qa__i pgh-qa__i--warning"
            onClick={() => onList({ expiring: true })}
            disabled={summary.expiring.length === 0}
          >
            <span className="pgh-qa__ic">
              <Icon name="clock" size={19} />
              {summary.expiring.length > 0 && (
                <span className="pgh-qa__badge pg-num">{summary.expiring.length}</span>
              )}
            </span>
            Истекают
          </button>
          <button type="button" className="pgh-qa__i" onClick={onExport}>
            <span className="pgh-qa__ic"><Icon name="download" size={19} /></span>
            Выгрузка
          </button>
        </div>

        {/* ---- требуют внимания ---- */}
        {firstLoad ? (
          <section className="pgh-sect">
            <div className="pgh-sect__h"><span>Загружаем</span></div>
            <LoadingState rows={2} />
          </section>
        ) : (
          <>
            {attention.length > 0 && (
              <section className="pgh-sect">
                <div className="pgh-sect__h">
                  <span>Требуют внимания</span>
                  {summary.expiring.length > attention.length && (
                    <button type="button" className="pgh-link" onClick={() => onList({ expiring: true })}>
                      Все <Icon name="chevronRight" size={14} />
                    </button>
                  )}
                </div>
                <div className="pgl-cards">
                  {attention.map((it) => (
                    <ProtectionCard key={it.id} item={it} onOpen={openItem} />
                  ))}
                </div>
              </section>
            )}

            <section className="pgh-sect">
              <div className="pgh-sect__h">
                <span>{attention.length > 0 ? "Недавние" : "Активные защиты"}</span>
                {active.length > recent.length && (
                  <button type="button" className="pgh-link" onClick={() => onList()}>
                    Все <Icon name="chevronRight" size={14} />
                  </button>
                )}
              </div>
              {recent.length === 0 ? (
                <EmptyState
                  icon="shield"
                  title="Активных защит нет"
                  text="Создайте первую — она появится здесь."
                  action={
                    <Button variant="primary" size="sm" icon="plus" onClick={onCreate}>
                      Создать защиту
                    </Button>
                  }
                />
              ) : (
                <div className="pgl-cards">
                  {recent.map((it) => (
                    <ProtectionCard key={it.id} item={it} onOpen={openItem} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        <div className="pgh__pad" />
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

      {sheets && <ActionSheets {...sheets} />}

      {newDetail && detailItem && (
        <ProtectionDetail
          item={detailItem}
          auth={auth}
          onBack={() => setDetailId(null)}
          act={act}
          openEditModal={openEditModal}
          restoreProtection={restoreProtection}
        />
      )}
    </div>
  );
}
