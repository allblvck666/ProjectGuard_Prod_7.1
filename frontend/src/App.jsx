// frontend/src/App.jsx
import axios from "axios";
import { api, fetchMe, adminUsersAPI } from "./api";

import AdminPage from "./AdminPage.jsx";
console.log("📦 App.jsx загружает AdminPage из", import.meta.url);
import { useEffect, useState } from "react";
import "./App.css";
console.log("🔥 App.jsx reloaded at", new Date().toISOString());
import LoginPage from "./LoginPage";

// ✅ Правильный универсальный путь
import { API_BASE } from "./api";

/* === Карточка статистики === */
function StatCard({ s }) {
  return (
    <div className="card stat-card">
      <h3>{s.manager}</h3>
      <div className="stat">Всего: {s.total}</div>
      <div className="stat">
        Активных: {s.active}{" "}
        <span className="text-muted">({s.active_area || 0} м²)</span>
      </div>
      <div className="stat">
        Успешных: {s.success}{" "}
        <span className="text-muted">({s.success_area || 0} м²)</span>
      </div>
      <div className="stat">
        Закрытых: {s.closed}{" "}
        <span className="text-muted">({s.closed_area || 0} м²)</span>
      </div>
      <div className="kpi">📈 {s.success_rate}% успеха</div>
    </div>
  );
}

/* === Выбор артикулов === */
function SkuSelector({ skus, selected, setSelected, perSkuMode, onAreaChange }) {
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [chooseType, setChooseType] = useState(null);

  useEffect(() => {
    const val = input.trim();
    if (!val) return setSuggestions([]);
    const matched = skus.filter((s) => String(s.sku).startsWith(val));
    setSuggestions(matched.slice(0, 10));
  }, [input, skus]);

  const pushSku = (skuObj) => {
    if (selected.length >= 3) {
      alert("Можно добавить максимум 3 артикула");
      return;
    }
    if (selected.find((s) => s.sku === skuObj.sku && s.type === skuObj.type)) {
      alert("Этот артикул уже добавлен");
      return;
    }
    setSelected([...selected, { ...skuObj, area: "" }]);
    setInput("");
    setSuggestions([]);
  };

  const addSku = (skuObj) => {
    const same = skus.filter((s) => s.sku === skuObj.sku);
    if (same.length > 1) {
      setChooseType(same);
      setSuggestions([]);
      setInput("");
      return;
    }
    pushSku(skuObj);
  };

  const removeSku = (sku) =>
    setSelected(selected.filter((s) => !(s.sku === sku.sku && s.type === sku.type)));

  return (
    <div style={{ width: "100%", position: "relative" }}>
      <div className="selected-skus">
        {selected.map((s, i) => (
          <div key={`${s.sku}-${s.type}-${i}`} className="sku-chip">
            <span>
              {s.sku} ({s.type})
            </span>
            <span className="close" onClick={() => removeSku(s)}>
              ×
            </span>
            {perSkuMode && (
              <input
                className="input small-input"
                placeholder="м²"
                value={s.area}
                onChange={(e) => onAreaChange(s, e.target.value)}
              />
            )}
          </div>
        ))}
      </div>

      <input
        className="input"
        placeholder="Введите артикул..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />

      {suggestions.length > 0 && (
        <div className="suggestions">
          {suggestions.map((s, i) => (
            <div
              key={`${s.sku}-${s.type}-${i}`}
              className="suggestion-item"
              onClick={() => addSku(s)}
            >
              {s.sku} — {s.collection} ({s.type})
            </div>
          ))}
        </div>
      )}

      {chooseType && (
        <div className="choose-type">
          <div style={{ marginBottom: 6 }}>
            Выберите тип для артикула <b>{chooseType[0].sku}</b>:
          </div>
          {chooseType.map((opt, i) => (
            <button
              key={i}
              className="btn"
              onClick={() => {
                pushSku(opt);
                setChooseType(null);
              }}
            >
              {opt.type}
            </button>
          ))}
          <button className="btn secondary" onClick={() => setChooseType(null)}>
            Отмена
          </button>
        </div>
      )}
    </div>
  );
}

/* === Простая модалка === */
function Modal({ title, children, onClose, onOk, okText = "OK", disabled }) {
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
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: "100%", maxWidth: 420 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        <div style={{ margin: "12px 0" }}>{children}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn secondary" onClick={onClose}>
            Отмена
          </button>
          <button className="btn" onClick={onOk} disabled={disabled}>
            {okText}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== КОМПОНЕНТЫ ЭКРАНОВ =====

// Компонент: Поставить защиту (только форма)
function CreateProtectionPage({ 
  form, setForm, 
  managers, skus, selectedSkus, setSelectedSkus, 
  perSkuMode, setPerSkuMode, onAreaChange,
  errorFields, submit, onBack 
}) {
  const errorClass = (field) => errorFields.includes(field) ? "input error" : "input";

  return (
    <div className="container">
      <div className="header sticky" style={{ gap: 8, alignItems: "center" }}>
        <button className="btn secondary" onClick={onBack} style={{ marginRight: "auto" }}>
          ← Назад
        </button>
        <h1 style={{ margin: 0, fontWeight: 700 }}>
          🛡️ Поставить защиту
        </h1>
      </div>
      {/* Фиксированная кнопка "назад" на мобильной версии */}
      <button 
        className="fixed-back-button" 
        onClick={onBack}
        aria-label="Назад"
      >
        ←
      </button>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="row">
          <select
            className="select"
            value={form.manager}
            onChange={(e) => setForm({ ...form, manager: e.target.value })}
          >
            <option value="">Выберите менеджера…</option>
            {Array.isArray(managers) &&
              managers.map((m) => (
                <option
                  key={m.id}
                  value={m.first_name || m.name || m.username}
                >
                  {m.first_name || m.name || m.username}
                </option>
              ))}
          </select>

          <input
            className={errorClass("partner")}
            placeholder="Партнёр (дилер)"
            value={form.partner}
            onChange={(e) => setForm({ ...form, partner: e.target.value })}
          />
          <input
            className={errorClass("partner_city")}
            placeholder="Город партнёра"
            value={form.partner_city}
            onChange={(e) =>
              setForm({ ...form, partner_city: e.target.value })
            }
          />
          <input
            className={errorClass("client")}
            placeholder="Клиент / организация"
            value={form.client}
            onChange={(e) => setForm({ ...form, client: e.target.value })}
          />

          <div className="mode-toggle">
            <div
              className={`tag ${!perSkuMode ? "active" : ""}`}
              onClick={() => setPerSkuMode(false)}
            >
              Единый
            </div>
            <div
              className={`tag ${perSkuMode ? "active" : ""}`}
              onClick={() => setPerSkuMode(true)}
            >
              Индивидуально
            </div>
          </div>

          <SkuSelector
            skus={skus}
            selected={selectedSkus}
            setSelected={setSelectedSkus}
            perSkuMode={perSkuMode}
            onAreaChange={onAreaChange}
          />

          {!perSkuMode && (
            <input
              className="input"
              placeholder="Единый метраж (м²)"
              value={form.area_m2}
              onChange={(e) => setForm({ ...form, area_m2: e.target.value })}
            />
          )}

          <input
            className={errorClass("last4")}
            placeholder="Последние 4 цифры телефона"
            value={form.last4}
            onChange={(e) => setForm({ ...form, last4: e.target.value })}
          />
          <input
            className={errorClass("object_city")}
            placeholder="Город объекта"
            value={form.object_city}
            onChange={(e) =>
              setForm({ ...form, object_city: e.target.value })
            }
          />
          <input
            className="input"
            placeholder="Адрес объекта"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
          <input
            className="input"
            placeholder="Комментарий"
            value={form.comment}
            onChange={(e) => setForm({ ...form, comment: e.target.value })}
          />

          <button className="btn" onClick={submit}>
            Добавить защиту
          </button>
        </div>
      </div>
    </div>
  );
}

// Компонент: Активные защиты (с вкладками "Мои защиты" и "Все защиты")
function ActiveProtectionsPage({
  auth, items, managers, expanded, toggleExpand, getBgColor,
  act, closeModal, setCloseModal, doClose, successModal, setSuccessModal, doSuccess,
  deleteModal, setDeleteModal, doDelete, editModal, setEditModal,
  editSelectedSkus, setEditSelectedSkus, editPerSkuMode, setEditPerSkuMode,
  editAreaUnified, setEditAreaUnified, editComment, setEditComment,
  submitEdit, skus, onAreaChange, openEditModal, load, onBack
}) {
  const [activeTab, setActiveTab] = useState("my"); // "my" | "all"
  const [search, setSearch] = useState("");
  const [managerFilter, setManagerFilter] = useState("");

  // Получаем manager_id пользователя для фильтрации "Мои защиты"
  // Защиты привязываются к manager_id пользователя, который их создал
  const currentUserId = auth.user?.id || auth.user?.user_id;
  
  // Фильтруем защиты
  let filteredItems = items.filter(it => it.status === "active");
  
  if (activeTab === "my") {
    // Мои защиты - фильтруем по manager_id из защиты
    // Защиты, где manager_id соответствует manager_id текущего пользователя
    filteredItems = filteredItems.filter(it => {
      // Если у защиты есть manager_id, сравниваем с manager_id пользователя
      if (it.manager_id && currentUserId) {
        return it.manager_id === currentUserId;
      }
      // Fallback: если manager_id нет, используем имя менеджера
      const currentUserManager = auth.user?.full_name || auth.user?.first_name || "";
      return it.manager === currentUserManager;
    });
  }
  
  if (search) {
    filteredItems = filteredItems.filter(it => 
      (it.client || "").toLowerCase().includes(search.toLowerCase()) ||
      (it.partner || "").toLowerCase().includes(search.toLowerCase()) ||
      (it.sku || "").toLowerCase().includes(search.toLowerCase())
    );
  }
  
  if (managerFilter && activeTab === "all") {
    filteredItems = filteredItems.filter(it => it.manager === managerFilter);
  }

  return (
    <div className="container">
      <div className="header sticky" style={{ gap: 8, alignItems: "center" }}>
        <button className="btn secondary" onClick={onBack} style={{ marginRight: "auto" }}>
          ← Назад
        </button>
        <h1 style={{ margin: 0, fontWeight: 700 }}>
          📋 Активные защиты
        </h1>
        <button className="btn refresh" onClick={load}>
          🔄 Обновить
        </button>
      </div>
      {/* Фиксированная кнопка "назад" на мобильной версии */}
      <button 
        className="fixed-back-button" 
        onClick={onBack}
        aria-label="Назад"
      >
        ←
      </button>

      {/* Вкладки */}
      <div className="card" style={{ marginTop: 16, marginBottom: 16 }}>
        <div className="mode-toggle" style={{ marginRight: "auto" }}>
          <div
            className={`tag ${activeTab === "my" ? "active" : ""}`}
            onClick={() => setActiveTab("my")}
          >
            Мои защиты
          </div>
          <div
            className={`tag ${activeTab === "all" ? "active" : ""}`}
            onClick={() => setActiveTab("all")}
          >
            Все защиты
          </div>
        </div>
      </div>

      {/* Фильтры и поиск */}
      <div className="toolbar" style={{ marginBottom: 16 }}>
        <input
          className="input search"
          placeholder="Поиск по клиенту, партнёру, артикулу…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {activeTab === "all" && (
          <select
            className="select"
            value={managerFilter}
            onChange={(e) => setManagerFilter(e.target.value)}
          >
            <option value="">Все менеджеры</option>
            {Array.isArray(managers) &&
              managers.map((m) => (
                <option key={m.id}>{m.first_name || m.name || m.username}</option>
              ))}
          </select>
        )}
      </div>

      {/* Список защит */}
      <div className="list">
        {filteredItems.length === 0 ? (
          <div className="card">
            <div className="small" style={{ textAlign: "center", opacity: 0.7 }}>
              {activeTab === "my" ? "У вас нет активных защит" : "Нет активных защит"}
            </div>
          </div>
        ) : (
          filteredItems.map((it) => {
            return (
              <div
                key={it.id}
                className="item"
                style={{ background: getBgColor(it) }}
              >
                <div className="line" onClick={() => toggleExpand(it.id)}>
                  <div>
                    <b>{it.client || "—"}</b> — {it.sku || "—"}{" "}
                    {it.area_m2 ? `(${it.area_m2} м²)` : ""}
                    <div className="small">
                      Осталось: {it.days_left} дн | Менеджер: {it.manager}
                      {typeof it.extend_count === "number"
                        ? ` | Продлений: ${it.extend_count}`
                        : ""}
                    </div>
                    {it.warn2d && (
                      <div
                        className="small"
                        style={{
                          marginTop: 6,
                          display: "inline-block",
                          background: "#3a2a00",
                          border: "1px solid #654e00",
                          padding: "4px 8px",
                          borderRadius: 8,
                        }}
                      >
                        ⏰ {it.warn_text || "Через 2 дня истекает"}
                      </div>
                    )}
                  </div>
                  <div className="small arrow">
                    {expanded[it.id] ? "▲" : "▼"}
                  </div>
                </div>

                {expanded[it.id] && (
                  <div className="details">
                    {it.partner && (
                      <div className="small">
                        🏢 {it.partner} — {it.partner_city}
                      </div>
                    )}
                    {it.object_city && (
                      <div className="small">📍 {it.object_city}</div>
                    )}
                    {it.address && (
                      <div className="small">🚚 {it.address}</div>
                    )}
                    {it.comment && (
                      <div className="small">💬 {it.comment}</div>
                    )}
                  </div>
                )}

                <div className="actions">
                  <button
                    className="btn secondary"
                    onClick={() => act(it.id, "extend")}
                  >
                    ⏳ Продлить
                  </button>
                  <button
                    className="btn success"
                    onClick={() => act(it.id, "success")}
                  >
                    ✅ Успешно
                  </button>
                  <button
                    className="btn secondary"
                    onClick={() => act(it.id, "close")}
                  >
                    🔒 Закрыть
                  </button>
                  {/* Показываем кнопку удаления только автору или админу */}
                  {(it.manager_id === currentUserId || auth.role === "admin" || auth.role === "superadmin") && (
                    <button
                      className="btn danger"
                      onClick={() => act(it.id, "delete")}
                    >
                      🗑️ Удалить
                    </button>
                  )}
                  <button
                    className="btn secondary"
                    onClick={() => openEditModal(it)}
                    style={{
                      background: "var(--bg-card)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    ✏️ Редактировать
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Модалки */}
      {closeModal.open && (
        <Modal
          title="Закрыть защиту"
          onClose={() => setCloseModal({ open: false, id: null, reason: "" })}
          onOk={doClose}
          okText="Закрыть"
        >
          <input
            className="input"
            placeholder="Причина закрытия"
            value={closeModal.reason}
            onChange={(e) =>
              setCloseModal({ ...closeModal, reason: e.target.value })
            }
          />
        </Modal>
      )}

      {successModal.open && (
        <Modal
          title="Отметить как успешную"
          onClose={() => setSuccessModal({ open: false, id: null, doc: "" })}
          onOk={doSuccess}
          okText="Подтвердить"
        >
          <input
            className="input"
            placeholder="Документ 1С (необязательно)"
            value={successModal.doc}
            onChange={(e) =>
              setSuccessModal({ ...successModal, doc: e.target.value })
            }
          />
        </Modal>
      )}

      {deleteModal.open && (
        <Modal
          title="Удалить защиту"
          onClose={() => setDeleteModal({ open: false, id: null, reason: "" })}
          onOk={doDelete}
          okText="Удалить"
        >
          <input
            className="input"
            placeholder="Причина удаления"
            value={deleteModal.reason}
            onChange={(e) =>
              setDeleteModal({ ...deleteModal, reason: e.target.value })
            }
          />
        </Modal>
      )}

      {editModal.open && (
        <Modal
          title="Редактировать защиту"
          onClose={() => setEditModal({ open: false, id: null })}
          onOk={submitEdit}
          okText="💾 Сохранить"
        >
          <div className="mode-toggle" style={{ marginBottom: 10 }}>
            <div
              className={`tag ${!editPerSkuMode ? "active" : ""}`}
              onClick={() => setEditPerSkuMode(false)}
            >
              Единый
            </div>
            <div
              className={`tag ${editPerSkuMode ? "active" : ""}`}
              onClick={() => setEditPerSkuMode(true)}
            >
              Индивидуально
            </div>
          </div>
          <SkuSelector
            skus={skus}
            selected={editSelectedSkus}
            setSelected={setEditSelectedSkus}
            perSkuMode={editPerSkuMode}
            onAreaChange={onAreaChange}
          />
          {!editPerSkuMode && (
            <input
              className="input"
              placeholder="Единый метраж (м²)"
              value={editAreaUnified}
              onChange={(e) => setEditAreaUnified(e.target.value)}
              style={{ marginTop: 10 }}
            />
          )}
          <textarea
            className="input"
            placeholder="Комментарий"
            value={editComment}
            onChange={(e) => setEditComment(e.target.value)}
            style={{ marginTop: 10, minHeight: 80 }}
          />
          <div className="small" style={{ marginTop: 6, opacity: 0.8 }}>
            💡 Можно добавлять или удалять артикулы, менять метраж
            (индивидуально или общий). Минимум 50 м² суммарно.
          </div>
        </Modal>
      )}
    </div>
  );
}

// Компонент: Архив защит (только закрытые защиты с поиском)
function ArchivePage({
  items, expanded, toggleExpand, search, setSearch,
  managerFilter, setManagerFilter, managers, load, onBack
}) {
  // Фильтруем только закрытые защиты (не active)
  let filteredItems = items.filter(it => it.status !== "active");
  
  if (search) {
    filteredItems = filteredItems.filter(it => 
      (it.client || "").toLowerCase().includes(search.toLowerCase()) ||
      (it.partner || "").toLowerCase().includes(search.toLowerCase()) ||
      (it.sku || "").toLowerCase().includes(search.toLowerCase())
    );
  }
  
  if (managerFilter) {
    filteredItems = filteredItems.filter(it => it.manager === managerFilter);
  }

  return (
    <div className="container">
      <div className="header sticky" style={{ gap: 8, alignItems: "center" }}>
        <button className="btn secondary" onClick={onBack} style={{ marginRight: "auto" }}>
          ← Назад
        </button>
        <h1 style={{ margin: 0, fontWeight: 700 }}>
          📦 Архив защит
        </h1>
        <button className="btn refresh" onClick={load}>
          🔄 Обновить
        </button>
      </div>
      {/* Фиксированная кнопка "назад" на мобильной версии */}
      <button 
        className="fixed-back-button" 
        onClick={onBack}
        aria-label="Назад"
      >
        ←
      </button>

      {/* Поиск и фильтры */}
      <div className="toolbar" style={{ marginTop: 16, marginBottom: 16 }}>
        <input
          className="input search"
          placeholder="Поиск по клиенту, партнёру, артикулу…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="select"
          value={managerFilter}
          onChange={(e) => setManagerFilter(e.target.value)}
        >
          <option value="">Все менеджеры</option>
          {Array.isArray(managers) &&
            managers.map((m) => (
              <option key={m.id}>{m.first_name || m.name || m.username}</option>
            ))}
        </select>
      </div>

      {/* Список защит */}
      <div className="list">
        {filteredItems.length === 0 ? (
          <div className="card">
            <div className="small" style={{ textAlign: "center", opacity: 0.7 }}>
              Нет закрытых защит
            </div>
          </div>
        ) : (
          filteredItems.map((it) => {
            const statusText = 
              it.status === "success" ? "✅ Успешна" :
              it.status === "closed" ? "🔒 Закрыта" :
              it.status === "deleted" ? "🗑️ Удалена" : it.status;
            
            return (
              <div key={it.id} className="item">
                <div className="line" onClick={() => toggleExpand(it.id)}>
                  <div>
                    <b>{it.client || "—"}</b> — {it.sku || "—"}{" "}
                    {it.area_m2 ? `(${it.area_m2} м²)` : ""}
                    <div className="small">
                      {statusText} | Менеджер: {it.manager}
                      {it.closed_at && ` | Закрыто: ${new Date(it.closed_at).toLocaleDateString()}`}
                    </div>
                    {it.close_reason && (
                      <div className="small" style={{ marginTop: 4, opacity: 0.8 }}>
                        Причина: {it.close_reason}
                      </div>
                    )}
                  </div>
                  <div className="small arrow">
                    {expanded[it.id] ? "▲" : "▼"}
                  </div>
                </div>

                {expanded[it.id] && (
                  <div className="details">
                    {it.partner && (
                      <div className="small">
                        🏢 {it.partner} — {it.partner_city}
                      </div>
                    )}
                    {it.object_city && (
                      <div className="small">📍 {it.object_city}</div>
                    )}
                    {it.address && (
                      <div className="small">🚚 {it.address}</div>
                    )}
                    {it.comment && (
                      <div className="small">💬 {it.comment}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// Компонент: Статистика
function StatsPage({ stats, onBack }) {
  return (
    <div className="container">
      <div className="header sticky" style={{ gap: 8, alignItems: "center" }}>
        <button className="btn secondary" onClick={onBack} style={{ marginRight: "auto" }}>
          ← Назад
        </button>
        <h1 style={{ margin: 0, fontWeight: 700 }}>
          📊 Статистика
        </h1>
      </div>
      {/* Фиксированная кнопка "назад" на мобильной версии */}
      <button 
        className="fixed-back-button" 
        onClick={onBack}
        aria-label="Назад"
      >
        ←
      </button>

      <div className="grid" style={{ marginTop: 16 }}>
        {stats.map((s) => (
          <StatCard key={s.manager} s={s} />
        ))}
      </div>

      {stats.length === 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="small" style={{ textAlign: "center", opacity: 0.7 }}>
            Нет данных для отображения
          </div>
        </div>
      )}

      {/* Детальная таблица статистики */}
      {stats.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0, marginBottom: 16 }}>📋 Детальная статистика по менеджерам</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: "8px", textAlign: "left" }}>Менеджер</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>Всего защит</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>Активных</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>Активных (м²)</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>Успешных</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>Успешных (м²)</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>Закрытых</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>Закрытых (м²)</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>% Успеха</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.manager} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "8px" }}><b>{s.manager || "—"}</b></td>
                    <td style={{ padding: "8px", textAlign: "right" }}>{s.total || 0}</td>
                    <td style={{ padding: "8px", textAlign: "right" }}>{s.active_cnt || 0}</td>
                    <td style={{ padding: "8px", textAlign: "right" }}>{s.active_area || 0} м²</td>
                    <td style={{ padding: "8px", textAlign: "right", color: "#4ade80" }}>{s.success_cnt || 0}</td>
                    <td style={{ padding: "8px", textAlign: "right", color: "#4ade80" }}>{s.success_area || 0} м²</td>
                    <td style={{ padding: "8px", textAlign: "right", color: "#f87171" }}>{s.closed_cnt || 0}</td>
                    <td style={{ padding: "8px", textAlign: "right", color: "#f87171" }}>{s.closed_area || 0} м²</td>
                    <td style={{ padding: "8px", textAlign: "right", fontWeight: "bold" }}>{s.rate || 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* === Основное приложение === */
function App() {
  // =====================================
  //   🔍 ДИАГНОСТИКА
  // =====================================
  const isTG = typeof window !== "undefined" && window.Telegram?.WebApp != null;

  const [auth, setAuth] = useState(() => {
    const token = localStorage.getItem("jwt_token") || "";
    const role = localStorage.getItem("role") || "";
    const userStr = localStorage.getItem("auth_user");
    const user = userStr ? JSON.parse(userStr) : null;
    // Если есть user, используем роль из user, иначе из localStorage
    const finalRole = user?.role || role;
    return { token, role: finalRole, user };
  });

  const [route, setRoute] = useState("home"); // "home" | "create" | "active" | "archive" | "stats" | "admin"

  const [tokenVerified, setTokenVerified] = useState(false);
  const [tokenValid, setTokenValid] = useState(false);

  console.log("📌 AUTH =", auth);
  console.log("📌 ROUTE =", route);
  console.log("📌 IS_TG =", isTG);

  // 🔍 Проверка валидности токена при загрузке (только для браузера)
  useEffect(() => {
    if (isTG) {
      // В Telegram WebApp проверка токена не нужна - там своя логика
      setTokenVerified(true);
      setTokenValid(!!auth.token);
      return;
    }

    if (!auth.token) {
      // Нет токена - сразу показываем LoginPage
      setTokenVerified(true);
      setTokenValid(false);
      return;
    }

    // Проверяем валидность токена и получаем актуальные данные пользователя
    api
      .get("/api/auth/verify")
      .then(() => {
        // Получаем актуальные данные пользователя
        return api.get("/api/auth/me").then((res) => {
          const user = res.data.user || res.data;
          if (user) {
            const role = user.role || "";
            localStorage.setItem("auth_user", JSON.stringify(user));
            localStorage.setItem("role", role);
            setAuth((prev) => ({ ...prev, role, user }));
          }
          setTokenValid(true);
        });
      })
      .catch((err) => {
        console.warn("⚠️ Token verification failed:", err);
        // Токен невалидный - очищаем и показываем LoginPage
        localStorage.removeItem("jwt_token");
        localStorage.removeItem("role");
        setAuth({ token: "", role: "" });
        setTokenValid(false);
      })
      .finally(() => {
        setTokenVerified(true);
      });
  }, [isTG, auth.token]);

  // 🔗 Токен уже настроен через api.js interceptor, ничего не делаем

  // 🔐 Telegram Auto-Login (только если есть Telegram WebApp)
  useEffect(() => {
    if (!isTG) return;

    // Если уже есть валидный токен - не делаем повторный логин
    if (auth.token) {
      // Проверяем валидность существующего токена
      api
        .get("/api/auth/verify")
        .then((res) => {
          if (res.data.ok) {
            const role = res.data.role;
            localStorage.setItem("role", role);
            setAuth((prev) => ({ ...prev, role }));
            if (role === "admin" || role === "superadmin") {
              setRoute("admin");
            } else {
              setRoute("home");
            }
          } else {
            throw new Error("Token invalid");
          }
        })
        .catch((err) => {
          console.warn("⚠️ Existing token invalid, re-login needed:", err);
          // Токен невалидный - делаем новый логин
          localStorage.removeItem("jwt_token");
          localStorage.removeItem("role");
          setAuth({ token: "", role: "" });
          // Продолжаем с автоматическим логином ниже
        });
    }

    try {
      const tg = window.Telegram?.WebApp;
      if (!tg?.initDataUnsafe?.user) {
        console.log("Telegram WebApp: нет initDataUnsafe.user");
        // Если нет данных пользователя, но есть токен - используем его
        if (auth.token) {
          return;
        }
        // Если нет ни токена, ни данных - показываем ошибку
        console.error("❌ Telegram WebApp: нет данных пользователя и нет токена");
        return;
      }

      const user = tg.initDataUnsafe.user;
      console.log("Telegram WebApp user =", user);

      // Если уже есть валидный токен - не делаем повторный запрос
      if (auth.token) {
        return;
      }

      fetch(`${API_BASE}/api/auth/telegram-login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tg_id: user.id,
          username: user.username || "",
          first_name: user.first_name || "",
        }),
      })
        .then((r) => {
          if (!r.ok) {
            throw new Error(`HTTP ${r.status}: ${r.statusText}`);
          }
          return r.json();
        })
        .then((data) => {
          console.log("telegram-login resp =", data);
          if (!data.ok) {
            console.error("❌ Telegram login failed:", data);
            return;
          }

          // Поддерживаем оба формата: старый (data.role) и новый (data.user.role)
          const role = data.user?.role || data.role || "manager";
          const user = data.user || { role };
          localStorage.setItem("jwt_token", data.token);
          localStorage.setItem("role", role);
          localStorage.setItem("auth_user", JSON.stringify(user));

          setAuth({ token: data.token, role, user });

          if (role === "admin" || role === "superadmin") {
            setRoute("admin");
          } else {
            setRoute("home");
          }

          tg.ready();
          tg.expand();
        })
        .catch((err) => {
          console.error("❌ Telegram auto-login error:", err);
          // Не очищаем токен, если он был - возможно это временная ошибка сети
        });
    } catch (err) {
      console.error("❌ Telegram auto-login skipped:", err);
    }
  }, [isTG, auth.token]);

  // ===== ВРЕМЕННЫЙ DEV-LOGIN =====
  const devLogin = async () => {
    const payload = {
      tg_id: 426188469,
      username: "messiah_66",
      first_name: "☺️",
      // role будет установлен автоматически на бэкенде для tg_id 426188469
    };

    try {
      const res = await fetch(`${API_BASE}/api/auth/dev-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (data.ok) {
        // Поддерживаем оба формата: старый (data.role) и новый (data.user.role)
        const role = data.user?.role || data.role || "manager";
        const user = data.user || { role };
        localStorage.setItem("jwt_token", data.token);
        localStorage.setItem("role", role);
        localStorage.setItem("auth_user", JSON.stringify(user));
        setAuth({ token: data.token, role, user });

        if (role === "admin" || role === "superadmin") {
          setRoute("admin");
        } else {
          setRoute("home");
        }

        // Показываем уведомление только в браузере
        if (!isTG) {
          alert("✅ Вход выполнен как " + role);
        } else {
          const tg = window.Telegram?.WebApp;
          if (tg?.HapticFeedback) {
            tg.HapticFeedback.notificationOccurred("success");
          }
        }
      } else {
        alert("❌ Ошибка входа");
      }
    } catch (err) {
      console.error(err);
      alert("Ошибка запроса к серверу");
    }
  };

  // ===========================
  //   ROLE ACCESS CONTROL
  // ===========================
  const role = auth.role;

  useEffect(() => {
    const currentRole = auth.role || role;
    if (route === "admin" && currentRole !== "admin" && currentRole !== "superadmin") {
      console.log("⛔ Доступ в админку запрещён — роль:", currentRole);
      setRoute("home");
    }
  }, [route, auth.role, role]);

  const goAdmin = () => {
    const currentRole = auth.role || role;
    if (currentRole === "admin" || currentRole === "superadmin") {
      setRoute("admin");
    } else {
      alert("⛔ Нет прав доступа к админке");
    }
  };

  const goMain = () => {
    setRoute("home");
  };

  const goHome = () => setRoute("home");
  const goCreate = () => setRoute("create");
  const goActive = () => setRoute("active");
  const goArchive = () => setRoute("archive");
  const goStats = () => setRoute("stats");
  const goSettings = () => setRoute("settings");

  // ===== Основное состояние приложения =====
  const [stats, setStats] = useState([]);
  const [items, setItems] = useState([]);
  const [managers, setManagers] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [managerFilter, setManagerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");

  const [form, setForm] = useState({
    manager: "",
    client: "",
    partner: "",
    partner_city: "",
    area_m2: "",
    last4: "",
    object_city: "",
    address: "",
    comment: "",
  });

  const [errorFields, setErrorFields] = useState([]);
  const [skus, setSkus] = useState([]);
  const [selectedSkus, setSelectedSkus] = useState([]);
  const [perSkuMode, setPerSkuMode] = useState(false);

  const [viewTab, setViewTab] = useState("active"); // 'active' | 'archive'
  const [archiveFilter, setArchiveFilter] = useState("all"); // 'all' | 'success' | 'closed' | 'deleted'

  const [closeModal, setCloseModal] = useState({
    open: false,
    id: null,
    reason: "",
  });
  const [successModal, setSuccessModal] = useState({
    open: false,
    id: null,
    doc: "",
  });
  const [deleteModal, setDeleteModal] = useState({
    open: false,
    id: null,
    reason: "",
  });

  // === Редактирование защиты ===
  const [editModal, setEditModal] = useState({ open: false, id: null });
  const [editSelectedSkus, setEditSelectedSkus] = useState([]);
  const [editPerSkuMode, setEditPerSkuMode] = useState(true);
  const [editAreaUnified, setEditAreaUnified] = useState("");
  const [editComment, setEditComment] = useState("");

  const openEditModal = (item) => {
    setEditModal({ open: true, id: item.id });
    const parsed = [];
    const parts = (item.sku || "").split(";").map((p) => p.trim());
    for (const p of parts) {
      const m = p.match(/([\w-]+) \(([^)]+)\).*?(\d+(?:\.\d+)?) м²/);
      if (m) parsed.push({ sku: m[1], type: m[2], area: m[3] });
    }
    setEditSelectedSkus(parsed);
    setEditComment(item.comment || "");
    if (parsed.every((s) => !s.area || Number(s.area) === 0)) {
      setEditPerSkuMode(false);
      setEditAreaUnified(item.area_m2 || "");
    } else {
      setEditPerSkuMode(true);
      setEditAreaUnified("");
    }
  };

  const submitEdit = async () => {
    let total = 0;
    let skuData = [];

    if (editPerSkuMode) {
      skuData = editSelectedSkus.map((s) => ({
        sku: s.sku,
        type: s.type,
        area: Number(s.area || 0),
      }));
      total = skuData.reduce((sum, s) => sum + s.area, 0);
    } else {
      const unified = Number(editAreaUnified || 0);
      skuData = editSelectedSkus.map((s) => ({
        sku: s.sku,
        type: s.type,
      }));
      total = unified;
    }

    if (total < 50) {
      return alert("❌ Минимум 50 м²");
    }

    const payload = {
      sku_data: skuData,
      area_m2: total,
      comment: editComment,
    };

    try {
      await api.put(`/api/protections/${editModal.id}`, payload);
      setEditModal({ open: false, id: null });
      await load();
    } catch (err) {
      alert("Ошибка при редактировании защиты");
    }
  };

  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);

  const load = async () => {
    // Загружаем данные в зависимости от текущего route
    if (route === "stats") {
      // Для статистики загружаем только stats
      const s = await api.get("/api/stats");
      setStats(s.data || []);
    } else if (route === "archive") {
      // Для архива загружаем только закрытые защиты
      const list = await api.get("/api/protections", {
        params: { manager: managerFilter, status: "", search },
      });
      let data = (list.data || []).filter((it) => it.status !== "active");
      setItems(data);
    } else if (route === "active") {
      // Для активных защит загружаем только активные
      const list = await api.get("/api/protections", {
        params: { manager: managerFilter, status: "active", search },
      });
      setItems(list.data || []);
    } else {
      // Для остальных экранов загружаем все
      const [s, list] = await Promise.all([
        api.get("/api/stats"),
        api.get("/api/protections", {
          params: { manager: managerFilter, status: statusFilter, search },
        }),
      ]);
      setStats(s.data || []);
      setItems(list.data || []);
    }
  };

  const loadHistory = async () => {
    const r = await api.get("/api/history");
    setHistory(r.data || []);
  };

  useEffect(() => {
    // Загружаем данные при смене route
    load();

    // Загружаем справочники только один раз или при необходимости
    api.get("/api/skus").then((r) => {
      console.log("📦 skus raw:", r.data);
      const dataRaw = Array.isArray(r.data) ? r.data : r.data?.skus || [];

      const normalized = dataRaw.map((x) => ({
        sku: x.sku || x.article || x.art || x.name || "",
        type: x.type || x.category || x.kind || x.group || "",
        collection: x.collection || x.series || x.line || "",
      }));

      console.log("✅ normalized skus:", normalized.slice(0, 5));
      setSkus(normalized);
    });

    api.get("/api/managers").then((r) => {
      console.log("👥 managers raw:", r.data);
      const dataRaw = Array.isArray(r.data) ? r.data : r.data?.managers || [];
      const normalized = dataRaw.map((m) => ({
        id: m.id,
        first_name: m.name || m.first_name || "",
      }));
      console.log("✅ normalized managers:", normalized);
      setManagers(normalized);
    });

    if (showHistory) loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, managerFilter, statusFilter, search]); // Загружаем при смене route и фильтров

  const onAreaChange = (skuObj, value) =>
    setSelectedSkus((prev) =>
      prev.map((s) =>
        s.sku === skuObj.sku && s.type === skuObj.type ? { ...s, area: value } : s
      )
    );

  const toggleExpand = (id) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const getBgColor = (it) => {
    if (it.status !== "active") return "transparent";
    if (it.days_left <= 0) return "rgba(255,80,80,0.25)";
    if (it.days_left <= 2) return "rgba(255,190,50,0.25)";
    return "transparent";
  };

  const submit = async () => {
    const required = ["partner", "partner_city", "client", "last4", "object_city"];
    const emptyFields = required.filter((f) => !String(form[f] || "").trim());
    const invalidLast4 = form.last4 && !/^\d{4}$/.test(form.last4);

    if (invalidLast4) emptyFields.push("last4");

    if (emptyFields.length > 0) {
      setErrorFields(emptyFields);
      alert("⚠️ Заполните обязательные поля: " + emptyFields.join(", "));
      return;
    }

    setErrorFields([]);

    if (!form.manager) return alert("Выберите менеджера");
    if (selectedSkus.length === 0) return alert("Добавьте артикул");

    const sku_data = selectedSkus.map((s) => ({
      sku: s.sku,
      type: s.type,
      area: perSkuMode ? Number(s.area || 0) : undefined,
    }));

    const total_area = perSkuMode
      ? sku_data.reduce((sum, it) => sum + Number(it.area || 0), 0)
      : Number(form.area_m2 || 0);

    if (total_area <= 0) return alert("Укажите метраж");

    const payload = {
      ...form,
      sku_data,
      area_m2: perSkuMode ? null : total_area,
    };

    try {
      await api.post("/api/protections", payload);
      setForm({
        manager: "",
        client: "",
        partner: "",
        partner_city: "",
        area_m2: "",
        last4: "",
        object_city: "",
        address: "",
        comment: "",
      });
      setSelectedSkus([]);
      setPerSkuMode(false);
      await load();
    } catch (err) {
      const detail = err.response?.data?.detail;

      if (typeof detail === "string") {
        alert("⚠️ " + detail);
      } else if (detail?.msg) {
        const conflictMsg = detail.msg;
        const reason = prompt(
          conflictMsg +
            "\n\n💬 Введите комментарий, если хотите отправить защиту админу:"
        );

        if (reason && reason.trim()) {
          try {
            await api.post("/api/protections/pending", {
              ...payload,
              comment: reason.trim(),
            });
            alert("✅ Отправлено админу на проверку.");
            await load();
          } catch (subErr) {
            console.error(subErr);
            alert("❌ Ошибка при отправке админу.");
          }
        } else {
          alert("⚠️ Защита не создана (отменено пользователем).");
        }
      } else if (err.response?.status === 400) {
        const msg = detail || "Ошибка данных защиты";
        alert("⚠️ " + msg);
        const possibleFields = [
          "partner",
          "partner_city",
          "client",
          "last4",
          "object_city",
          "area_m2",
        ];
        const matched = possibleFields.filter((f) =>
          String(msg).toLowerCase().includes(f.toLowerCase())
        );
        if (matched.length > 0) setErrorFields(matched);
      } else if (
        err.response?.status === 409 &&
        err.response?.data?.detail?.msg
      ) {
        alert(err.response.data.detail.msg);
      } else {
        alert("❌ Ошибка: не удалось создать защиту");
      }
    }
  };

  const extendAction = async (id, days = 10) => {
    try {
      await api.post(`/api/protections/${id}/extend?days=${days}`);
      await load();
    } catch (err) {
      const det = err.response?.data?.detail;

      if (err.response?.status === 403 && (det?.needs_admin || det?.msg)) {
        const reason = prompt(
          (det?.msg || "Лимит продлений.") +
            "\nВведите причину продления (например: клиент ждёт оплату, перенос поставки и т.п.):"
        );

        if (reason && reason.trim()) {
          await api.post(`/api/protections/${id}/request-extend`, {
            days,
            reason: reason.trim(),
          });
          alert("✅ Запрос на продление отправлен администратору.");
        } else {
          alert("⚠️ Причина не указана — запрос отменён.");
        }
      } else {
        alert("Не удалось продлить.");
      }
    }
  };

  const openCloseModal = (id) =>
    setCloseModal({ open: true, id, reason: "" });
  const openSuccessModal = (id) =>
    setSuccessModal({ open: true, id, doc: "" });
  const openDeleteModal = (id) =>
    setDeleteModal({ open: true, id, reason: "" });

  const doClose = async () => {
    try {
      await api.post(`/api/protections/${closeModal.id}/close`, {
        reason: closeModal.reason,
      });
      setCloseModal({ open: false, id: null, reason: "" });
      await load();
    } catch (e) {
      alert(e.response?.data?.detail || "Не удалось закрыть защиту");
    }
  };

  const doSuccess = async () => {
    try {
      await api.post(`/api/protections/${successModal.id}/success`, {
        doc_1c: successModal.doc,
      });
      setSuccessModal({ open: false, id: null, doc: "" });
      await load();
    } catch (e) {
      alert(e.response?.data?.detail || "Не удалось отметить как успешную");
    }
  };

  const doDelete = async () => {
    try {
      await api.delete(`/api/protections/${deleteModal.id}`, {
        params: { reason: deleteModal.reason || "not provided" },
      });
      setDeleteModal({ open: false, id: null, reason: "" });
      await load();
    } catch (e) {
      alert(e.response?.data?.detail || "Не удалось удалить защиту");
    }
  };

  const act = async (id, what) => {
    if (what === "extend") return extendAction(id, 10);
    if (what === "success") return openSuccessModal(id);
    if (what === "close") return openCloseModal(id);
    if (what === "delete") return openDeleteModal(id);
  };

  const exportXlsx = () => {
    const url = `${API_BASE}/api/export?search=${encodeURIComponent(
      search
    )}&manager=${encodeURIComponent(
      managerFilter
    )}&status=${encodeURIComponent(statusFilter)}`;
    window.open(url, "_blank");
  };

  const errorClass = (field) =>
    errorFields.includes(field) ? "input error" : "input";

  // ==============================
  // 🔂 ОСНОВНОЙ РЕНДЕР
  // ==============================

// 🛡️ Telegram WebApp: безопасный старт
  const [ready, setReady] = useState(!isTG);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isTG) {
      setReady(true);
      setLoading(false);
      return;
    }
    
    try {
      const tg = window.Telegram?.WebApp;
      if (tg) {
        tg.ready();
        tg.expand();
        // Настраиваем цвета Telegram WebApp
        tg.setHeaderColor('#0d1320');
        tg.setBackgroundColor('#0d1320');
        setReady(true);
      }
    } catch (e) {
      console.warn("Telegram WebApp init error:", e);
    } finally {
      setLoading(false);
    }
  }, [isTG]);

// Пока WebApp инициализируется — показываем загрузку
if (isTG && (!ready || loading)) {
  return (
    <div style={{ 
      padding: 40, 
      textAlign: "center", 
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "column",
      gap: 16
    }}>
      <div style={{ fontSize: 48 }}>⏳</div>
      <div style={{ opacity: 0.7 }}>Загрузка приложения...</div>
    </div>
  );
}


  // ⏳ Пока проверяем токен - показываем загрузку (только для браузера)
  if (!isTG && !tokenVerified) {
    return (
      <div style={{ 
        padding: 40, 
        textAlign: "center", 
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 16
      }}>
        <div style={{ fontSize: 48 }}>⏳</div>
        <div style={{ opacity: 0.7 }}>Проверка авторизации...</div>
      </div>
    );
  }

  // 🌐 Браузер без валидного токена — обычная страница логина
  if (!isTG && (!auth.token || !tokenValid)) {
    return (
      <LoginPage
        onLogin={async (roleFromLogin) => {
          const token = localStorage.getItem("jwt_token") || "";
          const userStr = localStorage.getItem("auth_user");
          let user = userStr ? JSON.parse(userStr) : { role: roleFromLogin };
          let finalRole = user.role || roleFromLogin;
          
          // Обновляем данные пользователя через API для получения актуальной роли
          if (token) {
            try {
              const res = await api.get("/api/auth/me");
              const updatedUser = res.data.user || res.data;
              if (updatedUser) {
                user = updatedUser;
                finalRole = updatedUser.role || finalRole;
                localStorage.setItem("auth_user", JSON.stringify(updatedUser));
                localStorage.setItem("role", finalRole);
              }
            } catch (e) {
              console.warn("Не удалось обновить данные пользователя:", e);
            }
          }
          
          setAuth({ token, role: finalRole, user });
          setTokenValid(true);
          if (finalRole === "admin" || finalRole === "superadmin") {
            setRoute("admin");
          } else {
            setRoute("home");
          }
        }}
      />
    );
  }

  // 👑 Админка
  if (route === "admin") {
    return <AdminPage onBack={goHome} />;
  }

  // ==== ГЛАВНЫЙ ЭКРАН С КАРТОЧКАМИ ====
  if (route === "home") {
    const userName = auth.user?.full_name || auth.user?.first_name || "Пользователь";
    const currentRole = auth.role || auth.user?.role || role;
    const isAdmin = currentRole === "admin" || currentRole === "superadmin";

    const handleLogout = () => {
      if (window.confirm("Вы уверены, что хотите выйти из аккаунта?")) {
        localStorage.clear();
        window.dispatchEvent(new CustomEvent("auth:logout"));
        setAuth({ token: "", role: "", user: null });
        setTokenValid(false);
        setRoute("home");
      }
    };

    return (
      <div className="container">
        <div className="home-header">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className="home-greeting">Привет, {userName} 👋</h1>
            <p className="home-subtitle">Выберите раздел для работы</p>
          </div>
          <button 
            className="btn secondary" 
            onClick={handleLogout}
            style={{ 
              fontSize: 14,
              padding: "12px 20px",
              height: "auto",
              whiteSpace: "nowrap",
              flexShrink: 0
            }}
          >
            🚪 Выйти
          </button>
        </div>

        <div className="home-grid">
          <div className="home-card" onClick={goCreate}>
            <div className="home-card-icon">🛡️</div>
            <h3 className="home-card-title">Поставить защиту</h3>
            <p className="home-card-subtitle">Создать новую защиту для объекта</p>
          </div>

          <div className="home-card" onClick={goActive}>
            <div className="home-card-icon">📋</div>
            <h3 className="home-card-title">Активные защиты</h3>
            <p className="home-card-subtitle">Список активных защит и управление</p>
          </div>

          <div className="home-card" onClick={goArchive}>
            <div className="home-card-icon">📦</div>
            <h3 className="home-card-title">Архив</h3>
            <p className="home-card-subtitle">История закрытых и успешных защит</p>
          </div>

          <div className="home-card" onClick={goStats}>
            <div className="home-card-icon">📊</div>
            <h3 className="home-card-title">Статистика</h3>
            <p className="home-card-subtitle">KPI и аналитика по защитам</p>
          </div>

          {isAdmin && (
            <div className="home-card" onClick={goAdmin}>
              <div className="home-card-icon">👑</div>
              <h3 className="home-card-title">Админка</h3>
              <p className="home-card-subtitle">Управление пользователями и настройки</p>
            </div>
          )}

          <div className="home-card" onClick={() => setRoute("settings")}>
            <div className="home-card-icon">⚙️</div>
            <h3 className="home-card-title">Настройки</h3>
            <p className="home-card-subtitle">Профиль и параметры приложения</p>
          </div>
        </div>
      </div>
    );
  }

  // ==== ПОСТАВИТЬ ЗАЩИТУ ====
  if (route === "create") {
    return (
      <CreateProtectionPage
        form={form}
        setForm={setForm}
        managers={managers}
        skus={skus}
        selectedSkus={selectedSkus}
        setSelectedSkus={setSelectedSkus}
        perSkuMode={perSkuMode}
        setPerSkuMode={setPerSkuMode}
        onAreaChange={onAreaChange}
        errorFields={errorFields}
        submit={submit}
        onBack={goHome}
      />
    );
  }

  // ==== АКТИВНЫЕ ЗАЩИТЫ ====
  if (route === "active") {
    return (
      <ActiveProtectionsPage
        auth={auth}
        items={items}
        managers={managers}
        expanded={expanded}
        toggleExpand={toggleExpand}
        getBgColor={getBgColor}
        act={act}
        closeModal={closeModal}
        setCloseModal={setCloseModal}
        doClose={doClose}
        successModal={successModal}
        setSuccessModal={setSuccessModal}
        doSuccess={doSuccess}
        deleteModal={deleteModal}
        setDeleteModal={setDeleteModal}
        doDelete={doDelete}
        editModal={editModal}
        setEditModal={setEditModal}
        editSelectedSkus={editSelectedSkus}
        setEditSelectedSkus={setEditSelectedSkus}
        editPerSkuMode={editPerSkuMode}
        setEditPerSkuMode={setEditPerSkuMode}
        editAreaUnified={editAreaUnified}
        setEditAreaUnified={setEditAreaUnified}
        editComment={editComment}
        setEditComment={setEditComment}
        submitEdit={submitEdit}
        skus={skus}
        onAreaChange={onAreaChange}
        openEditModal={openEditModal}
        load={load}
        onBack={goHome}
      />
    );
  }

  // ==== АРХИВ ЗАЩИТ ====
  if (route === "archive") {
    return (
      <ArchivePage
        items={items}
        expanded={expanded}
        toggleExpand={toggleExpand}
        search={search}
        setSearch={setSearch}
        managerFilter={managerFilter}
        setManagerFilter={setManagerFilter}
        managers={managers}
        load={load}
        onBack={goHome}
      />
    );
  }

  // ==== СТАТИСТИКА ====
  if (route === "stats") {
    return (
      <StatsPage
        stats={stats}
        onBack={goHome}
      />
    );
  }

  // ==== FALLBACK (не должно быть достигнуто) ====
  return (
    <div className="container">
      <div className="header sticky" style={{ gap: 8, alignItems: "center" }}>
        <button className="btn secondary" onClick={goHome} style={{ marginRight: "auto" }}>
          ← Назад
        </button>
        <h1 style={{ margin: 0, fontWeight: 700 }}>
          🔰 Aquafloor защиты
        </h1>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <div className="small" style={{ textAlign: "center", opacity: 0.7 }}>
          Неизвестный раздел. Вернитесь на главную страницу.
        </div>
      </div>
    </div>
  );
}

export default App;
