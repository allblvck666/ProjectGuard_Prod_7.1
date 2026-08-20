// frontend/src/pg/SkuPicker.jsx
// ============================================================
// Выбор артикулов. Правила те же, что и в старом SkuSelector
// (до 3 артикулов, метраж по артикулам) — меняется вид и то,
// как выбирается вариант.
//
// В справочнике один код живёт в нескольких вариантах: у 49 кодов
// есть и «замок», и «клей», а у части — ещё и разные коллекции.
// Поэтому в подсказке сразу видно тип и коллекцию, а выбранный
// вариант добавляется без второго вопроса «замок или клей».
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Icon, Input } from "./ui";
import { notify } from "./notify";

const MAX_SKUS = 3;
const MAX_SUGGESTIONS = 24;

function variantKey(s) {
  return [
    String(s.sku || "").toUpperCase(),
    String(s.type || "").toLowerCase(),
    String(s.collection || "").toLowerCase(),
  ].join("|");
}

export default function SkuPicker({
  skus = [],
  selected = [],
  setSelected,
  perSkuMode = false,
  onAreaChange,
  onNotice,
}) {
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const boxRef = useRef(null);

  const suggestions = useMemo(() => {
    const val = input.trim().toUpperCase();
    if (!val) return [];

    const seen = new Set();
    const found = [];
    for (const s of skus) {
      const code = String(s.sku || "").toUpperCase();
      if (!code.startsWith(val)) continue;
      const key = variantKey(s);
      if (seen.has(key)) continue; // в справочнике встречаются повторы строк
      seen.add(key);
      found.push(s);
    }

    // Варианты одного кода держим рядом: сначала точное совпадение, потом по коду и типу
    found.sort((a, b) => {
      const ca = String(a.sku || "");
      const cb = String(b.sku || "");
      if (ca !== cb) {
        if (ca.toUpperCase() === val) return -1;
        if (cb.toUpperCase() === val) return 1;
        return ca.localeCompare(cb, "ru", { numeric: true });
      }
      return String(a.type || "").localeCompare(String(b.type || ""), "ru");
    });

    return found.slice(0, MAX_SUGGESTIONS);
  }, [input, skus]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setFocused(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const notice = (msg) => (onNotice ? onNotice(msg) : notify.error(msg));

  // Мы добавляем артикул уже на касании, и подсказка сразу исчезает.
  // Отставший click после этого попал бы в то, что оказалось под пальцем
  // (в шите правки под списком — «Сохранить»), поэтому гасим ровно один.
  const swallowNextClick = () => {
    const handler = (e) => {
      e.stopPropagation();
      e.preventDefault();
      document.removeEventListener("click", handler, true);
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      document.removeEventListener("click", handler, true);
    }, 300);
    document.addEventListener("click", handler, true);
  };

  // В подсказке уже выбран конкретный вариант — добавляем как есть,
  // переспрашивать про тип не нужно
  const addSku = (skuObj) => {
    if (selected.length >= MAX_SKUS) {
      notice(`Можно добавить максимум ${MAX_SKUS} артикула`);
      return;
    }
    const already = selected.find(
      (s) =>
        String(s.sku).toUpperCase() === String(skuObj.sku).toUpperCase() &&
        String(s.type || "").toLowerCase() === String(skuObj.type || "").toLowerCase()
    );
    if (already) {
      notice(`${skuObj.sku} · ${skuObj.type || "без типа"} уже добавлен`);
      return;
    }
    setSelected([...selected, { ...skuObj, area: "" }]);
    setInput("");
    setFocused(false);
  };

  const removeSku = (sku) =>
    setSelected(selected.filter((s) => !(s.sku === sku.sku && s.type === sku.type)));

  const canAddMore = selected.length < MAX_SKUS;

  return (
    <div className="pgf-sku" ref={boxRef}>
      {selected.length > 0 && (
        <div className="pgf-sku__list">
          {selected.map((s, i) => (
            <div className="pgf-sku__item" key={`${s.sku}-${s.type}-${i}`}>
              <Badge tone="accent" plain className="pgf-sku__chip">
                <span>{s.sku}</span>
                {s.type && <span className="pgf-sku__type">{s.type}</span>}
                <button
                  type="button"
                  className="pgf-sku__x"
                  onClick={() => removeSku(s)}
                  aria-label={`Убрать ${s.sku}`}
                >
                  <Icon name="close" size={12} />
                </button>
              </Badge>
              {perSkuMode && (
                <Input
                  numeric
                  className="pgf-sku__area"
                  inputMode="numeric"
                  placeholder="м²"
                  value={s.area ?? ""}
                  onChange={(e) => onAreaChange?.(s, e.target.value)}
                  aria-label={`Метраж для ${s.sku}`}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {canAddMore ? (
        <div className="pgf-sku__search">
          <Input
            placeholder="Введите артикул"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setFocused(true);
            }}
            onFocus={() => setFocused(true)}
            inputMode="numeric"
            autoComplete="off"
          />
          {focused && input.trim() && (
            <div className="pgf-sku__drop">
              {suggestions.length === 0 ? (
                <div className="pgf-sku__none">
                  <Icon name="search" size={14} />
                  Артикул не найден
                </div>
              ) : (
                suggestions.map((s) => (
                  <button
                    type="button"
                    className="pgf-sku__opt"
                    key={variantKey(s)}
                    // Реагируем на касание, а не на click: на телефоне при тапе
                    // по подсказке закрывается клавиатура, страница подпрыгивает,
                    // и click уходит уже мимо кнопки. preventDefault удерживает
                    // фокус в поле, поэтому ничего не прыгает.
                    onPointerDown={(e) => {
                      e.preventDefault();
                      swallowNextClick();
                      addSku(s);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        addSku(s);
                      }
                    }}
                  >
                    <span className="pgf-sku__opt-head">
                      <b className="pgf-sku__opt-code">{s.sku}</b>
                      {s.type && <span className="pgf-sku__opt-type">{s.type}</span>}
                    </span>
                    {s.collection && (
                      <span className="pgf-sku__opt-meta">{s.collection}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="pgf-sku__limit">
          <Icon name="info" size={14} />
          Максимум {MAX_SKUS} артикула. Уберите один, чтобы добавить другой.
        </div>
      )}
    </div>
  );
}
