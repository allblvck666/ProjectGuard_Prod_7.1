export default function TelegramLoginButton() {
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
            "https://projectguard-prod-7-1.onrender.com/api/auth/telegram",
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

          // Сохраняем токен
          localStorage.setItem("jwt_token", data.token);

          // Перезагрузка приложения
          window.location.reload();
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
