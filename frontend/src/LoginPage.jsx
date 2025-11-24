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

  return (
    <div
      className="container"
      style={{
        maxWidth: 420,
        marginTop: 80,
        textAlign: "center",
      }}
    >
      <h2>Вход через Telegram</h2>
      <p className="small" style={{ opacity: 0.7 }}>
        Авторизуйтесь, чтобы попасть в ProjectGuard
      </p>

      <div style={{ display: "flex", justifyContent: "center", marginTop: 24 }}>
        <TelegramLoginButton onLogin={onLogin} />
      </div>

      <div style={{ marginTop: 40, opacity: 0.6, fontSize: 13 }}>
        или ручной вход (для тестов)
      </div>

      <form
        onSubmit={submit}
        className="card"
        style={{
          gap: 8,
          display: "flex",
          flexDirection: "column",
          marginTop: 12,
        }}
      >
        <label>
          Telegram ID
          <input
            className="input"
            value={tgId}
            onChange={(e) => setTgId(e.target.value)}
            placeholder="426188469"
          />
        </label>
        <label>
          Username
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="@username"
          />
        </label>
        <label>
          Имя
          <input
            className="input"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Дмитрий"
          />
        </label>

        {err && <div style={{ color: "tomato" }}>{err}</div>}

        <button className="btn" type="submit" disabled={loading}>
          {loading ? "Входим..." : "Войти вручную"}
        </button>
      </form>
    </div>
  );
}
