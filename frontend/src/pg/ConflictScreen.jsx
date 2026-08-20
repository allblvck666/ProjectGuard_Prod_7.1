// frontend/src/pg/ConflictScreen.jsx
// ============================================================
// Этап 4 — экран конфликта. Дубликат = тот же артикул и метраж в
// пределах ±10% от действующей защиты (правило проверяет бэкенд).
// Показываем, кто держит объект, дилера, клиента, метраж и до какого
// числа действует защита, чтобы менеджеру было с чем идти к коллеге.
// ============================================================

import { useMemo, useState } from "react";
import { Badge, Button, Card, Field, Icon, KV, Textarea } from "./ui";
import {
  daysLeftText, fmtArea, fmtDate, fmtNumber, maskPhone, parseSkuCodes, shortName,
} from "./format";
import { BACK_PRIORITY, isTelegramApp, useBackButton } from "./telegram";
import "./create.css";

// Насколько метраж действующей защиты отличается от нашего
function areaDelta(mine, theirs) {
  const a = Number(mine);
  const b = Number(theirs);
  if (!a || !b) return null;
  const pct = ((b - a) / a) * 100;
  if (Math.abs(pct) < 0.1) return "совпадает";
  const sign = pct > 0 ? "+" : "−";
  return `${sign}${fmtNumber(Math.abs(pct))}%`;
}

function daysUntil(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const diff = Math.ceil((d - Date.now()) / 86400000);
  return diff >= 0 ? diff : null;
}

export default function ConflictScreen({
  similar,          // detail.similar_protection с бэкенда
  payload,          // что пытались создать
  reason,           // причина (для запроса админу или ручного пропуска)
  setReason,
  isAdmin,
  onBack,           // «Изменить данные» — вернуться к форме
  onRequest,        // отправить запрос админу
  onSkip,           // пропустить вручную (админ)
  fallbackMessage,  // текст с бэкенда, если similar_protection не пришёл
}) {
  const [busy, setBusy] = useState(null);

  useBackButton(onBack, true, BACK_PRIORITY.overlay);

  const myArea = payload?.area_m2
    ? Number(payload.area_m2)
    : (payload?.sku_data || []).reduce((sum, s) => sum + Number(s.area || 0), 0);

  // Какой именно артикул пересёкся — по нему бэкенд и нашёл дубликат
  const clashSku = useMemo(() => {
    const mine = new Set(
      (payload?.sku_data || []).map((s) => String(s.sku || "").toUpperCase())
    );
    const theirs = parseSkuCodes(similar?.sku);
    return theirs.find((code) => mine.has(code.toUpperCase())) || theirs[0] || null;
  }, [payload, similar]);

  const left = daysUntil(similar?.expires_at);
  const delta = areaDelta(myArea, similar?.area_m2);
  const holder = similar?.creator_name && similar.creator_name !== "—"
    ? similar.creator_name
    : similar?.manager;

  const run = async (kind, fn) => {
    setBusy(kind);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const reasonReady = String(reason || "").trim().length > 0;

  return (
    <div className="pgc pgc--conflict">
      {!isTelegramApp() && (
        <div className="pgc__fallback">
          <Button variant="ghost" size="sm" icon="chevronLeft" onClick={onBack}>
            Назад
          </Button>
        </div>
      )}

      <div className="pgc__scroll">
        <div className="pgcf__top">
          <div className="pgcf__ic">
            <Icon name="ban" size={28} />
          </div>
          <h2 className="pgcf__title">Объект уже защищён</h2>
          <div className="pgcf__text">
            {similar ? (
              <>
                Артикул <b>{clashSku || "—"}</b> с метражом{" "}
                <b className="pg-num">{fmtArea(myArea)}</b> попадает в диапазон ±10%
                действующей защиты. Создать вторую нельзя.
              </>
            ) : (
              fallbackMessage || "Похожая активная защита уже существует."
            )}
          </div>
        </div>

        {similar && (
          <Card status="active">
            <div className="pgcf__partner">
              <div className="pgcf__partner-n">{similar.partner || "Партнёр не указан"}</div>
              <Badge tone="success">Активна</Badge>
            </div>
            {similar.partner_city && similar.partner_city !== "—" && (
              <div className="pgcf__partner-c">{similar.partner_city}</div>
            )}

            <div className="pgcf__kv">
              <KV k="Держит">{holder || "—"}</KV>
              {similar.manager && holder !== similar.manager && (
                <KV k="Менеджер">{similar.manager}</KV>
              )}
              <KV k="Клиент">{similar.client || "—"}</KV>
              {similar.object_city && similar.object_city !== "—" && (
                <KV k="Город объекта">{similar.object_city}</KV>
              )}
              <KV k="Артикул">{parseSkuCodes(similar.sku).join(", ") || "—"}</KV>
              <KV k="Метраж" numeric>
                {fmtArea(similar.area_m2)}
                {delta && <span className="pgcf__delta"> ({delta})</span>}
              </KV>
              <KV k="Телефон клиента" numeric>{maskPhone(similar.last4)}</KV>
              <KV k="Действует до" numeric>
                {fmtDate(similar.expires_at)}
                {left != null && <span className="pgcf__left"> · {daysLeftText({ days_left: left })}</span>}
              </KV>
            </div>
          </Card>
        )}

        <div className="pgcf__acts">
          <Field
            label="Причина"
            required
            hint={
              isAdmin
                ? "Нужна и для запроса, и для ручного пропуска. Например: другой этаж объекта, согласовано с дилером"
                : "Её увидит администратор. Например: другой этаж объекта, согласовано с дилером"
            }
          >
            <Textarea
              placeholder="Опишите ситуацию"
              value={reason || ""}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>

          <Button
            variant="secondary"
            block
            icon="send"
            disabled={!reasonReady}
            loading={busy === "request"}
            onClick={() => run("request", onRequest)}
          >
            Отправить запрос админу
          </Button>

          <Button variant="ghost" block icon="arrowLeft" onClick={onBack}>
            Изменить данные
          </Button>
        </div>

        {isAdmin && (
          <div className="pgcf__admin">
            <div className="pgcf__admin-h">
              <Icon name="crown" size={14} />
              Права админа
            </div>
            <div className="pgcf__admin-t">
              Защита будет создана в обход проверки на дубликат. Причина обязательна —
              она попадёт в комментарий и в историю защиты.
            </div>
            <Button
              variant="danger-soft"
              block
              disabled={!reasonReady}
              loading={busy === "skip"}
              onClick={() => run("skip", onSkip)}
            >
              Пропустить вручную
            </Button>
            {!reasonReady && (
              <div className="pgcf__admin-hint">Без причины пропустить нельзя</div>
            )}
          </div>
        )}

        <div className="pgc__pad" />
      </div>
    </div>
  );
}
