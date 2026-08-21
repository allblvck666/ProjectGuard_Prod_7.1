// frontend/src/pg/ProtectionsList.jsx
// ============================================================
// Этап 2 — список активных защит (флаг ?ui-list=new).
// Данные, фильтры и действия те же, что у старого экрана:
// компонент получает ровно те же пропсы и вызывает те же обработчики.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import {
  Badge, Button, EmptyState, ErrorState, Icon,
  Input, LoadingState, Segment, Sheet,
} from "./ui";
import ActionSheets from "./ActionSheets";
import ProtectionDetail from "./ProtectionDetail";
import ProtectionCard from "./ProtectionCard";
import {
  EXPIRING_DAYS, daysLeftText, fmtArea, fmtDateShort, managerName, plural,
  skuShort, statusBadge,
} from "./format";
import { usePullToRefresh } from "./usePullToRefresh";
import { usePaged } from "./usePaged";
import { BACK_PRIORITY, haptic, isTelegramApp, useBackButton, useDisableVerticalSwipes } from "./telegram";
import "./list.css";

/* ---------------- экран ---------------- */

export default function ProtectionsList({
  auth, items, managers, loading, load, onBack, act, openEditModal,
  closeModal, setCloseModal, doClose,
  successModal, setSuccessModal, doSuccess,
  deleteModal, setDeleteModal, doDelete,
  editModal, setEditModal, editSelectedSkus, setEditSelectedSkus,
  editPerSkuMode, setEditPerSkuMode, editAreaUnified, setEditAreaUnified,
  editComment, setEditComment, submitEdit, skus, onAreaChange,
  extendRequestModal, setExtendRequestModal, submitExtendRequest,
  updateClosedModal, setUpdateClosedModal, updateClosedProtection,
  restoreProtection, newDetail, loadError, initialFilter, showBack = true,
}) {
  const [tab, setTab] = useState(initialFilter?.expiring ? "all" : "my"); // "my" | "all"
  // Пришли с главной по «Истекают» — сразу показываем только горящие
  const [onlyExpiring, setOnlyExpiring] = useState(!!initialFilter?.expiring);
  const [search, setSearch] = useState("");
  const [managerFilter, setManagerFilter] = useState("");
  const [actionsFor, setActionsFor] = useState(null);
  const [managerSheet, setManagerSheet] = useState(false);
  const [detailId, setDetailId] = useState(null);

  const role = auth?.role || auth?.user?.role || "";
  const isAdmin = role === "admin" || role === "superadmin";
  const currentUserId = auth?.user?.id || auth?.user?.user_id;
  const currentUserName = auth?.user?.full_name || auth?.user?.first_name || "";

  useBackButton(onBack, showBack && detailId == null, BACK_PRIORITY.screen);
  useDisableVerticalSwipes(true);

  const { scrollRef, pull, refreshing, dragging, ready } = usePullToRefresh(load);

  // Фильтрация — та же логика, что на старом экране
  const filtered = useMemo(() => {
    let result = Array.isArray(items) ? items : [];

    if (tab === "my") {
      result = result.filter((it) => {
        if (it.manager_id && currentUserId) return it.manager_id === currentUserId;
        return it.manager === currentUserName;
      });
    }

    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (it) =>
          (it.client || "").toLowerCase().includes(q) ||
          (it.partner || "").toLowerCase().includes(q) ||
          (it.sku || "").toLowerCase().includes(q)
      );
    }

    if (managerFilter && tab === "all") {
      result = result.filter((it) => it.manager === managerFilter);
    }

    if (onlyExpiring) {
      result = result.filter((it) => Number(it.days_left) <= EXPIRING_DAYS);
    }

    // Самые срочные — наверх: ради этого и заведён янтарный акцент
    return [...result].sort((a, b) => {
      const da = Number(a.days_left);
      const db = Number(b.days_left);
      if (Number.isFinite(da) && Number.isFinite(db) && da !== db) return da - db;
      return String(a.partner || "").localeCompare(String(b.partner || ""), "ru");
    });
  }, [items, tab, search, managerFilter, onlyExpiring, currentUserId, currentUserName]);

  // В фильтре показываем справочник менеджеров плюс тех, кто встречается в защитах
  const managerOptions = useMemo(() => {
    const names = new Set();
    (Array.isArray(managers) ? managers : []).forEach((m) => {
      const name = managerName(m);
      if (name) names.add(name);
    });
    (Array.isArray(items) ? items : []).forEach((it) => {
      if (it.manager) names.add(it.manager);
    });
    return [...names].sort((a, b) => a.localeCompare(b, "ru"));
  }, [managers, items]);

  // Фильтр по менеджеру живёт только на вкладке «Все» — как и раньше
  useEffect(() => {
    if (tab !== "all" && managerFilter) setManagerFilter("");
  }, [tab, managerFilter]);

  // Карточка защиты открывается поверх списка: список остаётся смонтированным,
  // фильтры и позиция прокрутки не теряются. Если защита исчезла из выдачи
  // (удалили, закрыли) — карточка закрывается сама.
  const detailItem = useMemo(
    () => (detailId == null ? null : (items || []).find((it) => it.id === detailId) || null),
    [items, detailId]
  );
  useEffect(() => {
    if (detailId != null && !detailItem && !loading) setDetailId(null);
  }, [detailId, detailItem, loading]);

  const openItem = (item) => {
    if (newDetail) setDetailId(item.id);
    else setActionsFor(item);
  };

  // Список рисуем страницами: при сотнях защит иначе тормозит прокрутка
  const paged = usePaged(filtered, `${tab}|${search}|${managerFilter}|${onlyExpiring}`);

  const closeActions = () => setActionsFor(null);

  const runAction = (what) => {
    const item = actionsFor;
    if (!item) return;
    closeActions();
    haptic("select");
    if (what === "edit") openEditModal(item);
    else act(item.id, what);
  };

  const total = Array.isArray(items) ? items.length : 0;
  const canDelete = (item) =>
    isAdmin || (item?.manager_id && currentUserId && item.manager_id === currentUserId);

  const listBody = () => {
    if (loading && filtered.length === 0) return <LoadingState rows={4} />;
    if (loadError && total === 0) return <ErrorState text={loadError} onRetry={load} />;
    if (filtered.length > 0) {
      return (
        <>
          <div className="pgl-cards">
            {paged.visible.map((it) => (
              <ProtectionCard key={it.id} item={it} onOpen={openItem} />
            ))}
          </div>
          {paged.hasMore && (
            <div className="pgl-more">
              <Button variant="secondary" block icon="chevronDown" onClick={paged.showMore}>
                {paged.moreLabel}
              </Button>
            </div>
          )}
        </>
      );
    }
    if (total === 0) {
      return (
        <EmptyState
          icon="shield"
          title={tab === "my" ? "У вас нет активных защит" : "Активных защит нет"}
          text="Как только защита будет создана, она появится в этом списке."
        />
      );
    }

    // Частый случай: защиты есть, но за пользователем не числятся —
    // у старых записей не проставлен manager_id. Пустой экран без
    // объяснения выглядит как поломка, поэтому предлагаем «Все».
    if (tab === "my" && !search && !onlyExpiring) {
      return (
        <EmptyState
          icon="shield"
          title="За вами защит не числится"
          text={`Всего активных — ${total}. Возможно, они оформлены на другого менеджера.`}
          action={
            <Button variant="primary" size="sm" icon="shield" onClick={() => setTab("all")}>
              Показать все
            </Button>
          }
        />
      );
    }
    return (
      <EmptyState
        icon="search"
        title="Ничего не найдено"
        text={`Под фильтры не попала ни одна защита. Всего активных — ${total}.`}
        action={
          <Button
            variant="secondary"
            size="sm"
            icon="close"
            onClick={() => {
              setSearch("");
              setManagerFilter("");
              setOnlyExpiring(false);
              setTab("all");
            }}
          >
            Сбросить фильтры
          </Button>
        }
      />
    );
  };

  return (
    <div className="pgl">
      {!isTelegramApp() && showBack && (
        // В браузере нативной шапки Telegram нет — оставляем минимальный выход
        <div className="pgl__fallback">
          <Button variant="ghost" size="sm" icon="chevronLeft" onClick={onBack}>
            Назад
          </Button>
        </div>
      )}

      <div className="pgl__stuck">
        <Segment
          value={tab}
          onChange={(v) => {
            setTab(v);
            haptic("select");
          }}
          options={[
            { value: "my", label: "Мои" },
            { value: "all", label: "Все" },
          ]}
        />

        <div className="pg-search">
          <Icon name="search" size={18} className="pg-search__ic" />
          <Input
            placeholder="Партнёр, клиент или артикул"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Поиск по защитам"
          />
          {search ? (
            <button
              type="button"
              className="pg-search__btn"
              onClick={() => setSearch("")}
              aria-label="Очистить поиск"
            >
              <Icon name="close" size={16} />
            </button>
          ) : (
            <button
              type="button"
              className="pg-search__btn"
              onClick={load}
              disabled={loading || refreshing}
              aria-label="Обновить список"
            >
              <Icon name="refresh" size={16} className={loading || refreshing ? "pg-spin" : ""} />
            </button>
          )}
        </div>

        <div className="pgl-chips">
          <span className="pgl-chips__count pg-num">
            {filtered.length} {plural(filtered.length, "защита", "защиты", "защит")}
          </span>
          <button
            type="button"
            className="pg-chip"
            onClick={() => setOnlyExpiring((v) => !v)}
          >
            <Badge tone={onlyExpiring ? "warning" : undefined} plain>
              Истекают
              {onlyExpiring && <Icon name="close" size={12} />}
            </Badge>
          </button>
          {isAdmin && tab === "all" && (
            <button type="button" className="pg-chip" onClick={() => setManagerSheet(true)}>
              <Badge tone={managerFilter ? "accent" : undefined} plain>
                {managerFilter ? `Менеджер: ${managerFilter}` : "Менеджер: все"}
                <Icon name="chevronDown" size={12} />
              </Badge>
            </button>
          )}
        </div>
      </div>

      <div className="pgl__scroll" ref={scrollRef}>
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

        {listBody()}
        <div className="pgl__pad" />
      </div>

      {/* ---- действия по защите: карточка их больше не показывает ---- */}
      <Sheet
        open={!!actionsFor}
        title={actionsFor?.partner || "Защита"}
        onClose={closeActions}
      >
        {actionsFor && (
          <>
            <div className="pgl-act__sub">
              {[actionsFor.client, skuShort(actionsFor.sku), fmtArea(actionsFor.area_m2)]
                .filter(Boolean)
                .join(" · ")}
            </div>
            <div className="pgl-act__meta">
              <Badge tone={statusBadge(actionsFor).tone}>{statusBadge(actionsFor).label}</Badge>
              <Badge plain className="pg-num">
                {daysLeftText(actionsFor)} · до {fmtDateShort(actionsFor.expires_at)}
              </Badge>
            </div>

            <div className="pgl-act__list">
              <Button variant="primary" block icon="hourglass" onClick={() => runAction("extend")}>
                Продлить срок
              </Button>
              <Button variant="secondary" block icon="checkCircle" onClick={() => runAction("success")}>
                Успешно (1С)
              </Button>
              <Button variant="secondary" block icon="close" onClick={() => runAction("close")}>
                Закрыть защиту
              </Button>
              <Button variant="ghost" block icon="edit" onClick={() => runAction("edit")}>
                Редактировать
              </Button>
              {canDelete(actionsFor) && (
                <Button variant="ghost" block icon="trash" className="pg-btn--danger-text" onClick={() => runAction("delete")}>
                  Удалить
                </Button>
              )}
            </div>
          </>
        )}
      </Sheet>

      {/* ---- фильтр по менеджеру (админ) ---- */}
      <Sheet open={managerSheet} title="Менеджер" onClose={() => setManagerSheet(false)}>
        <div className="pgl-opts">
          <button
            type="button"
            className="pgl-opt"
            aria-selected={!managerFilter}
            onClick={() => {
              setManagerFilter("");
              setManagerSheet(false);
            }}
          >
            <span>Все менеджеры</span>
            {!managerFilter && <Icon name="check" size={16} />}
          </button>
          {managerOptions.map((name, i) => (
            <button
              type="button"
              className="pgl-opt"
              key={`${name}-${i}`}
              aria-selected={managerFilter === name}
              onClick={() => {
                setManagerFilter(name);
                setManagerSheet(false);
              }}
            >
              <span>{name}</span>
              {managerFilter === name && <Icon name="check" size={16} />}
            </button>
          ))}
        </div>
      </Sheet>

      <ActionSheets
        closeModal={closeModal}
        setCloseModal={setCloseModal}
        doClose={doClose}
        successModal={successModal}
        setSuccessModal={setSuccessModal}
        doSuccess={doSuccess}
        deleteModal={deleteModal}
        setDeleteModal={setDeleteModal}
        doDelete={doDelete}
        extendRequestModal={extendRequestModal}
        setExtendRequestModal={setExtendRequestModal}
        submitExtendRequest={submitExtendRequest}
        editModal={editModal}
        setEditModal={setEditModal}
        editSelectedSkus={editSelectedSkus}
        setEditSelectedSkus={setEditSelectedSkus}
        editPerSkuMode={editPerSkuMode}
        setEditPerSkuMode={setEditPerSkuMode}
        editAreaUnified={editAreaUnified}
        setEditAreaUnified={setEditAreaUnified}
        editComment={editComment}
        setEditComment={setEditComment}
        submitEdit={submitEdit}
        skus={skus}
        onAreaChange={onAreaChange}
      />

      {detailItem && (
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
