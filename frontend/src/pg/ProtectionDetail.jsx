// frontend/src/pg/ProtectionDetail.jsx
// ============================================================
// Этап 3 — карточка защиты (флаг ?ui-detail=new).
// Открывается поверх списка или архива: список остаётся смонтированным,
// поэтому фильтры и позиция прокрутки не теряются.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Badge, Button, Card, Icon, KV, Segment, Sheet, Skeleton, Track } from "./ui";
import ActionSheets from "./ActionSheets";
import {
  fmtArea, fmtDate, fmtDateShort, maskPhone, parseSkuCodes,
  remainingPercent, statusBadge, statusKind, trackTone,
} from "./format";
import { BACK_PRIORITY, haptic, isTelegramApp, useBackButton, useMainButton } from "./telegram";
import { useNativeNav } from "./useFlags";
import "./detail.css";

// Менеджер может продлить защиту дважды — дальше только через админа
const EXTEND_LIMIT = 2;

/* ---------------- история ---------------- */

const ACTION_LABEL = {
  create: "Защита создана",
  create_pending: "Отправлена админу на проверку",
  approve: "Одобрена админом",
  reject: "Отклонена админом",
  extend: "Продлена",
  extend_reject: "Продление отклонено",
  close: "Закрыта",
  success: "Отмечена успешной",
  delete: "Удалена",
  restore: "Восстановлена",
  edit: "Данные защиты изменены",
  update: "Данные защиты изменены",
  self_restore: "Восстановлена после истечения срока",
  auto_close: "Срок защиты истёк",
  update_closed: "Данные закрытия изменены",
};

const ACTOR_LABEL = {
  manager: "менеджер",
  admin: "админ",
  superadmin: "суперадмин",
  system: "система",
};

function historyLine(entry) {
  const p = entry.payload || {};
  const base = ACTION_LABEL[entry.action] || entry.action;

  if ((entry.action === "extend" || entry.action === "restore") && p.days) return `${base} на ${p.days} дн.`;
  if (entry.action === "close" && p.reason) return `${base}: ${p.reason}`;
  if (entry.action === "delete" && p.reason && p.reason !== "not provided") {
    return `${base}: ${p.reason}`;
  }
  if (entry.action === "success" && p.doc_1c) return `${base} · 1С ${p.doc_1c}`;
  if ((entry.action === "reject" || entry.action === "extend_reject") && p.reason) {
    return `${base}: ${p.reason}`;
  }
  if (entry.action === "create_pending" && p.reason) return `${base}: ${p.reason}`;
  return base;
}

const HISTORY_FIELDS = { manager: "Менеджер", client: "Клиент", partner: "Партнёр", partner_city: "Город партнёра", last4: "Телефон (4 цифры)", object_city: "Город объекта", address: "Адрес", sku: "Артикулы", area_m2: "Метраж", comment: "Комментарий", expires_at: "Срок", close_reason: "Причина закрытия", success_doc: "Документ 1С", status: "Статус", extend_count: "Продлений", closed_at: "Дата закрытия", auto_closed: "Автоматическое закрытие" };

function HistoryChanges({ entry }) {
  const before = entry.payload?.before;
  const after = entry.payload?.after;
  if (!before || !after) return null;
  const keys = Object.keys(after).filter((key) => HISTORY_FIELDS[key]);
  if (!keys.length) return null;
  const value = (key, input) => {
    if (input == null || input === "") return "не указано";
    if (key.endsWith("_at")) return fmtDate(input);
    if (key === "area_m2") return fmtArea(input);
    if (key === "status") return ({ active: "Активна", closed: "Закрыта", success: "Успешна", deleted: "Удалена" })[input] || String(input);
    if (key === "auto_closed") return Number(input) ? "да" : "нет";
    return String(input);
  };
  return <details className="pgd-hist__changes"><summary>Что изменилось</summary>{keys.map((key) => <div key={key}><strong>{HISTORY_FIELDS[key]}</strong><span>{value(key, before[key])} → {value(key, after[key])}</span></div>)}</details>;
}

function History({ protectionId }) {
  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setRows(null);
    setFailed(false);
    api
      .get("/api/history", { params: { protection_id: protectionId } })
      .then((r) => {
        if (!alive) return;
        const data = Array.isArray(r.data) ? r.data : [];
        setRows(data.filter((x) => x.protection_id === protectionId));
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [protectionId]);

  if (failed) {
    return <div className="pgd-hist__empty">Историю сейчас не загрузить</div>;
  }
  if (rows === null) {
    return (
      <div className="pgd-hist">
        {[0, 1, 2].map((i) => (
          <div className="pgd-hist__row" key={i}>
            <Skeleton height={12} width={40} />
            <Skeleton height={12} width="60%" />
          </div>
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return <div className="pgd-hist__empty">Записей пока нет</div>;
  }

  return (
    <div className="pgd-hist">
      {rows.map((entry) => (
        <div className="pgd-hist__row" key={entry.id}>
          <span className="pgd-hist__d pg-num">{fmtDateShort(entry.at)}</span>
          <span className="pgd-hist__t">
            {historyLine(entry)}
            <i>{entry.payload?.actor_role ? `${ACTOR_LABEL[entry.payload.actor_role] || entry.payload.actor_role} · сотрудник №${entry.payload.actor_id || entry.actor}` : ACTOR_LABEL[entry.actor] || entry.actor}</i>
            <HistoryChanges entry={entry} />
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------------- экран ---------------- */

export default function ProtectionDetail({ item, auth, onBack, act, openEditModal, restoreProtection, sheets }) {
  const [restoring, setRestoring] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreDays, setRestoreDays] = useState(10);

  const nativeNav = useNativeNav();
  useBackButton(onBack, true, BACK_PRIORITY.overlay);

  const role = auth?.role || auth?.user?.role || "";
  const isAdmin = role === "admin" || role === "superadmin";
  const isSuperadmin = role === "superadmin";
  const currentUserId = auth?.user?.id || auth?.user?.user_id;
  const isAuthor = !!(item?.manager_id && currentUserId && String(item.manager_id) === String(currentUserId));

  const canManage = item?.can_edit ?? (isAdmin || isAuthor);
  const expiredClosed = item?.status === "closed" && Number(item.auto_closed) === 1;
  const canRestore = item?.can_restore ?? (isSuperadmin && item?.status !== "active");
  const needsRestoreApproval = !!item?.restore_requires_admin;

  const kind = statusKind(item);
  const badge = statusBadge(item);
  const isActive = item?.status === "active";
  const isArchived = !isActive;

  const skuCodes = useMemo(() => parseSkuCodes(item?.sku), [item?.sku]);
  const extendCount = Number(item?.extend_count) || 0;
  const daysLeft = Number(item?.days_left);

  const run = (what) => {
    haptic("select");
    if (what === "edit") openEditModal(item);
    else act(item.id, what);
  };

  // Продление — главное действие карточки, поэтому уезжает в нижнюю
  // кнопку Telegram; в браузере остаётся кнопкой в странице
  useMainButton({
    text: "Продлить срок",
    onClick: () => run("extend"),
    visible: nativeNav && isActive && canManage,
  });

  const onRestore = async () => {
    if (needsRestoreApproval && sheets?.setExtendRequestModal) {
      setRestoreOpen(false);
      sheets.setExtendRequestModal({ open: true, id: item.id, days: restoreDays, reason: "", message: "Два самостоятельных продления использованы. Запросите восстановление с сохранением истории у администратора." });
      return;
    }
    setRestoring(true);
    const ok = await restoreProtection(item.id, restoreDays, isSuperadmin && !expiredClosed);
    setRestoring(false);
    if (ok) setRestoreOpen(false);
    if (ok) {
      haptic("success");
      onBack();
    }
  };

  return (
    <div className="pgd">
      {!isTelegramApp() && (
        <div className="pgd__fallback">
          <Button variant="ghost" size="sm" icon="chevronLeft" onClick={onBack}>
            Назад
          </Button>
        </div>
      )}

      <div className="pgd__scroll">
        <header className="pgd__head">
          <div className="pgd__badges">
            <Badge tone={badge.tone}>{badge.label}</Badge>
            <Badge plain className="pg-num">
              Продлений {extendCount}/{EXTEND_LIMIT}
            </Badge>
          </div>
          <h2 className="pgd__title">{item.partner || "Без партнёра"}</h2>
          <div className="pgd__sub">
            {[item.partner_city, item.client].filter(Boolean).join(" · ") || "—"}
          </div>
        </header>

        {/* ---- срок ---- */}
        <Card className="pgd__timer">
          {isActive ? (
            <>
              <div className="pgd__days">
                <span className="pg-num">{Number.isFinite(daysLeft) ? Math.max(0, daysLeft) : "—"}</span>{" "}
                {daysLeft <= 0 ? "дней — срок вышел" : "дн. до закрытия"}
              </div>
              <Track value={remainingPercent(item)} tone={trackTone(item)} />
              <div className="pgd__dates pg-num">
                <span>Открыта {fmtDateShort(item.created_at)}</span>
                <span>Закроется {fmtDateShort(item.expires_at)}</span>
              </div>
            </>
          ) : (
            <div className="pgd__dates pg-num">
              <span>Открыта {fmtDate(item.created_at)}</span>
              <span>
                {kind === "success" ? "Завершена" : kind === "deleted" ? "Удалена" : "Закрыта"}{" "}
                {fmtDate(item.closed_at || item.expires_at)}
              </span>
            </div>
          )}
        </Card>

        {/* ---- факты ---- */}
        <Card className="pgd__facts">
          <KV k={skuCodes.length > 1 ? "Артикулы" : "Артикул"}>
            {skuCodes.length ? skuCodes.join(", ") : "—"}
          </KV>
          <KV k="Метраж" numeric>{fmtArea(item.area_m2)}</KV>
          <KV k="Телефон клиента" numeric>{maskPhone(item.last4)}</KV>
          {item.object_city && <KV k="Город объекта">{item.object_city}</KV>}
          {item.address && <KV k="Адрес объекта">{item.address}</KV>}
          <KV k="Менеджер">{item.manager || "—"}</KV>
          {item.creator_name && item.creator_name !== item.manager && (
            <KV k="Создал">{item.creator_name}</KV>
          )}
          {item.comment && <KV k="Комментарий">{item.comment}</KV>}
        </Card>

        {/* ---- итог по закрытой защите ---- */}
        {isArchived && (item.close_reason || item.success_doc || item.delete_reason) && (
          <Card className="pgd__facts">
            {item.success_doc && <KV k="Документ 1С">{item.success_doc}</KV>}
            {item.close_reason && <KV k="Причина закрытия">{item.close_reason}</KV>}
            {item.delete_reason && <KV k="Причина удаления">{item.delete_reason}</KV>}
            {item.action_actor && <KV k="Кто выполнил">{item.action_actor}</KV>}
          </Card>
        )}

        {/* ---- история ---- */}
        <section className="pgd__sect">
          <div className="pgd__sect-h">История</div>
          <Card>
            <History protectionId={item.id} />
          </Card>
        </section>

        {/* ---- действия ---- */}
        <div className="pgd__acts">
          {isActive ? (
            canManage ? <>
              {!nativeNav && (
                <Button variant="primary" block icon="hourglass" onClick={() => run("extend")}>
                  Продлить срок
                </Button>
              )}
              <div className="pgd__acts-row">
                <Button variant="secondary" icon="checkCircle" onClick={() => run("success")}>
                  Успешно (1С)
                </Button>
                <Button variant="secondary" icon="close" onClick={() => run("close")}>
                  Закрыть
                </Button>
              </div>
              <div className="pgd__acts-row">
                <Button variant="ghost" icon="edit" onClick={() => run("edit")}>
                  Редактировать
                </Button>
                {canManage && (
                  <Button variant="ghost" icon="trash" className="pg-btn--danger-text" onClick={() => run("delete")}>
                    Удалить
                  </Button>
                )}
              </div>
            </> : <div className="pgd__note"><Icon name="lock" size={14} />Изменять защиту может её менеджер, назначенный помощник или администратор.</div>
          ) : (
            <>
              {(canRestore || needsRestoreApproval) && (
                <Button
                  variant="primary"
                  block
                  icon="restore"
                  loading={restoring}
                  onClick={() => setRestoreOpen(true)}
                >
                  {needsRestoreApproval ? "Запросить восстановление" : "Восстановить защиту"}
                </Button>
              )}
              {canManage && <Button variant="ghost" block icon="edit" onClick={() => run("edit")}>Редактировать данные</Button>}
              {canManage && item.status !== "success" && sheets?.setUpdateClosedModal && (
                <div className="pgd__acts-row">
                  <Button
                    variant="secondary"
                    icon="checkCircle"
                    onClick={() =>
                      sheets.setUpdateClosedModal({
                        open: true, id: item.id, close_reason: "",
                        success_doc: item.success_doc || "", mode: "success",
                      })
                    }
                  >
                    Успешно (1С)
                  </Button>
                  <Button
                    variant="ghost"
                    icon="edit"
                    onClick={() =>
                      sheets.setUpdateClosedModal({
                        open: true, id: item.id, close_reason: item.close_reason || "",
                        success_doc: "", mode: "reason",
                      })
                    }
                  >
                    Причина
                  </Button>
                </div>
              )}
              {!canManage && !canRestore && (
                <div className="pgd__note">
                  <Icon name="lock" size={14} />
                  Защита в архиве — доступна только для просмотра.
                </div>
              )}
            </>
          )}
        </div>

        <div className="pgd__pad" />
      </div>

      <Sheet open={restoreOpen} title="Восстановить защиту" onClose={() => !restoring && setRestoreOpen(false)} actions={<>
        <Button variant="primary" block loading={restoring} onClick={onRestore}>{needsRestoreApproval ? "Перейти к запросу" : "Восстановить защиту"}</Button>
        <Button variant="ghost" block disabled={restoring} onClick={() => setRestoreOpen(false)}>Отмена</Button>
      </>}>
        <div className="pg-sheet__text">Защита вернётся в активные с тем же номером и всей историей. Новый срок начнётся с сегодняшнего дня. Перед восстановлением проверим похожие активные защиты.</div>
        <Segment value={restoreDays} onChange={setRestoreDays} options={[{ value: 10, label: "10 рабочих дней" }, { value: 30, label: "30 рабочих дней" }]} />
        {!isAdmin && <div className="pg-sheet__text">{needsRestoreApproval ? "Лимит самостоятельных продлений исчерпан. Восстановление согласует администратор." : `Восстановление использует одно из двух продлений. Сейчас использовано: ${extendCount} из ${EXTEND_LIMIT}.`}</div>}
      </Sheet>
      {sheets && <ActionSheets {...sheets} />}
    </div>
  );
}
