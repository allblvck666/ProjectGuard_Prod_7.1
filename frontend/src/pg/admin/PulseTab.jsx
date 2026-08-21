// frontend/src/pg/admin/PulseTab.jsx
// Пульс: сводка по защитам за период и топ-разрезы.
// Источник тот же, что у старой вкладки — /api/protections.

import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { Badge, Card, EmptyState, ErrorState, Icon, LoadingState, Segment, Track } from "../ui";
import { fmtArea, fmtNumber, parseSkuCodes, plural } from "../format";
import { errText } from "../errors";

const PERIODS = [
  { value: "today", label: "Сегодня" },
  { value: "week", label: "7 дней" },
  { value: "month", label: "30 дней" },
  { value: "all", label: "Всё" },
];

const CUTS = [
  { value: "cities", label: "Города" },
  { value: "partners", label: "Партнёры" },
  { value: "skus", label: "Артикулы" },
];

function cutoffFor(period) {
  const now = new Date();
  if (period === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (period === "week") return now.getTime() - 7 * 86400000;
  if (period === "month") return now.getTime() - 30 * 86400000;
  return 0;
}

function topBy(rows, keyFn, limit = 6) {
  const map = new Map();
  rows.forEach((p) => {
    const keys = keyFn(p);
    (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
      if (!key) return;
      const prev = map.get(key) || { count: 0, area: 0 };
      prev.count += 1;
      prev.area += Number(p.area_m2) || 0;
      map.set(key, prev);
    });
  });
  return [...map.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.count - a.count || b.area - a.area)
    .slice(0, limit);
}

export default function PulseTab() {
  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(null);
  const [period, setPeriod] = useState("week");
  const [cut, setCut] = useState("cities");

  const load = () => {
    setFailed(null);
    setRows(null);
    api
      .get("/api/protections")
      .then((r) => setRows(Array.isArray(r.data) ? r.data : []))
      .catch((e) => setFailed(errText(e, "Не удалось загрузить защиты")));
  };

  useEffect(load, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const cutoff = cutoffFor(period);
    if (!cutoff) return rows;
    return rows.filter((p) => new Date(p.created_at).getTime() >= cutoff);
  }, [rows, period]);

  const stats = useMemo(() => {
    const acc = {
      total: filtered.length, active: 0, success: 0, closed: 0, pending: 0,
      area: 0, cities: new Set(), managers: new Set(),
    };
    filtered.forEach((p) => {
      if (p.status === "active") acc.active += 1;
      else if (p.status === "success") acc.success += 1;
      else if (p.status === "pending") acc.pending += 1;
      else acc.closed += 1;
      acc.area += Number(p.area_m2) || 0;
      const city = p.partner_city || p.object_city;
      if (city) acc.cities.add(city);
      if (p.manager) acc.managers.add(p.manager);
    });
    return acc;
  }, [filtered]);

  const top = useMemo(() => {
    if (cut === "partners") return topBy(filtered, (p) => p.partner);
    if (cut === "skus") return topBy(filtered, (p) => parseSkuCodes(p.sku));
    return topBy(filtered, (p) => p.partner_city || p.object_city);
  }, [filtered, cut]);

  const maxCount = top.reduce((m, t) => Math.max(m, t.count), 0) || 1;
  const rate = stats.total ? Math.round((stats.success / stats.total) * 100) : 0;

  if (failed) return <div className="pga__pad-top"><ErrorState text={failed} onRetry={load} /></div>;
  if (rows === null) return <div className="pga__pad-top"><LoadingState rows={3} /></div>;

  return (
    <div className="pga__pad-top">
      <Segment value={period} onChange={setPeriod} options={PERIODS} />

      <div className="pga-section">
        <div className="pga-metrics">
          <div className="pga-metric">
            <div className="pga-metric__l"><Icon name="shield" size={13} /> Всего защит</div>
            <div className="pga-metric__v pg-num">{fmtNumber(stats.total)}</div>
            <div className="pga-metric__s pg-num">{fmtArea(stats.area)}</div>
          </div>
          <div className="pga-metric pga-metric--success">
            <div className="pga-metric__l"><Icon name="checkCircle" size={13} /> Успешных</div>
            <div className="pga-metric__v pg-num">{fmtNumber(stats.success)}</div>
            <div className="pga-metric__s pg-num">{rate}% конверсия</div>
          </div>
          <div className="pga-metric pga-metric--warning">
            <div className="pga-metric__l"><Icon name="clock" size={13} /> Активных</div>
            <div className="pga-metric__v pg-num">{fmtNumber(stats.active)}</div>
            <div className="pga-metric__s pg-num">
              {stats.pending ? `${stats.pending} на проверке` : "без заявок"}
            </div>
          </div>
          <div className="pga-metric pga-metric--danger">
            <div className="pga-metric__l"><Icon name="close" size={13} /> Закрытых</div>
            <div className="pga-metric__v pg-num">{fmtNumber(stats.closed)}</div>
            <div className="pga-metric__s pg-num">
              {stats.cities.size} {plural(stats.cities.size, "город", "города", "городов")}
            </div>
          </div>
        </div>
      </div>

      <div className="pga-section">
        <div className="pga-section__h">
          <span>Разрез</span>
          <Badge plain className="pg-num">
            {stats.managers.size} {plural(stats.managers.size, "менеджер", "менеджера", "менеджеров")}
          </Badge>
        </div>

        <div className="pg-chips" style={{ marginBottom: 12 }}>
          {CUTS.map((c) => (
            <button key={c.value} type="button" className="pg-chip" onClick={() => setCut(c.value)}>
              <Badge tone={cut === c.value ? "accent" : undefined} plain>{c.label}</Badge>
            </button>
          ))}
        </div>

        {top.length === 0 ? (
          <EmptyState
            icon="chart"
            title="За период пусто"
            text="Выберите другой период — защит в этом окне не создавалось."
          />
        ) : (
          <Card>
            <div className="pga-top">
              {top.map((t) => (
                <div className="pga-top__i" key={t.name}>
                  <div className="pga-top__h">
                    <span className="pga-top__n">{t.name}</span>
                    <span className="pga-top__v pg-num">
                      {t.count} · {fmtArea(t.area)}
                    </span>
                  </div>
                  <Track value={(t.count / maxCount) * 100} />
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
