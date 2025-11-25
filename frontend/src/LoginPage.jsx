// frontend/src/LoginPage.jsx
import { useState, useEffect } from "react";
import { login, register, fetchMe } from "./api";
import TelegramLoginButton from "./TelegramLoginButton";

export default function LoginPage({ onLogin }) {
  const isTG = typeof window !== "undefined" && window.Telegram?.WebApp != null;
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [telegramLoading, setTelegramLoading] = useState(false);

  // === Форма входа/регистрации (для браузера) ===
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");

  // === Telegram авто-логин ===
  useEffect(() => {
    if (!isTG) return;

    const tg = window.Telegram?.WebApp;
    if (!tg?.initDataUnsafe?.user) {
      console.log("Telegram WebApp: нет initDataUnsafe.user");
      return;
    }

    const user = tg.initDataUnsafe.user;
    console.log("🔐 Telegram авто-логин для:", user);

    setTelegramLoading(true);

    // Отправляем Telegram данные на /api/auth/login
    login({
      telegram_id: user.id,
      username: user.username || "",
      first_name: user.first_name || "",
    })
      .then((data) => {
        console.log("✅ Telegram авто-логин успешен:", data);
        if (onLogin) {
          onLogin(data.user?.role || "manager");
        }
      })
      .catch((err) => {
        console.error("❌ Telegram авто-логин ошибка:", err);
        setErr(err.response?.data?.detail || "Ошибка авторизации через Telegram");
        setTelegramLoading(false);
      });
  }, [isTG, onLogin]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr("");

    if (!fullName || !phone) {
      setErr("Заполните имя и телефон");
      return;
    }

    try {
      setLoading(true);
      // Используем loginOrRegister - он создаст пользователя, если его нет
      const data = await login({
        full_name: fullName,
        phone: phone,
        company: company || null,
      });

      if (onLogin) {
        onLogin(data.user?.role || "manager");
      }
    } catch (e) {
      console.error(e);
      setErr(e.response?.data?.detail || "Ошибка входа");
    } finally {
      setLoading(false);
    }
  };

  // === Telegram Mini App - показываем спиннер ===
  if (isTG && telegramLoading) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          gap: 16,
          padding: 20,
        }}
      >
        <div style={{ fontSize: 48 }}>⏳</div>
        <div style={{ fontSize: 18, opacity: 0.8 }}>Авторизуем через Telegram...</div>
      </div>
    );
  }

  // === Обычный браузер - форма входа ===
  return (
    <div
      className="container"
      style={{
        maxWidth: 420,
        margin: "auto",
        paddingTop: isTG ? "20px" : "80px",
        paddingBottom: "40px",
        textAlign: "center",
        minHeight: isTG ? "100vh" : "auto",
        display: "flex",
        flexDirection: "column",
        justifyContent: isTG ? "center" : "flex-start",
      }}
    >
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ margin: "0 0 12px 0", fontSize: isTG ? "24px" : "28px" }}>
          🔐 ProjectGuard
        </h2>
        <p className="small" style={{ opacity: 0.7, margin: 0 }}>
          {isTG 
            ? "Авторизуйтесь для доступа" 
            : "Войдите или зарегистрируйтесь"}
        </p>
      </div>

      {/* Telegram Login Button (если доступен) */}
      {isTG && (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
          <TelegramLoginButton onLogin={onLogin} />
        </div>
      )}

      {/* Fallback форма для браузера */}
      {!isTG && (
        <form
          onSubmit={handleSubmit}
          className="card"
          style={{
            gap: 16,
            display: "flex",
            flexDirection: "column",
            textAlign: "left",
          }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 14, opacity: 0.8 }}>Полное имя *</span>
            <input
              className="input"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Иван Иванов"
              required
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 14, opacity: 0.8 }}>Телефон *</span>
            <input
              className="input"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+7 (999) 123-45-67"
              required
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 14, opacity: 0.8 }}>Компания</span>
            <input
              className="input"
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Название компании (необязательно)"
            />
          </label>

          {err && (
            <div
              style={{
                color: "var(--danger)",
                padding: "12px",
                background: "rgba(239, 68, 68, 0.1)",
                borderRadius: "8px",
                fontSize: 14,
              }}
            >
              {err}
            </div>
          )}

          <button
            className="btn"
            type="submit"
            disabled={loading}
            style={{ marginTop: 8 }}
          >
            {loading ? "⏳ Входим..." : "🚪 Войти / Зарегистрироваться"}
          </button>
        </form>
      )}
    </div>
  );
}
