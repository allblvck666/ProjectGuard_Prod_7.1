// frontend/src/pg/admin/PendingTab.jsx
// Заявки: защиты, отправленные на проверку админу.

import { useEffect, useState } from "react";
import { api } from "../../api";
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Icon,
  KV, LoadingState, Sheet, Textarea,
} from "../ui";
import { fmtArea, fmtDateShort, maskPhone, plural, shortName, skuShort } from "../format";
import { notify } from "../notify";
import { errText } from "../errors";

export default function PendingTab() {
  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(null);
  const [busy, setBusy] = useState(0);
  const [reject, setReject] = useState(null); // { id, reason }

  const load = async () => {
    setFailed(null);
    try {
      const r = await api.get("/api/protections", { params: { status: "pending" } });
      const data = Array.isArray(r.data) ? r.data : [];
      setRows(data.filter((p) => p.status === "pending"));
    } catch (e) {
      setFailed(errText(e, "Не удалось загрузить заявки"));
      setRows([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const approve = async (p) => {
    setBusy(p.id);
    try {
      await api.post(`/api/admin/pending/${p.id}/approve`);
      await load();
    } catch (e) {
      notify.error(errText(e, "Не удалось одобрить"));
    } finally {
      setBusy(0);
    }
  };

  const doReject = async () => {
    setBusy(reject.id);
    try {
      await api.post(`/api/admin/pending/${reject.id}/reject`, { reason: reject.reason.trim() });
      setReject(null);
      await load();
    } catch (e) {
      notify.error(errText(e, "Не удалось отклонить"));
    } finally {
      setBusy(0);
    }
  };

  if (failed && !rows?.length) {
    return <div className="pga__pad-top"><ErrorState text={failed} onRetry={load} /></div>;
  }
  if (rows === null) {
    return <div className="pga__pad-top"><LoadingState rows={3} /></div>;
  }

  return (
    <div className="pga__pad-top">
      <div className="pga-section">
        <div className="pga-section__h">
          <span>На проверке</span>
          {rows.length > 0 && (
            <span className="pg-num">
              {rows.length} {plural(rows.length, "заявка", "заявки", "заявок")}
            </span>
          )}
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon="file"
            title="Заявок нет"
            text="Сюда попадают защиты, которые менеджер отправил админу из-за конфликта с действующей."
          />
        ) : (
          <div className="pga-list">
            {rows.map((p) => (
              <Card key={p.id} status="expiring">
                <div className="pga-row">
                  <div className="pga-row__t">
                    <div className="pga-row__n">{p.partner || "—"}</div>
                    <div className="pga-row__s">{p.client || "Клиент не указан"}</div>
                  </div>
                  <Badge tone="warning">На проверке</Badge>
                </div>

                <div style={{ marginTop: 10 }}>
                  <KV k="Артикул">{skuShort(p.sku)}</KV>
                  <KV k="Метраж" numeric>{fmtArea(p.area_m2)}</KV>
                  <KV k="Менеджер">{shortName(p.manager)}</KV>
                  <KV k="Телефон клиента" numeric>{maskPhone(p.last4)}</KV>
                  {p.object_city && <KV k="Город объекта">{p.object_city}</KV>}
                  {p.created_at && (
                    <KV k="Отправлена" numeric>{fmtDateShort(p.created_at)}</KV>
                  )}
                </div>

                {p.comment && (
                  <div className="pga-req__reason" style={{ marginTop: 10 }}>
                    <Icon name="message" size={14} />
                    <span>{p.comment}</span>
                  </div>
                )}

                <div className="pga-actions" style={{ marginTop: 12 }}>
                  <Button
                    variant="primary"
                    block
                    icon="checkCircle"
                    disabled={busy === p.id}
                    onClick={() => approve(p)}
                  >
                    Одобрить
                  </Button>
                  <Button
                    variant="ghost"
                    block
                    icon="close"
                    className="pg-btn--danger-text"
                    disabled={busy === p.id}
                    onClick={() => setReject({ id: p.id, reason: "" })}
                  >
                    Отклонить
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Sheet
        open={!!reject}
        title="Отклонить заявку"
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
        <div className="pg-sheet__text">Причина уйдёт менеджеру в Telegram.</div>
        <Field label="Причина отказа" required>
          <Textarea
            placeholder="Например: объект уже держит другой дилер"
            value={reject?.reason || ""}
            onChange={(e) => setReject({ ...reject, reason: e.target.value })}
          />
        </Field>
      </Sheet>
    </div>
  );
}
