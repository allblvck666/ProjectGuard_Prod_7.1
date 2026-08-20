// frontend/src/pg/telegram.js
// Мост к нативным элементам Telegram Mini App: шапку, «Назад» и нижнюю
// кнопку рисует Telegram, своих мы не верстаем. Вне Telegram все вызовы
// безопасно превращаются в no-op.

import { useEffect, useRef } from "react";

export function getTG() {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp || null;
}

// telegram-web-app.js подключается и в обычном браузере, но там platform === "unknown".
// Отличаем настоящий Mini App, чтобы не прятать управление там, где его никто не нарисует.
export function isTelegramApp() {
  const tg = getTG();
  return !!(tg && tg.platform && tg.platform !== "unknown");
}

export function haptic(kind = "impact") {
  const hf = getTG()?.HapticFeedback;
  if (!hf) return;
  try {
    if (kind === "success" || kind === "error" || kind === "warning") {
      hf.notificationOccurred(kind);
    } else if (kind === "select") {
      hf.selectionChanged();
    } else {
      hf.impactOccurred("light");
    }
  } catch {
    // старые версии клиента — просто без вибрации
  }
}

// Нативная кнопка «Назад» в шапке Telegram
export function useBackButton(handler, active = true) {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    const bb = getTG()?.BackButton;
    if (!bb || !active) return undefined;

    const onClick = () => ref.current?.();
    try {
      bb.onClick(onClick);
      bb.show();
    } catch {
      return undefined;
    }
    return () => {
      try {
        bb.offClick(onClick);
        bb.hide();
      } catch {
        // клиент уже закрыт
      }
    };
  }, [active]);
}

// Нативная нижняя кнопка Telegram
export function useMainButton({ text, onClick, visible = true, disabled = false, loading = false, color }) {
  const ref = useRef(onClick);
  ref.current = onClick;

  useEffect(() => {
    const mb = getTG()?.MainButton;
    if (!mb) return undefined;

    const handler = () => ref.current?.();
    try {
      mb.offClick(handler);
      mb.onClick(handler);
    } catch {
      return undefined;
    }

    return () => {
      try {
        mb.offClick(handler);
        mb.hide();
      } catch {
        // клиент уже закрыт
      }
    };
  }, []);

  useEffect(() => {
    const mb = getTG()?.MainButton;
    if (!mb) return;
    try {
      if (!visible) {
        mb.hide();
        return;
      }
      if (text) mb.setText(text);
      if (color) mb.setParams({ color });
      if (disabled) mb.disable();
      else mb.enable();
      if (loading) mb.showProgress(true);
      else mb.hideProgress();
      mb.show();
    } catch {
      // старые версии клиента
    }
  }, [text, visible, disabled, loading, color]);
}

// Вертикальный свайп закрывает Mini App и мешает pull-to-refresh
export function useDisableVerticalSwipes(active = true) {
  useEffect(() => {
    const tg = getTG();
    if (!tg || !active || typeof tg.disableVerticalSwipes !== "function") return undefined;
    try {
      tg.disableVerticalSwipes();
    } catch {
      return undefined;
    }
    return () => {
      try {
        tg.enableVerticalSwipes?.();
      } catch {
        // клиент уже закрыт
      }
    };
  }, [active]);
}
