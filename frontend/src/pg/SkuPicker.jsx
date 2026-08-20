// frontend/src/pg/SkuPicker.jsx
// Выбор артикулов в новом оформлении. Правила те же, что и в старом
// SkuSelector (до 3 артикулов, выбор типа при совпадении кода,
// метраж по артикулам) — меняется только вид.

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Icon, Input } from "./ui";

const MAX_SKUS = 3;

export default function SkuPicker({
  skus = [],
  selected = [],
  setSelected,
  perSkuMode = false,
  onAreaChange,
  onNotice,
}) {
  const [input, setInput] = useState("");
  const [chooseType, setChooseType] = useState(null);
  const [focused, setFocused] = useState(false);
  const boxRef = useRef(null);

  const suggestions = useMemo(() => {
    const val = input.trim().toUpperCase();
    if (!val) return [];
    return skus.filter((s) => String(s.sku).toUpperCase().startsWith(val)).slice(0, 10);
  }, [input, skus]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setFocused(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const notice = (msg) => (onNotice ? onNotice(msg) : window.alert(msg));

  const pushSku = (skuObj) => {
    if (selected.length >= MAX_SKUS) {
      notice(`Можно добавить максимум ${MAX_SKUS} артикула`);
      return;
    }
    if (selected.find((s) => s.sku === skuObj.sku && s.type === skuObj.type)) {
      notice("Этот артикул уже добавлен");
      return;
    }
    setSelected([...selected, { ...skuObj, area: "" }]);
    setInput("");
    setFocused(false);
  };

  const addSku = (skuObj) => {
    const same = skus.filter((s) => s.sku === skuObj.sku);
    if (same.length > 1) {
      setChooseType(same);
      setInput("");
      setFocused(false);
      return;
    }
    pushSku(skuObj);
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
                <span className="pgf-sku__type">{s.type}</span>
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
            autoComplete="off"
          />
          {focused && suggestions.length > 0 && (
            <div className="pgf-sku__drop">
              {suggestions.map((s, i) => (
                <button
                  type="button"
                  className="pgf-sku__opt"
                  key={`${s.sku}-${s.type}-${i}`}
                  onClick={() => addSku(s)}
                >
                  <span className="pgf-sku__opt-code">{s.sku}</span>
                  <span className="pgf-sku__opt-meta">
                    {[s.collection, s.type].filter(Boolean).join(" · ")}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="pgf-sku__limit">
          <Icon name="info" size={14} />
          Максимум {MAX_SKUS} артикула. Уберите один, чтобы добавить другой.
        </div>
      )}

      {chooseType && (
        <div className="pgf-sku__choose">
          <div className="pgf-sku__choose-h">
            Выберите тип для <b>{chooseType[0].sku}</b>
          </div>
          <div className="pgf-sku__choose-b">
            {chooseType.map((opt, i) => (
              <Button
                key={i}
                variant="secondary"
                size="sm"
                onClick={() => {
                  pushSku(opt);
                  setChooseType(null);
                }}
              >
                {opt.type}
              </Button>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setChooseType(null)}>
              Отмена
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
