import { API_BASE } from "./api";

export default function TelegramLoginButton({ onLogin }) {
  const handleLogin = () => {
    window.Telegram.Login.auth(
      {
        bot_id: "8256079955", // ← сюда твой бот ID
        request_access: true,
      },
      async (user) => {
        try {
          // Отправляем JSON напрямую на бекенд
          const res = await fetch(
            `${API_BASE}/api/auth/telegram`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(user),
            }
          );

          const data = await res.json();

          if (!data.ok || !data.token) {
            alert("Ошибка авторизации");
            return;
          }

          // Сохраняем токен и роль
          localStorage.setItem("jwt_token", data.token);
          localStorage.setItem("role", data.role || "manager");

          // Вызываем callback вместо перезагрузки
          if (onLogin) {
            onLogin(data.role || "manager");
          } else {
            // Если callback нет, делаем мягкую перезагрузку
            window.location.href = "/";
          }
        } catch (error) {
          console.error(error);
          alert("Ошибка запроса");
        }
      }
    );
  };

  return (
    <button
      onClick={handleLogin}
      style={{
        background: "#4d6eeb",
        color: "white",
        padding: "12px 20px",
        borderRadius: 12,
        border: "none",
        cursor: "pointer",
        fontWeight: 600,
        fontSize: 16,
      }}
    >
      🔐 Войти через Telegram
    </button>
  );
}
