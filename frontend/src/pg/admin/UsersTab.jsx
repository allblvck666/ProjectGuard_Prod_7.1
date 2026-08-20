// frontend/src/pg/admin/UsersTab.jsx
// Пользователи: роли, доступ, привязка к менеджерам, удаление.
// Эндпоинты те же, что у старой вкладки.

import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Icon, Input,
  LoadingState, Select, Sheet,
} from "../ui";
import { fmtDate, initials, plural } from "../format";

const ROLES = [
  { value: "manager", label: "Менеджер" },
  { value: "assistant", label: "Ассистент" },
  { value: "admin", label: "Админ" },
  { value: "superadmin", label: "Суперадмин" },
];

const ROLE_TONE = {
  superadmin: "accent",
  admin: "accent",
  manager: undefined,
  assistant: undefined,
};

const MANAGER_SLOTS = 3;
const CLEAR_WORD = "УДАЛИТЬ";

function roleLabel(role) {
  return ROLES.find((r) => r.value === role)?.label || role || "—";
}

function managerIdsOf(user) {
  try {
    if (user.manager_ids) {
      const parsed = JSON.parse(user.manager_ids);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // строка битая — считаем, что привязок нет
  }
  return user.manager_id ? [user.manager_id] : [];
}

export default function UsersTab({ role, currentUserId }) {
  const [users, setUsers] = useState(null);
  const [managers, setManagers] = useState([]);
  const [failed, setFailed] = useState(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [onlyBlocked, setOnlyBlocked] = useState(false);

  const [opened, setOpened] = useState(null);   // пользователь в шите действий
  const [rename, setRename] = useState(null);   // { id, full_name }
  const [confirm, setConfirm] = useState(null); // { kind, user }
  const [clearOpen, setClearOpen] = useState(false);
  const [clearWord, setClearWord] = useState("");
  const [busy, setBusy] = useState(false);

  const isSuperadmin = role === "superadmin";

  const load = async () => {
    setFailed(null);
    try {
      const [u, m] = await Promise.all([
        api.get("/api/admin/users"),
        api.get("/api/admin/managers").catch(() => ({ data: [] })),
      ]);
      setUsers(u.data?.users || []);
      setManagers(Array.isArray(m.data) ? m.data : m.data?.managers || []);
    } catch (e) {
      setFailed(e.userMessage || e.response?.data?.detail || "Не удалось загрузить пользователей");
      setUsers([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const patch = async (id, data) => {
    setBusy(true);
    try {
      const res = await api.patch(`/api/admin/users/${id}`, data);
      const updated = res.data?.user;
      setUsers((prev) =>
        (prev || []).map((u) => (u.id === id ? { ...u, ...(updated || data) } : u))
      );
      setOpened((prev) => (prev && prev.id === id ? { ...prev, ...(updated || data) } : prev));
      return true;
    } catch (e) {
      window.alert("❌ " + (e.userMessage || e.response?.data?.detail || "Не удалось сохранить"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const removeUser = async (user, hard) => {
    setBusy(true);
    try {
      await api.delete(`/api/admin/users/${user.id}`, { params: { hard_delete: hard } });
      setUsers((prev) =>
        hard
          ? (prev || []).filter((u) => u.id !== user.id)
          : (prev || []).map((u) => (u.id === user.id ? { ...u, is_active: 0 } : u))
      );
      setConfirm(null);
      setOpened(null);
    } catch (e) {
      window.alert("❌ " + (e.userMessage || e.response?.data?.detail || "Не удалось удалить"));
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    setBusy(true);
    try {
      await api.post("/api/admin/clear-all-users");
      setClearOpen(false);
      setClearWord("");
      await load();
    } catch (e) {
      window.alert("❌ " + (e.userMessage || e.response?.data?.detail || "Не удалось очистить"));
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    let list = users || [];
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((u) =>
        [u.full_name, u.email, u.phone, u.company, u.city, String(u.tg_id || "")]
          .some((v) => String(v || "").toLowerCase().includes(q))
      );
    }
    if (roleFilter) list = list.filter((u) => u.role === roleFilter);
    if (onlyBlocked) list = list.filter((u) => u.is_active !== 1);
    return [...list].sort((a, b) => {
      if ((a.is_active === 1) !== (b.is_active === 1)) return a.is_active === 1 ? -1 : 1;
      return String(a.full_name || a.email || "").localeCompare(
        String(b.full_name || b.email || ""), "ru"
      );
    });
  }, [users, search, roleFilter, onlyBlocked]);

  if (failed && !users?.length) {
    return <div className="pga__pad-top"><ErrorState text={failed} onRetry={load} /></div>;
  }
  if (users === null) {
    return <div className="pga__pad-top"><LoadingState rows={4} /></div>;
  }

  const slots = managerIdsOf(opened || {});

  return (
    <div className="pga__pad-top">
      <div className="pga-filters">
        <div className="pg-search">
          <Icon name="search" size={18} className="pg-search__ic" />
          <Input
            placeholder="Имя, почта, телефон, компания"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Поиск по пользователям"
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

        <div className="pg-chips">
          <button type="button" className="pg-chip" onClick={() => setRoleFilter("")}>
            <Badge tone={!roleFilter ? "accent" : undefined} plain>Все роли</Badge>
          </button>
          {ROLES.map((r) => (
            <button key={r.value} type="button" className="pg-chip" onClick={() => setRoleFilter(r.value)}>
              <Badge tone={roleFilter === r.value ? "accent" : undefined} plain>{r.label}</Badge>
            </button>
          ))}
          <button type="button" className="pg-chip" onClick={() => setOnlyBlocked((v) => !v)}>
            <Badge tone={onlyBlocked ? "danger" : undefined} plain>Заблокированные</Badge>
          </button>
        </div>
      </div>

      <div className="pga-section">
        <div className="pga-section__h">
          <span>Пользователи</span>
          <span className="pg-num">
            {filtered.length} {plural(filtered.length, "человек", "человека", "человек")}
          </span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon="users" title="Никого не найдено" text="Измените поиск или фильтры." />
        ) : (
          <div className="pga-list">
            {filtered.map((u) => {
              const blocked = u.is_active !== 1;
              const bound = managerIdsOf(u).filter(Boolean).length;
              return (
                <Card key={u.id} tappable onClick={() => setOpened(u)}>
                  <div className="pga-row">
                    <div className="pga-profile__ava">{initials(u.full_name || u.email || "?")}</div>
                    <div className="pga-row__t">
                      <div className="pga-row__n">{u.full_name || u.email || `ID ${u.id}`}</div>
                      <div className="pga-row__s">
                        {[u.email, u.phone, u.tg_id ? `tg ${u.tg_id}` : null]
                          .filter(Boolean)
                          .join(" · ") || "Контактов нет"}
                      </div>
                      <div className="pga-row__badges">
                        <Badge tone={ROLE_TONE[u.role]} plain>{roleLabel(u.role)}</Badge>
                        {blocked && <Badge tone="danger">Заблокирован</Badge>}
                        {bound > 0 && (
                          <Badge plain className="pg-num">
                            {bound} {plural(bound, "менеджер", "менеджера", "менеджеров")}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Icon name="chevronRight" size={16} />
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {isSuperadmin && (
        <div className="pga-danger">
          <div className="pga-danger__h">
            <Icon name="alert" size={14} />
            Опасная зона
          </div>
          <div className="pga-danger__t">
            «Очистить всех» удалит всех пользователей, кроме вас. Каждому придётся
            регистрироваться заново. Отменить это нельзя.
          </div>
          <Button variant="danger-soft" block icon="trash" onClick={() => setClearOpen(true)}>
            Очистить всех, кроме себя
          </Button>
        </div>
      )}

      {/* ---- действия по пользователю ---- */}
      <Sheet
        open={!!opened}
        title={opened?.full_name || opened?.email || "Пользователь"}
        onClose={() => setOpened(null)}
      >
        {opened && (
          <>
            <div className="pg-sheet__text">
              {[opened.email, opened.phone, opened.company, opened.city]
                .filter(Boolean)
                .join(" · ") || "Дополнительных данных нет"}
              {opened.created_at && ` · с ${fmtDate(opened.created_at)}`}
            </div>

            <Field label="Роль">
              <Select
                value={opened.role || ""}
                onChange={(e) => patch(opened.id, { role: e.target.value })}
                disabled={busy || opened.id === currentUserId}
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </Select>
            </Field>
            {opened.id === currentUserId && (
              <div className="pga-note" style={{ marginTop: 6 }}>
                <Icon name="info" size={13} />
                Свою роль изменить нельзя
              </div>
            )}

            <div className="pga-section">
              <div className="pga-section__h"><span>Менеджеры</span></div>
              <div className="pga-actions">
                {Array.from({ length: MANAGER_SLOTS }, (_, i) => (
                  <Select
                    key={i}
                    value={slots[i] ?? ""}
                    disabled={busy}
                    onChange={(e) => {
                      const next = [...slots];
                      while (next.length < MANAGER_SLOTS) next.push(null);
                      const value = e.target.value ? parseInt(e.target.value, 10) : null;
                      // один менеджер не должен занимать два слота
                      const dup = next.findIndex((id) => id === value);
                      if (value && dup !== -1 && dup !== i) next[dup] = null;
                      next[i] = value;
                      patch(opened.id, { manager_ids: JSON.stringify(next.slice(0, MANAGER_SLOTS)) });
                    }}
                    aria-label={`Менеджер ${i + 1}`}
                  >
                    <option value="">— не выбран</option>
                    {managers.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </Select>
                ))}
              </div>
            </div>

            <div className="pga-section">
              <div className="pga-actions">
                <Button
                  variant="secondary"
                  block
                  icon="edit"
                  onClick={() => setRename({ id: opened.id, full_name: opened.full_name || "" })}
                >
                  Переименовать
                </Button>
                <Button
                  variant="secondary"
                  block
                  icon={opened.is_active === 1 ? "lock" : "check"}
                  disabled={busy || opened.id === currentUserId}
                  onClick={() => setConfirm({ kind: "block", user: opened })}
                >
                  {opened.is_active === 1 ? "Заблокировать" : "Разблокировать"}
                </Button>
                <Button
                  variant="ghost"
                  block
                  icon="trash"
                  className="pg-btn--danger-text"
                  disabled={busy || opened.id === currentUserId}
                  onClick={() => setConfirm({ kind: "delete", user: opened })}
                >
                  Удалить
                </Button>
              </div>
            </div>
          </>
        )}
      </Sheet>

      {/* ---- переименование ---- */}
      <Sheet
        open={!!rename}
        title="Имя пользователя"
        onClose={() => setRename(null)}
        actions={
          <>
            <Button
              variant="primary"
              block
              icon="check"
              disabled={busy || !String(rename?.full_name || "").trim()}
              onClick={async () => {
                const ok = await patch(rename.id, { full_name: rename.full_name.trim() });
                if (ok) setRename(null);
              }}
            >
              Сохранить
            </Button>
            <Button variant="ghost" block onClick={() => setRename(null)}>Отмена</Button>
          </>
        }
      >
        <Field label="Как показывать в списках" required>
          <Input
            value={rename?.full_name || ""}
            onChange={(e) => setRename({ ...rename, full_name: e.target.value })}
            placeholder="Имя и фамилия"
          />
        </Field>
      </Sheet>

      {/* ---- подтверждение блокировки / удаления ---- */}
      <Sheet
        open={!!confirm}
        title={
          confirm?.kind === "block"
            ? confirm.user.is_active === 1
              ? "Заблокировать доступ?"
              : "Вернуть доступ?"
            : "Удалить пользователя?"
        }
        onClose={() => setConfirm(null)}
        actions={
          confirm?.kind === "block" ? (
            <>
              <Button
                variant={confirm.user.is_active === 1 ? "danger" : "primary"}
                block
                disabled={busy}
                onClick={async () => {
                  const ok = await patch(confirm.user.id, {
                    is_active: confirm.user.is_active === 1 ? 0 : 1,
                  });
                  if (ok) setConfirm(null);
                }}
              >
                {confirm.user.is_active === 1 ? "Заблокировать" : "Разблокировать"}
              </Button>
              <Button variant="ghost" block onClick={() => setConfirm(null)}>Отмена</Button>
            </>
          ) : (
            <>
              <Button
                variant="secondary"
                block
                icon="lock"
                disabled={busy}
                onClick={() => removeUser(confirm.user, false)}
              >
                Заблокировать (обратимо)
              </Button>
              <Button
                variant="danger"
                block
                icon="trash"
                disabled={busy}
                onClick={() => removeUser(confirm.user, true)}
              >
                Удалить навсегда
              </Button>
              <Button variant="ghost" block onClick={() => setConfirm(null)}>Отмена</Button>
            </>
          )
        }
      >
        <div className="pg-sheet__text">
          {confirm?.kind === "block"
            ? confirm.user.is_active === 1
              ? "Пользователь не сможет войти, но все его защиты и история останутся."
              : "Пользователь снова сможет войти в приложение."
            : "Мягкая блокировка обратима. Полное удаление — нет: запись пропадёт вместе с привязками."}
        </div>
      </Sheet>

      {/* ---- очистка всех ---- */}
      <Sheet
        open={clearOpen}
        title="Очистить всех пользователей?"
        onClose={() => {
          setClearOpen(false);
          setClearWord("");
        }}
        actions={
          <>
            <Button
              variant="danger"
              block
              icon="trash"
              disabled={busy || clearWord.trim().toUpperCase() !== CLEAR_WORD}
              onClick={clearAll}
            >
              Удалить всех
            </Button>
            <Button
              variant="ghost"
              block
              onClick={() => {
                setClearOpen(false);
                setClearWord("");
              }}
            >
              Отмена
            </Button>
          </>
        }
      >
        <div className="pg-sheet__text">
          Будут удалены все пользователи, кроме вас. Им придётся зарегистрироваться
          заново. Действие необратимо.
        </div>
        <Field label={`Введите «${CLEAR_WORD}», чтобы подтвердить`} required>
          <Input
            value={clearWord}
            onChange={(e) => setClearWord(e.target.value)}
            placeholder={CLEAR_WORD}
            autoComplete="off"
          />
        </Field>
      </Sheet>
    </div>
  );
}
