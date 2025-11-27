// frontend/src/App.jsx
import axios from "axios";
import { api, fetchMe, adminUsersAPI } from "./api";

// Ленивая загрузка AdminPage - загружается только когда нужен
import { lazy, Suspense, memo } from "react";
const AdminPage = lazy(() => import("./AdminPage.jsx"));

import { useEffect, useState } from "react";
import "./App.css";
import LoginPage from "./LoginPage";
import ThemeToggle from "./ThemeToggle";

// ✅ Правильный универсальный путь
import { API_BASE } from "./api";

/* === Карточка статистики === */
const StatCard = memo(function StatCard({ s }) {
  const [expanded, setExpanded] = useState(false);
  
  return (
    <div className="card stat-card" style={{ cursor: "pointer" }} onClick={() => setExpanded(!expanded)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>{s.manager || "—"}</h3>
        <div className="small arrow" style={{ fontSize: 18 }}>
          {expanded ? "▲" : "▼"}
        </div>
      </div>
      
      <div className="stat">Всего: {s.total || 0}</div>
      <div className="stat">
        Активных: {s.active_cnt || s.active || 0}{" "}
        <span className="text-muted">({s.active_area || 0} м²)</span>
      </div>
      <div className="stat">
        Успешных: {s.success_cnt || s.success || 0}{" "}
        <span className="text-muted">({s.success_area || 0} м²)</span>
      </div>
      <div className="stat">
        Закрытых: {s.closed_cnt || s.closed || 0}{" "}
        <span className="text-muted">({s.closed_area || 0} м²)</span>
      </div>
      <div className="kpi">📈 {s.rate || s.success_rate || 0}% успеха</div>
      
      {expanded && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(255, 255, 255, 0.1)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, fontSize: 14 }}>
            <div>
              <div style={{ color: "rgba(255, 255, 255, 0.6)", marginBottom: 4 }}>Всего защит</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{s.total || 0}</div>
            </div>
            <div>
              <div style={{ color: "rgba(255, 255, 255, 0.6)", marginBottom: 4 }}>Активных</div>
              <div style={{ fontWeight: 700, fontSize: 18, color: "#3ddc97" }}>{s.active_cnt || s.active || 0}</div>
            </div>
            <div>
              <div style={{ color: "rgba(255, 255, 255, 0.6)", marginBottom: 4 }}>Активных (м²)</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{s.active_area || 0} м²</div>
            </div>
            <div>
              <div style={{ color: "rgba(255, 255, 255, 0.6)", marginBottom: 4 }}>Успешных</div>
              <div style={{ fontWeight: 700, fontSize: 18, color: "#4ade80" }}>{s.success_cnt || s.success || 0}</div>
            </div>
            <div>
              <div style={{ color: "rgba(255, 255, 255, 0.6)", marginBottom: 4 }}>Успешных (м²)</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{s.success_area || 0} м²</div>
            </div>
            <div>
              <div style={{ color: "rgba(255, 255, 255, 0.6)", marginBottom: 4 }}>Закрытых</div>
              <div style={{ fontWeight: 700, fontSize: 18, color: "#f87171" }}>{s.closed_cnt || s.closed || 0}</div>
            </div>
            <div>
              <div style={{ color: "rgba(255, 255, 255, 0.6)", marginBottom: 4 }}>Закрытых (м²)</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{s.closed_area || 0} м²</div>
            </div>
            <div>
              <div style={{ color: "rgba(255, 255, 255, 0.6)", marginBottom: 4 }}>% Успеха</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{s.rate || s.success_rate || 0}%</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

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

  const maxSkus = 3;
  const canAddMore = selected.length < maxSkus;

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
        {!canAddMore && (
          <div style={{ 
            padding: "8px 12px", 
            background: "rgba(255, 193, 7, 0.1)", 
            borderRadius: "8px",
            fontSize: "13px",
            color: "rgba(255, 193, 7, 0.9)",
            marginTop: "8px"
          }}>
            ⚠️ Максимум 3 артикула. Удалите один, чтобы добавить другой.
          </div>
        )}
      </div>

      {canAddMore && (
        <>
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
        </>
      )}

      {chooseType && canAddMore && (
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
  errorFields, submit, onBack,
  extendRequestModal, setExtendRequestModal, submitExtendRequest
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
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 14, opacity: 0.8 }}>
              Менеджер <span style={{ color: "#ef4444" }}>*</span>
            </span>
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
            {!form.manager && errorFields.includes("manager") && (
              <span style={{ fontSize: 12, color: "#ef4444", marginTop: -4 }}>
                ⚠️ Выберите менеджера
              </span>
            )}
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 14, opacity: 0.8 }}>
              Партнёр (дилер) <span style={{ color: "#ef4444" }}>*</span>
            </span>
            <input
              className={errorClass("partner")}
              placeholder="Партнёр (дилер)"
              value={form.partner}
              onChange={(e) => setForm({ ...form, partner: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const nextInput = e.target.parentElement?.nextElementSibling?.querySelector("input");
                  if (nextInput) nextInput.focus();
                }
              }}
            />
            {errorFields.includes("partner") && (
              <span style={{ fontSize: 12, color: "#ef4444", marginTop: -4 }}>
                ⚠️ Заполните поле "Партнёр (дилер)"
              </span>
            )}
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 14, opacity: 0.8 }}>
              Город партнёра <span style={{ color: "#ef4444" }}>*</span>
            </span>
            <input
              className={errorClass("partner_city")}
              placeholder="Город партнёра"
              value={form.partner_city}
              onChange={(e) =>
                setForm({ ...form, partner_city: e.target.value })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const nextInput = e.target.parentElement?.nextElementSibling?.querySelector("input");
                  if (nextInput) nextInput.focus();
                }
              }}
            />
            {errorFields.includes("partner_city") && (
              <span style={{ fontSize: 12, color: "#ef4444", marginTop: -4 }}>
                ⚠️ Заполните поле "Город партнёра"
              </span>
            )}
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 14, opacity: 0.8 }}>
              Клиент / организация <span style={{ color: "#ef4444" }}>*</span>
            </span>
            <input
              className={errorClass("client")}
              placeholder="Клиент / организация"
              value={form.client}
              onChange={(e) => setForm({ ...form, client: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const nextInput = e.target.parentElement?.nextElementSibling?.querySelector("input");
                  if (nextInput) nextInput.focus();
                }
              }}
            />
            {errorFields.includes("client") && (
              <span style={{ fontSize: 12, color: "#ef4444", marginTop: -4 }}>
                ⚠️ Заполните поле "Клиент / организация"
              </span>
            )}
          </label>

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
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 14, opacity: 0.8 }}>
                Единый метраж (м²) <span style={{ color: "#ef4444" }}>*</span>
              </span>
              <input
                className="input"
                placeholder="Единый метраж (м²)"
                value={form.area_m2}
                onChange={(e) => setForm({ ...form, area_m2: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const nextInput = e.target.parentElement?.nextElementSibling?.querySelector("input");
                    if (nextInput) nextInput.focus();
                  }
                }}
              />
            </label>
          )}

          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 14, opacity: 0.8 }}>
              Последние 4 цифры телефона <span style={{ color: "#ef4444" }}>*</span>
            </span>
            <input
              className={errorClass("last4")}
              placeholder="Последние 4 цифры телефона"
              value={form.last4}
              onChange={(e) => setForm({ ...form, last4: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const nextInput = e.target.parentElement?.nextElementSibling?.querySelector("input");
                  if (nextInput) nextInput.focus();
                }
              }}
            />
            {errorFields.includes("last4") && (
              <span style={{ fontSize: 12, color: "#ef4444", marginTop: -4 }}>
                ⚠️ Заполните поле "Последние 4 цифры телефона" (4 цифры)
              </span>
            )}
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 14, opacity: 0.8 }}>
              Город объекта <span style={{ color: "#ef4444" }}>*</span>
            </span>
            <input
              className={errorClass("object_city")}
              placeholder="Город объекта"
              value={form.object_city}
              onChange={(e) =>
                setForm({ ...form, object_city: e.target.value })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const nextInput = e.target.parentElement?.nextElementSibling?.querySelector("input");
                  if (nextInput) nextInput.focus();
                }
              }}
            />
            {errorFields.includes("object_city") && (
              <span style={{ fontSize: 12, color: "#ef4444", marginTop: -4 }}>
                ⚠️ Заполните поле "Город объекта"
              </span>
            )}
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 14, opacity: 0.8 }}>Адрес объекта</span>
            <input
              className="input"
              placeholder="Адрес объекта"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const nextInput = e.target.parentElement?.nextElementSibling?.querySelector("input");
                  if (nextInput) nextInput.focus();
                }
              }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 14, opacity: 0.8 }}>Комментарий</span>
            <input
              className="input"
              placeholder="Комментарий"
              value={form.comment}
              onChange={(e) => setForm({ ...form, comment: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const nextInput = e.target.parentElement?.nextElementSibling?.querySelector("button");
                  if (nextInput) nextInput.focus();
                }
              }}
            />
          </label>

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
  submitEdit, skus, onAreaChange, openEditModal, load, loading, onBack,
  extendRequestModal, setExtendRequestModal, submitExtendRequest
}) {
  const [activeTab, setActiveTab] = useState("my"); // "my" | "all"
  const [search, setSearch] = useState("");
  const [managerFilter, setManagerFilter] = useState("");

  // Получаем manager_id пользователя для фильтрации "Мои защиты"
  // Защиты привязываются к manager_id пользователя, который их создал
  const currentUserId = auth.user?.id || auth.user?.user_id;
  
  // Фильтруем защиты (данные уже приходят с status="active" из API)
  console.log("📋 ActiveProtectionsPage: items.length =", items?.length || 0, "currentUserId =", currentUserId);
  console.log("📋 ActiveProtectionsPage: items (первые 3) =", Array.isArray(items) ? items.slice(0, 3).map(it => ({ id: it.id, status: it.status, client: it.client, manager_id: it.manager_id })) : "не массив");
  
  // Начинаем с всех items (они уже должны быть активными)
  let filteredItems = Array.isArray(items) ? items : [];
  console.log("📋 ActiveProtectionsPage: filteredItems.length (начальное) =", filteredItems.length);
  
  // Фильтруем по вкладке "Мои защиты" или "Все защиты"
  if (activeTab === "my") {
    // Мои защиты - фильтруем по manager_id из защиты
    // Защиты, где manager_id соответствует manager_id текущего пользователя
    const beforeMyFilter = filteredItems.length;
    filteredItems = filteredItems.filter(it => {
      // Если у защиты есть manager_id, сравниваем с manager_id пользователя
      if (it.manager_id && currentUserId) {
        const matches = it.manager_id === currentUserId;
        if (!matches) {
          console.log("⚠️ Защита не принадлежит пользователю:", it.id, "manager_id защиты:", it.manager_id, "currentUserId:", currentUserId);
        }
        return matches;
      }
      // Fallback: если manager_id нет, используем имя менеджера
      const currentUserManager = auth.user?.full_name || auth.user?.first_name || "";
      return it.manager === currentUserManager;
    });
    console.log("📋 ActiveProtectionsPage: после фильтра 'Мои защиты':", filteredItems.length, "(было:", beforeMyFilter + ")");
  }
  
  // Фильтруем по поиску
  if (search) {
    const beforeSearch = filteredItems.length;
    filteredItems = filteredItems.filter(it => 
      (it.client || "").toLowerCase().includes(search.toLowerCase()) ||
      (it.partner || "").toLowerCase().includes(search.toLowerCase()) ||
      (it.sku || "").toLowerCase().includes(search.toLowerCase())
    );
    console.log("📋 ActiveProtectionsPage: после поиска:", filteredItems.length, "(было:", beforeSearch + ")");
  }
  
  // Фильтруем по менеджеру (только для вкладки "Все защиты")
  if (managerFilter && activeTab === "all") {
    const beforeManager = filteredItems.length;
    filteredItems = filteredItems.filter(it => it.manager === managerFilter);
    console.log("📋 ActiveProtectionsPage: после фильтра по менеджеру:", filteredItems.length, "(было:", beforeManager + ")");
  }
  
  console.log("📋 ActiveProtectionsPage: итоговый filteredItems.length =", filteredItems.length);

  return (
    <div className="container">
      <div className="header sticky" style={{ gap: 8, alignItems: "center" }}>
        <button className="btn secondary" onClick={onBack} style={{ marginRight: "auto" }}>
          ← Назад
        </button>
        <h1 style={{ margin: 0, fontWeight: 700 }}>
          📋 Активные защиты
        </h1>
        <button className="btn refresh" onClick={load} disabled={loading}>
          {loading ? "⏳ Загрузка..." : "🔄 Обновить"}
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
        {loading ? (
          <div className="card">
            <div className="small" style={{ textAlign: "center", opacity: 0.7 }}>
              ⏳ Загрузка активных защит...
            </div>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="card">
            <div className="small" style={{ textAlign: "center", opacity: 0.7 }}>
              {!Array.isArray(items) || items.length === 0 
                ? (activeTab === "my" ? "У вас нет активных защит" : "Нет активных защит")
                : `Нет защит, соответствующих фильтрам (всего загружено: ${items.length})`}
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
                    {/* Основная информация */}
                    <div style={{ 
                      marginBottom: 12, 
                      padding: 12, 
                      background: "rgba(102, 126, 234, 0.1)", 
                      borderRadius: 12, 
                      border: "1px solid rgba(102, 126, 234, 0.2)" 
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, opacity: 0.9, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                        📋 Основная информация
                      </div>
                      {it.client && (
                        <div className="small" style={{ marginBottom: 6 }}>
                          <b>👤 Клиент:</b> {it.client}
                        </div>
                      )}
                      {it.sku && (
                        <div className="small" style={{ marginBottom: 6 }}>
                          <b>📦 Артикул:</b> {it.sku}
                        </div>
                      )}
                      {it.area_m2 && (
                        <div className="small" style={{ marginBottom: 6 }}>
                          <b>📏 Площадь:</b> {it.area_m2} м²
                        </div>
                      )}
                      {it.manager && (
                        <div className="small" style={{ marginBottom: 6 }}>
                          <b>👨‍💼 Менеджер:</b> {it.manager}
                        </div>
                      )}
                      {it.creator_name && (
                        <div className="small" style={{ marginBottom: 6 }}>
                          <b>👤 Создал:</b> {it.creator_name}
                        </div>
                      )}
                      {it.created_at && (
                        <div className="small" style={{ marginBottom: 6 }}>
                          <b>📅 Создано:</b> {new Date(it.created_at).toLocaleString("ru-RU", { 
                            day: "2-digit", 
                            month: "2-digit", 
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit"
                          })}
                        </div>
                      )}
                      {it.expires_at && (
                        <div className="small" style={{ marginBottom: 6 }}>
                          <b>⏰ Истекает:</b> {new Date(it.expires_at).toLocaleString("ru-RU", { 
                            day: "2-digit", 
                            month: "2-digit", 
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit"
                          })}
                        </div>
                      )}
                      {typeof it.extend_count === "number" && it.extend_count > 0 && (
                        <div className="small">
                          <b>🔄 Продлений:</b> {it.extend_count}
                        </div>
                      )}
                    </div>

                    {/* Партнёр и объект */}
                    {(it.partner || it.partner_city || it.object_city || it.address) && (
                      <div style={{ 
                        marginBottom: 12, 
                        padding: 12, 
                        background: "rgba(34, 197, 94, 0.1)", 
                        borderRadius: 12, 
                        border: "1px solid rgba(34, 197, 94, 0.2)" 
                      }}>
                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, opacity: 0.9, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                          🏢 Партнёр и объект
                        </div>
                        {it.partner && (
                          <div className="small" style={{ marginBottom: 6 }}>
                            <b>🏢 Партнёр:</b> {it.partner}
                          </div>
                        )}
                        {it.partner_city && (
                          <div className="small" style={{ marginBottom: 6 }}>
                            <b>🌆 Город партнёра:</b> {it.partner_city}
                          </div>
                        )}
                        {it.object_city && (
                          <div className="small" style={{ marginBottom: 6 }}>
                            <b>📍 Город объекта:</b> {it.object_city}
                          </div>
                        )}
                        {it.address && (
                          <div className="small">
                            <b>🚚 Адрес:</b> {it.address}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Дополнительная информация */}
                    {(it.last4 || it.comment) && (
                      <div style={{ 
                        marginBottom: 12, 
                        padding: 12, 
                        background: "rgba(251, 191, 36, 0.1)", 
                        borderRadius: 12, 
                        border: "1px solid rgba(251, 191, 36, 0.2)" 
                      }}>
                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, opacity: 0.9, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                          ℹ️ Дополнительная информация
                        </div>
                        {it.last4 && (
                          <div className="small" style={{ marginBottom: 6 }}>
                            <b>🔢 Последние 4 цифры:</b> {it.last4}
                          </div>
                        )}
                        {it.comment && (
                          <div className="small">
                            <b>💬 Комментарий:</b> {it.comment}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Статус и причины */}
                    {it.close_reason && (
                      <div className="small" style={{ marginTop: 8, padding: 8, background: "rgba(255, 85, 85, 0.1)", borderRadius: 8, border: "1px solid rgba(255, 85, 85, 0.2)" }}>
                        🔒 <b>Причина закрытия:</b> {it.close_reason}
                      </div>
                    )}
                    {it.success_doc && (
                      <div className="small" style={{ marginTop: 8, padding: 8, background: "rgba(61, 220, 151, 0.1)", borderRadius: 8, border: "1px solid rgba(61, 220, 151, 0.2)" }}>
                        ✅ <b>Документ 1С:</b> {it.success_doc}
                      </div>
                    )}
                    {it.delete_reason && (
                      <div className="small" style={{ marginTop: 8, padding: 8, background: "rgba(239, 68, 68, 0.1)", borderRadius: 8, border: "1px solid rgba(239, 68, 68, 0.2)" }}>
                        🗑️ <b>Причина удаления:</b> {it.delete_reason}
                      </div>
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

      {extendRequestModal.open && (
        <Modal
          title="Запрос на продление защиты"
          onClose={() => setExtendRequestModal({ open: false, id: null, reason: "", days: 10, message: "" })}
          onOk={submitExtendRequest}
          okText="📤 Отправить запрос"
        >
          <div className="small" style={{ marginBottom: 12, color: "rgba(255, 255, 255, 0.8)" }}>
            {extendRequestModal.message}
          </div>
          <textarea
            className="input"
            placeholder="Причина продления (например: клиент ждёт оплату, перенос поставки и т.п.)"
            value={extendRequestModal.reason}
            onChange={(e) =>
              setExtendRequestModal({ ...extendRequestModal, reason: e.target.value })
            }
            style={{ 
              minHeight: 80, 
              maxHeight: 150,
              width: "100%", 
              resize: "vertical",
              fontSize: "16px", // Предотвращаем зум на iOS
              padding: "12px",
              boxSizing: "border-box"
            }}
          />
        </Modal>
      )}
    </div>
  );
}

// Компонент: Архив защит (только закрытые защиты с поиском)
function ArchivePage({
  items, expanded, toggleExpand, search, setSearch,
  managerFilter, setManagerFilter, managers, load, loading, onBack
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
        <button className="btn refresh" onClick={load} disabled={loading}>
          {loading ? "⏳ Загрузка..." : "🔄 Обновить"}
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
        {loading ? (
          <div className="card">
            <div className="small" style={{ textAlign: "center", opacity: 0.7 }}>
              ⏳ Загрузка архива...
            </div>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="card">
            <div className="small" style={{ textAlign: "center", opacity: 0.7 }}>
              {items.length === 0 ? "Нет закрытых защит в архиве" : "Нет защит, соответствующих фильтрам"}
            </div>
          </div>
        ) : (
          filteredItems.map((it) => {
            const statusText = 
              it.status === "success" ? "✅ Успешна" :
              it.status === "closed" && it.close_reason && it.close_reason.includes("бездействие") ? "⏰ Закрыта (автоматически)" :
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
                      {it.created_at && ` | Создано: ${new Date(it.created_at).toLocaleDateString()}`}
                    </div>
                    {it.area_m2 && (
                      <div className="small" style={{ marginTop: 4, opacity: 0.9 }}>
                        📏 Метраж: {it.area_m2} м²
                      </div>
                    )}
                    {it.sku && (
                      <div className="small" style={{ marginTop: 4, opacity: 0.9 }}>
                        📦 SKU: {it.sku}
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
                    {it.close_reason && (
                      <div className="small" style={{ 
                        marginTop: 8, 
                        padding: 8, 
                        background: it.close_reason.includes("бездействие") 
                          ? "rgba(255, 193, 7, 0.1)" 
                          : "rgba(239, 68, 68, 0.1)", 
                        borderRadius: 8, 
                        border: `1px solid ${it.close_reason.includes("бездействие") ? "rgba(255, 193, 7, 0.2)" : "rgba(239, 68, 68, 0.2)"}`
                      }}>
                        {it.close_reason.includes("бездействие") ? "⏰" : "🔒"} <b>Причина закрытия:</b> {it.close_reason}
                      </div>
                    )}
                    {it.success_doc && (
                      <div className="small" style={{ marginTop: 8, padding: 8, background: "rgba(34, 197, 94, 0.1)", borderRadius: 8, border: "1px solid rgba(34, 197, 94, 0.2)" }}>
                        ✅ <b>Документ 1С:</b> {it.success_doc}
                      </div>
                    )}
                    {it.delete_reason && (
                      <div className="small" style={{ marginTop: 8, padding: 8, background: "rgba(156, 163, 175, 0.1)", borderRadius: 8, border: "1px solid rgba(156, 163, 175, 0.2)" }}>
                        🗑️ <b>Причина удаления:</b> {it.delete_reason}
                      </div>
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
        // Если нет данных пользователя, но есть токен - используем его
        if (auth.token) {
          return;
        }
        // Если нет ни токена, ни данных - показываем ошибку
        return;
      }

      const user = tg.initDataUnsafe.user;

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
          if (!data.ok) {
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
          // Не очищаем токен, если он был - возможно это временная ошибка сети
        });
    } catch (err) {
      // Ошибка инициализации Telegram WebApp
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
  const [loading, setLoading] = useState(false);
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
  const [extendRequestModal, setExtendRequestModal] = useState({ open: false, id: null, reason: "", days: 10, message: "" });

  const load = async () => {
    setLoading(true);
    try {
      // Загружаем данные в зависимости от текущего route
      if (route === "stats") {
        // Для статистики загружаем только stats
        const s = await api.get("/api/stats");
        setStats(s.data || []);
      } else if (route === "archive") {
        // Для архива загружаем все неактивные защиты (success, closed, deleted)
        const list = await api.get("/api/protections", {
          params: { manager: managerFilter || "", status: "archived", search: search || "" },
        });
        let data = list.data || [];
        // Бэкенд уже возвращает только неактивные защиты (success, closed, deleted, archived)
        // Дополнительная фильтрация не нужна, но на всякий случай оставляем
        data = data.filter((it) => it.status !== "active" && it.status !== "pending");
        setItems(data);
      } else if (route === "active") {
        // Для активных защит загружаем только активные
        const list = await api.get("/api/protections", {
          params: { manager: managerFilter || "", status: "active", search: search || "" },
        });
        let data = list.data || [];
        // Убеждаемся, что все защиты активны (на всякий случай)
        data = data.filter(it => it.status === "active");
        setItems(data);
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
    } catch (err) {
      if (route === "archive" || route === "active") {
        setItems([]);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    const r = await api.get("/api/history");
    setHistory(r.data || []);
  };

  useEffect(() => {
    // Загружаем данные при смене route
    load();

    // Загружаем справочники только один раз (кэшируем в localStorage)
    const cachedSkus = localStorage.getItem("cached_skus");
    const cachedManagers = localStorage.getItem("cached_managers");
    const cacheTime = 5 * 60 * 1000; // 5 минут
    
    if (cachedSkus) {
      try {
        const { data, timestamp } = JSON.parse(cachedSkus);
        if (Date.now() - timestamp < cacheTime) {
          setSkus(data);
        } else {
          localStorage.removeItem("cached_skus");
        }
      } catch (e) {
        localStorage.removeItem("cached_skus");
      }
    }
    
    if (cachedManagers) {
      try {
        const { data, timestamp } = JSON.parse(cachedManagers);
        if (Date.now() - timestamp < cacheTime) {
          setManagers(data);
        } else {
          localStorage.removeItem("cached_managers");
        }
      } catch (e) {
        localStorage.removeItem("cached_managers");
      }
    }
    
    // Загружаем справочники только если нет кэша или кэш устарел
    if (!cachedSkus || Date.now() - JSON.parse(cachedSkus).timestamp >= cacheTime) {
      api.get("/api/skus").then((r) => {
        const dataRaw = Array.isArray(r.data) ? r.data : r.data?.skus || [];
        const normalized = dataRaw.map((x) => ({
          sku: x.sku || x.article || x.art || x.name || "",
          type: x.type || x.category || x.kind || x.group || "",
          collection: x.collection || x.series || x.line || "",
        }));
        setSkus(normalized);
        localStorage.setItem("cached_skus", JSON.stringify({ data: normalized, timestamp: Date.now() }));
      });
    }
    
    if (!cachedManagers || Date.now() - JSON.parse(cachedManagers).timestamp >= cacheTime) {
      api.get("/api/managers").then((r) => {
        const dataRaw = Array.isArray(r.data) ? r.data : r.data?.managers || [];
        const normalized = dataRaw.map((m) => ({
          id: m.id,
          first_name: m.name || m.first_name || "",
        }));
        setManagers(normalized);
        localStorage.setItem("cached_managers", JSON.stringify({ data: normalized, timestamp: Date.now() }));
      });
    }

    if (showHistory) loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, managerFilter, statusFilter, search]); // Загружаем при смене route и фильтров

  // Обработчик события выхода
  useEffect(() => {
    const handleLogout = () => {
      localStorage.clear();
      setAuth({ token: "", role: "", user: null });
      setTokenValid(false);
      // Не устанавливаем route, чтобы показалась страница логина
    };

    window.addEventListener("auth:logout", handleLogout);
    return () => {
      window.removeEventListener("auth:logout", handleLogout);
    };
  }, []);

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
        // Открываем модальное окно вместо prompt
        setExtendRequestModal({
          open: true,
          id,
          reason: "",
            days,
          message: det?.msg || "Лимит продлений. Введите причину продления:"
          });
      } else {
        alert("Не удалось продлить.");
      }
    }
  };

  const submitExtendRequest = async () => {
    if (!extendRequestModal.reason.trim()) {
      alert("⚠️ Причина не указана — запрос отменён.");
      return;
    }

    try {
      await api.post(`/api/protections/${extendRequestModal.id}/request-extend`, {
        days: extendRequestModal.days,
        reason: extendRequestModal.reason.trim(),
      });
      alert("✅ Запрос на продление отправлен администратору.");
      setExtendRequestModal({ open: false, id: null, reason: "", days: 10, message: "" });
      await load();
    } catch (err) {
      alert("Ошибка при отправке запроса на продление.");
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
    const [initialLoading, setInitialLoading] = useState(true);
    // Используем общий loading для загрузки данных

  useEffect(() => {
    // Устанавливаем data-атрибут для Telegram WebApp
    if (typeof document !== "undefined") {
      if (isTG) {
        document.body.setAttribute("data-telegram-webapp", "true");
      } else {
        document.body.removeAttribute("data-telegram-webapp");
      }
    }
    
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
      // Telegram WebApp init error
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
            // Не удалось обновить данные пользователя
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
    return (
      <Suspense fallback={
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
          <div style={{ opacity: 0.7 }}>Загрузка админки...</div>
        </div>
      }>
        <AdminPage onBack={goHome} />
      </Suspense>
    );
  }

  // ==== ГЛАВНЫЙ ЭКРАН С КАРТОЧКАМИ ====
  if (route === "home") {
    // Используем full_name, которое может быть установлено админом, иначе first_name
    const userName = auth.user?.full_name || auth.user?.first_name || "Пользователь";
    const currentRole = auth.role || auth.user?.role || role;
    const isAdmin = currentRole === "admin" || currentRole === "superadmin";

    const handleLogout = () => {
      if (window.confirm("Вы уверены, что хотите выйти из аккаунта?")) {
        localStorage.clear();
        setAuth({ token: "", role: "", user: null });
        setTokenValid(false);
        window.dispatchEvent(new CustomEvent("auth:logout"));
        // Не устанавливаем route, чтобы показалась страница логина
      }
    };

  return (
    <div className="container">
        <ThemeToggle />
        <div className="home-header">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className="home-greeting">Привет, {userName} 👋</h1>
            <p className="home-subtitle">Выберите раздел для работы</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
        extendRequestModal={extendRequestModal}
        setExtendRequestModal={setExtendRequestModal}
        submitExtendRequest={submitExtendRequest}
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
        loading={loading}
        onBack={goHome}
        extendRequestModal={extendRequestModal}
        setExtendRequestModal={setExtendRequestModal}
        submitExtendRequest={submitExtendRequest}
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
        loading={loading}
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

  // ==== НАСТРОЙКИ ====
  if (route === "settings") {
    return (
      <div className="container" style={{ position: "relative", minHeight: "100vh" }}>
        <ThemeToggle />
        <div className="header sticky" style={{ gap: 8, alignItems: "center" }}>
          <button className="btn secondary" onClick={goHome} style={{ marginRight: "auto" }}>
            ← Назад
          </button>
          <h1 style={{ margin: 0, fontWeight: 700 }}>
            ⚙️ Настройки
          </h1>
        </div>
        {/* Фиксированная кнопка "назад" на мобильной версии */}
        <button 
          className="fixed-back-button" 
          onClick={goHome}
          aria-label="Назад"
        >
          ←
        </button>
        
        {/* Размытый контент с сообщением о разработке */}
        <div style={{ 
          marginTop: 16,
          filter: "blur(8px)",
          pointerEvents: "none",
          userSelect: "none",
          opacity: 0.5
        }}>
          <div className="card">
            <h2>Мой профиль</h2>
            <div className="row">
              <input className="input" placeholder="Имя" value={auth.user?.full_name || ""} disabled />
              <input className="input" placeholder="Телефон" value={auth.user?.phone || ""} disabled />
              <input className="input" placeholder="Должность" value={auth.user?.position || ""} disabled />
            </div>
          </div>
        </div>
        
        {/* Сообщение о разработке */}
        <div style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 1000,
          background: "linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%)",
          border: "2px solid rgba(102, 126, 234, 0.5)",
          borderRadius: 24,
          padding: "32px 24px",
          textAlign: "center",
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.5)",
          maxWidth: "90%",
          width: "400px",
          backdropFilter: "blur(10px)"
        }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>🚧</div>
          <h2 style={{ margin: "0 0 12px 0", color: "#fff", fontWeight: 700 }}>
            Раздел в разработке
          </h2>
          <p style={{ margin: 0, color: "rgba(255, 255, 255, 0.7)", fontSize: 16 }}>
            Данный раздел находится в разработке
          </p>
          <button 
            className="btn" 
            onClick={goHome}
            style={{ marginTop: 24, width: "100%" }}
          >
            Вернуться на главную
          </button>
        </div>
      </div>
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
