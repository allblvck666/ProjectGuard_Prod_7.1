// frontend/src/pg/icons.jsx
// ============================================================
// Единый SVG-набор нового UI. Один компонент <Icon name="..." />,
// одна геометрия (24×24, stroke, currentColor) — эмодзи в новом
// слое не используются вообще.
// ============================================================

import PATHS from "./icon-paths";

export function Icon({ name, size = 18, className = "", strokeWidth = 2, ...rest }) {
  const path = PATHS[name];
  if (!path) return null;
  return (
    <svg
      className={className ? `pg-icon ${className}` : "pg-icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {path}
    </svg>
  );
}

export default Icon;
