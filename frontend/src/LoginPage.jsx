// frontend/src/LoginPage.jsx
import { useState } from "react";
import { api } from "./api";
import TelegramLoginButton from "./TelegramLoginButton";

export default function LoginPage({ onLogin }) {
  const [tgId, setTgId] = useState("");
  const [username, setUsername] = useState("");
  const [firstName, setFirstName] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setErr("");

    if (!tgId) {
      setErr("Введите Telegram ID (числом)");
      return;
    }

    const payload = {
      id: Number(tgId),
      username: username || "",
      first_name: firstName || "",
    };

    try {
      setLoading(true);
      const res = await api.post("/api/auth/telegram", payload);

      const { token, role } = res.data;

      localStorage.setItem("jwt_token", token);
      localStorage.setItem("role", role);

      // 👉 вместо перезагрузки — вызываем onLogin()
      if (onLogin) {
        onLogin(role);
      } else {
        // 👉 безопасное переключение маршрута
        localStorage.setItem(
          "route",
          role === "admin" || role === "superadmin" ? "admin" : "main"
        );
      }
    } catch (e) {
      console.error(e);
      setErr(e.response?.data?.detail || "Ошибка авторизации");
    } finally {
      setLoading(false);
    }
  };

  const isTG = typeof window !== "undefined" && window.Telegram?.WebApp != null;

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
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: "0 0 12px 0", fontSize: isTG ? "24px" : "28px" }}>
          🔐 Вход в систему
        </h2>
        <p className="small" style={{ opacity: 0.7, margin: 0 }}>
          {isTG 
            ? "Авторизуйтесь для доступа к ProjectGuard" 
            : "Авторизуйтесь, чтобы попасть в ProjectGuard"}
        </p>
      </div>

      <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
        <TelegramLoginButton onLogin={onLogin} />
      </div>

      {!isTG && (
        <div style={{ marginTop: 32, opacity: 0.6, fontSize: 13 }}>
          или ручной вход (для тестов)
        </div>
      )}

      {!isTG && (
        <form
          onSubmit={submit}
          className="card"
          style={{
            gap: 12,
            display: "flex",
            flexDirection: "column",
            marginTop: 12,
            textAlign: "left",
          }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 14, opacity: 0.8 }}>Telegram ID</span>
            <input
              className="input"
              value={tgId}
              onChange={(e) => setTgId(e.target.value)}
              placeholder="426188469"
              type="number"
              inputMode="numeric"
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 14, opacity: 0.8 }}>Username</span>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="@username"
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 14, opacity: 0.8 }}>Имя</span>
            <input
              className="input"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Дмитрий"
            />
          </label>

          {err && (
            <div style={{ 
              color: "var(--danger)", 
              padding: "8px 12px",
              background: "rgba(239, 68, 68, 0.1)",
              borderRadius: "8px",
              fontSize: 14
            }}>
              {err}
            </div>
          )}

          <button className="btn" type="submit" disabled={loading} style={{ marginTop: 8 }}>
            {loading ? "⏳ Входим..." : "🚪 Войти вручную"}
          </button>
        </form>
      )}
    </div>
  );
}
