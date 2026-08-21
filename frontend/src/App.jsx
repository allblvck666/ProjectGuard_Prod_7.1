// frontend/src/App.jsx
import axios from "axios";
import { api, fetchMe, adminUsersAPI } from "./api";

// Ленивая загрузка AdminPage - загружается только когда нужен
import { lazy, Suspense, memo, useMemo, useEffect } from "react";
const AdminPage = lazy(() => import("./AdminPage.jsx"));

// Новый слой представления (редизайн) — включается флагами, см. pg/flags.js
import { useNewUi } from "./pg/useFlags";
import { setFlag } from "./pg/flags";
import { BACK_PRIORITY, isTelegramApp, useBackButton } from "./pg/telegram";
import { notify } from "./pg/notify";
import { onDictsChanged } from "./pg/dicts";
import TabBar, { TABBAR_ROUTES } from "./pg/TabBar";
const UiKitPage = lazy(() => import("./pg/UiKit.jsx"));
const ProtectionsListNew = lazy(() => import("./pg/ProtectionsList.jsx"));
const ProtectionDetailNew = lazy(() => import("./pg/ProtectionDetail.jsx"));
const CreateProtectionNew = lazy(() => import("./pg/CreateProtection.jsx"));
const ArchiveListNew = lazy(() => import("./pg/ArchiveList.jsx"));
const StatsScreenNew = lazy(() => import("./pg/StatsScreen.jsx"));
const AdminScreenNew = lazy(() => import("./pg/AdminScreen.jsx"));
const HomeScreenNew = lazy(() => import("./pg/HomeScreen.jsx"));
const MoreScreenNew = lazy(() => import("./pg/MoreScreen.jsx"));

import { useState } from "react";
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
              <div style={{ color: "var(--hint)", marginBottom: 4 }}>Всего защит</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{s.total || 0}</div>
            </div>
            <div>
              <div style={{ color: "var(--hint)", marginBottom: 4 }}>Активных</div>
              <div style={{ fontWeight: 700, fontSize: 18, color: "#3ddc97" }}>{s.active_cnt || s.active || 0}</div>
            </div>
            <div>
              <div style={{ color: "var(--hint)", marginBottom: 4 }}>Активных (м²)</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{s.active_area || 0} м²</div>
            </div>
            <div>
              <div style={{ color: "var(--hint)", marginBottom: 4 }}>Успешных</div>
              <div style={{ fontWeight: 700, fontSize: 18, color: "#4ade80" }}>{s.success_cnt || s.success || 0}</div>
            </div>
            <div>
              <div style={{ color: "var(--hint)", marginBottom: 4 }}>Успешных (м²)</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{s.success_area || 0} м²</div>
            </div>
            <div>
              <div style={{ color: "var(--hint)", marginBottom: 4 }}>Закрытых</div>
              <div style={{ fontWeight: 700, fontSize: 18, color: "#f87171" }}>{s.closed_cnt || s.closed || 0}</div>
            </div>
            <div>
              <div style={{ color: "var(--hint)", marginBottom: 4 }}>Закрытых (м²)</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{s.closed_area || 0} м²</div>
            </div>
            <div>
              <div style={{ color: "var(--hint)", marginBottom: 4 }}>% Успеха</div>
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
      notify.error("Можно добавить максимум 3 артикула");
      return;
    }
    if (selected.find((s) => s.sku === skuObj.sku && s.type === skuObj.type)) {
      notify.error("Этот артикул уже добавлен");
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
  // Предотвращаем прокрутку body при открытом модальном окне
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: window.innerWidth <= 768 ? "16px" : "16px",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <div
        className="modal-content"
        style={{
          width: "100%",
          maxWidth: 420,
          maxHeight: window.innerWidth <= 768 ? "calc(100dvh - 32px)" : "90vh",
          overflowY: "auto",
          borderRadius: "24px",
          display: "flex",
          flexDirection: "column",
          color: "var(--text)",
          WebkitOverflowScrolling: "touch",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0, marginBottom: 16, flexShrink: 0 }}>{title}</h3>
        <div style={{ margin: "12px 0", flex: "1 1 auto", overflowY: "auto", minHeight: 0 }}>{children}</div>
        <div style={{ 
          display: "flex", 
          gap: 8, 
          justifyContent: "flex-end", 
          marginTop: 16, 
          paddingTop: 16, 
          borderTop: "1px solid var(--border)",
          flexShrink: 0,
          position: "sticky",
          bottom: 0,
          background: "inherit",
          zIndex: 10
        }}>
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
  extendRequestModal, setExtendRequestModal, submitExtendRequest,
  similarProtectionModal, setSimilarProtectionModal, submitSimilarProtectionRequest
}) {
  const errorClass = (field) => errorFields.includes(field) ? "input error" : "input";

  return (
    <div className="container">
      <div className="header sticky" style={{ gap: 8, alignItems: "center" }}>
        <button className="btn secondary pg-legacy-back" onClick={onBack} style={{ marginRight: "auto" }}>
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
              Имя клиент / организация (конечник) <span style={{ color: "#ef4444" }}>*</span>
            </span>
            <input
              className={errorClass("client")}
              placeholder="Имя клиент / организация (конечник)"
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
                ⚠️ Заполните поле "Имя клиент / организация (конечник)"
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

      {/* Модальное окно для похожей защиты */}
      {similarProtectionModal.open && (
        <Modal
          title="⚠️ Похожая защита уже существует"
          onClose={() => setSimilarProtectionModal({ open: false, similarInfo: null, payload: null, requestReason: "" })}
          onOk={submitSimilarProtectionRequest}
          okText="📤 Отправить запрос админу"
        >
          <div style={{ marginBottom: 16 }}>
            <div className="small" style={{ marginBottom: 16, color: "var(--hint)", whiteSpace: "pre-line" }}>
              {similarProtectionModal.similarInfo?.message || "Похожая активная защита уже существует."}
            </div>
            
            {/* Информация о похожей защите */}
            {similarProtectionModal.similarInfo?.similarProtection && (
              <div style={{ 
                padding: 16, 
                background: "rgba(255, 193, 7, 0.15)", 
                borderRadius: 12, 
                border: "2px solid rgba(255, 193, 7, 0.4)",
                marginBottom: 16,
                color: "var(--text)"
              }}>
                <div className="small" style={{ fontWeight: 700, marginBottom: 12, fontSize: 14, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  📋 Информация о существующей защите:
                </div>
                {similarProtectionModal.similarInfo.similarProtection.id && (
                  <div className="small" style={{ marginBottom: 6 }}>
                    <b>🆔 ID:</b> #{similarProtectionModal.similarInfo.similarProtection.id}
                  </div>
                )}
                {similarProtectionModal.similarInfo.similarProtection.manager && (
                  <div className="small" style={{ marginBottom: 6 }}>
                    <b>👤 Менеджер:</b> {similarProtectionModal.similarInfo.similarProtection.manager}
                  </div>
                )}
                {similarProtectionModal.similarInfo.similarProtection.creator_name && (
                  <div className="small" style={{ marginBottom: 6 }}>
                    <b>👤 Создал:</b> {similarProtectionModal.similarInfo.similarProtection.creator_name}
                  </div>
                )}
                {similarProtectionModal.similarInfo.similarProtection.partner && (
                  <div className="small" style={{ marginBottom: 6 }}>
                    <b>🏢 Партнёр:</b> {similarProtectionModal.similarInfo.similarProtection.partner}
                    {similarProtectionModal.similarInfo.similarProtection.partner_city && ` (${similarProtectionModal.similarInfo.similarProtection.partner_city})`}
                  </div>
                )}
                {similarProtectionModal.similarInfo.similarProtection.client && (
                  <div className="small" style={{ marginBottom: 6 }}>
                    <b>👥 Клиент:</b> {similarProtectionModal.similarInfo.similarProtection.client}
                  </div>
                )}
                {similarProtectionModal.similarInfo.similarProtection.sku && (
                  <div className="small" style={{ marginBottom: 6 }}>
                    <b>📦 Артикул:</b> {similarProtectionModal.similarInfo.similarProtection.sku}
                  </div>
                )}
                {similarProtectionModal.similarInfo.similarProtection.area_m2 && (
                  <div className="small" style={{ marginBottom: 6 }}>
                    <b>📏 Площадь:</b> {similarProtectionModal.similarInfo.similarProtection.area_m2} м²
                  </div>
                )}
                {similarProtectionModal.similarInfo.similarProtection.object_city && (
                  <div className="small" style={{ marginBottom: 6 }}>
                    <b>📍 Город объекта:</b> {similarProtectionModal.similarInfo.similarProtection.object_city}
                  </div>
                )}
                {similarProtectionModal.similarInfo.similarProtection.address && (
                  <div className="small" style={{ marginBottom: 6 }}>
                    <b>🚚 Адрес:</b> {similarProtectionModal.similarInfo.similarProtection.address}
                  </div>
                )}
                {similarProtectionModal.similarInfo.similarProtection.last4 && (
                  <div className="small" style={{ marginBottom: 6 }}>
                    <b>🔢 Последние 4 цифры:</b> {similarProtectionModal.similarInfo.similarProtection.last4}
                  </div>
                )}
                {similarProtectionModal.similarInfo.similarProtection.expires_at && (
                  <div className="small" style={{ marginBottom: 6 }}>
                    <b>⏰ Истекает:</b> {new Date(similarProtectionModal.similarInfo.similarProtection.expires_at).toLocaleString("ru-RU", { 
                      day: "2-digit", 
                      month: "2-digit", 
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </div>
                )}
                {similarProtectionModal.similarInfo.similarProtection.comment && (
                  <div className="small">
                    <b>💬 Комментарий:</b> {similarProtectionModal.similarInfo.similarProtection.comment}
                  </div>
                )}
              </div>
            )}
            
            <div style={{ 
              padding: 12, 
              background: "rgba(102, 126, 234, 0.1)", 
              borderRadius: 8, 
              border: "1px solid rgba(102, 126, 234, 0.3)",
              marginBottom: 12,
              color: "var(--text)"
            }}>
              <div className="small" style={{ fontWeight: 600, marginBottom: 8 }}>
                💬 Укажите причину для администратора:
              </div>
              <textarea
                className="input"
                placeholder="Например: это другой объект, другой клиент, согласовано с менеджером и т.п."
                value={similarProtectionModal.requestReason}
                onChange={(e) =>
                  setSimilarProtectionModal({ ...similarProtectionModal, requestReason: e.target.value })
                }
                style={{ 
                  minHeight: 100, 
                  maxHeight: 200,
                  width: "100%", 
                  resize: "vertical",
                  fontFamily: "inherit"
                }}
              />
            </div>
            <div className="small" style={{ color: "var(--hint)", fontSize: 12 }}>
              ⚠️ Защита будет отправлена администратору на проверку. Вы получите уведомление после решения.
            </div>
          </div>
        </Modal>
      )}
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
  extendRequestModal, setExtendRequestModal, submitExtendRequest,
  updateClosedModal, setUpdateClosedModal, updateClosedProtection
}) {
  const [activeTab, setActiveTab] = useState("my"); // "my" | "all"
  const [search, setSearch] = useState("");
  const [managerFilter, setManagerFilter] = useState("");

  // Получаем manager_id пользователя для фильтрации "Мои защиты"
  // Защиты привязываются к manager_id пользователя, который их создал
  const currentUserId = auth.user?.id || auth.user?.user_id;
  
  // Оптимизированная фильтрация с useMemo
  const filteredItems = useMemo(() => {
    // Начинаем с всех items (они уже должны быть активными)
    let result = Array.isArray(items) ? items : [];
    
    // Фильтруем по вкладке "Мои защиты" или "Все защиты"
    if (activeTab === "my") {
      // Мои защиты - фильтруем по manager_id из защиты
      const currentUserManager = auth.user?.full_name || auth.user?.first_name || "";
      result = result.filter(it => {
        // Если у защиты есть manager_id, сравниваем с manager_id пользователя
        if (it.manager_id && currentUserId) {
          return it.manager_id === currentUserId;
        }
        // Fallback: если manager_id нет, используем имя менеджера
        return it.manager === currentUserManager;
      });
    }
    
    // Фильтруем по поиску
    if (search) {
      const searchLower = search.toLowerCase();
      result = result.filter(it => 
        (it.client || "").toLowerCase().includes(searchLower) ||
        (it.partner || "").toLowerCase().includes(searchLower) ||
        (it.sku || "").toLowerCase().includes(searchLower)
      );
    }
    
    // Фильтруем по менеджеру (только для вкладки "Все защиты")
    if (managerFilter && activeTab === "all") {
      result = result.filter(it => it.manager === managerFilter);
    }
    
    return result;
  }, [items, activeTab, search, managerFilter, currentUserId, auth.user]);

  return (
    <div className="container">
      <div className="header sticky" style={{ gap: 8, alignItems: "center" }}>
        <button className="btn secondary pg-legacy-back" onClick={onBack} style={{ marginRight: "auto" }}>
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
                    <b>{it.partner || "—"}</b> — {it.sku || "—"}{" "}
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

      {/* Модальное окно для редактирования закрытых защит */}
      {updateClosedModal.open && (
        <Modal
          title={updateClosedModal.mode === "success" ? "✅ Отметить защиту как успешную" : "✏️ Добавить причину закрытия"}
          onClose={() => setUpdateClosedModal({ open: false, id: null, close_reason: "", success_doc: "", mode: "reason" })}
          onOk={updateClosedProtection}
          okText={updateClosedModal.mode === "success" ? "✅ Сохранить" : "💾 Сохранить"}
        >
          {updateClosedModal.mode === "success" ? (
            <div>
              <div className="small" style={{ marginBottom: 12, color: "rgba(255, 255, 255, 0.8)" }}>
                Укажите номер документа из 1С для отметки защиты как успешной:
              </div>
              <input
                className="input"
                placeholder="Номер документа 1С"
                value={updateClosedModal.success_doc}
                onChange={(e) => setUpdateClosedModal({ ...updateClosedModal, success_doc: e.target.value })}
                style={{ marginBottom: 10 }}
              />
              <div className="small" style={{ marginTop: 6, opacity: 0.8 }}>
                💡 После сохранения защита будет отмечена как успешная и появится в статистике
              </div>
            </div>
          ) : (
            <div>
              <div className="small" style={{ marginBottom: 12, color: "rgba(255, 255, 255, 0.8)" }}>
                Укажите причину закрытия защиты:
              </div>
              <textarea
                className="input"
                placeholder="Причина закрытия защиты"
                value={updateClosedModal.close_reason}
                onChange={(e) => setUpdateClosedModal({ ...updateClosedModal, close_reason: e.target.value })}
                style={{ minHeight: 100, marginBottom: 10 }}
              />
              <div className="small" style={{ marginTop: 6, opacity: 0.8 }}>
                💡 Причина будет сохранена в истории защиты
              </div>
            </div>
          )}
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
  managerFilter, setManagerFilter, managers, load, loading, onBack,
  updateClosedModal, setUpdateClosedModal,
  // Передаётся только при ?ui-detail=new: тап по карточке открывает
  // новую карточку защиты вместо разворачивания подробностей.
  onOpenDetail
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
        <button className="btn secondary pg-legacy-back" onClick={onBack} style={{ marginRight: "auto" }}>
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
                <div
                  className="line"
                  onClick={() => (onOpenDetail ? onOpenDetail(it.id) : toggleExpand(it.id))}
                >
                  <div>
                    <b>{it.partner || "—"}</b> — {it.sku || "—"}{" "}
                    {it.area_m2 ? `(${it.area_m2} м²)` : ""}
                    <div className="small">
                      {statusText} | Менеджер: {it.manager}
                      {it.action_actor && it.action_at && (
                        ` | Действие: ${it.action_actor} (${new Date(it.action_at).toLocaleString()})`
                      )}
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
                    {onOpenDetail ? "›" : expanded[it.id] ? "▲" : "▼"}
                  </div>
                </div>

                {!onOpenDetail && expanded[it.id] && (
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
                    {it.action_actor && it.action_at && (
                      <div className="small" style={{ marginTop: 8, padding: 8, background: "rgba(59, 130, 246, 0.1)", borderRadius: 8, border: "1px solid rgba(59, 130, 246, 0.2)" }}>
                        👤 <b>Действие выполнено:</b> {it.action_actor} | 📅 {new Date(it.action_at).toLocaleString()}
                      </div>
                    )}
                    
                    {/* Кнопки для редактирования закрытых защит */}
                    {(it.status === "closed" || it.status === "deleted" || it.status === "success") && (
                      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {it.status !== "success" && (
                          <button
                            className="btn"
                            style={{ flex: "1 1 auto", minWidth: "120px", fontSize: "14px", padding: "8px 12px" }}
                            onClick={() => {
                              const user = JSON.parse(localStorage.getItem("auth_user") || "{}");
                              const isAuthor = user.id && it.manager_id && user.id === it.manager_id;
                              const isAdmin = user.role === "admin" || user.role === "superadmin";
                              
                              if (!isAuthor && !isAdmin) {
                                notify.error("Обновить защиту может только её автор или администратор");
                                return;
                              }
                              
                              setUpdateClosedModal({
                                open: true,
                                id: it.id,
                                close_reason: it.close_reason || "",
                                success_doc: "",
                                mode: "reason"
                              });
                            }}
                          >
                            ✏️ Добавить причину
                          </button>
                        )}
                        {it.status !== "success" && (
                          <button
                            className="btn"
                            style={{ flex: "1 1 auto", minWidth: "120px", fontSize: "14px", padding: "8px 12px", background: "#22c55e", color: "white" }}
                            onClick={() => {
                              const user = JSON.parse(localStorage.getItem("auth_user") || "{}");
                              const isAuthor = user.id && it.manager_id && user.id === it.manager_id;
                              const isAdmin = user.role === "admin" || user.role === "superadmin";
                              
                              if (!isAuthor && !isAdmin) {
                                notify.error("Обновить защиту может только её автор или администратор");
                                return;
                              }
                              
                              setUpdateClosedModal({
                                open: true,
                                id: it.id,
                                close_reason: "",
                                success_doc: it.success_doc || "",
                                mode: "success"
                              });
                            }}
                          >
                            ✅ Отметить как успешную
                          </button>
                        )}
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
        <button className="btn secondary pg-legacy-back" onClick={onBack} style={{ marginRight: "auto" }}>
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

  // Витрина дизайн-системы: ?ui-kit=1
  const showUiKit = useNewUi("ui-kit");
  // Новая главная: ?ui-home=new
  const newHome = useNewUi("ui-home");
  // Новый список активных защит: ?ui-list=new
  const newList = useNewUi("ui-list");
  // Новая карточка защиты: ?ui-detail=new
  const newDetail = useNewUi("ui-detail");
  // Новое создание защиты и экран конфликта: ?ui-create=new
  const newCreate = useNewUi("ui-create");
  // Новый архив: ?ui-archive=new
  const newArchive = useNewUi("ui-archive");
  // Новая админка и статистика: ?ui-admin=new
  const newAdmin = useNewUi("ui-admin");
  // Нативная навигация Telegram: ?ui-nav=new
  const newNav = useNewUi("ui-nav");
  const nativeNav = newNav && isTelegramApp();

  const [tokenVerified, setTokenVerified] = useState(false);
  const [tokenValid, setTokenValid] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const body = document.body;
    const getStoredTheme = () => {
      const saved = localStorage.getItem("theme");
      return saved === "light" || saved === "dark" ? saved : null;
    };
    const applyTheme = (theme) => {
      const isLightTheme = theme === "light";
      body.classList.toggle("light-theme", isLightTheme);
      window.dispatchEvent(new CustomEvent("app-theme-sync", { detail: { theme } }));
      return isLightTheme;
    };

    if (!isTG) {
      body.removeAttribute("data-telegram-webapp");
      const savedTheme = getStoredTheme();
      applyTheme(savedTheme === "light" ? "light" : "dark");
      return undefined;
    }

    const tg = window.Telegram?.WebApp;
    if (!tg) {
      body.setAttribute("data-telegram-webapp", "true");
      return undefined;
    }

    const resolveTheme = () => {
      const savedTheme = getStoredTheme();
      if (savedTheme) {
        return savedTheme;
      }

      const isLightScheme =
        tg.colorScheme === "light" ||
        (typeof tg.themeParams?.bg_color === "string" &&
          tg.themeParams.bg_color.toLowerCase() === "#ffffff");
      return isLightScheme ? "light" : "dark";
    };

    const syncTelegramTheme = (forcedTheme) => {
      const theme = forcedTheme || resolveTheme();
      const isLightTheme = applyTheme(theme);
      const shellColor = isLightTheme ? "#f8fafc" : "#0d1320";

      body.setAttribute("data-telegram-webapp", "true");

      try {
        tg.setHeaderColor(shellColor);
      } catch (e) {
        // ignore Telegram shell color errors
      }

      try {
        tg.setBackgroundColor(shellColor);
      } catch (e) {
        // ignore Telegram shell color errors
      }
    };

    const handleManualThemeChange = (event) => {
      const nextTheme = event?.detail?.theme;
      if (nextTheme === "light" || nextTheme === "dark") {
        syncTelegramTheme(nextTheme);
      } else {
        syncTelegramTheme();
      }
    };

    syncTelegramTheme();
    tg.onEvent?.("themeChanged", syncTelegramTheme);
    window.addEventListener("app-theme-change", handleManualThemeChange);

    return () => {
      tg.offEvent?.("themeChanged", syncTelegramTheme);
      window.removeEventListener("app-theme-change", handleManualThemeChange);
    };
  }, [isTG]);

  // Панель разделов внизу — только на корневых экранах нового UI.
  // На вложенных (карточка защиты, создание, админка) её нет: назад ведёт Telegram.
  const tabsOn =
    TABBAR_ROUTES.includes(route) &&
    ((route === "home" && newHome) ||
      (route === "active" && newList) ||
      (route === "archive" && newArchive) ||
      route === "more");

  // Нативная навигация: «Назад» для всех экранов на самом низком приоритете —
  // новые экраны перекрывают его своим обработчиком, когда открыт слой поверх.
  useBackButton(
    () => setRoute("home"),
    nativeNav && route !== "home" && !tabsOn,
    BACK_PRIORITY.app
  );

  // Экраны поджимаются на высоту панели разделов, чтобы контент не уезжал под неё
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const root = document.documentElement;
    if (tabsOn) root.setAttribute("data-pg-tabs", "on");
    else root.removeAttribute("data-pg-tabs");
    return () => root.removeAttribute("data-pg-tabs");
  }, [tabsOn]);

  // Метка для CSS: прячем свои «← Назад» и плавающую стрелку на старых экранах,
  // но только когда кнопку действительно рисует Telegram.
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const root = document.documentElement;
    if (nativeNav) root.setAttribute("data-pg-nav", "native");
    else root.removeAttribute("data-pg-nav");
    return () => root.removeAttribute("data-pg-nav");
  }, [nativeNav]);

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
            // Админку открываем по запросу из «Ещё», а не вместо главной
            setRoute("home");
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
          init_data: tg.initData || "",
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

          setRoute("home");

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

        setRoute("home");

        // Показываем уведомление только в браузере
        if (!isTG) {
          notify.success("Вход выполнен как " + role);
        } else {
          const tg = window.Telegram?.WebApp;
          if (tg?.HapticFeedback) {
            tg.HapticFeedback.notificationOccurred("success");
          }
        }
      } else {
        notify.error("Ошибка входа");
      }
    } catch (err) {
      notify.error("Ошибка запроса к серверу");
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
      notify.error("Нет прав доступа к админке");
    }
  };

  const goMain = () => {
    setRoute("home");
  };

  const goHome = () => {
    setListFilter(null);
    setRoute("home");
  };
  const goMore = () => setRoute("more");
  // Статистика, админка и настройки живут в «Ещё» — назад логичнее туда
  const goBackFromSecondary = () => (newHome ? goMore() : goHome());
  const goCreate = () => setRoute("create");
  const goActive = () => setRoute("active");
  const goArchive = () => setRoute("archive");
  const goStats = () => setRoute("stats");
  const goSettings = () => setRoute("settings");

  // ===== Основное состояние приложения =====
  const [stats, setStats] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  // Карточка защиты, открытая из архива (в списке она живёт внутри экрана списка)
  const [archiveDetailId, setArchiveDetailId] = useState(null);
  // Карточка защиты, открытая с главной, и предустановленный фильтр списка
  const [homeDetailId, setHomeDetailId] = useState(null);
  const [listFilter, setListFilter] = useState(null);
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
    // Бэкенд склеивает артикулы двумя способами:
    //   "AF1 (Тип) + AF2 (Тип)"                      — единый метраж, «м²» в строке нет
    //   "AF1 (Тип) — 180 м²; AF2 (Тип) — 140 м²"     — метраж по артикулам
    // Раньше разбирался только второй вариант, и у защит с единым метражом
    // список артикулов открывался пустым.
    const parts = (item.sku || "")
      .split(/;|\s\+\s/)
      .map((p) => p.trim())
      .filter(Boolean);
    for (const p of parts) {
      const m = p.match(/^(.+?)\s*\(([^)]*)\)(?:\s*[—-]\s*([\d.,]+)\s*м²)?\s*$/);
      if (m) {
        parsed.push({
          sku: m[1].trim(),
          type: (m[2] || "").trim(),
          area: m[3] ? m[3].replace(",", ".") : "",
        });
      } else {
        // артикул без типа, как в старых записях
        parsed.push({ sku: p, type: "", area: "" });
      }
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
      notify.error("Минимум 50 м²");
      return;
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
      const userMessage = err.userMessage || err.response?.data?.detail || "Ошибка при редактировании защиты";
      notify.error(userMessage);
    }
  };

  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const [extendRequestModal, setExtendRequestModal] = useState({ open: false, id: null, reason: "", days: 10, message: "" });
  const [similarProtectionModal, setSimilarProtectionModal] = useState({ 
    open: false, 
    similarInfo: null, 
    payload: null, 
    requestReason: "" 
  });

  // === Редактирование закрытых защит (для архива) ===
  const [updateClosedModal, setUpdateClosedModal] = useState({
    open: false,
    id: null,
    close_reason: "",
    success_doc: "",
    mode: "reason" // "reason" | "success"
  });

  // === Обновление закрытых защит ===
  const updateClosedProtection = async () => {
    if (!updateClosedModal.id) return;
    
    const payload = {};
    if (updateClosedModal.mode === "reason" && updateClosedModal.close_reason.trim()) {
      payload.close_reason = updateClosedModal.close_reason.trim();
    }
    if (updateClosedModal.mode === "success" && updateClosedModal.success_doc.trim()) {
      payload.success_doc = updateClosedModal.success_doc.trim();
    }
    
    if (Object.keys(payload).length === 0) {
      notify.error("Заполните хотя бы одно поле");
      return;
    }
    
    try {
      await api.put(`/api/protections/${updateClosedModal.id}/update-closed`, payload);
      setUpdateClosedModal({ open: false, id: null, close_reason: "", success_doc: "", mode: "reason" });
      await load();
      notify.success("Защита обновлена");
    } catch (err) {
      const userMessage = err.userMessage || err.response?.data?.detail || "Ошибка при обновлении защиты";
      notify.error(userMessage);
    }
  };

  const load = async () => {
    setLoading(true);
    setLoadError(null);
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
      // Используем понятное сообщение из interceptor, если есть
      const errorMessage = err.userMessage || err.response?.data?.detail || "Ошибка загрузки данных";
      setLoadError(typeof errorMessage === "string" ? errorMessage : "Ошибка загрузки данных");
      if (route === "archive" || route === "active") {
        setItems([]);
      }
      // Показываем ошибку только если это не первая загрузка или если это критическая ошибка
      if (err.response?.status >= 500 || err.code === "ERR_NETWORK") {
        // Критическая ошибка - показываем пользователю
        if (import.meta.env.DEV) {
          console.error("Ошибка загрузки:", errorMessage);
        }
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

    loadDicts();

    if (showHistory) loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, managerFilter, statusFilter, search]); // Загружаем при смене route и фильтров

  // Справочники: кэш на 5 минут, но после правок в админке читаем заново
  function loadDicts(force = false) {
    const cachedSkus = force ? null : localStorage.getItem("cached_skus");
    const cachedManagers = force ? null : localStorage.getItem("cached_managers");
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
  }

  // Админка правит справочники — перечитываем их сразу, не дожидаясь кэша
  useEffect(() => onDictsChanged(() => loadDicts(true)), []);

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
      notify.error("Заполните обязательные поля: " + emptyFields.join(", "));
      return false;
    }

    setErrorFields([]);

    if (!form.manager) {
      notify.error("Выберите менеджера");
      return false;
    }
    if (selectedSkus.length === 0) {
      notify.error("Добавьте артикул");
      return false;
    }

    const sku_data = selectedSkus.map((s) => ({
      sku: s.sku,
      type: s.type,
      area: perSkuMode ? Number(s.area || 0) : undefined,
    }));

    const total_area = perSkuMode
      ? sku_data.reduce((sum, it) => sum + Number(it.area || 0), 0)
      : Number(form.area_m2 || 0);

    if (total_area <= 0) {
      notify.error("Укажите метраж");
      return false;
    }

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
      return true;
    } catch (err) {
      // Используем понятное сообщение из interceptor
      const userMessage = err.userMessage;
      const detail = err.response?.data?.detail;

      if (err.response?.status === 409 && detail?.msg) {
        // Конфликт - похожая защита
        const msg = detail.msg;
        const similarProtection = detail?.similar_protection || null;
        const similarInfo = {
          message: msg,
          similarProtection: similarProtection
        };
        setSimilarProtectionModal({
          open: true,
          similarInfo,
          payload,
          requestReason: ""
        });
      } else if (typeof detail === "string") {
        notify.error(detail);
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
            notify.success("Отправлено админу на проверку.");
            await load();
          } catch (subErr) {
            const subUserMessage = subErr.userMessage || subErr.response?.data?.detail || "Ошибка при отправке админу";
            notify.error(subUserMessage);
          }
        } else {
          notify.error("Защита не создана (отменено пользователем).");
        }
      } else if (err.response?.status === 400) {
        const msg = userMessage || detail || "Ошибка данных защиты";
        notify.error(msg);
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
      } else {
        const finalMessage = userMessage || detail || "Не удалось создать защиту. Попробуйте позже.";
        notify.error(finalMessage);
      }
      return false;
    }
  };

  // Ручной пропуск конфликта (админ/суперадмин): защита уходит на проверку
  // и тут же одобряется тем же админом — оба эндпоинта уже есть.
  // Причина обязательна и остаётся в комментарии и в истории защиты.
  const skipConflictManually = async (payload, reason) => {
    const note = `Пропущено вручную: ${reason.trim()}`;
    const body = {
      ...payload,
      comment: payload?.comment ? `${payload.comment} · ${note}` : note,
    };
    try {
      const created = await api.post("/api/protections/pending", body);
      const pendingId = created?.data?.id;
      if (!pendingId) throw new Error("Не получен id защиты");
      await api.post(`/api/admin/pending/${pendingId}/approve`);
      setSimilarProtectionModal({
        open: false, similarInfo: null, payload: null, requestReason: "",
      });
      setForm({
        manager: "", client: "", partner: "", partner_city: "", area_m2: "",
        last4: "", object_city: "", address: "", comment: "",
      });
      setSelectedSkus([]);
      setPerSkuMode(false);
      await load();
      return true;
    } catch (err) {
      const userMessage =
        err.userMessage || err.response?.data?.detail || "Не удалось пропустить защиту";
      notify.error((typeof userMessage === "string" ? userMessage : "Не удалось пропустить защиту"));
      return false;
    }
  };

  const extendAction = async (id, days = 10) => {
    try {
      await api.post(`/api/protections/${id}/extend?days=${days}`);
      await load();
    } catch (err) {
      const userMessage = err.userMessage;
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
        const finalMessage = userMessage || det?.msg || det || "Не удалось продлить защиту";
        notify.error(finalMessage);
      }
    }
  };

  const submitExtendRequest = async () => {
    if (!extendRequestModal.reason.trim()) {
      notify.error("Причина не указана — запрос отменён.");
      return;
    }

    try {
      await api.post(`/api/protections/${extendRequestModal.id}/request-extend`, {
        days: extendRequestModal.days,
        reason: extendRequestModal.reason.trim(),
      });
      notify.success("Запрос на продление отправлен администратору.");
      setExtendRequestModal({ open: false, id: null, reason: "", days: 10, message: "" });
      await load();
    } catch (err) {
      const userMessage = err.userMessage || err.response?.data?.detail || "Ошибка при отправке запроса на продление";
      notify.error(userMessage);
    }
  };

  const submitSimilarProtectionRequest = async () => {
    if (!similarProtectionModal.requestReason.trim()) {
      notify.error("Укажите причину для запроса администратору.");
      return;
    }

    try {
      await api.post("/api/protections/pending", {
        ...similarProtectionModal.payload,
        comment: similarProtectionModal.requestReason.trim(),
      });
      // Новый экран показывает результат сам, старому нужен alert
      if (!newCreate) notify.success("Запрос отправлен администратору на проверку.");
      setSimilarProtectionModal({ open: false, similarInfo: null, payload: null, requestReason: "" });
      await load();
      return true;
    } catch (err) {
      const userMessage = err.userMessage || err.response?.data?.detail || "Ошибка при отправке запроса администратору";
      notify.error(userMessage);
      return false;
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
      const userMessage = e.userMessage || e.response?.data?.detail || "Не удалось закрыть защиту";
      notify.error(userMessage);
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
      const userMessage = e.userMessage || e.response?.data?.detail || "Не удалось отметить как успешную";
      notify.error(userMessage);
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
      const userMessage = e.userMessage || e.response?.data?.detail || "Не удалось удалить защиту";
      notify.error(userMessage);
    }
  };

  // Восстановление закрытой/удалённой защиты — только суперадмин
  const restoreProtection = async (id) => {
    try {
      await api.post(`/api/admin/protections/${id}/restore`);
      await load();
      return true;
    } catch (e) {
      const userMessage =
        e.userMessage || e.response?.data?.detail || "Не удалось восстановить защиту";
      notify.error(userMessage);
      return false;
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

    // В Telegram window.open блокируется вебвью — файл открывается через openLink
    const tg = typeof window !== "undefined" ? window.Telegram?.WebApp : null;
    if (tg?.openLink) {
      try {
        tg.openLink(url);
        return;
      } catch {
        // старый клиент — падаем на обычное открытие
      }
    }
    const win = window.open(url, "_blank");
    if (!win) {
      notify.error("Браузер заблокировал открытие файла. Разрешите всплывающие окна.");
    }
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
        setReady(true);
      }
    } catch (e) {
      // Telegram WebApp init error
    } finally {
      setLoading(false);
    }
    }, [isTG]);

// На новых экранах глобальный лоадер не нужен: у них есть свои состояния
// загрузки, а полноэкранная заглушка размонтировала бы экран на каждом
// обновлении (и сбрасывала бы фильтры и pull-to-refresh).
const usesNewUi =
  (route === "home" && newHome) ||
  (route === "more" && newHome) ||
  (route === "active" && newList) ||
  (route === "create" && newCreate) ||
  (route === "archive" && (newArchive || (newDetail && archiveDetailId != null))) ||
  (route === "stats" && newAdmin) ||
  (route === "admin" && newAdmin);

// 🎨 Витрина дизайн-системы (?ui-kit=1). Отдельный экран, прод-роуты не трогает.
if (showUiKit) {
  return (
    <Suspense fallback={null}>
      <UiKitPage onClose={() => setFlag("ui-kit", "off")} />
    </Suspense>
  );
}

// Пока WebApp инициализируется — показываем загрузку
if (isTG && (!ready || (loading && !usesNewUi))) {
  return (
    <div style={{ 
      padding: 40, 
      textAlign: "center", 
      minHeight: "100dvh",
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
        minHeight: "100dvh",
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
          setRoute("home");
        }}
      />
    );
  }

  // Бейдж на вкладке «Защиты»: сколько защит горит
  const expiringCount = (Array.isArray(items) ? items : []).filter(
    (it) => it.status === "active" && Number(it.days_left) <= 2
  ).length;

  // Корневой экран + панель разделов под ним
  const withTabs = (screen) => (
    <>
      {screen}
      {tabsOn && (
        <TabBar
          active={route}
          onChange={(next) => {
            if (next === "home") goHome();
            else if (next === "active") {
              setListFilter(null);
              goActive();
            } else if (next === "archive") goArchive();
            else goMore();
          }}
          badges={{ active: expiringCount }}
        />
      )}
    </>
  );

  // ==== ЕЩЁ ====
  if (route === "more") {
    return withTabs(
      <Suspense fallback={null}>
        <MoreScreenNew
          auth={auth}
          onStats={goStats}
          onAdmin={goAdmin}
          onExport={exportXlsx}
          onLogout={() => {
            localStorage.clear();
            setAuth({ token: "", role: "", user: null });
            setTokenValid(false);
            window.dispatchEvent(new CustomEvent("auth:logout"));
          }}
        />
      </Suspense>
    );
  }

  // 👑 Админка
  if (route === "admin") {
    if (newAdmin) {
      return (
        <Suspense fallback={null}>
          <AdminScreenNew auth={auth} onBack={goBackFromSecondary} />
        </Suspense>
      );
    }

    return (
      <Suspense fallback={
        <div style={{ 
          padding: 40, 
          textAlign: "center", 
          minHeight: "100dvh",
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
    const doLogout = () => {
      localStorage.clear();
      setAuth({ token: "", role: "", user: null });
      setTokenValid(false);
      window.dispatchEvent(new CustomEvent("auth:logout"));
    };

    // Новая главная (?ui-home=new): сводка по защитам вместо шести плиток
    if (newHome) {
      return withTabs(
        <Suspense fallback={null}>
          <HomeScreenNew
            auth={auth}
            items={items}
            loading={loading}
            load={load}
            onCreate={goCreate}
            onList={(filter) => {
              setListFilter(filter || null);
              goActive();
            }}
            onArchive={goArchive}
            onStats={goStats}
            onAdmin={goAdmin}
            onSettings={() => setRoute("settings")}
            onExport={exportXlsx}
            onLogout={doLogout}
            newDetail={newDetail}
            detailId={homeDetailId}
            setDetailId={setHomeDetailId}
            act={act}
            openEditModal={openEditModal}
            restoreProtection={restoreProtection}
            sheets={{
              closeModal, setCloseModal, doClose,
              successModal, setSuccessModal, doSuccess,
              deleteModal, setDeleteModal, doDelete,
              extendRequestModal, setExtendRequestModal, submitExtendRequest,
              editModal, setEditModal, editSelectedSkus, setEditSelectedSkus,
              editPerSkuMode, setEditPerSkuMode, editAreaUnified, setEditAreaUnified,
              editComment, setEditComment, submitEdit, skus, onAreaChange,
            }}
          />
        </Suspense>
      );
    }

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
    if (newCreate) {
      return (
        <Suspense fallback={null}>
          <CreateProtectionNew
            form={form}
            setForm={setForm}
            managers={managers}
            skus={skus}
            selectedSkus={selectedSkus}
            setSelectedSkus={setSelectedSkus}
            perSkuMode={perSkuMode}
            setPerSkuMode={setPerSkuMode}
            onAreaChange={onAreaChange}
            submit={submit}
            onBack={goHome}
            onGoToList={goActive}
            auth={auth}
            similarProtectionModal={similarProtectionModal}
            setSimilarProtectionModal={setSimilarProtectionModal}
            submitSimilarProtectionRequest={submitSimilarProtectionRequest}
            skipConflictManually={skipConflictManually}
          />
        </Suspense>
      );
    }

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
        similarProtectionModal={similarProtectionModal}
        setSimilarProtectionModal={setSimilarProtectionModal}
        submitSimilarProtectionRequest={submitSimilarProtectionRequest}
      />
    );
  }

  // ==== АКТИВНЫЕ ЗАЩИТЫ ====
  if (route === "active") {
    // Новый экран (?ui-list=new) получает те же данные и те же обработчики,
    // что и старый: меняется только слой представления.
    if (newList) {
      return withTabs(
        <Suspense fallback={null}>
          <ProtectionsListNew
            auth={auth}
            items={items}
            managers={managers}
            loading={loading}
            loadError={loadError}
            load={load}
            onBack={goHome}
            act={act}
            openEditModal={openEditModal}
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
            extendRequestModal={extendRequestModal}
            setExtendRequestModal={setExtendRequestModal}
            submitExtendRequest={submitExtendRequest}
            restoreProtection={restoreProtection}
            newDetail={newDetail}
            initialFilter={listFilter}
            showBack={!tabsOn}
          />
        </Suspense>
      );
    }

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
        updateClosedModal={updateClosedModal}
        setUpdateClosedModal={setUpdateClosedModal}
        updateClosedProtection={updateClosedProtection}
        setExtendRequestModal={setExtendRequestModal}
        submitExtendRequest={submitExtendRequest}
      />
    );
  }

  // ==== АРХИВ ЗАЩИТ ====
  if (route === "archive") {
    const archiveDetailItem =
      archiveDetailId == null
        ? null
        : (items || []).find((it) => it.id === archiveDetailId) || null;

    return withTabs(
      <>
      {newArchive ? (
        <Suspense fallback={null}>
          <ArchiveListNew
            items={items}
            loading={loading}
            loadError={loadError}
            load={load}
            onBack={goHome}
            managers={managers}
            auth={auth}
            showBack={!tabsOn}
            onOpenDetail={(item) =>
              newDetail ? setArchiveDetailId(item.id) : toggleExpand(item.id)
            }
          />
        </Suspense>
      ) : (
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
        updateClosedModal={updateClosedModal}
        setUpdateClosedModal={setUpdateClosedModal}
        onBack={goHome}
        onOpenDetail={newDetail ? setArchiveDetailId : undefined}
      />
      )}
      {/* Новая карточка защиты (?ui-detail=new) — слоем поверх архива,
          сам архив остаётся смонтированным и не теряет прокрутку. */}
      {newDetail && archiveDetailItem && (
        <Suspense fallback={null}>
          <ProtectionDetailNew
            item={archiveDetailItem}
            auth={auth}
            onBack={() => setArchiveDetailId(null)}
            act={act}
            openEditModal={openEditModal}
            restoreProtection={restoreProtection}
            sheets={{
              closeModal, setCloseModal, doClose,
              successModal, setSuccessModal, doSuccess,
              deleteModal, setDeleteModal, doDelete,
              extendRequestModal, setExtendRequestModal, submitExtendRequest,
              editModal, setEditModal, editSelectedSkus, setEditSelectedSkus,
              editPerSkuMode, setEditPerSkuMode, editAreaUnified, setEditAreaUnified,
              editComment, setEditComment, submitEdit, skus, onAreaChange,
              updateClosedModal, setUpdateClosedModal, updateClosedProtection,
            }}
          />
        </Suspense>
      )}
      </>
    );
  }

  // ==== СТАТИСТИКА ====
  if (route === "stats") {
    if (newAdmin) {
      return (
        <Suspense fallback={null}>
          <StatsScreenNew
            stats={stats}
            loading={loading}
            loadError={loadError}
            load={load}
            onBack={goBackFromSecondary}
          />
        </Suspense>
      );
    }

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
      <div className="container" style={{ position: "relative", minHeight: "100dvh" }}>
        <ThemeToggle />
        <div className="header sticky" style={{ gap: 8, alignItems: "center" }}>
          <button className="btn secondary pg-legacy-back" onClick={goBackFromSecondary} style={{ marginRight: "auto" }}>
            ← Назад
          </button>
          <h1 style={{ margin: 0, fontWeight: 700 }}>
            ⚙️ Настройки
          </h1>
        </div>
        {/* Фиксированная кнопка "назад" на мобильной версии */}
        <button 
          className="fixed-back-button" 
          onClick={goBackFromSecondary}
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
          <p style={{ margin: 0, color: "var(--hint-strong)", fontSize: 16 }}>
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
        <button className="btn secondary pg-legacy-back" onClick={goHome} style={{ marginRight: "auto" }}>
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
