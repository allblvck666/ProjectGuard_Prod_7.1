import { useState } from "react";
import { authenticateTelegram, resumeAutomaticAuthentication } from "./api";
import { isTelegramApp } from "./pg/telegram";
import { Button, Card, Icon } from "./pg/ui";
import { protectionError } from "./pg/protection-edit";

export default function LoginPage({ onLogin }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isTG = isTelegramApp();
  const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || "";
  const appUrl = import.meta.env.VITE_TELEGRAM_APP_URL || (/^[A-Za-z0-9_]+$/.test(botUsername) ? `https://t.me/${botUsername}` : "");
  const canOpenApp = /^https:\/\/t\.me\/[A-Za-z0-9_]+(?:[/?].*)?$/.test(appUrl);
  const retry = async () => {
    setLoading(true);
    setError("");
    try {
      resumeAutomaticAuthentication();
      const session = await authenticateTelegram();
      await onLogin?.(session.role);
    } catch (err) {
      setError(protectionError(err, "Закройте это окно и откройте приложение снова кнопкой в боте ProjectGuard."));
    } finally {
      setLoading(false);
    }
  };
  return <main className="pg-login">
    <div className="pg-login__brand"><Icon name="shield" size={32} /><h1>ProjectGuard</h1></div>
    <Card>
      <h2>{isTG ? "Подтвердите вход" : "Вход через Telegram"}</h2>
      <p className="pg-sheet__text">{isTG ? "Чтобы продолжить с вашим профилем, подтвердите вход через Telegram. Если окно давно открыто, закройте его и снова нажмите кнопку приложения в боте." : "Откройте приложение кнопкой в привычном боте ProjectGuard. Мы найдём ваш существующий профиль по подтверждённому аккаунту Telegram."}</p>
      <p className="pg-sheet__text">Ваши защиты, история и назначенные роли сохраняются.</p>
      {error && <p className="pg-login__error" role="alert">{error}</p>}
      {isTG && <Button variant="primary" block loading={loading} onClick={retry}>Повторить вход</Button>}
      {!isTG && canOpenApp && <a className="pg-btn pg-btn--primary pg-btn--block" href={appUrl}>Открыть в Telegram</a>}
    </Card>
  </main>;
}
