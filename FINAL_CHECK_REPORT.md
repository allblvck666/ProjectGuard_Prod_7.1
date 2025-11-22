# 🔍 ФИНАЛЬНАЯ ПРОВЕРКА ГОТОВНОСТИ К ДЕПЛОЮ

**Дата:** 2025-01-27  
**Проект:** ProjectGuard_7.1_notify_dev

---

## 📋 РЕЗЮМЕ

**Готово к деплою: НЕТ**

**Причина:** Найдена критическая ошибка в `create_token()` - используется `SECRET_KEY` вместо вычисленного `secret`, что может привести к несоответствию JWT-секретов. Также есть недостижимый код в `update_protection`.

---

## 1. JWT и секреты

**Найдено 1 проблема:**

**backend/main.py:300** - В функции `create_token()` вычисляется переменная `secret`, но используется `SECRET_KEY`:

```python
def create_token(user_id: int, role: str):
    secret = JWT_SECRET or SECRET_KEY  # вычислено, но не используется
    return jwt.encode({"sub": str(user_id), "role": role}, SECRET_KEY, algorithm=ALGORITHM)
```

**Исправление:**
```python
def create_token(user_id: int, role: str):
    secret = JWT_SECRET or SECRET_KEY
    return jwt.encode({"sub": str(user_id), "role": role}, secret, algorithm=ALGORITHM)
```

**Остальное:**
- ✅ `backend/main.py:40` - `JWT_SECRET = env_get("JWT_SECRET") or SECRET_KEY` - корректно
- ✅ `backend/auth.py:9` - `JWT_SECRET = getenv("JWT_SECRET") or getenv("SECRET_KEY") or "dev_secret"` - корректно
- ✅ `backend/users.py:151` - `SECRET_KEY = getenv("JWT_SECRET") or getenv("SECRET_KEY") or "dev_secret"` - корректно
- ✅ Хардкодов типа `SECRET_KEY = "supersecretkey"` не осталось

---

## 2. Прямые подключения к SQLite

**Прямых sqlite3.connect не осталось.**

- ✅ Все подключения используют `get_conn()` из `backend/db.py`
- ✅ `backend/db.py:93` - это сам `get_conn()`, что корректно
- ✅ `backend/main.py:561` - использует `get_conn()`

---

## 3. Aiogram и Telegram-ошибки

**ОК**

**3.1. `check_expiring_protections()`:**
- ✅ Строки 1419-1423: есть проверка `if tg_id:` перед добавлением в `recipients`
- ✅ Строка 1426: есть проверка `if not tid: continue` перед отправкой
- ✅ `chat_id` всегда int, не None

**3.2. Эндпоинт `/api/notify`:**
- ✅ Строка 1738: использует `BOT_TOKEN` из env
- ✅ Строки 1740-1741: есть один `chat_id` и поле `text`
- ✅ Строки 1731-1734: есть валидация `chat_id` и `message`

---

## 4. Dev-mode и Telegram-авторизация

**Найдено 1 проблема:**

**backend/main.py:316** - В dev-mode передается `tg_id` в `create_token()`, но функция ожидает `user_id` из таблицы `users`. В других местах (строка 356) тоже передается `tg_id`, что может вызвать проблемы при декодировании токена, если `decode_jwt` ищет пользователя по `user_id`.

**Текущий код:**
```python
if data.get("hash") == "dev-mode":
    tg_id = int(data["id"])
    username = data.get("username")
    first_name = data.get("first_name")
    role = "superadmin" if tg_id == 426188469 else "manager"
    token = create_token(tg_id, role)  # передается tg_id, а не user_id
    return {"ok": True, "role": role, "token": token}
```

**Исправление:**
```python
if data.get("hash") == "dev-mode":
    tg_id = int(data["id"])
    username = data.get("username")
    first_name = data.get("first_name")
    role = "superadmin" if tg_id == 426188469 else "manager"
    
    # Создаем или получаем пользователя
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "INSERT OR IGNORE INTO users (tg_id, tg_username, first_name, role, created_at) VALUES (?,?,?,?,?)",
        (tg_id, username, first_name, role, now_iso())
    )
    conn.commit()
    user = cur.execute("SELECT * FROM users WHERE tg_id=?", (tg_id,)).fetchone()
    conn.close()
    
    token = create_token(user["id"], role)
    return {"ok": True, "role": role, "token": token}
```

**Остальное:**
- ✅ Основная ветка Telegram Auth (строки 319-357) - логика создания/поиска пользователя корректна

---

## 5. Дублирующий код и миграции

**Найдено 1 проблема:**

**5.1. `update_protection`:**
- ❌ **backend/main.py:901-903** - Недостижимый код после `return row_to_out(updated)` (строка 899)

**Исправление:** Удалить строки 901-903 (комментарий и пустые строки).

**5.2. `_safe_migrate()`:**
- ✅ Строка 236: `ALTER TABLE managers ADD COLUMN telegrams` вызывается только один раз
- ✅ Дубликатов нет

---

## 6. FRONTEND_URL, WEBAPP_URL и CORS

**ОК**

**6.1. URL из окружения:**
- ✅ `backend/main.py:41` - `FRONTEND_URL = env_get("FRONTEND_URL", ...)` - берется из env
- ✅ `backend/main.py:1683` - `WEBAPP_URL = FRONTEND_URL` - использует `FRONTEND_URL`, не хардкод

**6.2. CORS:**
- ✅ `backend/main.py:75-80` - `origins` содержит `FRONTEND_URL` из env
- ✅ Дефолт `"https://projectguard-frontend-prod-7-1.onrender.com"` соответствует `render.yaml:21`
- ✅ Нет старых/лишних URL

---

## 7. Frontend: VITE_API_URL и Authorization

**ОК**

**7.1. Базовый URL API:**
- ✅ `frontend/src/api.js:5` - `export const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000"`
- ✅ Используется `import.meta.env.VITE_API_URL` с дефолтом для локальной разработки

**7.2. Заголовок Authorization:**
- ✅ `frontend/src/api.js:18` - `config.headers.Authorization = \`Bearer ${token}\``
- ✅ Токен отправляется в заголовке `Authorization: Bearer <token>`
- ✅ Соответствует `HTTPBearer` в `backend/auth.py`

---

## 8. Render.yaml соответствие

**ОК**

**Backend:**
- ✅ `startCommand: uvicorn backend.main:app --host 0.0.0.0 --port $PORT` - соответствует
- ✅ Есть диск с `mountPath: /var/data`
- ✅ `DB_PATH: /var/data/data.sqlite3` - соответствует коду
- ✅ `FRONTEND_URL: https://projectguard-frontend-prod-7-1.onrender.com` - соответствует дефолту в коде

**Frontend:**
- ✅ `buildCommand: cd frontend && npm install && npm run build` - соответствует
- ✅ `staticPublishPath: frontend/dist` - соответствует
- ✅ `VITE_API_URL: https://projectguard-backend.onrender.com` - используется в коде через `import.meta.env.VITE_API_URL`

---

## ✅ ИТОГОВЫЙ ЧЕКЛИСТ

- [x] 1. JWT и секреты - **1 проблема** (create_token использует SECRET_KEY вместо secret)
- [x] 2. Прямые подключения к SQLite - **ОК**
- [x] 3. Aiogram и Telegram-ошибки - **ОК**
- [x] 4. Dev-mode и Telegram-авторизация - **1 проблема** (tg_id вместо user_id)
- [x] 5. Дублирующий код и миграции - **1 проблема** (недостижимый код)
- [x] 6. FRONTEND_URL, WEBAPP_URL и CORS - **ОК**
- [x] 7. Frontend: VITE_API_URL и Authorization - **ОК**
- [x] 8. Render.yaml соответствие - **ОК**

---

## 🚨 КРИТИЧНЫЕ ПРОБЛЕМЫ ДЛЯ ИСПРАВЛЕНИЯ

1. **backend/main.py:300** - Исправить `create_token()`: использовать `secret` вместо `SECRET_KEY`
2. **backend/main.py:316** - Исправить dev-mode: создавать/получать пользователя и передавать `user["id"]` в `create_token()`
3. **backend/main.py:901-903** - Удалить недостижимый код после `return`

**Критичных блокеров для деплоя: 3 проблемы (2 критичные, 1 косметическая).**

---

**Конец отчета**

