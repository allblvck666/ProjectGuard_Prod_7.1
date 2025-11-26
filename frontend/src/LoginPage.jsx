// frontend/src/LoginPage.jsx
import { useState, useEffect } from "react";
import { registerOrLogin } from "./api";
import TelegramLoginButton from "./TelegramLoginButton";

// Функция для нормализации номера телефона (убираем все нецифровые символы)
function normalizePhone(phone) {
  return phone.replace(/\D/g, "");
}

export default function LoginPage({ onLogin }) {
  const isTG = typeof window !== "undefined" && window.Telegram?.WebApp != null;
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [telegramLoading, setTelegramLoading] = useState(false);

  // === Форма входа/регистрации ===
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [position, setPosition] = useState("");

  // === Telegram авто-логин ===
  useEffect(() => {
    if (!isTG) return;

    const tg = window.Telegram?.WebApp;
    if (!tg?.initDataUnsafe?.user) {
      console.log("Telegram WebApp: нет initDataUnsafe.user");
      return;
    }

    const tgUser = tg.initDataUnsafe.user;
    console.log("🔐 Telegram авто-логин для:", tgUser);

    // Заполняем форму данными из Telegram
    setFullName(tgUser.first_name || tgUser.last_name ? 
      `${tgUser.first_name || ""} ${tgUser.last_name || ""}`.trim() : "");
    
    setTelegramLoading(true);

    // Если есть имя - пытаемся автоматически залогиниться
    if (tgUser.first_name) {
      handleTelegramAutoLogin(tgUser);
    } else {
      setTelegramLoading(false);
    }
  }, [isTG]);

  const handleTelegramAutoLogin = async (tgUser) => {
    try {
      // В Telegram WebApp тоже используем номер телефона как основной идентификатор
      // Если есть номер телефона в Telegram - используем его
      const tg = window.Telegram?.WebApp;
      let phone = "";
      if (tg?.initDataUnsafe?.user?.phone_number) {
        phone = tg.initDataUnsafe.user.phone_number;
      }
      
      // Если нет телефона в Telegram - не делаем авто-логин, показываем форму
      if (!phone) {
        setTelegramLoading(false);
        setErr("Введите номер телефона для входа");
        return;
      }
      
      // Нормализуем номер телефона
      const phoneDigits = normalizePhone(phone);
      if (!phoneDigits) {
        setTelegramLoading(false);
        setErr("Введите корректный номер телефона");
        return;
      }
      
      // Используем номер телефона как tg_id для единообразия
      // Это гарантирует, что один номер = один аккаунт на всех устройствах
      const tg_id = `tg-${phoneDigits}`;
      
      const data = await registerOrLogin({
        tg_id: tg_id,
        full_name: `${tgUser.first_name || ""} ${tgUser.last_name || ""}`.trim() || "Пользователь",
        phone: phone,
        position: "",
      });

      console.log("✅ Telegram авто-логин успешен:", data);
      if (onLogin) {
        onLogin(data.user?.role || "user");
      }
    } catch (err) {
      console.error("❌ Telegram авто-логин ошибка:", err);
      // Если ошибка - показываем форму для ввода телефона
      setTelegramLoading(false);
      if (err.response?.status === 400 && err.response?.data?.detail?.includes("phone")) {
        setErr("Введите телефон для завершения регистрации");
      } else {
        setErr(err.response?.data?.detail || "Ошибка авторизации через Telegram");
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr("");

    if (!fullName || !phone) {
      setErr("Заполните имя и телефон");
      return;
    }

    // Нормализуем номер телефона
    const phoneDigits = normalizePhone(phone);
    if (!phoneDigits) {
      setErr("Введите корректный номер телефона");
      return;
    }
    
    // Получаем tg_id - ВСЕГДА на основе номера телефона для единообразия
    // Один и тот же номер телефона на разных устройствах = один и тот же аккаунт
    let tg_id = "";
    if (isTG) {
      // В Telegram тоже используем номер телефона как основной идентификатор
      tg_id = `tg-${phoneDigits}`;
    } else {
      // Для браузера - используем префикс dev-
      tg_id = `dev-${phoneDigits}`;
    }

    if (!tg_id) {
      setErr("Не удалось определить идентификатор пользователя");
      return;
    }

    try {
      setLoading(true);
      const data = await registerOrLogin({
        tg_id: tg_id,
        full_name: fullName,
        phone: phone,
        position: position || null,
      });

      if (onLogin) {
        onLogin(data.user?.role || "user");
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

  // === Форма входа ===
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
            ? "Заполните данные для входа" 
            : "Войдите или зарегистрируйтесь"}
        </p>
      </div>

      {/* Telegram Login Button (если доступен и не загружается) */}
      {isTG && !telegramLoading && (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
          <TelegramLoginButton onLogin={onLogin} />
        </div>
      )}

      {/* Форма входа/регистрации */}
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
          <span style={{ fontSize: 14, opacity: 0.8 }}>Должность</span>
          <input
            className="input"
            type="text"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            placeholder="Менеджер по продажам (необязательно)"
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
    </div>
  );
}
