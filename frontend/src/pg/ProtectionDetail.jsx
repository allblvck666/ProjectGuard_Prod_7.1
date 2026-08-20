// frontend/src/pg/ProtectionDetail.jsx
// ============================================================
// Этап 3 — карточка защиты (флаг ?ui-detail=new).
// Открывается поверх списка или архива: список остаётся смонтированным,
// поэтому фильтры и позиция прокрутки не теряются.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Badge, Button, Card, Icon, KV, Skeleton, Track } from "./ui";
import ActionSheets from "./ActionSheets";
import {
  daysLeftText, fmtArea, fmtDate, fmtDateShort, maskPhone, parseSkuCodes,
  remainingPercent, statusBadge, statusKind, trackTone,
} from "./format";
import { haptic, isTelegramApp, useBackButton } from "./telegram";
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

  if (entry.action === "extend" && p.days) return `${base} на ${p.days} дн.`;
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
            <i>{ACTOR_LABEL[entry.actor] || entry.actor}</i>
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------------- экран ---------------- */

export default function ProtectionDetail({ item, auth, onBack, act, openEditModal, restoreProtection, sheets }) {
  const [restoring, setRestoring] = useState(false);

  useBackButton(onBack);

  const role = auth?.role || auth?.user?.role || "";
  const isAdmin = role === "admin" || role === "superadmin";
  const isSuperadmin = role === "superadmin";
  const currentUserId = auth?.user?.id || auth?.user?.user_id;
  const isAuthor = !!(item?.manager_id && currentUserId && item.manager_id === currentUserId);

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

  const onRestore = async () => {
    setRestoring(true);
    const ok = await restoreProtection(item.id);
    setRestoring(false);
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
            <>
              <Button variant="primary" block icon="hourglass" onClick={() => run("extend")}>
                Продлить срок
              </Button>
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
                {(isAdmin || isAuthor) && (
                  <Button variant="ghost" icon="trash" className="pgd__danger" onClick={() => run("delete")}>
                    Удалить
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              {isSuperadmin && (
                <Button
                  variant="primary"
                  block
                  icon="restore"
                  loading={restoring}
                  onClick={onRestore}
                >
                  Восстановить защиту
                </Button>
              )}
              {(isAdmin || isAuthor) && item.status !== "success" && sheets?.setUpdateClosedModal && (
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
              {!isSuperadmin && !isAdmin && !isAuthor && (
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

      {sheets && <ActionSheets {...sheets} />}
    </div>
  );
}
