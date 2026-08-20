// frontend/src/pg/usePullToRefresh.js
// Pull-to-refresh для скролл-контейнера: тянем вниз от самого верха.
// Тач — основной сценарий (Mini App на телефоне), колесо мыши — для
// Telegram Desktop и браузера, где тач-событий нет.

import { useCallback, useEffect, useRef, useState } from "react";
import { haptic } from "./telegram";

const THRESHOLD = 64;   // сколько нужно протянуть, чтобы сработало
const MAX_PULL = 96;    // дальше не растягиваем
const HOLD = 44;        // высота индикатора во время обновления

export function usePullToRefresh(onRefresh) {
  const scrollRef = useRef(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [dragging, setDragging] = useState(false);

  const state = useRef({ startY: 0, active: false, pull: 0, busy: false, wheelTimer: null });
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  const run = useCallback(async () => {
    if (state.current.busy) return;
    state.current.busy = true;
    setRefreshing(true);
    setPull(HOLD);
    haptic("impact");
    try {
      await refreshRef.current?.();
    } finally {
      state.current.busy = false;
      state.current.pull = 0;
      setRefreshing(false);
      setPull(0);
    }
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;

    const setPullValue = (value) => {
      state.current.pull = value;
      setPull(value);
    };

    const onTouchStart = (e) => {
      if (state.current.busy || el.scrollTop > 0 || e.touches.length !== 1) return;
      state.current.startY = e.touches[0].clientY;
      state.current.active = true;
      setDragging(true);
    };

    const onTouchMove = (e) => {
      if (!state.current.active) return;
      const dy = e.touches[0].clientY - state.current.startY;
      if (dy <= 0 || el.scrollTop > 0) {
        if (state.current.pull !== 0) setPullValue(0);
        state.current.active = false;
        setDragging(false);
        return;
      }
      e.preventDefault();
      // сопротивление: чем дальше тянем, тем медленнее едет
      setPullValue(Math.min(MAX_PULL, dy * 0.5));
    };

    const onTouchEnd = () => {
      if (!state.current.active) return;
      state.current.active = false;
      setDragging(false);
      if (state.current.pull >= THRESHOLD) run();
      else setPullValue(0);
    };

    // Колесо мыши: копим «перекрут» вверх на самом верху списка
    const onWheel = (e) => {
      if (state.current.busy || el.scrollTop > 0 || e.deltaY >= 0) {
        if (state.current.pull !== 0 && e.deltaY > 0) setPullValue(0);
        return;
      }
      const next = Math.min(MAX_PULL, state.current.pull + Math.min(24, -e.deltaY));
      setDragging(true);
      setPullValue(next);
      clearTimeout(state.current.wheelTimer);
      state.current.wheelTimer = setTimeout(() => {
        setDragging(false);
        if (state.current.pull >= THRESHOLD) run();
        else setPullValue(0);
      }, 140);
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });

    return () => {
      clearTimeout(state.current.wheelTimer);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("wheel", onWheel);
    };
  }, [run]);

  return {
    scrollRef,
    pull,
    refreshing,
    dragging,
    ready: pull >= THRESHOLD,
    refresh: run,
  };
}

export default usePullToRefresh;
