// frontend/src/NotificationsTab.jsx
import React, { useEffect, useState } from "react";

import { API_BASE } from "./api";
const API = API_BASE;

export default function NotificationsTab() {
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  useEffect(() => {
    loadManagers();
  }, []);

  async function loadManagers() {
    try {
      const res = await fetch(`${API}/api/admin/managers`);
      const data = await res.json();
      setManagers(data);
    } catch (e) {
      alert("Ошибка загрузки менеджеров");
    } finally {
      setLoading(false);
    }
  }

  async function saveTelegrams(m) {
    let value = m.telegramsInput?.trim();
    if (!value) return alert("Введите хотя бы один Telegram!");

    try {
      // пытаемся распарсить JSON, если ввели в формате ["@one", "@two"]
      let telegrams;
      try {
        telegrams = JSON.parse(value);
      } catch {
        // если просто строки через запятую — разбиваем
        telegrams = value
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
      }

      setSavingId(m.id);

      const res = await fetch(`${API}/api/admin/managers/${m.id}/telegrams`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${localStorage.getItem("jwt_token")}` },
        body: JSON.stringify({ telegrams }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Ошибка при сохранении");
      }

      alert(typeof data === "object" ? JSON.stringify(data, null, 2) : data);
      await loadManagers();
    } catch (e) {
      console.error("❌ Ошибка при сохранении:", e);
      alert(e.message || "Ошибка при сохранении уведомлений");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>🔔 Настройка уведомлений</h3>

      {loading && <div className="small">Загрузка менеджеров…</div>}

      {!loading && managers.length === 0 && (
        <div className="small">Пока нет менеджеров 👀</div>
      )}

      {!loading && managers.length > 0 && (
        <table className="table" style={{ minWidth: 720 }}>
          <thead>
            <tr>
              <th>Менеджер</th>
              <th>Telegram ID / Юзернеймы</th>
              <th>Действие</th>
            </tr>
          </thead>
          <tbody>
            {managers.map((m) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td>
                  <input
                    className="input"
                    placeholder='Например ["@messiah_admin", "@messiah_66"] или через запятую'
                    style={{ width: "100%" }}
                    defaultValue={
                      Array.isArray(m.telegrams)
                        ? m.telegrams.join(", ")
                        : ""
                    }
                    onChange={(e) =>
                      (m.telegramsInput = e.target.value)
                    }
                  />
                </td>
                <td>
                  <button
                    className="btn success"
                    disabled={savingId === m.id}
                    onClick={() => saveTelegrams(m)}
                  >
                    {savingId === m.id ? "💾..." : "💾 Сохранить"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
