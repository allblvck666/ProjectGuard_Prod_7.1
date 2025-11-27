// frontend/src/ThemeToggle.jsx
import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [isLight, setIsLight] = useState(() => {
    const saved = localStorage.getItem("theme");
    return saved === "light";
  });

  useEffect(() => {
    // Применяем тему при загрузке
    if (isLight) {
      document.body.classList.add("light-theme");
    } else {
      document.body.classList.remove("light-theme");
    }
  }, [isLight]);

  const toggleTheme = () => {
    const newTheme = !isLight;
    setIsLight(newTheme);
    localStorage.setItem("theme", newTheme ? "light" : "dark");
    
    if (newTheme) {
      document.body.classList.add("light-theme");
    } else {
      document.body.classList.remove("light-theme");
    }
  };

  return (
    <div 
      className="theme-toggle" 
      onClick={toggleTheme}
      title={isLight ? "Переключить на темную тему" : "Переключить на светлую тему"}
    >
      <div className="theme-toggle-slider">
        <span className="theme-toggle-icon moon">🌙</span>
        <span className="theme-toggle-icon sun">☀️</span>
      </div>
    </div>
  );
}

