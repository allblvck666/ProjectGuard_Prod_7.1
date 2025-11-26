import { useEffect, useState } from "react";
import { api } from "./api";
import "./styles.css";

// ==============================
// 🎨 ПРЕМИУМ ДИЗАЙН АДМИНКИ
// ==============================

console.log("🔥 AdminPage loaded");

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
        background: "rgba(0,0,0,.7)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: 16,
      }}
      onClick={onCancel}
    >
      <div
        className="admin-card"
        style={{ width: "100%", maxWidth: 520 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0, color: "#fff" }}>{title}</h3>
        <div style={{ margin: "12px 0", color: "rgba(255,255,255,0.8)" }}>{children}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="admin-btn-secondary" onClick={onCancel}>
            {cancelText}
          </button>
          <button className="admin-btn-primary" onClick={onOk} disabled={disabled}>
            {okText}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ===== ДАШБОРД С СТАТИСТИКОЙ ===== */
function DashboardTab() {
  const [stats, setStats] = useState({
    totalUsers: 0,
    activeUsers: 0,
    totalManagers: 0,
    totalProtections: 0,
    activeProtections: 0,
    pendingRequests: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadStats = async () => {
      setLoading(true);
      try {
        const [usersRes, managersRes, protectionsRes, requestsRes] = await Promise.all([
          api.get("/api/admin/users").catch(() => ({ data: { users: [] } })),
          api.get("/api/admin/managers").catch(() => ({ data: [] })),
          api.get("/api/protections").catch(() => ({ data: [] })),
          api.get("/api/admin/extend-requests").catch(() => ({ data: [] })),
        ]);

        const users = usersRes.data?.users || [];
        const managers = managersRes.data || [];
        const protections = protectionsRes.data || [];

        setStats({
          totalUsers: users.length,
          activeUsers: users.filter((u) => u.is_active === 1).length,
          totalManagers: managers.length,
          totalProtections: protections.length,
          activeProtections: protections.filter((p) => p.status === "active").length,
          pendingRequests: requestsRes.data?.length || 0,
        });
      } catch (e) {
        console.error("Ошибка загрузки статистики:", e);
      } finally {
        setLoading(false);
      }
    };
    loadStats();
  }, []);

  if (loading) {
    return (
      <div className="admin-card">
        <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.6)" }}>
          Загрузка статистики...
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="admin-stat-grid">
        <div 
          className="admin-stat-card" 
          style={{ background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", cursor: "pointer" }}
          onClick={() => {
            const event = new CustomEvent("admin:switch-tab", { detail: "users" });
            window.dispatchEvent(event);
          }}
        >
          <div className="admin-stat-icon">👥</div>
          <div className="admin-stat-value">{stats.totalUsers}</div>
          <div className="admin-stat-label">Всего пользователей</div>
          <div className="admin-stat-sublabel">{stats.activeUsers} активных</div>
        </div>

        <div 
          className="admin-stat-card" 
          style={{ background: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)", cursor: "pointer" }}
          onClick={() => {
            const event = new CustomEvent("admin:switch-tab", { detail: "managers" });
            window.dispatchEvent(event);
          }}
        >
          <div className="admin-stat-icon">👔</div>
          <div className="admin-stat-value">{stats.totalManagers}</div>
          <div className="admin-stat-label">Менеджеров</div>
        </div>

        <div 
          className="admin-stat-card" 
          style={{ background: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)", cursor: "pointer" }}
          onClick={() => {
            const event = new CustomEvent("admin:switch-tab", { detail: "pending" });
            window.dispatchEvent(event);
          }}
        >
          <div className="admin-stat-icon">🛡️</div>
          <div className="admin-stat-value">{stats.totalProtections}</div>
          <div className="admin-stat-label">Всего защит</div>
          <div className="admin-stat-sublabel">{stats.activeProtections} активных</div>
        </div>

        <div 
          className="admin-stat-card" 
          style={{ background: "linear-gradient(135deg, #fa709a 0%, #fee140 100%)", cursor: "pointer" }}
          onClick={() => {
            const event = new CustomEvent("admin:switch-tab", { detail: "requests" });
            window.dispatchEvent(event);
          }}
        >
          <div className="admin-stat-icon">⏰</div>
          <div className="admin-stat-value">{stats.pendingRequests}</div>
          <div className="admin-stat-label">Запросов на продление</div>
        </div>
      </div>
    </div>
  );
}

/* ===== Вкладка: пользователи (для супер-админа) ===== */
function UsersTable() {
  const [users, setUsers] = useState([]);
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editUser, setEditUser] = useState(null);
  const [expandedUsers, setExpandedUsers] = useState({});
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const role = localStorage.getItem("role");
  const isSuperadmin = role === "superadmin";
  const roles = isSuperadmin ? ["user", "manager", "admin", "superadmin"] : ["user", "manager", "admin"];

  const loadManagers = async () => {
    try {
      const r = await api.get("/api/admin/managers");
      setManagers(r.data || []);
    } catch (e) {
      console.error("Ошибка загрузки менеджеров:", e);
    }
  };

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get("/api/admin/users");
      // API может вернуть массив напрямую или объект с users
      const usersData = Array.isArray(r.data) ? r.data : (r.data?.users || []);
      setUsers(usersData);
    } catch (e) {
      console.error("Ошибка загрузки пользователей:", e);
      const errorMsg = e.response?.data?.detail || "Не удалось загрузить пользователей";
      setError(errorMsg);
      alert(`❌ ${errorMsg}`);
    } finally {
      setLoading(false);
    }
  };

  const updateUser = async (userId, data) => {
    try {
      const response = await api.patch(`/api/admin/users/${userId}`, data);
      setEditUser(null);
      await loadUsers(); // Перезагружаем список пользователей
      return response.data;
    } catch (e) {
      console.error("Ошибка обновления:", e);
      const errorMsg = e.response?.data?.detail || "Ошибка при обновлении";
      alert(`❌ ${errorMsg}`);
      throw e; // Пробрасываем ошибку дальше
    }
  };

  const toggleActive = async (u) => {
    const newStatus = u.is_active === 1 ? 0 : 1;
    const action = newStatus === 1 ? "разблокировать" : "заблокировать";
    if (!window.confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} пользователя ${u.email || u.full_name || u.id}?`)) return;
    await updateUser(u.id, { is_active: newStatus });
  };

  const changeRole = async (u, newRole) => {
    if (newRole === u.role) return; // Роль не изменилась
    if (!window.confirm(`Изменить роль пользователя ${u.email || u.full_name || u.id} на "${newRole}"?`)) {
      return;
    }
    try {
      const response = await api.patch(`/api/admin/users/${u.id}`, { role: newRole });
      // Успешно обновлено - перезагружаем список
      await loadUsers();
      alert(`✅ Роль изменена на "${newRole}"`);
    } catch (e) {
      console.error("Ошибка изменения роли:", e);
      const errorMsg = e.response?.data?.detail || "Ошибка при изменении роли";
      alert(`❌ ${errorMsg}`);
      // Перезагружаем список, чтобы сбросить select
      await loadUsers();
    }
  };

  const deleteUser = async (u) => {
    if (!window.confirm(`Удалить пользователя ${u.email || u.full_name || u.id}?`)) return;
    try {
      await api.delete(`/api/admin/users/${u.id}`);
      await loadUsers();
      alert("✅ Пользователь удалён");
    } catch (e) {
      console.error("Ошибка удаления:", e);
      alert(e.response?.data?.detail || "Ошибка при удалении");
    }
  };

  const changeManager = async (u, managerId, index) => {
    // Получаем текущий список менеджеров из manager_ids или manager_id
    let managerIds = [];
    try {
      if (u.manager_ids) {
        managerIds = JSON.parse(u.manager_ids);
      } else if (u.manager_id) {
        managerIds = [u.manager_id];
      }
    } catch (e) {
      managerIds = [];
    }
    
    const managerIdNum = managerId ? parseInt(managerId) : null;
    
    // Обновляем менеджера по индексу
    if (index !== undefined && index >= 0 && index < 3) {
      // Заполняем массив до нужной длины (3 элемента)
      while (managerIds.length < 3) {
        managerIds.push(null);
      }
      
      // Проверяем, не выбран ли уже этот менеджер в другом поле
      if (managerIdNum) {
        const existingIndex = managerIds.findIndex(id => id === managerIdNum);
        if (existingIndex !== -1 && existingIndex !== index) {
          // Если менеджер уже выбран в другом поле, очищаем старое поле
          managerIds[existingIndex] = null;
        }
      }
      
      // Устанавливаем новое значение
      managerIds[index] = managerIdNum;
      
      // Сохраняем массив из 3 элементов (может содержать null)
      // Удаляем только undefined, но сохраняем null для пустых полей
      const cleaned = managerIds.map(id => (id === undefined ? null : id)).slice(0, 3);
      while (cleaned.length < 3) {
        cleaned.push(null);
      }
      managerIds = cleaned;
    } else {
      // Старая логика для обратной совместимости
      if (managerIdNum === (u.manager_id || null)) return; // Не изменилось
      managerIds = managerIdNum ? [managerIdNum, null, null] : [null, null, null];
    }
    
    try {
      await updateUser(u.id, { manager_ids: JSON.stringify(managerIds) });
      await loadUsers(); // Перезагружаем список для обновления UI
    } catch (e) {
      console.error("Ошибка изменения менеджера:", e);
      alert(e.response?.data?.detail || "Ошибка при изменении менеджера");
      await loadUsers(); // Перезагружаем даже при ошибке
    }
  };

  useEffect(() => {
    loadUsers();
    loadManagers();
  }, []);

  const filteredUsers = users.filter((u) => {
    const matchesSearch = !search || 
      (u.email || "").toLowerCase().includes(search.toLowerCase()) ||
      (u.full_name || "").toLowerCase().includes(search.toLowerCase()) ||
      (u.phone || "").includes(search);
    const matchesRole = !roleFilter || u.role === roleFilter;
    const matchesStatus = !statusFilter || 
      (statusFilter === "active" && u.is_active === 1) ||
      (statusFilter === "inactive" && u.is_active === 0);
    return matchesSearch && matchesRole && matchesStatus;
  });

  return (
    <div>
      <div className="admin-card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <input
            className="admin-input"
            placeholder="🔍 Поиск по email, имени, телефону..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
          <select
            className="admin-select"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            style={{ minWidth: 150 }}
          >
            <option value="">Все роли</option>
            {roles.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <select
            className="admin-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ minWidth: 150 }}
          >
            <option value="">Все статусы</option>
            <option value="active">Активные</option>
            <option value="inactive">Заблокированные</option>
          </select>
          <button className="admin-btn-secondary" onClick={loadUsers} disabled={loading}>
        🔄 Обновить
      </button>
        </div>
      </div>

      <div className="admin-card" style={{ width: "100%", boxSizing: "border-box" }}>
        <h3 style={{ marginTop: 0, marginBottom: 16, color: "#fff", fontSize: 20, fontWeight: 700 }}>
          👥 Управление пользователями ({filteredUsers.length})
        </h3>
        
      {loading && (
          <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.6)" }}>
          ⏳ Загрузка…
        </div>
      )}
      
      {error && (
        <div style={{ 
          textAlign: "center", 
          padding: 20, 
          color: "#ef4444",
          background: "rgba(239, 68, 68, 0.1)",
          borderRadius: "12px",
          marginBottom: 16,
          border: "1px solid rgba(239, 68, 68, 0.3)"
        }}>
          ❌ {error}
        </div>
      )}
        
        {!loading && !error && filteredUsers.length === 0 && (
          <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.6)" }}>
            📭 Пользователей не найдено.
        </div>
      )}
        
        {!loading && filteredUsers.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%", boxSizing: "border-box" }}>
                {filteredUsers.map((u) => (
                  <div key={u.id} className="admin-user-card" style={{ 
                    opacity: u.is_active === 0 ? 0.6 : 1,
                    cursor: "pointer",
                    width: "100%",
                    boxSizing: "border-box"
                  }} onClick={() => setExpandedUsers(prev => ({ ...prev, [u.id]: !prev[u.id] }))}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
                          <b style={{ fontSize: 18, color: "#fff" }}>{u.full_name || "—"}</b>
                          <span className="admin-badge" style={{
                            background: u.role === "superadmin" ? "rgba(255, 193, 7, 0.2)" : 
                                         u.role === "admin" ? "rgba(33, 150, 243, 0.2)" : 
                                         u.role === "manager" ? "rgba(76, 175, 80, 0.2)" :
                                         "rgba(158, 158, 158, 0.2)",
                            color: u.role === "superadmin" ? "#ffc107" : 
                                   u.role === "admin" ? "#2196f3" : 
                                   u.role === "manager" ? "#4caf50" : "#9e9e9e",
                          }}>
                            {u.role === "superadmin" ? "👑 Супер-админ" : 
                             u.role === "admin" ? "👑 Админ" : 
                             u.role === "manager" ? "👔 Менеджер" : "👤 Пользователь"}
                          </span>
                          <span className="admin-badge" style={{
                            background: u.is_active === 1 ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)",
                            color: u.is_active === 1 ? "#22c55e" : "#ef4444",
                          }}>
                            {u.is_active === 1 ? "✅ Активен" : "❌ Заблокирован"}
                          </span>
                        </div>
                        <div style={{ fontSize: 14, color: "rgba(255, 255, 255, 0.7)", marginBottom: 4 }}>
                          {u.email || (u.tg_id ? `TG: ${u.tg_id}` : "—")}
                        </div>
                        {u.phone && (
                          <div style={{ fontSize: 13, color: "rgba(255, 255, 255, 0.6)" }}>
                            📞 {u.phone}
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <button
                          className="admin-btn-secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedUsers(prev => ({ ...prev, [u.id]: !prev[u.id] }));
                          }}
                          style={{ fontSize: 20, padding: "8px 12px" }}
                        >
                          {expandedUsers[u.id] ? "▲" : "▼"}
                        </button>
                      </div>
                    </div>
                    
                    {expandedUsers[u.id] && (
                      <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(255, 255, 255, 0.1)" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 16 }}>
                          <div>
                            <div style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.5)", marginBottom: 4 }}>ID</div>
                            <div style={{ color: "#fff" }}>#{u.id}</div>
                          </div>
                          {u.company && (
                            <div>
                              <div style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.5)", marginBottom: 4 }}>Компания</div>
                              <div style={{ color: "#fff" }}>{u.company}</div>
                            </div>
                          )}
                          {u.city && (
                            <div>
                              <div style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.5)", marginBottom: 4 }}>Город</div>
                              <div style={{ color: "#fff" }}>{u.city}</div>
                            </div>
                          )}
                          {u.last_login && (
                            <div>
                              <div style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.5)", marginBottom: 4 }}>Последний вход</div>
                              <div style={{ color: "#fff", fontSize: 13 }}>{new Date(u.last_login).toLocaleString("ru-RU")}</div>
                            </div>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 12, borderTop: "1px solid rgba(255, 255, 255, 0.1)" }}>
                          <select
                              className="admin-select-small"
                              value={u.role}
                              onClick={(e) => e.stopPropagation()}
                              onMouseDown={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                e.stopPropagation();
                                changeRole(u, e.target.value);
                              }}
                              key={`role-${u.id}-${u.role}`}
                              style={{ minWidth: 180 }}
                            >
                              {roles.map((r) => (
                                <option key={r} value={r}>
                                  {r === "superadmin" ? "👑 Супер-админ" : 
                                   r === "admin" ? "👑 Админ" : 
                                   r === "manager" ? "👔 Менеджер" : "👤 Пользователь"}
                                </option>
                              ))}
                          </select>
                          <div style={{ width: "100%" }}>
                            <div style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.6)", marginBottom: 8 }}>
                              Привязка к менеджерам (максимум 3):
                            </div>
                            {[0, 1, 2].map((idx) => {
                              // Получаем текущий список менеджеров
                              let managerIds = [];
                              try {
                                if (u.manager_ids) {
                                  managerIds = JSON.parse(u.manager_ids);
                                } else if (u.manager_id && idx === 0) {
                                  managerIds = [u.manager_id];
                                }
                              } catch (e) {
                                managerIds = [];
                              }
                              const currentManagerId = managerIds[idx] || "";
                              
                              return (
                                <select
                                  key={idx}
                                  className="admin-select-small"
                                  value={currentManagerId}
                                  onClick={(e) => e.stopPropagation()}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onChange={(e) => {
                                    e.stopPropagation();
                                    changeManager(u, e.target.value, idx);
                                  }}
                                  style={{ minWidth: 200, marginBottom: 8 }}
                                >
                                  <option value="">— Не выбран</option>
                                  {managers.map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.name}
                                    </option>
                                  ))}
                                </select>
                              );
                            })}
                          </div>
                          <button
                            className="admin-btn-secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleActive(u);
                            }}
                          >
                            {u.is_active === 1 ? "🚫 Заблокировать" : "✅ Разблокировать"}
                          </button>
                          <button
                            className="admin-btn-danger"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteUser(u);
                            }}
                          >
                            🗑️ Удалить
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ===== Вкладка: Менеджеры ===== */
function ManagersTab({ managers, loadingManagers, loadManagers, newName, setNewName, doAdd, edit, setEdit, startEdit, cancelEdit, saveEdit, askRemove, remove, setRemove, cancelRemove, confirmRemove, transferTo, setTransferTo, openedManagerId, setOpenedManagerId, openedProtections, loadingProtections, loadManagerProtections, adminCloseProtection, adminDeleteProtection }) {
  const [search, setSearch] = useState("");

  const filteredManagers = managers.filter((m) => 
    !search || (m.name || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="admin-card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0, marginBottom: 16, color: "#fff" }}>
          👔 Управление менеджерами
        </h3>

        <Row>
          <input
            className="admin-input"
            style={{ minWidth: 260 }}
            placeholder="Новый менеджер…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button className="admin-btn-primary" onClick={doAdd}>
            ➕ Добавить
          </button>
          <button
            className="admin-btn-secondary"
            onClick={loadManagers}
            disabled={loadingManagers}
          >
            🔄 Обновить
          </button>
        </Row>
      </div>

      <div className="admin-card" style={{ marginBottom: 16 }}>
        <input
          className="admin-input"
          placeholder="🔍 Поиск менеджера..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: "100%" }}
        />
      </div>

      <div className="admin-card">
        {loadingManagers && (
          <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.6)" }}>
            Загрузка…
          </div>
        )}
        
        {!loadingManagers && filteredManagers.length === 0 && (
          <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.6)" }}>
            Пока нет менеджеров — добавьте первого 👆
          </div>
        )}
        
        {!loadingManagers && filteredManagers.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%", boxSizing: "border-box" }}>
            {filteredManagers.map((m) => {
              const isEdit = edit?.id === m.id;
              const isOpened = openedManagerId === m.id;
              return (
                <div key={m.id} className="admin-user-card" style={{ width: "100%", boxSizing: "border-box" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
                        {isEdit ? (
                          <input
                            className="admin-input"
                            value={edit.name}
                            onChange={(e) =>
                              setEdit((v) => ({
                                ...v,
                                name: e.target.value,
                              }))
                            }
                            style={{ maxWidth: 300 }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <b style={{ fontSize: 20, color: "#fff" }}>{m.name}</b>
                        )}
                      </div>
                      
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 16, marginTop: 16 }}>
                        <div style={{ 
                          background: "rgba(255, 255, 255, 0.05)", 
                          padding: "12px", 
                          borderRadius: "12px",
                          textAlign: "center"
                        }}>
                          <div style={{ fontSize: 24, fontWeight: 700, color: "#fff", marginBottom: 4 }}>{m.total}</div>
                          <div style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.6)" }}>Всего</div>
                        </div>
                        <div style={{ 
                          background: "rgba(61, 220, 151, 0.15)", 
                          padding: "12px", 
                          borderRadius: "12px",
                          textAlign: "center",
                          border: "1px solid rgba(61, 220, 151, 0.3)"
                        }}>
                          <div style={{ fontSize: 24, fontWeight: 700, color: "#3ddc97", marginBottom: 4 }}>{m.active}</div>
                          <div style={{ fontSize: 12, color: "rgba(61, 220, 151, 0.8)" }}>Активных</div>
                        </div>
                        <div style={{ 
                          background: "rgba(77, 110, 235, 0.15)", 
                          padding: "12px", 
                          borderRadius: "12px",
                          textAlign: "center",
                          border: "1px solid rgba(77, 110, 235, 0.3)"
                        }}>
                          <div style={{ fontSize: 24, fontWeight: 700, color: "#6e8eff", marginBottom: 4 }}>{m.success}</div>
                          <div style={{ fontSize: 12, color: "rgba(77, 110, 235, 0.8)" }}>Успешных</div>
                        </div>
                        <div style={{ 
                          background: "rgba(255, 85, 85, 0.15)", 
                          padding: "12px", 
                          borderRadius: "12px",
                          textAlign: "center",
                          border: "1px solid rgba(255, 85, 85, 0.3)"
                        }}>
                          <div style={{ fontSize: 24, fontWeight: 700, color: "#ff5555", marginBottom: 4 }}>{m.closed}</div>
                          <div style={{ fontSize: 12, color: "rgba(255, 85, 85, 0.8)" }}>Закрытых</div>
                        </div>
                      </div>
                    </div>
                    
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end", minWidth: 200 }}>
                      {isEdit ? (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", width: "100%" }}>
                          <button className="admin-btn-success" onClick={saveEdit} style={{ flex: 1 }}>
                            💾 Сохранить
                          </button>
                          <button className="admin-btn-secondary" onClick={cancelEdit} style={{ flex: 1 }}>
                            Отмена
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
                          <button className="admin-btn-secondary" onClick={() => startEdit(m)} style={{ width: "100%" }}>
                            ✏️ Переименовать
                          </button>
                          <button
                            className="admin-btn-secondary"
                            onClick={() => {
                              const newOpened = isOpened ? null : m.id;
                              setOpenedManagerId(newOpened);
                              if (!isOpened) {
                                loadManagerProtections(m.id);
                              }
                            }}
                            style={{ width: "100%" }}
                          >
                            {isOpened ? "🔽 Скрыть защиты" : "📂 Показать защиты"}
                          </button>
                          <button className="admin-btn-danger" onClick={() => askRemove(m)} style={{ width: "100%" }}>
                            🗑️ Удалить
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {isOpened && openedManagerId === m.id && (
                    <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid rgba(255, 255, 255, 0.1)" }}>
                      <h4 style={{ marginBottom: 16, color: "#fff", fontSize: 16, fontWeight: 600 }}>
                        🧾 Защиты менеджера:{" "}
                        <span style={{ color: "#6b8aff" }}>{m.name}</span>
                        {!loadingProtections && openedProtections.length > 0 && (
                          <span className="admin-badge" style={{ marginLeft: 8 }}>
                            {openedProtections.length} шт.
                          </span>
                        )}
                      </h4>
                      
                      {loadingProtections && (
                        <div style={{ textAlign: "center", padding: 20, color: "rgba(255,255,255,0.6)" }}>
                          ⏳ Загрузка защит...
                        </div>
                      )}
                      
                      {!loadingProtections && openedProtections.length === 0 && (
                        <div style={{ textAlign: "center", padding: 20, color: "rgba(255,255,255,0.6)" }}>
                          📭 У этого менеджера пока нет защит.
                        </div>
                      )}
                      
                      {!loadingProtections && openedProtections.length > 0 && (
                        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
                          {openedProtections.map((p) => (
                            <div key={p.id} className="admin-protection-card" style={{ 
                              background: "rgba(255, 255, 255, 0.05)",
                              padding: "16px",
                              borderRadius: "12px",
                              border: "1px solid rgba(255, 255, 255, 0.1)"
                            }}>
                              <div style={{ marginBottom: 8 }}>
                                <strong style={{ color: "#fff" }}>#{p.id}</strong>
                                <span className="admin-badge" style={{ 
                                  marginLeft: 8,
                                  background: p.status === "active" ? "rgba(61, 220, 151, 0.2)" : "rgba(255, 85, 85, 0.2)",
                                  color: p.status === "active" ? "#3ddc97" : "#ff5555"
                                }}>
                                  {p.status === "active" ? "✅ Активна" : "❌ Закрыта"}
                                </span>
                              </div>
                              <div style={{ fontSize: 13, color: "rgba(255, 255, 255, 0.7)", marginBottom: 6 }}>
                                📍 {p.address || p.partner || "—"}
                              </div>
                              {p.client && (
                                <div style={{ fontSize: 13, color: "rgba(255, 255, 255, 0.7)", marginBottom: 6 }}>
                                  👤 {p.client}
                                </div>
                              )}
                              {p.area_m2 && (
                                <div style={{ fontSize: 13, color: "rgba(255, 255, 255, 0.7)", marginBottom: 6 }}>
                                  📐 {p.area_m2} м²
                                </div>
                              )}
                              {p.expires_at && (
                                <div style={{ fontSize: 13, color: "rgba(255, 255, 255, 0.7)", marginBottom: 6 }}>
                                  ⏰ {p.expires_at}
                                </div>
                              )}
                              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                                {p.status === "active" && (
                                  <button 
                                    className="admin-btn-secondary" 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const reason = prompt("Причина закрытия:", "Закрыто администратором");
                                      if (reason) adminCloseProtection(p, reason);
                                    }}
                                    style={{ fontSize: 12, padding: "6px 12px" }}
                                  >
                                    🔒 Закрыть
                                  </button>
                                )}
                                <button 
                                  className="admin-btn-danger" 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    adminDeleteProtection(p);
                                  }}
                                  style={{ fontSize: 12, padding: "6px 12px" }}
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
              );
            })}
          </div>
        )}
      </div>
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
    <div className="admin-card">
      <h3 style={{ marginTop: 0, marginBottom: 16, color: "#fff" }}>Новые защиты (на проверке)</h3>
      <button className="admin-btn-secondary" onClick={load} disabled={loading}>
        🔄 Обновить
      </button>

      {loading && (
        <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.6)" }}>
          Загрузка…
        </div>
      )}
      
      {!loading && items.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.6)" }}>
          Нет заявок.
        </div>
      )}
      
      {!loading && items.length > 0 && (
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", marginTop: 16 }}>
          {items.map((p) => (
            <div key={p.id} className="admin-card" style={{ background: "rgba(255,255,255,0.02)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <b style={{ color: "#fff" }}>#{p.id}</b>
                <span style={{ fontSize: 12, opacity: 0.6 }}>{p.created_at}</span>
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.6, color: "rgba(255,255,255,0.8)", marginBottom: 12 }}>
                <div>👤 {p.manager}</div>
                <div>🏢 {p.partner} — {p.partner_city}</div>
                <div>📦 {p.sku}</div>
                <div>📏 {p.area_m2} м²</div>
                {p.comment && <div style={{ marginTop: 4 }}>💬 {p.comment}</div>}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="admin-btn-success" onClick={() => approve(p)}>
                  ✅ Принять
                </button>
                <button className="admin-btn-danger" onClick={() => reject(p)}>
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
    <div className="admin-card">
      <h3 style={{ marginTop: 0, marginBottom: 16, color: "#fff" }}>🔔 Уведомления менеджеров</h3>
      <button className="admin-btn-secondary" onClick={loadManagers} disabled={loading}>
        🔄 Обновить список
      </button>

      {loading && <div style={{ textAlign: "center", padding: 20, color: "rgba(255,255,255,0.6)" }}>Загрузка...</div>}

      {!loading && managers.length === 0 && (
        <div style={{ textAlign: "center", padding: 20, color: "rgba(255,255,255,0.6)" }}>Менеджеров пока нет.</div>
      )}

      {!loading && managers.length > 0 && (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 16 }}>
          {managers.map((m) => (
            <div key={m.id} className="admin-card" style={{ background: "rgba(255,255,255,0.02)" }}>
              <h4 style={{ marginTop: 0, marginBottom: 12, color: "#fff" }}>{m.name}</h4>
              {m.telegrams.map((t, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                  <input
                    className="admin-input"
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
                  <button className="admin-btn-icon-danger" onClick={() => removeTelegram(m.id, i)}>
                    🗑
                  </button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <button className="admin-btn-secondary" onClick={() => addTelegram(m.id)}>
                  ➕ Добавить адрес
                </button>
                <button
                  className="admin-btn-success"
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

/* ===== Вкладка: Запросы на продление ===== */
function RequestsTab({ requests, loadingReq, loadRequests, doAdminExtend, extendBusy }) {
  return (
    <div className="admin-card">
      <Row>
        <h3 style={{ margin: 0, color: "#fff" }}>⏰ Запросы на продление</h3>
        <button className="admin-btn-secondary" onClick={loadRequests} disabled={loadingReq}>
          🔄 Обновить
        </button>
      </Row>

      <div style={{ marginTop: 16 }}>
        {loadingReq && (
          <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.6)" }}>
            Загрузка…
          </div>
        )}
        
        {!loadingReq && requests.length === 0 && (
          <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.6)" }}>
            Запросов нет.
          </div>
        )}
        
        {!loadingReq && requests.length > 0 && (
          <div>
            {/* Десктопная версия - таблица */}
            <div className="admin-table-desktop" style={{ overflowX: "auto" }}>
              <table className="admin-table" style={{ width: "100%", minWidth: 1000 }}>
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
                      <td data-label="ID">#{r.protection_id}</td>
                      <td data-label="Менеджер">{r.manager}</td>
                      <td data-label="Партнёр">{r.partner}</td>
                      <td data-label="SKU" style={{ fontSize: 12 }}>{r.sku}</td>
                      <td data-label="Запрошено" style={{ fontSize: 12 }}>{new Date(r.requested_at).toLocaleString()}</td>
                      <td data-label="Дней" style={{ textAlign: "center" }}>{r.days}</td>
                      <td data-label="Истекает" style={{ fontSize: 12 }}>{r.expires_at}</td>
                      <td data-label="Причина" style={{ fontSize: 12, maxWidth: 240, whiteSpace: "pre-wrap" }}>
                        💬 {r.reason || "—"}
                      </td>
                      <td data-label="Действия">
                        <Row gap={6} wrap={false}>
                          <button
                            className="admin-btn-success"
                            onClick={() => doAdminExtend(r.protection_id, r.days || 10)}
                            disabled={extendBusy === r.protection_id}
                          >
                            ✅ Продлить
                          </button>
                          <button
                            className="admin-btn-secondary"
                            onClick={() => doAdminExtend(r.protection_id, 10)}
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
            
            {/* Мобильная версия - карточки */}
            <div className="admin-requests-mobile">
              {requests.map((r) => (
                <div key={r.history_id} className="admin-request-card">
                  <div className="admin-request-card-header">
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
                        Защита #{r.protection_id}
                      </div>
                      <div style={{ fontSize: 14, opacity: 0.8 }}>
                        👤 {r.manager} | 🏢 {r.partner}
                      </div>
                    </div>
                  </div>
                  
                  <div className="admin-request-card-body">
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>SKU</div>
                      <div style={{ fontSize: 14 }}>{r.sku || "—"}</div>
                    </div>
                    
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Запрошено</div>
                      <div style={{ fontSize: 14 }}>{new Date(r.requested_at).toLocaleString()}</div>
                    </div>
                    
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Дней / Истекает</div>
                      <div style={{ fontSize: 14 }}>
                        {r.days} дн. | {r.expires_at}
                      </div>
                    </div>
                    
                    {r.reason && (
                      <div style={{ marginBottom: 12, padding: 12, background: "rgba(255, 255, 255, 0.05)", borderRadius: 8 }}>
                        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>💬 Причина продления</div>
                        <div style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{r.reason}</div>
                      </div>
                    )}
                  </div>
                  
                  <div className="admin-request-card-actions">
                    <button
                      className="admin-btn-success"
                      onClick={() => doAdminExtend(r.protection_id, r.days || 10)}
                      disabled={extendBusy === r.protection_id}
                      style={{ flex: 1 }}
                    >
                      ✅ Продлить на {r.days || 10} дн.
                    </button>
                    <button
                      className="admin-btn-secondary"
                      onClick={() => doAdminExtend(r.protection_id, 10)}
                      disabled={extendBusy === r.protection_id}
                      style={{ flex: 1 }}
                    >
                      ➕ +10 дн
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ===== ГЛАВНЫЙ КОМПОНЕНТ АДМИНКИ ===== */
export default function AdminPage({ onBack }) {
  const [tab, setTab] = useState("dashboard");
  
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

  // Слушаем события переключения вкладок из дашборда
  useEffect(() => {
    const handleTabSwitch = (e) => {
      if (e.detail && typeof e.detail === "string") {
        setTab(e.detail);
      }
    };
    window.addEventListener("admin:switch-tab", handleTabSwitch);
    return () => window.removeEventListener("admin:switch-tab", handleTabSwitch);
  }, []);

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
    
    // Обработчик события для переключения вкладок из дашборда
    const handleTabSwitch = (e) => {
      setTab(e.detail);
    };
    window.addEventListener("admin:switch-tab", handleTabSwitch);
    return () => {
      window.removeEventListener("admin:switch-tab", handleTabSwitch);
    };
  }, []);

  const back = () => {
    // Если мы не на дашборде - возвращаемся на дашборд
    if (tab !== "dashboard") {
      setTab("dashboard");
    } else {
      // Если на дашборде - возвращаемся на главную
      if (onBack) onBack();
      else window.history.back();
    }
  };

  const handleLogout = () => {
    if (window.confirm("Вы уверены, что хотите выйти из аккаунта?")) {
      localStorage.clear();
      window.dispatchEvent(new CustomEvent("auth:logout"));
      if (onBack) onBack();
      else window.location.href = "/";
    }
  };

  const role = localStorage.getItem("role");

  return (
    <div className="container" style={{ background: "linear-gradient(135deg, #0d1320 0%, #1a1f3a 100%)", minHeight: "100vh" }}>
      {/* Фиксированная кнопка "назад" на мобильной версии */}
      <button 
        className="fixed-back-button" 
        onClick={back}
        aria-label="Назад"
      >
        ←
      </button>
      
      <div className="admin-header">
        <h1 style={{ margin: 0, background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", fontWeight: 700 }}>
          👑 Панель администратора
        </h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="admin-btn-secondary" onClick={handleLogout} style={{ fontSize: 14, padding: "10px 16px" }}>
            🚪 Выйти
          </button>
          {tab !== "dashboard" && (
            <button className="admin-btn-secondary" onClick={back}>
              ⬅️ Назад
            </button>
          )}
          {tab === "dashboard" && (
            <button className="admin-btn-secondary" onClick={back}>
              🏠 На главную
            </button>
          )}
        </div>
      </div>

      <div className="admin-tabs">
          <div
          className={`admin-tab ${tab === "dashboard" ? "active" : ""}`}
          onClick={() => setTab("dashboard")}
          >
          📊 Дашборд
          </div>
          <div
          className={`admin-tab ${tab === "users" ? "active" : ""}`}
          onClick={() => setTab("users")}
          >
          👥 Пользователи
          </div>
          <div
          className={`admin-tab ${tab === "managers" ? "active" : ""}`}
          onClick={() => setTab("managers")}
          >
          👔 Менеджеры
          </div>
            <div
          className={`admin-tab ${tab === "requests" ? "active" : ""}`}
          onClick={() => setTab("requests")}
            >
          ⏰ Запросы
            </div>
        <div
          className={`admin-tab ${tab === "pending" ? "active" : ""}`}
          onClick={() => setTab("pending")}
        >
          🔍 Проверка
                      </div>
                      </div>

      <div style={{ marginTop: 24 }}>
        {tab === "dashboard" && <DashboardTab />}
        {tab === "users" && (
          (role === "superadmin" || role === "admin") ? <UsersTable /> : (
            <div className="admin-card">
              <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.6)" }}>
                ⛔ Доступ к управлению пользователями только для администратора
                      </div>
                    </div>
          )
        )}
        {tab === "managers" && (
          <ManagersTab
            managers={managers}
            loadingManagers={loadingManagers}
            loadManagers={loadManagers}
            newName={newName}
            setNewName={setNewName}
            doAdd={doAdd}
            edit={edit}
            setEdit={setEdit}
            startEdit={startEdit}
            cancelEdit={cancelEdit}
            saveEdit={saveEdit}
            askRemove={askRemove}
            remove={remove}
            setRemove={setRemove}
            cancelRemove={cancelRemove}
            confirmRemove={confirmRemove}
            transferTo={transferTo}
            setTransferTo={setTransferTo}
            openedManagerId={openedManagerId}
            setOpenedManagerId={setOpenedManagerId}
            openedProtections={openedProtections}
            loadingProtections={loadingProtections}
            loadManagerProtections={loadManagerProtections}
            adminCloseProtection={adminCloseProtection}
            adminDeleteProtection={adminDeleteProtection}
          />
        )}
      {tab === "requests" && (
          <RequestsTab
            requests={requests}
            loadingReq={loadingReq}
            loadRequests={loadRequests}
            doAdminExtend={doAdminExtend}
            extendBusy={extendBusy}
          />
        )}
      {tab === "pending" && <PendingProtections />}
      </div>

      {remove && (
        <Confirm
          title="Удалить менеджера"
          okText="Удалить"
          onOk={confirmRemove}
          onCancel={cancelRemove}
          disabled={false}
        >
          <div style={{ lineHeight: 1.5, color: "rgba(255,255,255,0.8)" }}>
            Вы собираетесь удалить менеджера <b>{remove.name}</b>.
            {remove.total > 0 ? (
              <>
                <br />
                У него есть <b>{remove.total}</b> защит(ы). Выберите, кому их перевести, или удаление не будет выполнено.
                <div style={{ marginTop: 10 }}>
                  <select
                    className="admin-select"
                    value={transferTo}
                    onChange={(e) => setTransferTo(e.target.value)}
                  >
                    <option value="">— выбрать менеджера для перевода —</option>
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
