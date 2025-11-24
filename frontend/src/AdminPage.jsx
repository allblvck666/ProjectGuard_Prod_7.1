import { useEffect, useState } from "react";
import { api } from "./api";
import "./styles.css";

// ==============================
// 🔐 ПРОВЕРКА ДОСТУПА (мягкая, через компонент)
// ==============================

console.log("🔥 AdminPage loaded from", import.meta.url);
console.log("🔥 AdminPage активен — путь:", import.meta.url);

/* ===== Универсальная строка с отступами ===== */
function Row({ children, gap = 8, wrap = true }) {
  return (
    <div
      className="row"
      style={{ alignItems: "center", gap, flexWrap: wrap ? "wrap" : "nowrap" }}
    >
      {children}
    </div>
  );
}

/* ===== Модалка подтверждения ===== */
function Confirm({
  title = "Подтверждение",
  okText = "OK",
  cancelText = "Отмена",
  onOk,
  onCancel,
  children,
  disabled,
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: 16,
      }}
      onClick={onCancel}
    >
      <div
        className="card"
        style={{ width: "100%", maxWidth: 520 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        <div style={{ margin: "12px 0" }}>{children}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn secondary" onClick={onCancel}>
            {cancelText}
          </button>
          <button className="btn" onClick={onOk} disabled={disabled}>
            {okText}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ===== Вкладка: пользователи (для супер-админа) ===== */

function UsersTable() {
  const [users, setUsers] = useState([]);
  const [managers, setManagers] = useState([]); // список менеджеров
  const [loading, setLoading] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [roles] = useState(["superadmin", "admin", "manager", "assistant"]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/users");
      setUsers(r.data?.users || []);
    } catch {
      alert("Не удалось загрузить пользователей");
    } finally {
      setLoading(false);
    }
  };

  const loadManagers = async () => {
    try {
      const res = await api.get("/api/managers");
      const data = Array.isArray(res.data)
        ? res.data
        : res.data.managers || [];
      setManagers(data);
    } catch (e) {
      console.error("Ошибка загрузки менеджеров:", e);
    }
  };

  const saveUser = async (u) => {
    try {
      await api.patch(`/api/users/${u.id}`, {
        role: u.role,
        group_tag: u.group_tag,
        manager_id: u.manager_id || null,
      });
      setEditUser(null);
      await loadUsers();
    } catch {
      alert("Ошибка при сохранении");
    }
  };

  const removeUser = async (u) => {
    if (!window.confirm(`Удалить пользователя ${u.first_name}?`)) return;
    try {
      await api.delete(`/api/users/${u.id}`);
      await loadUsers();
    } catch {
      alert("Ошибка при удалении");
    }
  };

  useEffect(() => {
    loadUsers();
    loadManagers();
  }, []);

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Пользователи</h3>
      <button className="btn secondary" onClick={loadUsers} disabled={loading}>
        🔄 Обновить
      </button>
      {loading && (
        <div className="small" style={{ marginTop: 8 }}>
          Загрузка…
        </div>
      )}
      {!loading && users.length === 0 && (
        <div className="small" style={{ marginTop: 8 }}>
          Пользователей пока нет.
        </div>
      )}
      {!loading && users.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table className="table" style={{ width: "100%", minWidth: 880 }}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Имя</th>
                <th>Username</th>
                <th>Роль</th>
                <th>Группа</th>
                <th>Менеджер</th>
                <th>Регион</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isEdit = editUser?.id === u.id;
                const managerName =
                  managers.find((m) => m.id === u.manager_id)?.name || "—";

                return (
                  <tr key={u.id}>
                    <td>{u.id}</td>
                    <td>{u.first_name}</td>
                    <td>@{u.tg_username || "—"}</td>
                    <td>
                      {isEdit ? (
                        <select
                          className="select"
                          value={editUser.role}
                          onChange={(e) =>
                            setEditUser({ ...editUser, role: e.target.value })
                          }
                        >
                          {roles.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      ) : (
                        u.role
                      )}
                    </td>
                    <td>
                      {isEdit ? (
                        <input
                          className="input"
                          value={editUser.group_tag || ""}
                          onChange={(e) =>
                            setEditUser({
                              ...editUser,
                              group_tag: e.target.value,
                            })
                          }
                        />
                      ) : (
                        u.group_tag || "—"
                      )}
                    </td>
                    <td>
                      {isEdit ? (
                        <select
                          className="select"
                          value={editUser.manager_id || ""}
                          onChange={(e) =>
                            setEditUser({
                              ...editUser,
                              manager_id: e.target.value
                                ? parseInt(e.target.value)
                                : null,
                            })
                          }
                        >
                          <option value="">—</option>
                          {managers.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        managerName
                      )}
                    </td>
                    <td>{u.region || "—"}</td>
                    <td>
                      {isEdit ? (
                        <>
                          <button
                            className="btn success"
                            onClick={() => saveUser(editUser)}
                          >
                            💾
                          </button>
                          <button
                            className="btn secondary"
                            onClick={() => setEditUser(null)}
                          >
                            ❌
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="btn secondary"
                            onClick={() => setEditUser(u)}
                          >
                            ✏️
                          </button>
                          <button
                            className="btn danger"
                            onClick={() => removeUser(u)}
                          >
                            🗑️
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ===== Вкладка: новые защиты (pending) ===== */
function PendingProtections() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/protections", {
        params: { status: "pending" },
      });
      setItems(r.data || []);
    } catch {
      alert("Не удалось загрузить новые защиты");
    } finally {
      setLoading(false);
    }
  };

  const approve = async (p) => {
    if (!window.confirm(`✅ Активировать защиту #${p.id}?`)) return;
    try {
      await api.post(`/api/admin/pending/${p.id}/approve`);
      await load();
      alert("Защита активирована ✅");
    } catch {
      alert("Ошибка при активации");
    }
  };

  const reject = async (p) => {
    const reason = prompt("Причина отклонения:", "Не согласовано");
    if (reason === null) return;
    try {
      await api.post(`/api/admin/pending/${p.id}/reject`, { reason });
      await load();
      alert("Защита отклонена ❌");
    } catch {
      alert("Ошибка при отклонении");
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Новые защиты (на проверке)</h3>
      <button className="btn secondary" onClick={load} disabled={loading}>
        🔄 Обновить
      </button>

      {loading && (
        <div className="small" style={{ marginTop: 8 }}>
          Загрузка…
        </div>
      )}
      {!loading && items.length === 0 && (
        <div className="small" style={{ marginTop: 8 }}>
          Нет заявок.
        </div>
      )}
      {!loading && items.length > 0 && (
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
            marginTop: 12,
          }}
        >
          {items.map((p) => (
            <div
              key={p.id}
              className="card"
              style={{ background: "var(--bg-card)" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <b>#{p.id}</b>
                <span className="small" style={{ opacity: 0.6 }}>
                  {p.created_at}
                </span>
              </div>
              <div className="small" style={{ marginTop: 4 }}>
                👤 {p.manager}
              </div>
              <div className="small">
                🏢 {p.partner} — {p.partner_city}
              </div>
              <div className="small">📦 {p.sku}</div>
              <div className="small">📏 {p.area_m2} м²</div>
              {p.comment && (
                <div className="small" style={{ marginTop: 4 }}>
                  💬 {p.comment}
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 8,
                  marginTop: 8,
                }}
              >
                <button className="btn success" onClick={() => approve(p)}>
                  ✅ Принять
                </button>
                <button className="btn danger" onClick={() => reject(p)}>
                  ❌ Отклонить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ===== Вкладка: Telegram-уведомления менеджеров ===== */
function NotificationsTab() {
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(0);

  const loadManagers = async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/admin/managers");
      const data = (r.data || []).map((m) => ({
        ...m,
        telegrams: m.telegrams || [""],
      }));
      setManagers(data);
    } catch (e) {
      alert("Ошибка загрузки менеджеров");
    } finally {
      setLoading(false);
    }
  };

  const saveTelegrams = async (m) => {
    setSaving(m.id);
    try {
      const telegrams = m.telegrams
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      const res = await api.put(
        `/api/admin/managers/${m.id}/telegrams`,
        { telegrams }
      );

      alert(res.data.message || "✅ Telegram-уведомления обновлены");
      await loadManagers();
    } catch (e) {
      console.error("❌ Ошибка при сохранении:", e);
      alert(e.response?.data?.detail || e.message || "Ошибка сохранения");
    } finally {
      setSaving(0);
    }
  };

  const addTelegram = (managerId) => {
    setManagers((prev) =>
      prev.map((m) =>
        m.id === managerId
          ? { ...m, telegrams: [...m.telegrams, ""] }
          : m
      )
    );
  };

  const removeTelegram = (managerId, index) => {
    setManagers((prev) =>
      prev.map((m) =>
        m.id === managerId
          ? { ...m, telegrams: m.telegrams.filter((_, i) => i !== index) }
          : m
      )
    );
  };

  useEffect(() => {
    loadManagers();
  }, []);

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Уведомления менеджеров</h3>
      <button className="btn secondary" onClick={loadManagers} disabled={loading}>
        🔄 Обновить список
      </button>

      {loading && <div className="small">Загрузка...</div>}

      {!loading && managers.length === 0 && (
        <div className="small">Менеджеров пока нет.</div>
      )}

      {!loading && managers.length > 0 && (
        <div
          style={{
            marginTop: 16,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {managers.map((m) => (
            <div
              key={m.id}
              className="card"
              style={{ background: "rgba(255,255,255,0.02)" }}
            >
              <h4 style={{ marginTop: 0 }}>{m.name}</h4>
              {m.telegrams.map((t, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    marginBottom: 6,
                  }}
                >
                  <input
                    className="input"
                    placeholder="@telegram_username"
                    value={t}
                    onChange={(e) =>
                      setManagers((prev) =>
                        prev.map((x) =>
                          x.id === m.id
                            ? {
                                ...x,
                                telegrams: x.telegrams.map((tt, ii) =>
                                  ii === i ? e.target.value : tt
                                ),
                              }
                            : x
                        )
                      )
                    }
                  />
                  <button
                    className="btn danger small"
                    onClick={() => removeTelegram(m.id, i)}
                  >
                    🗑
                  </button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <button
                  className="btn secondary small"
                  onClick={() => addTelegram(m.id)}
                >
                  ➕ Добавить адрес
                </button>
                <button
                  className="btn success small"
                  disabled={saving === m.id}
                  onClick={() => saveTelegrams(m)}
                >
                  💾 Сохранить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ===== ГЛАВНЫЙ КОМПОНЕНТ АДМИНКИ ===== */
export default function AdminPage({ onBack }) {
  const [tab, setTab] = useState("managers");
  
  // 🔐 Проверка доступа при монтировании
  useEffect(() => {
    const token = localStorage.getItem("jwt_token");
    const role = localStorage.getItem("role");
    
    if (!token || (role !== "admin" && role !== "superadmin")) {
      console.warn("⛔ Доступ в админку запрещён — нет токена или роли");
      if (onBack) {
        onBack();
      } else {
        window.location.href = "/";
      }
    }
  }, [onBack]);

  const [managers, setManagers] = useState([]);
  const [loadingManagers, setLoadingManagers] = useState(false);
  const [newName, setNewName] = useState("");
  const [edit, setEdit] = useState(null);
  const [remove, setRemove] = useState(null);
  const [transferTo, setTransferTo] = useState("");

  const [openedManagerId, setOpenedManagerId] = useState(null);
  const [openedProtections, setOpenedProtections] = useState([]);
  const [loadingProtections, setLoadingProtections] = useState(false);

  const [requests, setRequests] = useState([]);
  const [loadingReq, setLoadingReq] = useState(false);
  const [extendBusy, setExtendBusy] = useState(0);

  const loadManagers = async () => {
    setLoadingManagers(true);
    try {
      const r = await api.get("/api/admin/managers");
      setManagers(r.data || []);
    } finally {
      setLoadingManagers(false);
    }
  };

  const loadManagerProtections = async (managerId) => {
    if (!managerId) return;
    setLoadingProtections(true);
    try {
      const r = await api.get("/api/admin/manager-protections", {
        params: { manager_id: managerId },
      });
      setOpenedProtections(r.data || []);
    } catch (e) {
      console.warn("Не удалось загрузить защиты менеджера", e);
      setOpenedProtections([]);
    } finally {
      setLoadingProtections(false);
    }
  };

  const doAdd = async () => {
    const name = newName.trim();
    if (!name) return alert("Введите имя менеджера");
    await api.post("/api/admin/managers", { name });
    setNewName("");
    await loadManagers();
  };

  const startEdit = (m) => setEdit({ id: m.id, name: m.name, orig: m.name });
  const cancelEdit = () => setEdit(null);

  const saveEdit = async () => {
    const nm = (edit?.name || "").trim();
    if (!nm) return alert("Имя не может быть пустым");
    await api.patch(`/api/admin/managers/${edit.id}`, { name: nm });
    setEdit(null);
    await loadManagers();
  };

  const askRemove = (m) => {
    setTransferTo("");
    setRemove({ id: m.id, name: m.name, total: m.total });
  };
  const cancelRemove = () => setRemove(null);

  const confirmRemove = async () => {
    const params = {};
    if (transferTo) params.transfer_to = transferTo;
    await api.delete(`/api/admin/managers/${remove.id}`, { params });
    setRemove(null);
    await loadManagers();
  };

  const loadRequests = async () => {
    setLoadingReq(true);
    try {
      const r = await api.get("/api/admin/extend-requests");
      setRequests(r.data || []);
    } finally {
      setLoadingReq(false);
    }
  };

  const doAdminExtend = async (pid, days = 10) => {
    try {
      setExtendBusy(pid);
      await api.post(
        `/api/admin/protections/${pid}/extend-any?days=${days}`
      );
      await loadRequests();
    } catch (e) {
      alert(e.response?.data?.detail || "Не удалось продлить");
    } finally {
      setExtendBusy(0);
    }
  };

  const adminCloseProtection = async (prot) => {
    const reason = prompt(
      "Причина закрытия защиты:",
      "Закрыта администратором"
    );
    if (!reason) return;
    try {
      await api.post(`/api/protections/${prot.id}/close`, { reason });
      await loadManagerProtections(openedManagerId);
      await loadManagers();
    } catch (e) {
      alert(e.response?.data?.detail || "Не удалось закрыть");
    }
  };

  const adminDeleteProtection = async (prot) => {
    const reason = prompt(
      "Причина удаления защиты:",
      "Удалена администратором"
    );
    if (reason === null) return;
    try {
      await api.delete(`/api/protections/${prot.id}`, {
        params: { reason: reason || "Удалена администратором" },
      });
      await loadManagerProtections(openedManagerId);
      await loadManagers();
    } catch (e) {
      alert(e.response?.data?.detail || "Не удалось удалить");
    }
  };

  useEffect(() => {
    loadManagers();
    loadRequests();
  }, []);

  const back = () => {
    if (onBack) onBack();
    else window.history.back();
  };

  const role = localStorage.getItem("role");

  return (
    <div className="container">
      <div className="header sticky" style={{ gap: 8, alignItems: "center" }}>
        <h1 style={{ marginRight: "auto" }}>👑 Админка</h1>
        <div className="mode-toggle">
          <div
            className={`tag ${tab === "managers" ? "active" : ""}`}
            onClick={() => setTab("managers")}
          >
            Менеджеры
          </div>
          <div
            className={`tag ${tab === "requests" ? "active" : ""}`}
            onClick={() => setTab("requests")}
          >
            Запросы на продление
          </div>
          <div
            className={`tag ${tab === "pending" ? "active" : ""}`}
            onClick={() => setTab("pending")}
          >
            Защиты проверка
          </div>
          <div
            className={`tag ${tab === "notifications" ? "active" : ""}`}
            onClick={() => setTab("notifications")}
          >
            Уведомления
          </div>
          {role === "superadmin" && (
            <div
              className={`tag ${tab === "users" ? "active" : ""}`}
              onClick={() => setTab("users")}
            >
              Пользователи
            </div>
          )}
        </div>
        <button className="btn" onClick={back}>
          ⬅️ Назад
        </button>
      </div>

      {/* ===== TAB: MANAGERS ===== */}
      {tab === "managers" && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Управление менеджерами</h3>

          <Row>
            <input
              className="input"
              style={{ minWidth: 260 }}
              placeholder="Новый менеджер…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button className="btn" onClick={doAdd}>
              ➕ Добавить
            </button>
            <button
              className="btn secondary"
              onClick={loadManagers}
              disabled={loadingManagers}
            >
              🔄 Обновить
            </button>
          </Row>

          <div style={{ marginTop: 12 }}>
            {loadingManagers && <div className="small">Загрузка…</div>}
            {!loadingManagers && managers.length === 0 && (
              <div className="small">
                Пока нет менеджеров — добавьте первого 👆
              </div>
            )}
            {!loadingManagers && managers.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <table
                  className="table"
                  style={{ width: "100%", minWidth: 760 }}
                >
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>Имя</th>
                      <th>Всего</th>
                      <th>Активных</th>
                      <th>Успешных</th>
                      <th>Закрытых</th>
                      <th style={{ width: 280 }}>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {managers.map((m) => {
                      const isEdit = edit?.id === m.id;
                      const isOpened = openedManagerId === m.id;
                      return (
                        <tr key={m.id}>
                          <td>
                            {isEdit ? (
                              <input
                                className="input"
                                value={edit.name}
                                onChange={(e) =>
                                  setEdit((v) => ({
                                    ...v,
                                    name: e.target.value,
                                  }))
                                }
                              />
                            ) : (
                              <b>{m.name}</b>
                            )}
                          </td>
                          <td
                            data-label="Всего"
                            style={{ textAlign: "center" }}
                          >
                            {m.total}
                          </td>
                          <td
                            data-label="Активных"
                            style={{ textAlign: "center" }}
                          >
                            {m.active}
                          </td>
                          <td
                            data-label="Успешных"
                            style={{ textAlign: "center" }}
                          >
                            {m.success}
                          </td>
                          <td
                            data-label="Закрытых"
                            style={{ textAlign: "center" }}
                          >
                            {m.closed}
                          </td>
                          <td data-label="Действия">
                            {isEdit ? (
                              <Row gap={6} wrap={false}>
                                <button
                                  className="btn success"
                                  onClick={saveEdit}
                                >
                                  💾 Сохранить
                                </button>
                                <button
                                  className="btn secondary"
                                  onClick={cancelEdit}
                                >
                                  Отмена
                                </button>
                              </Row>
                            ) : (
                              <Row gap={6} wrap={false}>
                                <button
                                  className="btn"
                                  onClick={() => startEdit(m)}
                                >
                                  ✏️ Переименовать
                                </button>
                                <button
                                  className="btn secondary"
                                  onClick={() => {
                                    const newOpened =
                                      isOpened ? null : m.id;
                                    setOpenedManagerId(newOpened);
                                    if (!isOpened) {
                                      loadManagerProtections(m.id);
                                    }
                                  }}
                                >
                                  {isOpened ? "🔽 Скрыть" : "📂 Защиты"}
                                </button>
                                <button
                                  className="btn danger"
                                  onClick={() => askRemove(m)}
                                >
                                  🗑️ Удалить
                                </button>
                              </Row>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {openedManagerId && (
            <div style={{ marginTop: 24 }}>
              <h3
                style={{
                  marginBottom: 12,
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                🧾 Защиты менеджера:
                <span style={{ color: "var(--accent-light)" }}>
                  {managers.find((m) => m.id === openedManagerId)?.name ||
                    `ID ${openedManagerId}`}
                </span>
                {!loadingProtections && openedProtections.length > 0 && (
                  <span
                    style={{
                      background: "var(--bg-card)",
                      padding: "2px 10px",
                      borderRadius: 8,
                      fontSize: 14,
                      opacity: 0.9,
                    }}
                  >
                    {`${openedProtections.length} шт.`}
                  </span>
                )}
                {!loadingProtections && openedProtections.length > 0 && (
                  <span
                    style={{
                      background: "rgba(61,220,151,0.15)",
                      border: "1px solid rgba(61,220,151,0.3)",
                      padding: "2px 10px",
                      borderRadius: 8,
                      fontSize: 14,
                      color: "#3ddc97",
                      fontWeight: 600,
                    }}
                  >
                    {`${openedProtections.reduce(
                      (sum, p) => sum + (p.area_m2 || 0),
                      0
                    )} м²`}
                  </span>
                )}
                {loadingProtections && (
                  <span
                    style={{
                      background: "var(--bg-card)",
                      padding: "2px 10px",
                      borderRadius: 8,
                      fontSize: 14,
                      opacity: 0.8,
                    }}
                  >
                    Загрузка...
                  </span>
                )}
              </h3>

              {loadingProtections && (
                <div className="small">Загрузка защит...</div>
              )}

              {!loadingProtections && openedProtections.length === 0 && (
                <div className="small" style={{ opacity: 0.8 }}>
                  У этого менеджера пока нет защит.
                </div>
              )}

              {!loadingProtections && openedProtections.length > 0 && (
                <div
                  style={{
                    display: "grid",
                    gap: 12,
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(380px, 1fr))",
                  }}
                >
                  {openedProtections.map((p) => (
                    <div
                      key={p.id}
                      className="card"
                      style={{
                        background: "var(--bg-card)",
                        border: "1px solid var(--border)",
                        padding: 16,
                        display: "flex",
                        flexDirection: "column",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <b>#{p.id}</b>
                        <span
                          style={{
                            background:
                              p.status === "active"
                                ? "rgba(61,220,151,0.2)"
                                : p.status === "success"
                                ? "rgba(77,110,235,0.25)"
                                : "rgba(255,85,85,0.25)",
                            color:
                              p.status === "active"
                                ? "#3ddc97"
                                : p.status === "success"
                                ? "#6e8eff"
                                : "#ff5555",
                            borderRadius: 8,
                            fontSize: 12,
                            padding: "2px 8px",
                            fontWeight: 600,
                          }}
                        >
                          {p.status.toUpperCase()}
                        </span>
                      </div>

                      <div
                        style={{
                          marginTop: 8,
                          fontSize: 14,
                          lineHeight: 1.6,
                        }}
                      >
                        <div>
                          <span className="text-muted">Партнёр:</span>{" "}
                          <b>{p.partner || "—"}</b>
                        </div>
                        <div>
                          <span className="text-muted">Клиент:</span>{" "}
                          <b>{p.client || "—"}</b>
                        </div>
                        <div>
                          <span className="text-muted">SKU:</span>{" "}
                          <span style={{ opacity: 0.9 }}>
                            {p.sku || "—"}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted">Площадь:</span>{" "}
                          {p.area_m2 ? `${p.area_m2} м²` : "—"}
                        </div>
                        <div>
                          <span className="text-muted">Истекает:</span>{" "}
                          <span style={{ opacity: 0.8 }}>
                            {p.expires_at}
                          </span>
                        </div>
                        {p.comment && (
                          <div>
                            <span className="text-muted">
                              Комментарий:
                            </span>{" "}
                            <i>{p.comment}</i>
                          </div>
                        )}
                      </div>

                      <div
                        style={{
                          display: "flex",
                          justifyContent: "flex-end",
                          gap: 8,
                          marginTop: 14,
                        }}
                      >
                        {p.status === "active" && (
                          <button
                            className="btn secondary"
                            onClick={() => adminCloseProtection(p)}
                          >
                            🚫 Закрыть
                          </button>
                        )}
                        <button
                          className="btn danger"
                          onClick={() => adminDeleteProtection(p)}
                        >
                          🗑️ Удалить
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== TAB: REQUESTS ===== */}
      {tab === "requests" && (
        <div className="card">
          <Row>
            <h3 style={{ margin: 0 }}>Запросы на продление</h3>
            <button
              className="btn secondary"
              onClick={loadRequests}
              disabled={loadingReq}
            >
              🔄 Обновить
            </button>
          </Row>

          <div style={{ marginTop: 12 }}>
            {loadingReq && <div className="small">Загрузка…</div>}
            {!loadingReq && requests.length === 0 && (
              <div className="small">Запросов нет.</div>
            )}
            {!loadingReq && requests.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <table
                  className="table"
                  style={{ width: "100%", minWidth: 860 }}
                >
                  <thead>
                    <tr>
                      <th>ID защиты</th>
                      <th>Менеджер</th>
                      <th>Партнёр</th>
                      <th>SKU</th>
                      <th>Запрошено</th>
                      <th>Дней</th>
                      <th>Истекает</th>
                      <th>Причина продления</th>
                      <th>Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((r) => (
                      <tr key={r.history_id}>
                        <td data-label="ID защиты">#{r.protection_id}</td>
                        <td data-label="Менеджер">{r.manager}</td>
                        <td data-label="Партнёр">{r.partner}</td>
                        <td data-label="SKU" className="small">
                          {r.sku}
                        </td>
                        <td
                          data-label="Запрошено"
                          className="small"
                        >
                          {new Date(r.requested_at).toLocaleString()}
                        </td>
                        <td
                          data-label="Дней"
                          style={{ textAlign: "center" }}
                        >
                          {r.days}
                        </td>
                        <td
                          data-label="Истекает"
                          className="small"
                        >
                          {r.expires_at}
                        </td>
                        <td
                          data-label="Причина"
                          className="small"
                          style={{
                            maxWidth: 240,
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          💬 {r.reason || "—"}
                        </td>
                        <td>
                          <Row gap={6} wrap={false}>
                            <button
                              className="btn success"
                              onClick={() =>
                                doAdminExtend(
                                  r.protection_id,
                                  r.days || 10
                                )
                              }
                              disabled={extendBusy === r.protection_id}
                            >
                              ✅ Продлить
                            </button>
                            <button
                              className="btn secondary"
                              onClick={() =>
                                doAdminExtend(r.protection_id, 10)
                              }
                              disabled={extendBusy === r.protection_id}
                            >
                              ➕ 10 дн
                            </button>
                          </Row>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "pending" && <PendingProtections />}
      {tab === "notifications" && <NotificationsTab />}
      {tab === "users" && role === "superadmin" && <UsersTable />}

      {remove && (
        <Confirm
          title="Удалить менеджера"
          okText="Удалить"
          onOk={confirmRemove}
          onCancel={cancelRemove}
          disabled={false}
        >
          <div className="small" style={{ lineHeight: 1.5 }}>
            Вы собираетесь удалить менеджера <b>{remove.name}</b>.
            {remove.total > 0 ? (
              <>
                <br />
                У него есть <b>{remove.total}</b> защит(ы). Выберите, кому их
                перевести, или удаление не будет выполнено.
                <div style={{ marginTop: 10 }}>
                  <select
                    className="select"
                    value={transferTo}
                    onChange={(e) => setTransferTo(e.target.value)}
                  >
                    <option value="">
                      — выбрать менеджера для перевода —
                    </option>
                    {managers
                      .filter((m) => m.id !== remove.id)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </select>
                </div>
              </>
            ) : (
              <>
                <br />
                У него нет защит — можно удалять.
              </>
            )}
          </div>
        </Confirm>
      )}
    </div>
  );
}
