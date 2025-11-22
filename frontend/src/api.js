// frontend/src/api.js
import axios from "axios";

// 🔥 ЕДИНЫЙ ИСТОЧНИК API, без env
export const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

console.log("API_BASE =", API_BASE);

// 🔥 axios создаём с единым URL
export const api = axios.create({
  baseURL: API_BASE,
});

// 🔥 backend принимает токен ТОЛЬКО в headers.token !!!
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("jwt_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  } // <-- ВАЖНО
  return config;
});

