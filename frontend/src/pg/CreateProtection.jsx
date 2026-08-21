// frontend/src/pg/CreateProtection.jsx
// ============================================================
// Этап 4 — создание защиты (флаг ?ui-create=new).
// Поля, правила и запрос те же, что у старого экрана: компонент
// проверяет форму до отправки и показывает ошибки прямо у полей,
// вместо alert-ов. При дубликате открывается экран конфликта.
// ============================================================

import { useMemo, useState } from "react";
import { Badge, Button, Field, Icon, Input, Select, Textarea } from "./ui";
import SkuPicker from "./SkuPicker";
import ConflictScreen from "./ConflictScreen";
import { fmtArea, fmtNumber, managerName, plural } from "./format";
import { BACK_PRIORITY, haptic, isTelegramApp, useBackButton, useMainButton } from "./telegram";
import { useNativeNav } from "./useFlags";
import "./create.css";
import "./form.css";

const MIN_AREA = 50;

// Срок защиты в рабочих днях считает бэкенд — здесь та же таблица,
// чтобы менеджер видел результат до отправки.
function ttlWorkdays(area) {
  if (!area || area < MIN_AREA) return null;
  if (area < 100) return 5;
  if (area < 250) return 10;
  if (area < 500) return 15;
  return 30;
}

const REQUIRED_LABELS = {
  manager: "менеджер",
  partner: "партнёр",
  partner_city: "город партнёра",
  client: "клиент",
  last4: "последние 4 цифры",
  object_city: "город объекта",
  skus: "артикулы",
  area: "метраж",
};

export default function CreateProtection({
  form, setForm, managers, skus, selectedSkus, setSelectedSkus,
  perSkuMode, setPerSkuMode, onAreaChange, submit, onBack, onGoToList,
  similarProtectionModal, setSimilarProtectionModal,
  submitSimilarProtectionRequest, skipConflictManually, auth,
}) {
  const [touched, setTouched] = useState({});
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null); // null | "created" | "requested"

  const role = auth?.role || auth?.user?.role || "";
  const isAdmin = role === "admin" || role === "superadmin";

  const conflictOpen = !!similarProtectionModal?.open;
  const nativeNav = useNativeNav();
  useBackButton(onBack, !conflictOpen && !done, BACK_PRIORITY.screen);

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  const blur = (field) => () => setTouched((t) => ({ ...t, [field]: true }));

  const totalArea = useMemo(() => {
    if (perSkuMode) {
      return selectedSkus.reduce((sum, s) => sum + Number(s.area || 0), 0);
    }
    return Number(form.area_m2 || 0);
  }, [perSkuMode, selectedSkus, form.area_m2]);

  const ttl = ttlWorkdays(totalArea);

  const errors = useMemo(() => {
    const e = {};
    if (!String(form.manager || "").trim()) e.manager = "Выберите менеджера";
    if (!String(form.partner || "").trim()) e.partner = "Укажите партнёра";
    if (!String(form.partner_city || "").trim()) e.partner_city = "Укажите город партнёра";
    if (!String(form.client || "").trim()) e.client = "Укажите клиента";
    if (!/^\d{4}$/.test(String(form.last4 || "").trim())) {
      e.last4 = form.last4 ? "Нужны ровно 4 цифры" : "Укажите последние 4 цифры";
    }
    if (!String(form.object_city || "").trim()) e.object_city = "Укажите город объекта";
    if (selectedSkus.length === 0) e.skus = "Добавьте хотя бы один артикул";
    if (perSkuMode && selectedSkus.some((s) => !Number(s.area))) {
      e.area = "Укажите метраж для каждого артикула";
    } else if (!totalArea) {
      e.area = "Укажите метраж";
    } else if (totalArea < MIN_AREA) {
      e.area = `Защита ставится от ${MIN_AREA} м²`;
    }
    return e;
  }, [form, selectedSkus, perSkuMode, totalArea]);

  const errorFor = (field) =>
    showAllErrors || touched[field] ? errors[field] : undefined;

  const steps = [
    { label: "Дилер", done: !errors.manager && !errors.partner && !errors.partner_city },
    { label: "Объект", done: !errors.client && !errors.last4 && !errors.object_city },
    { label: "Товар", done: !errors.skus && !errors.area },
  ];

  const missing = Object.keys(errors);

  const onSubmit = async () => {
    if (missing.length > 0) {
      setShowAllErrors(true);
      haptic("error");
      const first = document.querySelector(".pgc .pg-field--error");
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setSaving(true);
    const ok = await submit();
    setSaving(false);
    if (ok) {
      haptic("success");
      setTouched({});
      setShowAllErrors(false);
      setDone("created");
    }
  };

  // Нижнюю кнопку рисует Telegram; в браузере остаётся кнопка в странице
  useMainButton({
    text: "Создать защиту",
    onClick: () => onSubmit(),
    visible: nativeNav && !conflictOpen && !done,
    loading: saving,
  });

  /* ---------------- экран конфликта ---------------- */

  if (conflictOpen) {
    return (
      <ConflictScreen
        similar={similarProtectionModal.similarInfo?.similarProtection}
        fallbackMessage={similarProtectionModal.similarInfo?.message}
        payload={similarProtectionModal.payload}
        reason={similarProtectionModal.requestReason}
        setReason={(value) =>
          setSimilarProtectionModal({ ...similarProtectionModal, requestReason: value })
        }
        isAdmin={isAdmin}
        onBack={() =>
          setSimilarProtectionModal({
            open: false, similarInfo: null, payload: null, requestReason: "",
          })
        }
        onRequest={async () => {
          const ok = await submitSimilarProtectionRequest();
          if (ok) {
            haptic("success");
            setDone("requested");
          }
        }}
        onSkip={async () => {
          const ok = await skipConflictManually(
            similarProtectionModal.payload,
            similarProtectionModal.requestReason
          );
          if (ok) {
            haptic("success");
            setDone("created");
          }
        }}
      />
    );
  }

  /* ---------------- защита создана ---------------- */

  if (done) {
    const requested = done === "requested";
    return (
      <div className="pgc">
        <div className="pgc__scroll">
          <div className="pgc-done">
            <div className={`pgc-done__ic${requested ? " pgc-done__ic--wait" : ""}`}>
              <Icon name={requested ? "send" : "shieldCheck"} size={30} />
            </div>
            <h2 className="pgc-done__title">
              {requested ? "Запрос отправлен" : "Защита создана"}
            </h2>
            <div className="pgc-done__text">
              {requested
                ? "Админ увидит его в заявках. Как только защиту одобрят, она появится в списке активных."
                : "Она уже в списке активных. Уведомления уйдут менеджеру и админам."}
            </div>
            <div className="pgc-done__acts">
              <Button variant="primary" block icon="shield" onClick={onGoToList}>
                К списку защит
              </Button>
              <Button
                variant="ghost"
                block
                icon={requested ? "arrowLeft" : "plus"}
                onClick={() => setDone(null)}
              >
                {requested ? "Вернуться к форме" : "Создать ещё одну"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ---------------- форма ---------------- */

  return (
    <div className="pgc">
      {!isTelegramApp() && (
        <div className="pgc__fallback">
          <Button variant="ghost" size="sm" icon="chevronLeft" onClick={onBack}>
            Назад
          </Button>
        </div>
      )}

      <div className="pgc__scroll">
        <div className="pgc-steps">
          {steps.map((s) => (
            <span
              key={s.label}
              className={`pgc-steps__i${s.done ? " pgc-steps__i--on" : ""}`}
            >
              {s.label}
            </span>
          ))}
        </div>

        {/* ---- кто защищает ---- */}
        <div className="pgc-grp">
          <div className="pgc-grp__h">Кто защищает</div>

          <Field label="Менеджер" required error={errorFor("manager")}>
            <Select
              value={form.manager || ""}
              onChange={set("manager")}
              onBlur={blur("manager")}
            >
              <option value="">Выберите менеджера…</option>
              {(managers || []).map((m, i) => {
                const name = managerName(m);
                return (
                  <option key={m?.id ?? `${name}-${i}`} value={name}>
                    {name}
                  </option>
                );
              })}
            </Select>
          </Field>

          <Field label="Партнёр (дилер)" required error={errorFor("partner")}>
            <Input
              placeholder="Кто ставит защиту"
              value={form.partner || ""}
              onChange={set("partner")}
              onBlur={blur("partner")}
            />
          </Field>

          <Field label="Город партнёра" required error={errorFor("partner_city")}>
            <Input
              placeholder="Город"
              value={form.partner_city || ""}
              onChange={set("partner_city")}
              onBlur={blur("partner_city")}
            />
          </Field>
        </div>

        {/* ---- объект и клиент ---- */}
        <div className="pgc-grp">
          <div className="pgc-grp__h">Объект и клиент</div>

          <Field label="Клиент / организация" required error={errorFor("client")}>
            <Input
              placeholder="Кого защищаем"
              value={form.client || ""}
              onChange={set("client")}
              onBlur={blur("client")}
            />
          </Field>

          <Field
            label="Последние 4 цифры телефона"
            required
            error={errorFor("last4")}
            hint="Нужны для проверки на дубликат"
          >
            <Input
              numeric
              inputMode="numeric"
              maxLength={4}
              placeholder="0000"
              value={form.last4 || ""}
              onChange={(e) =>
                setForm({ ...form, last4: e.target.value.replace(/\D/g, "").slice(0, 4) })
              }
              onBlur={blur("last4")}
            />
          </Field>

          <Field label="Город объекта" required error={errorFor("object_city")}>
            <Input
              placeholder="Город"
              value={form.object_city || ""}
              onChange={set("object_city")}
              onBlur={blur("object_city")}
            />
          </Field>

          <Field label="Адрес объекта">
            <Input
              placeholder="Улица, дом"
              value={form.address || ""}
              onChange={set("address")}
            />
          </Field>
        </div>

        {/* ---- товар и метраж ---- */}
        <div className="pgc-grp">
          <div className="pgc-grp__h">Товар и метраж</div>

          <div className="pgc-mode">
            <div className="pg-segment">
              <button
                type="button"
                className="pg-segment__item"
                aria-selected={!perSkuMode}
                onClick={() => setPerSkuMode(false)}
              >
                Единый метраж
              </button>
              <button
                type="button"
                className="pg-segment__item"
                aria-selected={perSkuMode}
                onClick={() => setPerSkuMode(true)}
              >
                По артикулам
              </button>
            </div>
          </div>

          <Field
            as="div"
            label="Артикулы"
            required
            error={errorFor("skus")}
            hint={selectedSkus.length > 0 ? `Выбрано ${selectedSkus.length} из 3` : undefined}
          >
            <SkuPicker
              skus={skus}
              selected={selectedSkus}
              setSelected={(next) => {
                setSelectedSkus(next);
                setTouched((t) => ({ ...t, skus: true }));
              }}
              perSkuMode={perSkuMode}
              onAreaChange={(sku, value) => {
                onAreaChange(sku, value);
                setTouched((t) => ({ ...t, area: true }));
              }}
            />
          </Field>

          {!perSkuMode && (
            <Field label="Единый метраж (м²)" required error={errorFor("area")}>
              <Input
                numeric
                inputMode="numeric"
                placeholder="0"
                value={form.area_m2 || ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    // запятая под рукой в русской раскладке, но Number("120,5") — NaN
                    area_m2: e.target.value.replace(/[^\d.,]/g, "").replace(",", "."),
                  })
                }
                onBlur={blur("area")}
              />
            </Field>
          )}
          {perSkuMode && errorFor("area") && (
            <div className="pgc-err">{errorFor("area")}</div>
          )}

          <div className="pgc-rule">
            <Icon name="info" size={16} />
            <div>
              {ttl ? (
                <>
                  <b className="pg-num">{fmtArea(totalArea)}</b> → защита на{" "}
                  <b className="pg-num">
                    {ttl} {plural(ttl, "рабочий день", "рабочих дня", "рабочих дней")}
                  </b>
                </>
              ) : (
                <>
                  Защита ставится от <b className="pg-num">{MIN_AREA} м²</b>
                  {totalArea > 0 && (
                    <>
                      {" "}· сейчас <b className="pg-num">{fmtNumber(totalArea)}</b>
                    </>
                  )}
                </>
              )}
              <div className="pgc-rule__s pg-num">
                50–100 → 5 · 100–250 → 10 · 250–500 → 15 · 500+ → 30
              </div>
            </div>
          </div>

          <Field label="Комментарий">
            <Textarea
              placeholder="Необязательно"
              value={form.comment || ""}
              onChange={set("comment")}
            />
          </Field>
        </div>

        {/* ---- отправка ---- */}
        <div className="pgc-submit">
          {showAllErrors && missing.length > 0 && (
            <div className="pgc-missing">
              <Icon name="alert" size={14} />
              Заполните: {missing.map((f) => REQUIRED_LABELS[f] || f).join(", ")}
            </div>
          )}
          {!nativeNav && (
            <Button
              variant="primary"
              block
              icon="shieldCheck"
              loading={saving}
              onClick={onSubmit}
            >
              Создать защиту
            </Button>
          )}
          <div className="pgc-submit__note">
            <Badge plain className="pg-num">
              {selectedSkus.length
                ? `${selectedSkus.length} ${plural(selectedSkus.length, "артикул", "артикула", "артикулов")}`
                : "Артикулы не выбраны"}
            </Badge>
            {totalArea > 0 && <Badge plain className="pg-num">{fmtArea(totalArea)}</Badge>}
          </div>
        </div>

        <div className="pgc__pad" />
      </div>
    </div>
  );
}
