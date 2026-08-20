// frontend/src/pg/StatsScreen.jsx
// ============================================================
// Этап 6 — статистика (флаг ?ui-admin=new).
// Данные те же: /api/stats отдаёт срез по менеджерам.
// ============================================================

import { useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, ErrorState, Icon, LoadingState } from "./ui";
import { fmtArea, fmtNumber, plural } from "./format";
import { BACK_PRIORITY, isTelegramApp, useBackButton } from "./telegram";
import "./stats.css";

const SORTS = [
  { value: "success", label: "По успешным" },
  { value: "rate", label: "По конверсии" },
  { value: "total", label: "По объёму" },
];

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function ManagerCard({ s, allTotal }) {
  const [open, setOpen] = useState(false);

  const total = num(s.total);
  const active = num(s.active_cnt ?? s.active);
  const success = num(s.success_cnt ?? s.success);
  const closed = num(s.closed_cnt ?? s.closed);
  const rate = num(s.rate ?? s.success_rate);
  const known = active + success + closed || 1;

  return (
    <Card className="pgs-card">
      <button
        type="button"
        className="pgs-card__head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div className="pgs-card__name">{s.manager || "—"}</div>
        <Badge
          tone={rate >= 50 ? "success" : rate >= 30 ? "warning" : undefined}
          plain
          className="pg-num"
        >
          {rate}% успеха
        </Badge>
        <Icon name={open ? "chevronDown" : "chevronRight"} size={16} className="pgs-card__chev" />
      </button>

      {/* Доля менеджера в общем объёме — сравнение между строками */}
      <div className="pgs-bar" aria-hidden="true">
        <span className="pgs-bar__seg pgs-bar__seg--success" style={{ width: `${(success / known) * 100}%` }} />
        <span className="pgs-bar__seg pgs-bar__seg--active" style={{ width: `${(active / known) * 100}%` }} />
        <span className="pgs-bar__seg pgs-bar__seg--closed" style={{ width: `${(closed / known) * 100}%` }} />
      </div>

      <div className="pgs-legend">
        <span className="pgs-legend__i pgs-legend__i--success pg-num">{success} успешных</span>
        <span className="pgs-legend__i pgs-legend__i--active pg-num">{active} активных</span>
        <span className="pgs-legend__i pgs-legend__i--closed pg-num">{closed} закрытых</span>
      </div>

      {open && (
        <div className="pgs-grid">
          <div className="pgs-grid__i">
            <span>Всего защит</span>
            <b className="pg-num">{fmtNumber(total)}</b>
          </div>
          <div className="pgs-grid__i">
            <span>Доля от всех защит</span>
            <b className="pg-num">{allTotal ? Math.round((total / allTotal) * 100) : 0}%</b>
          </div>
          <div className="pgs-grid__i">
            <span>Активные</span>
            <b className="pg-num">{fmtArea(s.active_area)}</b>
          </div>
          <div className="pgs-grid__i">
            <span>Успешные</span>
            <b className="pg-num">{fmtArea(s.success_area)}</b>
          </div>
          <div className="pgs-grid__i">
            <span>Закрытые</span>
            <b className="pg-num">{fmtArea(s.closed_area)}</b>
          </div>
          <div className="pgs-grid__i">
            <span>Конверсия</span>
            <b className="pg-num">{rate}%</b>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function StatsScreen({ stats, loading, loadError, load, onBack }) {
  const [sort, setSort] = useState("success");

  useBackButton(onBack, true, BACK_PRIORITY.screen);

  const rows = Array.isArray(stats) ? stats : [];

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, s) => {
        acc.total += num(s.total);
        acc.active += num(s.active_cnt ?? s.active);
        acc.success += num(s.success_cnt ?? s.success);
        acc.closed += num(s.closed_cnt ?? s.closed);
        acc.successArea += num(s.success_area);
        acc.activeArea += num(s.active_area);
        return acc;
      },
      { total: 0, active: 0, success: 0, closed: 0, successArea: 0, activeArea: 0 }
    );
  }, [rows]);

  const sorted = useMemo(() => {
    const list = [...rows];
    if (sort === "rate") {
      list.sort((a, b) => num(b.rate ?? b.success_rate) - num(a.rate ?? a.success_rate));
    } else if (sort === "total") {
      list.sort((a, b) => num(b.total) - num(a.total));
    } else {
      list.sort((a, b) => num(b.success_cnt ?? b.success) - num(a.success_cnt ?? a.success));
    }
    return list;
  }, [rows, sort]);

  const overallRate = totals.total ? Math.round((totals.success / totals.total) * 100) : 0;

  return (
    <div className="pgs">
      {!isTelegramApp() && (
        <div className="pgs__fallback">
          <Button variant="ghost" size="sm" icon="chevronLeft" onClick={onBack}>
            Назад
          </Button>
        </div>
      )}

      <div className="pgs__scroll">
        {loading && rows.length === 0 ? (
          <div className="pgs__pad-top">
            <LoadingState rows={3} />
          </div>
        ) : loadError && rows.length === 0 ? (
          <ErrorState text={loadError} onRetry={load} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="chart"
            title="Данных пока нет"
            text="Статистика появится, как только по менеджерам будут закрытые защиты."
          />
        ) : (
          <>
            <div className="pgs-hero">
              <div className="pgs-hero__label">Конверсия в успешные</div>
              <div className="pgs-hero__value pg-num">
                {overallRate}
                <span className="pgs-hero__unit">%</span>
              </div>
              <div className="pgs-hero__sub">
                <Badge plain className="pg-num">
                  {totals.total} {plural(totals.total, "защита", "защиты", "защит")}
                </Badge>
                <Badge tone="success" className="pg-num">
                  {totals.success} успешных
                </Badge>
                <Badge tone="warning" className="pg-num">
                  {totals.active} активных
                </Badge>
              </div>
              <div className="pgs-hero__area pg-num">
                <Icon name="ruler" size={14} />
                {fmtArea(totals.successArea)} закрыто успешно · {fmtArea(totals.activeArea)} под защитой
              </div>
            </div>

            <div className="pgs-sort">
              {SORTS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  className="pg-chip"
                  onClick={() => setSort(s.value)}
                >
                  <Badge tone={sort === s.value ? "accent" : undefined} plain>
                    {s.label}
                  </Badge>
                </button>
              ))}
            </div>

            <div className="pgs-list">
              {sorted.map((s) => (
                <ManagerCard key={s.manager} s={s} allTotal={totals.total} />
              ))}
            </div>
          </>
        )}
        <div className="pgs__pad" />
      </div>
    </div>
  );
}
