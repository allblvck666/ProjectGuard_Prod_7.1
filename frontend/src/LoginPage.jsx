// frontend/src/LoginPage.jsx
import { useState, useEffect } from "react";
import { registerOrLogin } from "./api";
import TelegramLoginButton from "./TelegramLoginButton";

// Функция для нормализации номера телефона (убираем все нецифровые символы)
function normalizePhone(phone) {
  return phone.replace(/\D/g, "");
}

export default function LoginPage({ onLogin }) {
  // Простая и надежная проверка Telegram WebApp
  const [isTG, setIsTG] = useState(() => {
    // Проверяем сразу при инициализации
    if (typeof window === "undefined") return false;
    return window.Telegram?.WebApp != null;
  });
  
  // Проверяем Telegram WebApp при загрузке - агрессивная проверка
  useEffect(() => {
    const checkTelegram = () => {
      if (typeof window === "undefined") return;
      
      // Множественные проверки для определения Telegram WebApp
      const hasTelegram = window.Telegram?.WebApp != null;
      const hasTelegramObject = window.Telegram != null;
      
      // Дополнительные проверки по URL и другим признакам
      const isTelegramUserAgent = navigator.userAgent.includes("Telegram");
      const hasTelegramInReferrer = document.referrer.includes("telegram.org") || document.referrer.includes("t.me");
      
      if (hasTelegram) {
        const tg = window.Telegram.WebApp;
        // Инициализируем WebApp
        try {
          tg.ready();
          tg.expand();
        } catch (e) {
          console.log("⚠️ Ошибка инициализации WebApp:", e);
        }
        
        console.log("✅ Telegram WebApp обнаружен:", {
          platform: tg.platform,
          version: tg.version,
          hasInitData: !!tg.initData,
          hasInitDataUnsafe: !!tg.initDataUnsafe,
          hasUser: !!tg.initDataUnsafe?.user,
          userId: tg.initDataUnsafe?.user?.id,
          initDataLength: tg.initData?.length || 0
        });
        
        setIsTG(true);
        return true;
      } else if (hasTelegramObject || isTelegramUserAgent || hasTelegramInReferrer) {
        // Если есть признаки Telegram, но WebApp еще не загружен - ждем
        console.log("⏳ Признаки Telegram обнаружены, ждем загрузки WebApp...", {
          hasTelegramObject,
          isTelegramUserAgent,
          hasTelegramInReferrer
        });
        // Не устанавливаем isTG в false, чтобы не показывать ошибку
        return false;
      } else {
        console.log("❌ Telegram WebApp не обнаружен");
        setIsTG(false);
        return false;
      }
    };
    
    // Проверяем сразу
    checkTelegram();
    
    // Проверяем очень часто в течение первых 5 секунд (на случай медленной загрузки)
    const intervals = [];
    for (let i = 0; i < 50; i++) {
      intervals.push(setTimeout(checkTelegram, i * 100));
    }
    
    // Также проверяем при различных событиях
    const handleLoad = () => checkTelegram();
    const handleDOMContentLoaded = () => checkTelegram();
    
    window.addEventListener('load', handleLoad);
    document.addEventListener('DOMContentLoaded', handleDOMContentLoaded);
    
    return () => {
      intervals.forEach(clearTimeout);
      window.removeEventListener('load', handleLoad);
      document.removeEventListener('DOMContentLoaded', handleDOMContentLoaded);
    };
  }, []);
  
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

    // Функция для проверки и получения данных пользователя
    const checkUser = () => {
      // Пробуем получить из initDataUnsafe
      let tgUser = tg?.initDataUnsafe?.user;
      
      // Если нет, пробуем получить из initData (будет парситься на бэкенде)
      const hasInitData = tg?.initData && tg.initData.length > 0;
      
      if (!tgUser && !hasInitData) {
        // Пробуем еще раз через небольшую задержку
        setTimeout(checkUser, 500);
        return;
      }

      // Заполняем форму данными из Telegram (если есть)
      if (tgUser) {
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
          return;
        }
      }
      
      setTelegramLoading(false);
    };

    // Проверяем сразу и через небольшие задержки
    checkUser();
    setTimeout(checkUser, 300);
    setTimeout(checkUser, 800);
    setTimeout(checkUser, 1500);
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

      // Проверяем Telegram WebApp еще раз (на случай, если он загрузился позже)
      const tg = window.Telegram?.WebApp;
      const isTelegramWebApp = tg != null;
      
      console.log("🔍 DEBUG handleSubmit:", {
        hasTelegram: !!window.Telegram,
        hasWebApp: !!tg,
        platform: tg?.platform,
        version: tg?.version,
        hasInitData: !!tg?.initData,
        hasInitDataUnsafe: !!tg?.initDataUnsafe,
        isTelegramWebApp,
        tgUser: tg?.initDataUnsafe?.user
      });
      
      if (isTelegramWebApp) {
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
        } else if (tg?.initData && tg.initData.length > 0) {
          // Если initDataUnsafe недоступен, но есть initData - отправляем на бэкенд
          try {
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
          } catch (err) {
            console.error("❌ Ошибка регистрации с initData:", err);
            setErr(err.response?.data?.detail || "Не удалось получить Telegram ID. Попробуйте перезагрузить страницу.");
            return;
          }
        } else {
          // Если нет ни tg_id, ни initData - это странно для Telegram WebApp
          // Но пробуем отправить запрос - бэкенд вернет понятную ошибку
          setErr("Не удалось получить данные Telegram. Попробуйте перезагрузить страницу.");
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
        {!isTG && (
          <p className="small" style={{ opacity: 0.5, margin: "8px 0 0 0", fontSize: 11, color: "#ffa500" }}>
            ⚠️ Приложение должно быть открыто через Telegram бота
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
          <div style={{ 
            fontSize: 12, 
            opacity: 0.7, 
            margin: "16px 0 0 0", 
            textAlign: "center",
            padding: "12px",
            background: "rgba(255, 165, 0, 0.1)",
            borderRadius: "8px",
            border: "1px solid rgba(255, 165, 0, 0.3)"
          }}>
            <p style={{ margin: "0 0 8px 0" }}>⚠️ Приложение должно быть открыто через Telegram бота</p>
            <p style={{ margin: 0, fontSize: 11, opacity: 0.8 }}>
              Найдите бота в Telegram и нажмите кнопку "Войти в систему"
            </p>
          </div>
        )}
      </form>
    </div>
  );
}
