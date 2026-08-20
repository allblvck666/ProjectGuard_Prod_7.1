// frontend/src/pg/ArchiveList.jsx
// ============================================================
// Этап 6 — архив защит (флаг ?ui-archive=new).
// Те же данные, что у старого экрана: App грузит неактивные защиты
// для маршрута archive. Тап по карточке открывает карточку защиты.
// ============================================================

import { useMemo, useState } from "react";
import {
  Badge, Button, Card, EmptyState, ErrorState, Icon, Input, LoadingState, Segment,
} from "./ui";
import {
  fmtArea, fmtDateShort, plural, shortName, skuShort, statusBadge, statusKind,
} from "./format";
import { usePullToRefresh } from "./usePullToRefresh";
import {
  BACK_PRIORITY, haptic, isTelegramApp, useBackButton, useDisableVerticalSwipes,
} from "./telegram";
import "./list.css";

const TABS = [
  { value: "all", label: "Все" },
  { value: "success", label: "Успешные" },
  { value: "closed", label: "Закрытые" },
  { value: "deleted", label: "Удалённые" },
];

function ArchiveCard({ item, onOpen }) {
  const badge = statusBadge(item);
  const kind = statusKind(item);
  const note = item.success_doc
    ? `1С ${item.success_doc}`
    : item.close_reason || item.delete_reason || "";

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

      <div className="pgl-card__foot pgl-card__foot--archive">
        <span className="pgl-card__note">{note || "Без комментария"}</span>
        <span className="pgl-card__days pg-num">
          {fmtDateShort(item.closed_at || item.expires_at)}
        </span>
      </div>
    </Card>
  );
}

export default function ArchiveList({
  items, loading, loadError, load, onBack, onOpenDetail, managers, auth,
}) {
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");

  useBackButton(onBack, true, BACK_PRIORITY.screen);
  useDisableVerticalSwipes(true);
  const { scrollRef, pull, refreshing, dragging, ready } = usePullToRefresh(load);

  const archived = useMemo(
    () => (Array.isArray(items) ? items : []).filter((it) => it.status !== "active"),
    [items]
  );

  const counts = useMemo(() => {
    const acc = { all: archived.length, success: 0, closed: 0, deleted: 0 };
    archived.forEach((it) => {
      const kind = statusKind(it);
      if (kind === "success") acc.success += 1;
      else if (kind === "deleted") acc.deleted += 1;
      else acc.closed += 1;
    });
    return acc;
  }, [archived]);

  const filtered = useMemo(() => {
    let result = archived;
    if (tab !== "all") result = result.filter((it) => statusKind(it) === tab);

    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (it) =>
          (it.client || "").toLowerCase().includes(q) ||
          (it.partner || "").toLowerCase().includes(q) ||
          (it.sku || "").toLowerCase().includes(q) ||
          (it.manager || "").toLowerCase().includes(q)
      );
    }

    // Свежие сверху: сначала по дате закрытия, потом по сроку
    return [...result].sort((a, b) => {
      const da = new Date(a.closed_at || a.expires_at || 0).getTime();
      const db = new Date(b.closed_at || b.expires_at || 0).getTime();
      return db - da;
    });
  }, [archived, tab, search]);

  const body = () => {
    if (loading && filtered.length === 0) return <LoadingState rows={4} />;
    if (loadError && archived.length === 0) return <ErrorState text={loadError} onRetry={load} />;
    if (filtered.length > 0) {
      return (
        <div className="pgl-cards">
          {filtered.map((it) => (
            <ArchiveCard key={it.id} item={it} onOpen={onOpenDetail} />
          ))}
        </div>
      );
    }
    if (archived.length === 0) {
      return (
        <EmptyState
          icon="archive"
          title="Архив пуст"
          text="Сюда попадают закрытые, успешные и удалённые защиты."
        />
      );
    }
    return (
      <EmptyState
        icon="search"
        title="Ничего не найдено"
        text={`Под фильтры не попала ни одна защита. Всего в архиве — ${archived.length}.`}
        action={
          <Button
            variant="secondary"
            size="sm"
            icon="close"
            onClick={() => {
              setSearch("");
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
          options={TABS}
          className="pgl-segment--wide"
        />

        <div className="pg-search">
          <Icon name="search" size={18} className="pg-search__ic" />
          <Input
            placeholder="Партнёр, клиент, артикул или менеджер"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Поиск по архиву"
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
              aria-label="Обновить архив"
            >
              <Icon name="refresh" size={16} className={loading || refreshing ? "pg-spin" : ""} />
            </button>
          )}
        </div>

        <div className="pgl-chips">
          <span className="pgl-chips__count pg-num">
            {filtered.length} {plural(filtered.length, "защита", "защиты", "защит")}
            {tab !== "all" && counts.all > 0 && ` из ${counts.all}`}
          </span>
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

        {body()}
        <div className="pgl__pad" />
      </div>
    </div>
  );
}
