// frontend/src/api.js
import axios from "axios";

export const API_BASE =
  import.meta.env.VITE_API_URL || "https://projectguard-prod-7-1.onrender.com";

console.log("API_BASE =", API_BASE);

export const api = axios.create({
  baseURL: API_BASE,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("jwt_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
