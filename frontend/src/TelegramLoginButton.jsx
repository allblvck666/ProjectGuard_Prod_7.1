export default function TelegramLoginButton() {

  const handleLogin = () => {
    window.Telegram.Login.auth(
      {
        bot_id: "твой_бот_ID",
        request_access: true,
      },
      async (user) => {
        try {
          const res = await fetch(
            "https://projectguard-prod-7-1.onrender.com/api/auth/telegram",
            {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${localStorage.getItem("jwt_token")}` },
              body: JSON.stringify(user),
            }
          );

          const data = await res.json();
          if (data.ok && data.token) {
            localStorage.setItem("jwt_token", data.token);
            window.location.reload();
          } else {
            alert("Ошибка авторизации");
          }
        } catch (e) {
          console.error(e);
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
