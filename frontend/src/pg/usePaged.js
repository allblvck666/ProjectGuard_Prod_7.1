// frontend/src/pg/usePaged.js
// ============================================================
// Списки бывают большими: в архиве под тысячу защит. Если рисовать
// все разом, получается больше 20 тысяч узлов DOM — на телефоне
// это заметное подвисание при каждом переключении фильтра.
//
// Показываем страницами, «Показать ещё» догружает следующую.
// При смене фильтра счётчик сбрасывается: список начинается сверху.
// ============================================================

import { useEffect, useMemo, useState } from "react";

export const PAGE_SIZE = 30;

export function usePaged(items, resetKey) {
  const [limit, setLimit] = useState(PAGE_SIZE);

  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [resetKey]);

  const list = Array.isArray(items) ? items : [];
  const visible = useMemo(() => list.slice(0, limit), [list, limit]);

  return {
    visible,
    hasMore: list.length > limit,
    rest: Math.max(0, list.length - limit),
    showMore: () => setLimit((l) => l + PAGE_SIZE),
  };
}

export default usePaged;
