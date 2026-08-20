// frontend/src/pg/ProtectionsList.jsx
// ============================================================
// Этап 2 — список активных защит (флаг ?ui-list=new).
// Данные, фильтры и действия те же, что у старого экрана:
// компонент получает ровно те же пропсы и вызывает те же обработчики.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Icon,
  Input, LoadingState, Segment, Sheet, Textarea, Track,
} from "./ui";
import SkuPicker from "./SkuPicker";
import {
  daysLeftText, fmtArea, fmtDateShort, managerName, plural, remainingPercent,
  shortName, skuShort, statusBadge, statusKind, trackTone,
} from "./format";
import { usePullToRefresh } from "./usePullToRefresh";
import { haptic, isTelegramApp, useBackButton, useDisableVerticalSwipes } from "./telegram";
import "./list.css";
import "./form.css";

/* ---------------- карточка списка ---------------- */

function ProtectionCard({ item, onOpen }) {
  const badge = statusBadge(item);
  const kind = statusKind(item);

  return (
    <Card status={kind} tappable onClick={() => onOpen(item)} className="pgl-card">
      <div className="pgl-card__top">
        <div className="pgl-card__partner">{item.partner || "—"}</div>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>

      <div className="pgl-card__client">{item.client || "Клиент не указан"}</div>

      <div className="pgl-card__meta">
        <span className="pgl-card__m">
          <Icon name="package" size={14} />
          {skuShort(item.sku)}
        </span>
        <span className="pgl-card__m pg-num">
          <Icon name="ruler" size={14} />
          {fmtArea(item.area_m2)}
        </span>
        <span className="pgl-card__m">
          <Icon name="user" size={14} />
          {shortName(item.manager)}
        </span>
      </div>

      <div className="pgl-card__foot">
        <Track value={remainingPercent(item)} tone={trackTone(item)} />
        <span className="pgl-card__days pg-num">
          {daysLeftText(item)} · до {fmtDateShort(item.expires_at)}
        </span>
      </div>
    </Card>
  );
}

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
  loadError,
}) {
  const [tab, setTab] = useState("my");           // "my" | "all"
  const [search, setSearch] = useState("");
  const [managerFilter, setManagerFilter] = useState("");
  const [actionsFor, setActionsFor] = useState(null);
  const [managerSheet, setManagerSheet] = useState(false);

  const role = auth?.role || auth?.user?.role || "";
  const isAdmin = role === "admin" || role === "superadmin";
  const currentUserId = auth?.user?.id || auth?.user?.user_id;
  const currentUserName = auth?.user?.full_name || auth?.user?.first_name || "";

  useBackButton(onBack);
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

    // Самые срочные — наверх: ради этого и заведён янтарный акцент
    return [...result].sort((a, b) => {
      const da = Number(a.days_left);
      const db = Number(b.days_left);
      if (Number.isFinite(da) && Number.isFinite(db) && da !== db) return da - db;
      return String(a.partner || "").localeCompare(String(b.partner || ""), "ru");
    });
  }, [items, tab, search, managerFilter, currentUserId, currentUserName]);

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
        <div className="pgl-cards">
          {filtered.map((it) => (
            <ProtectionCard key={it.id} item={it} onOpen={setActionsFor} />
          ))}
        </div>
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
      {!isTelegramApp() && (
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

        <div className="pgl-search">
          <Icon name="search" size={18} className="pgl-search__ic" />
          <Input
            placeholder="Партнёр, клиент или артикул"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Поиск по защитам"
          />
          {search ? (
            <button
              type="button"
              className="pgl-search__btn"
              onClick={() => setSearch("")}
              aria-label="Очистить поиск"
            >
              <Icon name="close" size={16} />
            </button>
          ) : (
            <button
              type="button"
              className="pgl-search__btn"
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
          {isAdmin && tab === "all" && (
            <button type="button" className="pgl-chip" onClick={() => setManagerSheet(true)}>
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
          className="pgl-ptr"
          style={{ height: pull, transition: dragging ? "none" : "height 200ms ease" }}
          aria-hidden={pull === 0}
        >
          <span className="pgl-ptr__in" style={{ opacity: Math.min(1, pull / 40) }}>
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
                <Button variant="ghost" block icon="trash" className="pgl-act__danger" onClick={() => runAction("delete")}>
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

      {/* ---- подтверждения действий ---- */}
      <Sheet
        open={!!closeModal?.open}
        title="Закрыть защиту"
        onClose={() => setCloseModal({ open: false, id: null, reason: "" })}
        actions={
          <>
            <Button variant="primary" block onClick={doClose}>Закрыть защиту</Button>
            <Button variant="ghost" block onClick={() => setCloseModal({ open: false, id: null, reason: "" })}>
              Отмена
            </Button>
          </>
        }
      >
        <Field label="Причина закрытия">
          <Input
            placeholder="Например: клиент выбрал другого поставщика"
            value={closeModal?.reason || ""}
            onChange={(e) => setCloseModal({ ...closeModal, reason: e.target.value })}
          />
        </Field>
      </Sheet>

      <Sheet
        open={!!successModal?.open}
        title="Отметить как успешную"
        onClose={() => setSuccessModal({ open: false, id: null, doc: "" })}
        actions={
          <>
            <Button variant="primary" block onClick={doSuccess}>Подтвердить</Button>
            <Button variant="ghost" block onClick={() => setSuccessModal({ open: false, id: null, doc: "" })}>
              Отмена
            </Button>
          </>
        }
      >
        <Field label="Документ 1С" hint="Необязательно — можно добавить позже">
          <Input
            placeholder="Номер документа"
            value={successModal?.doc || ""}
            onChange={(e) => setSuccessModal({ ...successModal, doc: e.target.value })}
          />
        </Field>
      </Sheet>

      <Sheet
        open={!!deleteModal?.open}
        title="Удалить защиту?"
        onClose={() => setDeleteModal({ open: false, id: null, reason: "" })}
        actions={
          <>
            <Button variant="danger" block onClick={doDelete}>Удалить</Button>
            <Button variant="ghost" block onClick={() => setDeleteModal({ open: false, id: null, reason: "" })}>
              Отмена
            </Button>
          </>
        }
      >
        <p className="pg-sheet__text">
          Защита уйдёт в архив. Восстановить её сможет только суперадмин.
        </p>
        <Field label="Причина удаления" hint="Попадёт в историю защиты">
          <Input
            placeholder="Например: дубль, создано по ошибке"
            value={deleteModal?.reason || ""}
            onChange={(e) => setDeleteModal({ ...deleteModal, reason: e.target.value })}
          />
        </Field>
      </Sheet>

      <Sheet
        open={!!extendRequestModal?.open}
        title="Запрос на продление"
        onClose={() =>
          setExtendRequestModal({ open: false, id: null, reason: "", days: 10, message: "" })
        }
        actions={
          <>
            <Button variant="primary" block icon="send" onClick={submitExtendRequest}>
              Отправить админу
            </Button>
            <Button
              variant="ghost"
              block
              onClick={() =>
                setExtendRequestModal({ open: false, id: null, reason: "", days: 10, message: "" })
              }
            >
              Отмена
            </Button>
          </>
        }
      >
        {extendRequestModal?.message && (
          <p className="pg-sheet__text">{extendRequestModal.message}</p>
        )}
        <Field label="Причина продления" required>
          <Textarea
            placeholder="Клиент ждёт оплату, перенос поставки и т.п."
            value={extendRequestModal?.reason || ""}
            onChange={(e) => setExtendRequestModal({ ...extendRequestModal, reason: e.target.value })}
          />
        </Field>
      </Sheet>

      {/* ---- редактирование ---- */}
      <Sheet
        open={!!editModal?.open}
        title="Редактировать защиту"
        onClose={() => setEditModal({ open: false, id: null })}
        actions={
          <>
            <Button variant="primary" block icon="check" onClick={submitEdit}>Сохранить</Button>
            <Button variant="ghost" block onClick={() => setEditModal({ open: false, id: null })}>
              Отмена
            </Button>
          </>
        }
      >
        <div className="pgf-group">
          <Segment
            value={editPerSkuMode ? "per" : "one"}
            onChange={(v) => setEditPerSkuMode(v === "per")}
            options={[
              { value: "one", label: "Единый метраж" },
              { value: "per", label: "По артикулам" },
            ]}
          />

          <Field label="Артикулы" required>
            <SkuPicker
              skus={skus}
              selected={editSelectedSkus}
              setSelected={setEditSelectedSkus}
              perSkuMode={editPerSkuMode}
              onAreaChange={onAreaChange}
            />
          </Field>

          {!editPerSkuMode && (
            <Field label="Единый метраж (м²)" required hint="Минимум 50 м² суммарно">
              <Input
                numeric
                inputMode="numeric"
                value={editAreaUnified}
                onChange={(e) => setEditAreaUnified(e.target.value)}
              />
            </Field>
          )}

          <Field label="Комментарий">
            <Textarea
              placeholder="Необязательно"
              value={editComment}
              onChange={(e) => setEditComment(e.target.value)}
            />
          </Field>
        </div>
      </Sheet>
    </div>
  );
}
