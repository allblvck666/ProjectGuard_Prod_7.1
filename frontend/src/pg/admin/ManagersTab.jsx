// frontend/src/pg/admin/ManagersTab.jsx
// Справочник менеджеров: добавить, переименовать, удалить с переносом
// защит. Плюс просмотр защит конкретного менеджера.

import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Icon, Input,
  LoadingState, Select, Sheet,
} from "../ui";
import { fmtArea, fmtDateShort, plural, skuShort, statusBadge } from "../format";
import { notify } from "../notify";
import { errText } from "../errors";
import { invalidateDicts } from "../dicts";

export default function ManagersTab() {
  const [managers, setManagers] = useState(null);
  const [failed, setFailed] = useState(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [rename, setRename] = useState(null);      // { id, name }
  const [removing, setRemoving] = useState(null);  // { id, name }
  const [transferTo, setTransferTo] = useState("");
  const [opened, setOpened] = useState(null);      // менеджер, чьи защиты смотрим
  const [protections, setProtections] = useState(null);

  const load = async () => {
    setFailed(null);
    try {
      const r = await api.get("/api/admin/managers");
      setManagers(Array.isArray(r.data) ? r.data : r.data?.managers || []);
    } catch (e) {
      setFailed(errText(e, "Не удалось загрузить менеджеров"));
      setManagers([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openProtections = async (m) => {
    setOpened(m);
    setProtections(null);
    try {
      const r = await api.get("/api/admin/manager-protections", { params: { manager: m.name } });
      setProtections(Array.isArray(r.data) ? r.data : r.data?.protections || []);
    } catch {
      setProtections([]);
    }
  };

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await api.post("/api/admin/managers", { name });
      setNewName("");
      setAddOpen(false);
      invalidateDicts();
      await load();
    } catch (e) {
      notify.error(errText(e, "Не удалось добавить"));
    } finally {
      setBusy(false);
    }
  };

  const saveRename = async () => {
    const name = String(rename?.name || "").trim();
    if (!name) return;
    setBusy(true);
    try {
      await api.patch(`/api/admin/managers/${rename.id}`, { name });
      setRename(null);
      invalidateDicts();
      await load();
    } catch (e) {
      notify.error(errText(e, "Не удалось переименовать"));
    } finally {
      setBusy(false);
    }
  };

  const doRemove = async () => {
    setBusy(true);
    try {
      const params = transferTo ? { transfer_to: transferTo } : {};
      await api.delete(`/api/admin/managers/${removing.id}`, { params });
      setRemoving(null);
      setTransferTo("");
      invalidateDicts();
      await load();
    } catch (e) {
      notify.error(errText(e, "Не удалось удалить"));
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    const list = managers || [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => String(m.name || "").toLowerCase().includes(q));
  }, [managers, search]);

  if (failed && !managers?.length) {
    return <div className="pga__pad-top"><ErrorState text={failed} onRetry={load} /></div>;
  }
  if (managers === null) {
    return <div className="pga__pad-top"><LoadingState rows={4} /></div>;
  }

  return (
    <div className="pga__pad-top">
      <div className="pga-filters">
        <div className="pg-search">
          <Icon name="search" size={18} className="pg-search__ic" />
          <Input
            placeholder="Имя менеджера"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Поиск по менеджерам"
          />
          {search && (
            <button type="button" className="pg-search__btn" onClick={() => setSearch("")} aria-label="Очистить">
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
        <Button variant="primary" block icon="plus" onClick={() => setAddOpen(true)}>
          Добавить менеджера
        </Button>
      </div>

      <div className="pga-section">
        <div className="pga-section__h">
          <span>Справочник</span>
          <span className="pg-num">
            {filtered.length} {plural(filtered.length, "менеджер", "менеджера", "менеджеров")}
          </span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon="user"
            title={managers.length ? "Никого не найдено" : "Менеджеров пока нет"}
            text={managers.length ? "Измените поиск." : "Добавьте первого — он появится в выборе при создании защиты."}
          />
        ) : (
          <div className="pga-list">
            {filtered.map((m) => (
              <Card key={m.id}>
                <div className="pga-row">
                  <div className="pga-row__t">
                    <div className="pga-row__n">{m.name}</div>
                    <div className="pga-row__s pg-num">ID {m.id}</div>
                  </div>
                  <Button variant="ghost" size="sm" icon="shield" onClick={() => openProtections(m)}>
                    Защиты
                  </Button>
                </div>
                <div className="pga-actions pga-actions--row" style={{ marginTop: 12 }}>
                  <Button variant="secondary" size="sm" icon="edit" onClick={() => setRename({ id: m.id, name: m.name })}>
                    Переименовать
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="trash"
                    className="pg-btn--danger-text"
                    onClick={() => {
                      setRemoving(m);
                      setTransferTo("");
                    }}
                  >
                    Удалить
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* ---- добавление ---- */}
      <Sheet
        open={addOpen}
        title="Новый менеджер"
        onClose={() => setAddOpen(false)}
        actions={
          <>
            <Button variant="primary" block icon="check" disabled={busy || !newName.trim()} onClick={add}>
              Добавить
            </Button>
            <Button variant="ghost" block onClick={() => setAddOpen(false)}>Отмена</Button>
          </>
        }
      >
        <Field label="Имя" required hint="Так менеджер будет виден в выборе при создании защиты">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Имя и фамилия" />
        </Field>
      </Sheet>

      {/* ---- переименование ---- */}
      <Sheet
        open={!!rename}
        title="Переименовать"
        onClose={() => setRename(null)}
        actions={
          <>
            <Button variant="primary" block icon="check" disabled={busy || !String(rename?.name || "").trim()} onClick={saveRename}>
              Сохранить
            </Button>
            <Button variant="ghost" block onClick={() => setRename(null)}>Отмена</Button>
          </>
        }
      >
        <Field label="Имя" required>
          <Input value={rename?.name || ""} onChange={(e) => setRename({ ...rename, name: e.target.value })} />
        </Field>
      </Sheet>

      {/* ---- удаление с переносом ---- */}
      <Sheet
        open={!!removing}
        title="Удалить менеджера?"
        onClose={() => setRemoving(null)}
        actions={
          <>
            <Button variant="danger" block icon="trash" disabled={busy} onClick={doRemove}>
              {transferTo ? "Перенести и удалить" : "Удалить"}
            </Button>
            <Button variant="ghost" block onClick={() => setRemoving(null)}>Отмена</Button>
          </>
        }
      >
        <div className="pg-sheet__text">
          Менеджер <b>{removing?.name}</b> исчезнет из справочника. Его защиты можно
          передать другому — иначе они останутся без ответственного.
        </div>
        <Field label="Передать защиты" hint="Необязательно">
          <Select value={transferTo} onChange={(e) => setTransferTo(e.target.value)}>
            <option value="">— не передавать</option>
            {(managers || [])
              .filter((m) => m.id !== removing?.id)
              .map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
          </Select>
        </Field>
      </Sheet>

      {/* ---- защиты менеджера ---- */}
      <Sheet open={!!opened} title={`Защиты · ${opened?.name || ""}`} onClose={() => setOpened(null)}>
        {protections === null ? (
          <LoadingState rows={3} />
        ) : protections.length === 0 ? (
          <EmptyState icon="shield" title="Защит нет" text="За этим менеджером ничего не числится." />
        ) : (
          <div className="pga-list">
            {protections.map((p) => {
              const badge = statusBadge(p);
              return (
                <Card key={p.id} status={badge.tone === "success" ? "active" : undefined}>
                  <div className="pga-row">
                    <div className="pga-row__t">
                      <div className="pga-row__n">{p.partner || "—"}</div>
                      <div className="pga-row__s">
                        {[skuShort(p.sku), fmtArea(p.area_m2), p.client].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </div>
                  {p.expires_at && (
                    <div className="pga-row__s pg-num" style={{ marginTop: 8 }}>
                      до {fmtDateShort(p.expires_at)}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </Sheet>
    </div>
  );
}
