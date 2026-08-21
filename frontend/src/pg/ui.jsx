// frontend/src/pg/ui.jsx
// ============================================================
// Базовые компоненты нового UI (Этап 1).
// Разметка один в один с прототипом, классы — только pg-*.
// ============================================================

import { useEffect, useRef } from "react";
import { Icon } from "./icons";
import { BACK_PRIORITY, useBackButton } from "./telegram";

const cx = (...parts) => parts.filter(Boolean).join(" ");

/* ================= Кнопка ================= */

export function Button({
  variant = "secondary",   // primary | secondary | danger | danger-soft | ghost
  size,                    // sm
  block = false,
  icon,
  loading = false,
  disabled = false,
  className,
  children,
  type = "button",
  ...rest
}) {
  return (
    <button
      type={type}
      className={cx(
        "pg-btn",
        `pg-btn--${variant}`,
        size === "sm" && "pg-btn--sm",
        block && "pg-btn--block",
        className
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <Icon name="loader" size={size === "sm" ? 15 : 18} className="pg-spin" />
      ) : (
        icon && <Icon name={icon} size={size === "sm" ? 15 : 18} />
      )}
      {children}
    </button>
  );
}

/* ================= Карточка ================= */

export function Card({ status, tappable = false, className, children, onClick, ...rest }) {
  const cls = cx(
    "pg-card",
    status && "pg-card--stripe",
    tappable && "pg-card--tap",
    className
  );

  if (tappable) {
    return (
      <button type="button" className={cls} data-status={status} onClick={onClick} {...rest}>
        {children}
      </button>
    );
  }

  return (
    <div className={cls} data-status={status} onClick={onClick} {...rest}>
      {children}
    </div>
  );
}

/* ================= Бейдж ================= */

export function Badge({ tone, plain = false, className, children, ...rest }) {
  return (
    <span
      className={cx(
        "pg-badge",
        tone && `pg-badge--${tone}`,   // success | warning | danger | accent
        plain && "pg-badge--plain",
        className
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

/* ================= Поля ================= */

export function Field({ label, required = false, hint, error, className, children, as }) {
  // <label> активирует первый интерактивный элемент внутри. Для простого поля
  // это удобно (клик по подписи ставит фокус), но если внутри есть кнопки —
  // клик по подписи нажимает первую из них. Такие поля рисуем как div.
  const Tag = as === "div" ? "div" : "label";
  return (
    <Tag className={cx("pg-field", error && "pg-field--error", className)}>
      {label && (
        <span className="pg-field__label">
          {label} {required && <span className="pg-field__req">*</span>}
        </span>
      )}
      {children}
      {error ? (
        <span className="pg-field__hint pg-field__hint--error">{error}</span>
      ) : (
        hint && <span className="pg-field__hint">{hint}</span>
      )}
    </Tag>
  );
}

export function Input({ className, numeric = false, ...rest }) {
  return <input className={cx("pg-input", numeric && "pg-num", className)} {...rest} />;
}

export function Textarea({ className, ...rest }) {
  return <textarea className={cx("pg-textarea", className)} {...rest} />;
}

export function Select({ className, children, ...rest }) {
  return (
    <select className={cx("pg-select", className)} {...rest}>
      {children}
    </select>
  );
}

/* ================= Сегмент-контрол ================= */

export function Segment({ value, onChange, options, className, ...rest }) {
  return (
    <div className={cx("pg-segment", className)} role="tablist" {...rest}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          className="pg-segment__item"
          aria-selected={opt.value === value}
          onClick={() => onChange?.(opt.value)}
        >
          {opt.icon && <Icon name={opt.icon} size={15} />}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/* ================= Боттом-шит ================= */

export function Sheet({ open, title, onClose, children, actions }) {
  const sheetRef = useRef(null);

  // Пока шит открыт, «Назад» в шапке Telegram закрывает его, а не экран под ним
  useBackButton(onClose, !!open, BACK_PRIORITY.sheet);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="pg-sheet-backdrop" onClick={onClose} />
      <div className="pg-sheet" role="dialog" aria-modal="true" ref={sheetRef}>
        <div className="pg-sheet__handle" />
        {title && <h3 className="pg-sheet__title">{title}</h3>}
        <div className="pg-sheet__body">
          {children}
          {actions && <div className="pg-sheet__actions">{actions}</div>}
        </div>
      </div>
    </>
  );
}

/* ================= Состояния ================= */

export function Skeleton({ height = 16, width = "100%", radius, className, style }) {
  return (
    <div
      className={cx("pg-skeleton", className)}
      style={{ height, width, borderRadius: radius, ...style }}
    />
  );
}

// Скелетон карточки списка — три строки в габаритах реальной карточки
export function CardSkeleton() {
  return (
    <div className="pg-card pg-card--stripe">
      <Skeleton height={15} width="58%" />
      <Skeleton height={12} width="42%" style={{ marginTop: 10 }} />
      <Skeleton height={11} width="76%" style={{ marginTop: 14 }} />
      <Skeleton height={3} width="100%" style={{ marginTop: 16 }} />
    </div>
  );
}

export function StateBlock({ variant = "empty", icon, title, text, action }) {
  const fallbackIcon = variant === "error" ? "wifiOff" : "inbox";
  return (
    <div className={cx("pg-state", variant === "error" && "pg-state--error")}>
      <div className="pg-state__icon">
        <Icon name={icon || fallbackIcon} size={26} />
      </div>
      {title && <h3 className="pg-state__title">{title}</h3>}
      {text && <div className="pg-state__text">{text}</div>}
      {action}
    </div>
  );
}

export function LoadingState({ text = "Загружаем…", rows = 3 }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="pg-sr-only">{text}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {Array.from({ length: rows }, (_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

export function ErrorState({ text = "Не удалось загрузить данные", onRetry }) {
  return (
    <StateBlock
      variant="error"
      title="Что-то пошло не так"
      text={text}
      action={
        onRetry && (
          <Button variant="secondary" size="sm" icon="refresh" onClick={onRetry}>
            Повторить
          </Button>
        )
      }
    />
  );
}

export function EmptyState({ icon = "inbox", title = "Пусто", text, action }) {
  return <StateBlock variant="empty" icon={icon} title={title} text={text} action={action} />;
}

/* ================= Мелкие паттерны ================= */

export function Track({ value = 0, tone }) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <div className={cx("pg-track", tone && `pg-track--${tone}`)}>
      <div className="pg-track__fill" style={{ width: `${width}%` }} />
    </div>
  );
}

export function KV({ k, children, numeric = false }) {
  return (
    <div className="pg-kv">
      <span className="pg-kv__k">{k}</span>
      <span className={cx("pg-kv__v", numeric && "pg-num")}>{children}</span>
    </div>
  );
}

export { Icon };
