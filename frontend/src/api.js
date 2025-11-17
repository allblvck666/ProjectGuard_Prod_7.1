// frontend/src/api.js
import axios from "axios";

// 🔥 ЕДИНЫЙ ИСТОЧНИК API, без env
export const API_BASE = "https://projectguard-prod-7-1.onrender.com";

console.log("API_BASE =", API_BASE);

// 🔥 axios создаём с единым URL
export const api = axios.create({
  baseURL: API_BASE,
});

// 🔥 backend принимает токен ТОЛЬКО в headers.token !!!
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("jwt_token");
  if (token) config.headers.token = token; // <-- ВАЖНО
  return config;
});

