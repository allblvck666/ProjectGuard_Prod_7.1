// frontend/src/api.js
import axios from "axios";

// 🔥 ЕДИНЫЙ ИСТОЧНИК API
const PROD_API_FALLBACK = "https://projectguard-prod-7-1.onrender.com";
const LOCAL_API_FALLBACK = "http://localhost:8000";

function inferApiBase() {
  if (typeof window === "undefined") {
    return PROD_API_FALLBACK;
  }
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return LOCAL_API_FALLBACK;
  }
  return PROD_API_FALLBACK;
}

export const API_BASE = import.meta.env.VITE_API_URL || inferApiBase();

// 🔥 axios создаём с единым URL
export const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000, // 30 секунд таймаут
});

// Only reads are retried after an uncertain network/server failure. Repeating a
// mutation could create two protections or consume two extensions.
const safeToRetry = (config) => ["get", "head", "options"].includes((config?.method || "get").toLowerCase());
let recoveryPromise = null;
let authGeneration = 0;
let explicitlyLoggedOut = false;
let authenticationIssue = null;

export function admissionError(error) {
  const detail = error?.response?.data?.detail;
  return error?.response?.status === 403 && ["access_pending", "access_rejected", "access_blocked"].includes(detail?.code)
    ? { code: detail.code, message: detail.message || "Обратитесь к администратору для получения доступа." }
    : null;
}

export const getAuthenticationIssue = () => authenticationIssue;

function denyAuthentication(issue) {
  authenticationIssue = issue;
  ["jwt_token", "role", "auth_user", "cached_managers", "cached_skus"].forEach(key => localStorage.removeItem(key));
  window.dispatchEvent(new CustomEvent("auth:denied", { detail: issue }));
}

window.addEventListener("auth:logout", () => {
  explicitlyLoggedOut = true;
  authGeneration += 1;
});

export function resumeAutomaticAuthentication() {
  explicitlyLoggedOut = false;
}

export function storeAuthentication(data) {
  if (!data?.token || !data?.user?.id) throw new Error("Invalid authentication response");
  authenticationIssue = null;
  const session = { token: data.token, role: data.user.role, user: data.user };
  localStorage.setItem("jwt_token", session.token);
  localStorage.setItem("role", session.role);
  localStorage.setItem("auth_user", JSON.stringify(session.user));
  window.dispatchEvent(new CustomEvent("auth:updated", { detail: session }));
  return session;
}

export function authenticateTelegram() {
  if (explicitlyLoggedOut) return Promise.reject(new Error("Explicitly logged out"));
  if (recoveryPromise) return recoveryPromise;
  const initData = window.Telegram?.WebApp?.initData;
  if (!initData) return Promise.reject(new Error("Reopen the application through Telegram"));
  const generation = authGeneration;
  const telegramUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  // These display fields keep the previous backend compatible during rollout.
  // The updated server derives identity exclusively from verified init_data.
  const payload = {
    init_data: initData,
    ...(telegramUser?.id ? { tg_id: telegramUser.id, username: telegramUser.username || "", first_name: telegramUser.first_name || "" } : {}),
  };
  // A separate axios call avoids recursively recovering a failed login.
  recoveryPromise = axios.post(`${API_BASE}/api/auth/telegram-login`, payload, { timeout: 30000 })
    .then(({ data }) => {
      if (generation !== authGeneration || explicitlyLoggedOut) throw new Error("Authentication cancelled");
      return storeAuthentication(data);
    })
    .catch(error => {
      const issue = admissionError(error);
      if (issue && generation === authGeneration && !explicitlyLoggedOut) denyAuthentication(issue);
      throw error;
    })
    .finally(() => { recoveryPromise = null; });
  return recoveryPromise;
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("jwt_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  else delete config.headers.Authorization;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    const issue = admissionError(error);
    if (issue) {
      denyAuthentication(issue);
      error.userMessage = issue.message;
      return Promise.reject(error);
    }
    const isLogin = /\/api\/(?:auth\/(?:login|register|telegram|dev-login)|users\/auth)/.test(original?.url || "");
    if (status === 401 && original && !isLogin && !original._authRecovery && !explicitlyLoggedOut) {
      original._authRecovery = true;
      let session;
      try {
        session = await authenticateTelegram();
      } catch (recoveryError) {
        // A temporary Telegram/network failure must not erase the stored account.
        if (recoveryError.response?.status >= 500 || recoveryError.code === "ERR_NETWORK" || recoveryError.code === "ECONNABORTED") {
          recoveryError.userMessage = "Не удалось проверить вход. Проверьте связь и повторите попытку.";
          return Promise.reject(recoveryError);
        }
        if (admissionError(recoveryError)) return Promise.reject(recoveryError);
        localStorage.removeItem("jwt_token");
        window.dispatchEvent(new CustomEvent("auth:expired"));
        error.userMessage = recoveryError.response?.data?.detail || "Откройте приложение заново через Telegram для подтверждения входа.";
      }
      if (session) {
        original.headers.Authorization = `Bearer ${session.token}`;
        // A 401 is returned before an authenticated endpoint performs its action.
        return api.request(original);
      }
    }
    const networkFailure = error.code === "ERR_NETWORK" || error.code === "ECONNABORTED";
    if (original && safeToRetry(original) && !original._networkRetry && (networkFailure || status >= 500)) {
      original._networkRetry = true;
      await new Promise(resolve => setTimeout(resolve, 1000));
      return api.request(original);
    }
    if (!error.userMessage) {
      const detail = error.response?.data?.detail;
      if (typeof detail === "string") error.userMessage = detail;
      else if (detail?.msg || detail?.message) error.userMessage = detail.msg || detail.message;
      else if (networkFailure) error.userMessage = "Проблема с подключением к серверу. Проверьте интернет-соединение.";
      else if (status >= 500) error.userMessage = "Ошибка сервера. Повторите попытку позже.";
      else if (status === 401) error.userMessage = "Откройте приложение заново через Telegram для подтверждения входа.";
      else if (status === 403) error.userMessage = "Недостаточно прав для выполнения этого действия.";
      else if (status === 404) error.userMessage = "Запрашиваемый ресурс не найден.";
      else if (status === 409) error.userMessage = "Конфликт данных. Обновите запись и проверьте изменения.";
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
