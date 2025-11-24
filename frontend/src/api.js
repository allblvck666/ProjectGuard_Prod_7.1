// frontend/src/api.js
import axios from "axios";

// 🔥 ЕДИНЫЙ ИСТОЧНИК API, без env
export const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

console.log("API_BASE =", API_BASE);

// 🔥 axios создаём с единым URL
export const api = axios.create({
  baseURL: API_BASE,
});

// 🔥 Добавляем токен в Authorization header для всех запросов
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("jwt_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 🔥 Обработка ошибок CORS и сетевых ошибок
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.code === "ERR_NETWORK" || error.message?.includes("Network Error")) {
      console.error("❌ Network Error - проверьте CORS и URL бэкенда:", error.config?.url);
    }
    
    // Обработка 401 - неавторизован
    if (error.response?.status === 401) {
      console.warn("▲ 401 от API:", error.config?.url);
      // Очищаем невалидный токен
      const token = localStorage.getItem("jwt_token");
      if (token) {
        localStorage.removeItem("jwt_token");
        localStorage.removeItem("role");
        // Не делаем редирект автоматически, пусть пользователь сам войдет
      }
    }
    
    return Promise.reject(error);
  }
);

