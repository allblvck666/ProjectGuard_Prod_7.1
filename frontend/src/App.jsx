// frontend/src/App.jsx
import axios from "axios";

import AdminPage from "./AdminPage.jsx";
console.log("📦 App.jsx загружает AdminPage из", import.meta.url);
import { useEffect, useState } from "react";
import "./App.css";
console.log("🔥 App.jsx reloaded at", new Date().toISOString());
import LoginPage from "./LoginPage";

// ✅ Правильный универсальный путь
import { API_BASE } from "./api";
const API = API_BASE;

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
    if (selected.length >= 3) return alert("Можно добавить максимум 3 артикула");
    if (selected.find((s) => s.sku === skuObj.sku && s.type === skuObj.type))
      return alert("Этот артикул уже добавлен");
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

/* === Основное приложение === */
function App() {
  // =====================================
  //   🔍 ДИАГНОСТИКА
  // =====================================
  const isTG = typeof window !== "undefined" && window.Telegram?.WebApp != null;

  const [auth, setAuth] = useState(() => ({
    token: localStorage.getItem("jwt_token") || "",
    role: localStorage.getItem("role") || "",
  }));

  const [route, setRoute] = useState(() => {
    if (auth.role === "admin" || auth.role === "superadmin") return "admin";
    return "main";
  });

  console.log("📌 AUTH =", auth);
  console.log("📌 ROUTE =", route);
  console.log("📌 IS_TG =", isTG);

  // 🔗 Синхронизация axios с токеном при старте и при смене токена
  useEffect(() => {
    if (auth.token) {
      axios.defaults.headers.common["token"] = auth.token;
      console.log("🔗 axios token set");
    } else {
      delete axios.defaults.headers.common["token"];
      console.log("🔗 axios token cleared");
    }
  }, [auth.token]);

  // 🔐 Telegram Auto-Login (только если есть Telegram WebApp)
  useEffect(() => {
    if (!isTG) return;

    try {
      const tg = window.Telegram?.WebApp;
      if (!tg?.initDataUnsafe?.user) {
        console.log("Telegram WebApp: нет initDataUnsafe.user");
        return;
      }

      const user = tg.initDataUnsafe.user;
      console.log("Telegram WebApp user =", user);

      fetch(`${API}/api/auth/telegram-login`, {
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
        .then((r) => r.json())
        .then((data) => {
          console.log("telegram-login resp =", data);
          if (!data.ok) return;

          localStorage.setItem("jwt_token", data.token);
          localStorage.setItem("role", data.role);

          axios.defaults.headers.common["token"] = data.token;
          setAuth({ token: data.token, role: data.role });

          if (data.role === "admin" || data.role === "superadmin") {
            setRoute("admin");
          } else {
            setRoute("main");
          }

          tg.ready();
          tg.expand();
        })
        .catch((err) => {
          console.log("Telegram auto-login error", err);
        });
    } catch (err) {
      console.log("Telegram auto-login skipped", err);
    }
  }, [isTG]);

  // ===== ВРЕМЕННЫЙ DEV-LOGIN =====
  const devLogin = async () => {
    const payload = {
      tg_id: 426188469,
      username: "messiah",
      first_name: "Dmitry",
      role: "superadmin",
    };

    try {
      const res = await fetch(`${API}/api/auth/dev-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (data.ok) {
        localStorage.setItem("jwt_token", data.token);
        localStorage.setItem("role", data.role);
        axios.defaults.headers.common["token"] = data.token;
        setAuth({ token: data.token, role: data.role });

        if (data.role === "admin" || data.role === "superadmin") {
          setRoute("admin");
        } else {
          setRoute("main");
        }

        alert("✅ Вход выполнен как " + data.role);
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
    if (route === "admin" && role !== "admin" && role !== "superadmin") {
      console.log("⛔ Доступ в админку запрещён — роль:", role);
      setRoute("main");
    }
  }, [route, role]);

  const goAdmin = () => {
    if (role === "admin" || role === "superadmin") {
      setRoute("admin");
    } else {
      alert("⛔ Нет прав доступа к админке");
    }
  };

  const goMain = () => {
    setRoute("main");
  };

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
      await axios.put(`${API}/api/protections/${editModal.id}`, payload);
      setEditModal({ open: false, id: null });
      await load();
    } catch (err) {
      alert("Ошибка при редактировании защиты");
    }
  };

  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);

  const load = async () => {
    let statusParam = statusFilter;
    if (viewTab === "active") {
      statusParam = "active";
    } else {
      statusParam = archiveFilter === "all" ? "" : archiveFilter;
    }

    const [s, list] = await Promise.all([
      axios.get(`${API}/api/stats`),
      axios.get(`${API}/api/protections`, {
        params: { manager: managerFilter, status: statusParam, search },
      }),
    ]);

    let data = list.data || [];
    if (viewTab === "archive" && archiveFilter === "all") {
      data = data.filter((it) => it.status !== "active");
    }

    setStats(s.data || []);
    setItems(data);
  };

  const loadHistory = async () => {
    const r = await axios.get(`${API}/api/history`);
    setHistory(r.data || []);
  };

  useEffect(() => {
    load();

    axios.get(`${API}/api/skus`).then((r) => {
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

    axios.get(`${API}/api/managers`).then((r) => {
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
  }, [managerFilter, statusFilter, search, showHistory, viewTab, archiveFilter]);

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
      await axios.post(`${API}/api/protections`, payload);
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
            await axios.post(`${API}/api/protections/pending`, {
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
      await axios.post(`${API}/api/protections/${id}/extend?days=${days}`);
      await load();
    } catch (err) {
      const det = err.response?.data?.detail;

      if (err.response?.status === 403 && (det?.needs_admin || det?.msg)) {
        const reason = prompt(
          (det?.msg || "Лимит продлений.") +
            "\nВведите причину продления (например: клиент ждёт оплату, перенос поставки и т.п.):"
        );

        if (reason && reason.trim()) {
          await axios.post(`${API}/api/protections/${id}/request-extend`, {
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
      await axios.post(`${API}/api/protections/${closeModal.id}/close`, {
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
      await axios.post(`${API}/api/protections/${successModal.id}/success`, {
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
      await axios.delete(`${API}/api/protections/${deleteModal.id}`, {
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
    const url = `${API}/api/export?search=${encodeURIComponent(
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

  useEffect(() => {
      if (!isTG) return;
      const tg = window.Telegram.WebApp;
      tg.ready();
      setReady(true);
    }, [isTG]);

// Пока WebApp инициализируется — ничего НЕ рендерим
if (isTG && !ready) {
  return <div style={{ padding: 20, textAlign: "center", opacity: 0.6 }}>Загрузка…</div>;
}


  // 🌐 Браузер без токена — обычная страница логина
  if (!isTG && !auth.token) {
    return (
      <LoginPage
        onLogin={(roleFromLogin) => {
          const token = localStorage.getItem("jwt_token") || "";
          setAuth({ token, role: roleFromLogin });
          if (roleFromLogin === "admin" || roleFromLogin === "superadmin") {
            setRoute("admin");
          } else {
            setRoute("main");
          }
        }}
      />
    );
  }

  // 👑 Админка
  if (route === "admin") {
    return <AdminPage onBack={goMain} />;
  }

  // ==== Обычный экран CRM ====
  return (
    <div className="container">
      <div className="header sticky" style={{ gap: 8, alignItems: "center" }}>
        <h1
          style={{
            marginRight: "auto",
            color: "#4d6eeb",
            fontWeight: 700,
            letterSpacing: "0.5px",
          }}
        >
          🔰 Aquafloor защиты
        </h1>

        <button className="btn" onClick={goAdmin}>
          👑 Админка !! TEST !!
        </button>
        <button
          onClick={devLogin}
          style={{
            background: "#3ddc97",
            color: "white",
            border: "none",
            borderRadius: 8,
            padding: "8px 12px",
            marginLeft: 8,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          🚪 DEV LOGIN
        </button>

        <button className="btn refresh" onClick={load}>
          🔄 Обновить
        </button>
        <button
          className="btn secondary"
          onClick={() => setShowHistory((v) => !v)}
          title="История действий"
        >
          🧾 История
        </button>
      </div>

      {showHistory && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="small" style={{ marginBottom: 8 }}>
            Последние события (до 500):
          </div>
          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            {history.length === 0 && <div className="small">Пусто…</div>}
            {history.map((h) => (
              <div
                key={h.id}
                className="small"
                style={{
                  padding: "6px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <b>#{h.protection_id}</b> • {h.actor} → {h.action} •{" "}
                {new Date(h.at).toLocaleString()} •{" "}
                <span style={{ opacity: 0.9 }}>{JSON.stringify(h.payload)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 8, marginBottom: 8 }}>
        <div className="row" style={{ alignItems: "center", gap: 8 }}>
          <div className="mode-toggle" style={{ marginRight: "auto" }}>
            <div
              className={`tag ${viewTab === "active" ? "active" : ""}`}
              onClick={() => setViewTab("active")}
            >
              Активные
            </div>
            <div
              className={`tag ${viewTab === "archive" ? "active" : ""}`}
              onClick={() => setViewTab("archive")}
            >
              Архив защит
            </div>
          </div>

          {viewTab === "archive" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="small" style={{ opacity: 0.85 }}>
                Показать:
              </span>
              <select
                className="select"
                value={archiveFilter}
                onChange={(e) => setArchiveFilter(e.target.value)}
              >
                <option value="all">Все (кроме активных)</option>
                <option value="success">Успешные</option>
                <option value="closed">Закрытые</option>
                <option value="deleted">Удалённые</option>
              </select>
            </div>
          )}
        </div>
      </div>

      <div className="grid">
        {stats.map((s) => (
          <StatCard key={s.manager} s={s} />
        ))}
      </div>

      <div className="card">
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

          <select
            className="select"
            value={managerFilter}
            onChange={(e) => setManagerFilter(e.target.value)}
          >
            <option value="">Все менеджеры</option>
            {Array.isArray(managers) &&
              managers.map((m) => (
                <option key={m.id}>
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

      <div className="toolbar">
        <input
          className="input search"
          placeholder="Поиск…"
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
              <option key={m.id}>{m.first_name}</option>
            ))}
        </select>
        <button className="btn secondary" onClick={exportXlsx}>
          ⬇️ Экспорт
        </button>
      </div>

      <div className="list">
        {items.map((it) => {
          const isArchive = it.status !== "active";
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
                    {it.status === "active" && "Активна"}
                    {it.status === "success" && "Успешна"}
                    {it.status === "closed" && "Закрыта"}
                    {it.status === "deleted" && "Удалена"}
                    {" | "}Осталось: {it.days_left} дн | Менеджер: {it.manager}
                    {typeof it.extend_count === "number"
                      ? ` | Продлений: ${it.extend_count}`
                      : ""}
                  </div>
                  {it.warn2d && it.status === "active" && (
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
                      ⏰{" "}
                      {it.warn_text ||
                        "Через 2 дня истекает — напомни менеджеру"}
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

              {!isArchive && (
                <div className="actions">
                  <button
                    className="btn secondary"
                    onClick={() => act(it.id, "extend")}
                  >
                    Продлить
                  </button>
                  <button
                    className="btn success"
                    onClick={() => act(it.id, "success")}
                  >
                    ✅ Успешна
                  </button>
                  <button
                    className="btn"
                    onClick={() => act(it.id, "close")}
                  >
                    🚫 Закрыть
                  </button>
                  <button
                    className="btn danger"
                    onClick={() => act(it.id, "delete")}
                  >
                    🗑️ Удалить
                  </button>
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
              )}
            </div>
          );
        })}
      </div>

      {closeModal.open && (
        <Modal
          title="Закрыть защиту"
          onClose={() =>
            setCloseModal({ open: false, id: null, reason: "" })
          }
          onOk={doClose}
          okText="Закрыть"
          disabled={!closeModal.reason.trim()}
        >
          <input
            className="input"
            placeholder="Причина закрытия (обязательно)"
            value={closeModal.reason}
            onChange={(e) =>
              setCloseModal((v) => ({
                ...v,
                reason: e.target.value,
              }))
            }
          />
        </Modal>
      )}

      {successModal.open && (
        <Modal
          title="Отметить как успешную"
          onClose={() =>
            setSuccessModal({ open: false, id: null, doc: "" })
          }
          onOk={doSuccess}
          okText="Сохранить"
          disabled={!successModal.doc.trim()}
        >
          <input
            className="input"
            placeholder="Номер документа из 1С (обязательно)"
            value={successModal.doc}
            onChange={(e) =>
              setSuccessModal((v) => ({
                ...v,
                doc: e.target.value,
              }))
            }
          />
        </Modal>
      )}

      {deleteModal.open && (
        <Modal
          title="Удалить защиту"
          onClose={() =>
            setDeleteModal({ open: false, id: null, reason: "" })
          }
          onOk={doDelete}
          okText="Удалить"
          disabled={!deleteModal.reason.trim()}
        >
          <input
            className="input"
            placeholder="Причина удаления (обязательно)"
            value={deleteModal.reason}
            onChange={(e) =>
              setDeleteModal((v) => ({
                ...v,
                reason: e.target.value,
              }))
            }
          />
          <div className="small" style={{ marginTop: 6, opacity: 0.8 }}>
            Будет выполнено мягкое удаление (в архив истории).
          </div>
        </Modal>
      )}

      {editModal?.open && (
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
            onAreaChange={(sku, val) =>
              setEditSelectedSkus((prev) =>
                prev.map((s) =>
                  s.sku === sku.sku && s.type === sku.type
                    ? { ...s, area: val }
                    : s
                )
              )
            }
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

          <input
            className="input"
            placeholder="Комментарий"
            value={editComment}
            onChange={(e) => setEditComment(e.target.value)}
            style={{ marginTop: 10 }}
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

export default App;
