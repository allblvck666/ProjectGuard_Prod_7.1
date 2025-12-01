// frontend/src/api.js
import axios from "axios";

// 🔥 ЕДИНЫЙ ИСТОЧНИК API
export const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

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

// 🔥 Обработка ошибок и 401 редирект
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Обработка сетевых ошибок
    if (error.code === "ERR_NETWORK" || error.message?.includes("Network Error")) {
      // В production не логируем, но можно добавить отправку в сервис мониторинга
      if (import.meta.env.DEV) {
        console.error("❌ Network Error:", error.config?.url);
      }
    }
    
    // Обработка 401 - неавторизован
    if (error.response?.status === 401) {
      // Очищаем невалидный токен и данные пользователя
      localStorage.removeItem("jwt_token");
      localStorage.removeItem("role");
      localStorage.removeItem("auth_user");
      
      // Редирект на логин только если не на странице логина
      if (!window.location.pathname.includes("login") && !window.location.hash.includes("login")) {
        // Используем событие для уведомления App.jsx о необходимости показать LoginPage
        window.dispatchEvent(new CustomEvent("auth:logout"));
      }
    }
    
    // Обработка других ошибок (500, 400 и т.д.)
    if (error.response?.status >= 500) {
      // Серверная ошибка - можно показать уведомление пользователю
      if (import.meta.env.DEV) {
        console.error("❌ Server Error:", error.response?.data);
      }
    }
    
    return Promise.reject(error);
  }
);

// ===== ХЕЛПЕРЫ ДЛЯ АВТОРИЗАЦИИ =====

export const registerOrLogin = async (data) => {
  const res = await api.post("/api/auth/register_or_login", data);
  if (res.data.token && res.data.user) {
    localStorage.setItem("jwt_token", res.data.token);
    localStorage.setItem("role", res.data.user.role);
    localStorage.setItem("auth_user", JSON.stringify(res.data.user));
  }
  return res.data;
};

export const login = async (data) => {
  const res = await api.post("/api/auth/login", data);
  if (res.data.token && res.data.user) {
    localStorage.setItem("jwt_token", res.data.token);
    localStorage.setItem("role", res.data.user.role);
    localStorage.setItem("auth_user", JSON.stringify(res.data.user));
  }
  return res.data;
};

export const register = async (data) => {
  const res = await api.post("/api/auth/register", data);
  if (res.data.token && res.data.user) {
    localStorage.setItem("jwt_token", res.data.token);
    localStorage.setItem("role", res.data.user.role);
    localStorage.setItem("auth_user", JSON.stringify(res.data.user));
  }
  return res.data;
};

export const fetchMe = async () => {
  const res = await api.get("/api/auth/me");
  if (res.data.user) {
    localStorage.setItem("auth_user", JSON.stringify(res.data.user));
    localStorage.setItem("role", res.data.user.role);
  }
  return res.data.user;
};

// ===== ВЕРИФИКАЦИЯ ЧЕРЕЗ TELEGRAM =====

export const requestVerificationCode = async (data) => {
  const res = await api.post("/api/auth/request-verification-code", data);
  return res.data;
};

export const verifyCode = async (data) => {
  const res = await api.post("/api/auth/verify-code", data);
  return res.data;
};

// ===== АДМИНСКИЕ API ДЛЯ УПРАВЛЕНИЯ ПОЛЬЗОВАТЕЛЯМИ =====

export const adminUsersAPI = {
  getAll: async () => {
    const res = await api.get("/api/admin/users");
    return res.data.users || [];
  },
  
  update: async (userId, data) => {
    const res = await api.patch(`/api/admin/users/${userId}`, data);
    return res.data.user;
  },
  
  delete: async (userId) => {
    const res = await api.delete(`/api/admin/users/${userId}`);
    return res.data;
  },
};

