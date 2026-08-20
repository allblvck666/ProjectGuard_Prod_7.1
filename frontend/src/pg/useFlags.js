// frontend/src/pg/useFlags.js
import { useEffect, useState } from "react";
import { getFlags, isNew, onFlagsChange } from "./flags";
import { isTelegramApp } from "./telegram";

// Подписка на флаги: экран перерисовывается сразу после window.__pgFlags().set(...)
export function useFlags() {
  const [flags, setFlags] = useState(getFlags);

  useEffect(() => onFlagsChange(() => setFlags(getFlags())), []);

  return flags;
}

export function useNewUi(name) {
  const flags = useFlags();
  return flags[name] === "new" || flags[name] === "on";
}

// Нативную навигацию включаем только там, где её реально рисует Telegram:
// в обычном браузере BackButton/MainButton не отображаются, и без
// запасных кнопок пользователь остался бы заперт на экране.
export function useNativeNav() {
  return useNewUi("ui-nav") && isTelegramApp();
}

export { isNew };
