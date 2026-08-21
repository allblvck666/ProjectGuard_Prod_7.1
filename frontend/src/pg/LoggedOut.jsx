// frontend/src/pg/LoggedOut.jsx
// ============================================================
// Экран после выхода внутри Telegram.
//
// В браузере «Выйти» возвращает на страницу логина, а в Telegram
// страницы логина нет: вход идёт по данным самого мессенджера.
// Раньше после выхода приложение оставалось на месте — токена нет,
// запросы отваливаются, кнопки «не срабатывают». Показываем честный
// экран с одной кнопкой обратно.
// ============================================================

import { Icon } from "./icons";
import "./logged-out.css";

export default function LoggedOut({ onLogin, name }) {
  return (
    <div className="pglo">
      <div className="pglo__badge">
        <Icon name="logout" size={26} />
      </div>
      <div className="pglo__title">Вы вышли из аккаунта</div>
      <div className="pglo__text">
        {name
          ? `Сессия ${name} закрыта. Вход в Telegram выполняется по вашему профилю — нажмите кнопку ниже, чтобы вернуться.`
          : "Вход в Telegram выполняется по вашему профилю — нажмите кнопку ниже, чтобы вернуться."}
      </div>
      <button type="button" className="pg-btn pg-btn--primary pg-btn--block" onClick={onLogin}>
        Войти снова
      </button>
    </div>
  );
}
