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
    if (!isTG) {
      return;
    }

    const tg = window.Telegram?.WebApp;
    if (!tg) {
      return;
    }

    // Инициализируем WebApp
    tg.ready();
    tg.expand();

    // Ждем немного, чтобы WebApp инициализировался
    const checkUser = () => {
      const tgUser = tg?.initDataUnsafe?.user;
      
      if (!tgUser) {
        setTelegramLoading(false);
        return;
      }

      // Заполняем форму данными из Telegram
      if (tgUser.first_name || tgUser.last_name) {
        setFullName(`${tgUser.first_name || ""} ${tgUser.last_name || ""}`.trim());
      }
      
      // Если есть номер телефона в Telegram - заполняем его
      if (tgUser.phone_number) {
        setPhone(tgUser.phone_number);
      }

      // Если есть все данные - пытаемся автоматически залогиниться
      if (tgUser.id && (tgUser.first_name || tgUser.last_name || tgUser.phone_number)) {
        setTelegramLoading(true);
        handleTelegramAutoLogin(tgUser);
      } else {
        setTelegramLoading(false);
      }
    };

    // Проверяем сразу и через небольшую задержку
    checkUser();
    const timeout = setTimeout(checkUser, 500);
    
    return () => clearTimeout(timeout);
  }, [isTG]);

  const handleTelegramAutoLogin = async (tgUser) => {
    try {
      const tg = window.Telegram?.WebApp;
      let phone = "";
      if (tg?.initDataUnsafe?.user?.phone_number) {
        phone = tg.initDataUnsafe.user.phone_number;
      }
      
      // Если нет телефона в Telegram - не делаем авто-логин, показываем форму
      if (!phone) {
        setTelegramLoading(false);
        return;
      }
      
      // Нормализуем номер телефона
      const phoneDigits = normalizePhone(phone);
      if (!phoneDigits) {
        setTelegramLoading(false);
        return;
      }
      
      // Используем реальный tg_id из Telegram WebApp
      const tg_id = String(tgUser.id);
      const full_name = `${tgUser.first_name || ""} ${tgUser.last_name || ""}`.trim() || "Пользователь";
      
      const data = await registerOrLogin({
        tg_id: tg_id,
        full_name: full_name,
        phone: phone,
        position: "",
      });

      if (onLogin) {
        onLogin(data.user?.role || "user");
      }
    } catch (err) {
      console.error("❌ Telegram авто-логин ошибка:", err);
      setTelegramLoading(false);
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

    try {
      setLoading(true);

      // Если это Telegram WebApp - используем tg_id напрямую или initData
      if (isTG) {
        const tg = window.Telegram?.WebApp;
        const tgUser = tg?.initDataUnsafe?.user;
        
        if (tgUser?.id) {
          // Используем реальный tg_id из Telegram WebApp
          const tg_id = String(tgUser.id);
          
          const data = await registerOrLogin({
            tg_id: tg_id,
            full_name: fullName,
            phone: phone,
            position: position || null,
          });

          if (onLogin) {
            onLogin(data.user?.role || "user");
          }
          return;
        } else if (tg?.initData) {
          // Если initDataUnsafe недоступен, но есть initData - отправляем на бэкенд
          const data = await registerOrLogin({
            init_data: tg.initData,
            full_name: fullName,
            phone: phone,
            position: position || null,
          });

          if (onLogin) {
            onLogin(data.user?.role || "user");
          }
          return;
        } else {
          setErr("Не удалось получить данные Telegram. Убедитесь, что вы открыли приложение через Telegram.");
          return;
        }
      } else {
        // Для браузера - показываем сообщение
        setErr("Пожалуйста, откройте приложение через Telegram бота для авторизации.");
        return;
      }
    } catch (e) {
      console.error("❌ Ошибка регистрации:", e);
      setErr(e.response?.data?.detail || "Ошибка регистрации. Попробуйте еще раз.");
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

  // === Форма входа/регистрации ===
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
            : "Откройте приложение через Telegram бота"}
        </p>
        {isTG && (
          <p className="small" style={{ opacity: 0.6, margin: "8px 0 0 0", fontSize: 12 }}>
            Ваш Telegram ID определяется автоматически
          </p>
        )}
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
          {loading 
            ? "⏳ Регистрируем..." 
            : "🚪 Войти / Зарегистрироваться"}
        </button>

        {!isTG && (
          <p style={{ fontSize: 12, opacity: 0.6, margin: 0, textAlign: "center" }}>
            Откройте приложение через Telegram бота для авторизации
          </p>
        )}
      </form>
    </div>
  );
}
