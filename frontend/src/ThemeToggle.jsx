// frontend/src/ThemeToggle.jsx
import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const isTG = typeof window !== "undefined" && window.Telegram?.WebApp != null;
  const [isLight, setIsLight] = useState(() => {
    const saved = localStorage.getItem("theme");
    return saved === "light";
  });

  useEffect(() => {
    if (isTG) return;
    if (isLight) {
      document.body.classList.add("light-theme");
    } else {
      document.body.classList.remove("light-theme");
    }
  }, [isLight, isTG]);

  useEffect(() => {
    if (isTG) {
      document.body.classList.remove("light-theme");
    }
  }, [isTG]);

  const toggleTheme = () => {
    const newTheme = !isLight;
    setIsLight(newTheme);
    localStorage.setItem("theme", newTheme ? "light" : "dark");
  };

  if (isTG) {
    return null;
  }

  return (
    <div 
      className="theme-toggle" 
      onClick={toggleTheme}
      title={isLight ? "Переключить на темную тему" : "Переключить на светлую тему"}
    >
      <div className="theme-toggle-slider">
        <span className="theme-toggle-icon moon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3a7 7 0 1 0 11.5 11.5Z" />
          </svg>
        </span>
        <span className="theme-toggle-icon sun" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M12 18a6 6 0 1 1 0-12 6 6 0 0 1 0 12Zm0-16a1 1 0 0 1 1 1v2a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1Zm0 18a1 1 0 0 1 1 1v0a1 1 0 1 1-2 0 1 1 0 0 1 1-1Zm10-8a1 1 0 0 1-1 1h-2a1 1 0 1 1 0-2h2a1 1 0 0 1 1 1ZM5 12a1 1 0 0 1-1 1H2a1 1 0 1 1 0-2h2a1 1 0 0 1 1 1Zm14.07-7.07a1 1 0 0 1 0 1.41l-1.42 1.42a1 1 0 0 1-1.41-1.42l1.41-1.41a1 1 0 0 1 1.42 0ZM7.76 17.66a1 1 0 0 1 0 1.41l-1.42 1.42a1 1 0 1 1-1.41-1.42l1.41-1.41a1 1 0 0 1 1.42 0Zm11.31 1.42a1 1 0 0 1-1.41 0l-1.42-1.42a1 1 0 0 1 1.42-1.41l1.41 1.41a1 1 0 0 1 0 1.42ZM7.76 6.34A1 1 0 0 1 6.34 7.76L4.92 6.34a1 1 0 1 1 1.42-1.41l1.42 1.41Z" />
          </svg>
        </span>
      </div>
    </div>
  );
}
