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

// ============================================================
// Нативная кнопка «Назад».
// Экранов, которым нужна кнопка, может быть несколько сразу
// (список → карточка → шит), поэтому держим реестр с приоритетами:
// побеждает самый «верхний» слой. Приоритет надёжнее порядка
// монтирования — React выполняет эффекты детей раньше родителей.
// ============================================================

const BACK_PRIORITY = { app: 0, screen: 10, overlay: 20, sheet: 30 };

const backHandlers = new Map(); // id -> { ref, priority }
let boundBack = null;
let backSeq = 0;

function topBackHandler() {
  let top = null;
  backHandlers.forEach((entry) => {
    if (!top || entry.priority >= top.priority) top = entry;
  });
  return top;
}

function syncBackButton() {
  const bb = getTG()?.BackButton;
  if (!bb) return;

  const top = topBackHandler();

  try {
    if (boundBack) {
      bb.offClick(boundBack);
      boundBack = null;
    }
    if (top) {
      const current = top;
      boundBack = () => current.ref.current?.();
      bb.onClick(boundBack);
      bb.show();
    } else {
      bb.hide();
    }
  } catch {
    // старый клиент — просто без нативной кнопки
  }
}

export function useBackButton(handler, active = true, priority = BACK_PRIORITY.screen) {
  const ref = useRef(handler);
  ref.current = handler;

  const idRef = useRef(null);
  if (idRef.current === null) idRef.current = ++backSeq;

  useEffect(() => {
    const id = idRef.current;
    if (active) backHandlers.set(id, { ref, priority });
    else backHandlers.delete(id);
    syncBackButton();

    return () => {
      backHandlers.delete(id);
      syncBackButton();
    };
  }, [active, priority]);
}

export { BACK_PRIORITY };

// Нативная нижняя кнопка принадлежит верхнему экрану. Любой открытый
// Sheet блокирует её, включая уже поставленные Telegram в очередь клики.
const mainRequests = new Map();
const mainBlockers = new Set();
let mainSeq = 0;
let boundMain = null;

function activeMainRequest() {
  if (mainBlockers.size) return null;
  let top = null;
  mainRequests.forEach((entry) => { if (entry.current.visible) top = entry.current; });
  return top;
}

function dispatchMainClick() {
  const current = activeMainRequest();
  if (current && !current.disabled && !current.loading) current.onClick?.();
}

function syncMainButton() {
  const mb = getTG()?.MainButton;
  if (!mb) return;
  const current = activeMainRequest();
  try {
    if (boundMain) {
      boundMain.offClick(dispatchMainClick);
      boundMain = null;
    }
    if (!current) {
      mb.hide();
      return;
    }
    mb.onClick(dispatchMainClick);
    boundMain = mb;
    if (current.text) mb.setText(current.text);
    if (current.color) mb.setParams({ color: current.color, text_color: current.textColor });
    if (current.disabled || current.loading) mb.disable();
    else mb.enable();
    if (current.loading) mb.showProgress(true);
    else mb.hideProgress();
    mb.show();
  } catch {
    // Старый клиент может не поддерживать отдельные методы.
  }
}

export function useMainButton({
  text, onClick, visible = true, disabled = false, loading = false,
  color = "#667eea", textColor = "#ffffff",
}) {
  const ref = useRef(null);
  ref.current = { text, onClick, visible, disabled, loading, color, textColor };
  const id = useRef(null);
  if (id.current === null) id.current = ++mainSeq;
  useEffect(() => {
    const key = id.current;
    mainRequests.set(key, ref);
    syncMainButton();
    return () => {
      mainRequests.delete(key);
      syncMainButton();
    };
  }, []);
  useEffect(syncMainButton, [text, visible, disabled, loading, color, textColor]);
}

export function useMainButtonBlocked(active) {
  const id = useRef(null);
  if (id.current === null) id.current = ++mainSeq;
  useEffect(() => {
    const key = id.current;
    if (active) mainBlockers.add(key);
    else mainBlockers.delete(key);
    syncMainButton();
    return () => {
      mainBlockers.delete(key);
      syncMainButton();
    };
  }, [active]);
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
