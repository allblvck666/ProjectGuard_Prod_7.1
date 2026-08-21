// frontend/src/pg/admin/RequestsTab.jsx
// Запросы на продление сверх лимита: продлить, отклонить, снять запрос.

import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Icon, Input,
  LoadingState, Sheet, Textarea,
} from "../ui";
import { fmtArea, fmtDateShort, plural, shortName, skuShort } from "../format";
import { notify } from "../notify";
import { errText } from "../errors";

export default function RequestsTab() {
  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(0);
  const [reject, setReject] = useState(null);  // { pid, reason }
  const [drop, setDrop] = useState(null);      // запрос на снятие

  const load = async () => {
    setFailed(null);
    try {
      const r = await api.get("/api/admin/extend-requests");
      setRows(Array.isArray(r.data) ? r.data : []);
    } catch (e) {
      setFailed(errText(e, "Не удалось загрузить запросы"));
      setRows([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const extend = async (req) => {
    setBusy(req.protection_id);
    try {
      await api.post(`/api/admin/protections/${req.protection_id}/extend-any`, null, {
        params: { days: req.days || 10 },
      });
      await load();
    } catch (e) {
      notify.error(errText(e, "Не удалось продлить"));
    } finally {
      setBusy(0);
    }
  };

  const doReject = async () => {
    setBusy(reject.pid);
    try {
      await api.post(`/api/admin/protections/${reject.pid}/reject-extend-request`, {
        reason: reject.reason.trim(),
      });
      setReject(null);
      await load();
    } catch (e) {
      notify.error(errText(e, "Не удалось отклонить"));
    } finally {
      setBusy(0);
    }
  };

  const doDrop = async () => {
    setBusy(drop.protection_id);
    try {
      await api.delete(`/api/admin/protections/${drop.protection_id}/delete-extend-request`);
      setDrop(null);
      await load();
    } catch (e) {
      notify.error(errText(e, "Не удалось снять запрос"));
    } finally {
      setBusy(0);
    }
  };

  const filtered = useMemo(() => {
    const list = rows || [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) =>
      [r.partner, r.manager, r.user_name, r.sku, r.reason]
        .some((v) => String(v || "").toLowerCase().includes(q))
    );
  }, [rows, search]);

  if (failed && !rows?.length) {
    return <div className="pga__pad-top"><ErrorState text={failed} onRetry={load} /></div>;
  }
  if (rows === null) {
    return <div className="pga__pad-top"><LoadingState rows={3} /></div>;
  }

  return (
    <div className="pga__pad-top">
      {rows.length > 0 && (
        <div className="pg-search">
          <Icon name="search" size={18} className="pg-search__ic" />
          <Input
            placeholder="Партнёр, менеджер, артикул или причина"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Поиск по запросам"
          />
          {search ? (
            <button type="button" className="pg-search__btn" onClick={() => setSearch("")} aria-label="Очистить">
              <Icon name="close" size={16} />
            </button>
          ) : (
            <button type="button" className="pg-search__btn" onClick={load} aria-label="Обновить">
              <Icon name="refresh" size={16} />
            </button>
          )}
        </div>
      )}

      <div className="pga-section">
        <div className="pga-section__h">
          <span>Запросы на продление</span>
          {rows.length > 0 && (
            <span className="pg-num">
              {filtered.length} {plural(filtered.length, "запрос", "запроса", "запросов")}
            </span>
          )}
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon="hourglass"
            title={rows.length ? "Ничего не найдено" : "Запросов нет"}
            text={
              rows.length
                ? "Измените поиск."
                : "Менеджеры продлевают защиту сами дважды. Сюда попадают только запросы сверх лимита."
            }
          />
        ) : (
          <div className="pga-list">
            {filtered.map((r) => (
              <Card key={r.history_id} status="expiring">
                <div className="pga-row">
                  <div className="pga-row__t">
                    <div className="pga-row__n">{r.partner || "—"}</div>
                    <div className="pga-row__s">
                      {[skuShort(r.sku), shortName(r.manager)].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <Badge tone="warning" className="pg-num">+{r.days || 10} дн.</Badge>
                </div>

                <div className="pga-req__reason">
                  <Icon name="message" size={14} />
                  <span>{r.reason && r.reason !== "—" ? r.reason : "Причина не указана"}</span>
                </div>

                <div className="pga-row__s pg-num" style={{ marginTop: 8 }}>
                  {r.user_name && r.user_name !== "—" ? `Просит ${r.user_name}` : "Автор неизвестен"}
                  {r.requested_at && ` · ${fmtDateShort(r.requested_at)}`}
                  {r.expires_at && ` · сейчас до ${fmtDateShort(r.expires_at)}`}
                </div>

                <div className="pga-actions" style={{ marginTop: 12 }}>
                  <Button
                    variant="primary"
                    block
                    icon="hourglass"
                    disabled={busy === r.protection_id}
                    onClick={() => extend(r)}
                  >
                    Продлить на {r.days || 10} дн.
                  </Button>
                  <div className="pga-actions pga-actions--row">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="close"
                      disabled={busy === r.protection_id}
                      onClick={() => setReject({ pid: r.protection_id, reason: "" })}
                    >
                      Отклонить
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="trash"
                      disabled={busy === r.protection_id}
                      onClick={() => setDrop(r)}
                    >
                      Снять запрос
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Sheet
        open={!!reject}
        title="Отклонить продление"
        onClose={() => setReject(null)}
        actions={
          <>
            <Button
              variant="danger"
              block
              icon="close"
              disabled={!String(reject?.reason || "").trim()}
              onClick={doReject}
            >
              Отклонить
            </Button>
            <Button variant="ghost" block onClick={() => setReject(null)}>Отмена</Button>
          </>
        }
      >
        <div className="pg-sheet__text">Причина уйдёт менеджеру и останется в истории защиты.</div>
        <Field label="Причина отказа" required>
          <Textarea
            placeholder="Например: клиент уже полгода не отвечает"
            value={reject?.reason || ""}
            onChange={(e) => setReject({ ...reject, reason: e.target.value })}
          />
        </Field>
      </Sheet>

      <Sheet
        open={!!drop}
        title="Снять запрос?"
        onClose={() => setDrop(null)}
        actions={
          <>
            <Button variant="danger" block icon="trash" onClick={doDrop}>Снять</Button>
            <Button variant="ghost" block onClick={() => setDrop(null)}>Отмена</Button>
          </>
        }
      >
        <div className="pg-sheet__text">
          Запрос исчезнет из очереди без решения. Срок защиты не изменится,
          менеджер сможет попросить продление снова.
        </div>
      </Sheet>
    </div>
  );
}
