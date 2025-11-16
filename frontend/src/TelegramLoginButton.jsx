// frontend/src/TelegramLoginButton.jsx

export default function TelegramLoginButton() {
  const BACKEND_URL = import.meta.env.VITE_API_URL; // <-- строго из .env

  const handleLogin = async () => {
    console.log("🔵 BACKEND_URL =", BACKEND_URL);

    const payload = {
      id: 426188469,
      username: "messiah_66",
      first_name: "Messiah",
      hash: "dev-mode", // чтобы backend пропускал
      role: "superadmin",
    };

    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/dev-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      console.log("🟢 AUTH RESPONSE:", data);

      if (!data.ok || !data.token) {
        alert("❌ Ошибка авторизации: сервер не выдал токен");
        return;
      }

      localStorage.setItem("jwt_token", data.token);
      localStorage.setItem("role", data.role || "manager");

      window.location.reload(); // перезагрузка — вход в систему
    } catch (err) {
      console.error("🔥 AUTH ERROR:", err);
      alert("Ошибка при авторизации");
    }
  };

  return (
    <div
      onClick={handleLogin}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "#229ED9",
        color: "white",
        padding: "10px 16px",
        borderRadius: 12,
        fontSize: 16,
        fontWeight: 600,
        cursor: "pointer",
        width: "fit-content",
        margin: "0 auto",
      }}
    >
      <img
        src="https://telegram.org/img/t_logo.svg"
        alt="Telegram"
        style={{ width: 24, height: 24 }}
      />
      Войти через Telegram 😌
    </div>
  );
}
