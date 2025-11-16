// frontend/src/api.js
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL; // ← строго из .env

const api = axios.create({
  baseURL: API_BASE,
});

// автоматически подставляем токен в каждый запрос
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("jwt_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export { api, API_BASE };
