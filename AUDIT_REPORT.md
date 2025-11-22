# 🔍 АУДИТ ПРОЕКТА ProjectGuard 7.1

**Дата:** 2025-01-27  
**Версия:** 7.1_notify_dev

---

## 📋 КРАТКОЕ РЕЗЮМЕ

### ✅ Что работает хорошо:
- Базовая структура проекта корректна
- Использование env-переменных через `env_get()` реализовано правильно
- CORS настроен с использованием `FRONTEND_URL` из env
- Основная логика защит работает

### ⚠️ Критичные проблемы:
1. **Несоответствие JWT-секретов** между `main.py` (SECRET_KEY) и `auth.py` (JWT_SECRET)
2. **Хардкод SECRET_KEY** в `backend/users.py:152`
3. **Дублирующий код** в `update_protection` (строки 899-929)
4. **Ошибка в dev-mode авторизации** - неопределенная переменная `user`
5. **Проблема с tg_id = None** в `check_expiring_protections`
6. **Неправильный заголовок токена** - фронтенд отправляет `headers.token`, а `HTTPBearer` ожидает `Authorization: Bearer`

### 🔧 Требуют правок:
- Прямое подключение к SQLite в `main.py:559` (минуя `get_conn`)
- Фронтенд не использует `VITE_API_URL`, хардкод в `api.js`
- Потенциальная ошибка при пустом `skus_in[0]` (хотя есть проверка)
- Дубликат `chat_id` и отсутствие `text` в `/api/notify`

---

## 1. СТРУКТУРА БЭКЕНДА

### 1.1. `backend/main.py`
**Основные эндпоинты:**
- `GET /api/ping` - проверка работоспособности
- `GET /api/skus` - список SKU
- `POST /api/auth/telegram` - авторизация через Telegram
- `POST /api/auth/dev-login` - dev-авторизация
- `POST /api/protections` - создание защиты
- `POST /api/protections/pending` - создание защиты на проверку
- `PUT /api/protections/{pid}` - обновление защиты
- `POST /api/protections/{pid}/extend` - продление защиты
- `POST /api/protections/{pid}/request-extend` - запрос на продление
- `POST /api/protections/{pid}/success` - отметка успешной защиты
- `POST /api/protections/{pid}/close` - закрытие защиты
- `DELETE /api/protections/{pid}` - удаление защиты
- `GET /api/history` - история действий
- `GET /api/stats` - статистика
- `GET /api/admin/managers` - список менеджеров (admin)
- `GET /api/admin/extend-requests` - запросы на продление (admin)
- `GET /api/admin/manager-protections` - защиты менеджера (admin)
- `POST /api/admin/pending/{pid}/approve` - одобрение защиты (admin)
- `POST /api/admin/pending/{pid}/reject` - отклонение защиты (admin)
- `POST /api/notify` - отправка уведомления в Telegram

**Импорты:** ✅ Корректны, используются `from backend.db import ...`, `from backend.auth import require_admin`

### 1.2. `backend/db.py`
**Функции:**
- `get_conn()` - создает подключение к SQLite с `row_factory = sqlite3.Row`
- `init_db()` - создает таблицы `protections` и `users`
- `now_iso()` - возвращает текущее время в ISO формате с "Z"
- `add_days(dt_iso, days)` - добавляет дни к ISO-дате
- `get_user_by_id(user_id)` - получает пользователя по ID
- `get_user_by_tg_id(tg_id)` - получает пользователя по Telegram ID
- `load_skus()` - загружает SKU из CSV

**DB_PATH:** ✅ Определяется через `os.getenv("DB_PATH", ...)`

### 1.3. `backend/auth.py`
**Функции:**
- `create_jwt(user_id)` - создает JWT токен (использует `JWT_SECRET`)
- `decode_jwt(token)` - декодирует JWT токен
- `require_admin(credentials)` - проверяет роль admin/superadmin через `HTTPBearer`

**Проблема:** ⚠️ Использует `JWT_SECRET`, а `main.py` использует `SECRET_KEY` для создания токенов

### 1.4. `backend/users.py`
**Роутеры:**
- `POST /api/users/` - создание пользователя
- `GET /api/users/` - список пользователей
- `PATCH /api/users/{user_id}` - обновление пользователя (admin)
- `DELETE /api/users/{user_id}` - удаление пользователя (admin)
- `POST /api/users/link-assistant` - привязка помощника к менеджеру
- `GET /api/users/assistants/{manager_id}` - список помощников

**Проблема:** ⚠️ Хардкод `SECRET_KEY = "supersecretkey"` в строке 152

---

## 2. РАБОТА С .ENV И КОНФИГОМ

### 2.1. Загрузка переменных окружения
✅ **Корректно реализовано:**
- `load_env_file()` читает `.env` файл
- `env_get()` проверяет сначала `os.environ`, потом `.env`, потом дефолт
- Все секреты загружаются через `env_get()`

### 2.2. Проверка BOT_TOKEN и SECRET_KEY

**Найдены проблемы:**

1. **`backend/users.py:152`** - хардкод секрета:
```python
SECRET_KEY = "supersecretkey"  # потом можно вынести в .env
```

2. **`backend/main.py:314`** - ошибка в dev-mode:
```python
if data.get("hash") == "dev-mode":
    tg_id = int(data["id"])
    username = data.get("username")
    first_name = data.get("first_name")
    role = "superadmin" if tg_id == 426188469 else "manager"
    token = create_token(user["id"], role)  # ❌ user не определен!
    return {"ok": True, "role": role, "token": token}
```

3. **Несоответствие JWT-секретов:**
   - `main.py:300` использует `SECRET_KEY` для `create_token()`
   - `auth.py:10` использует `JWT_SECRET` (или `SECRET_KEY` как fallback)
   - `users.py:184` использует хардкод `SECRET_KEY = "supersecretkey"`

**Предложение исправления:**

```python
# backend/users.py:152 - заменить на:
from os import getenv
SECRET_KEY = getenv("JWT_SECRET") or getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("JWT_SECRET or SECRET_KEY must be set")
```

```python
# backend/main.py:314 - исправить на:
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

---

## 3. `backend/db.py` И `DB_PATH`

### 3.1. Определение DB_PATH
✅ **Корректно:** `DB_PATH = os.getenv("DB_PATH", str(BASE_DIR / "data.sqlite3"))`

### 3.2. Функции работы с БД
✅ **`get_conn()`** - всегда использует `DB_PATH` из env
✅ **`get_user_by_id()`** - использует `get_conn()`
✅ **`get_user_by_tg_id()`** - использует `get_conn()`
✅ **`init_db()`** - использует `get_conn()`

### 3.3. Прямые подключения к SQLite

**Найдено одно место:**

**`backend/main.py:559`** - прямое подключение:
```python
conn = sqlite3.connect(DB_PATH, timeout=5, check_same_thread=False)
```

**Предложение:** Заменить на:
```python
conn = get_conn()
# или если нужен timeout и check_same_thread:
# можно добавить параметры в get_conn() или создать get_conn_with_options()
```

---

## 4. JWT / АВТОРИЗАЦИЯ / require_admin

### 4.1. Проверка require_admin
✅ **Нет дубликатов:** `require_admin` определен только в `backend/auth.py` и импортируется в `main.py` и `users.py`

### 4.2. Использование JWT-секрета

**Проблема:** ⚠️ **Несоответствие секретов**

- `main.py:300` - `create_token()` использует `SECRET_KEY`
- `auth.py:10` - `JWT_SECRET = getenv("JWT_SECRET") or getenv("SECRET_KEY")`
- `auth.py:23,29` - использует `JWT_SECRET` для encode/decode
- `users.py:152,184` - хардкод `SECRET_KEY = "supersecretkey"`

**Результат:** Токены, созданные в `main.py`, могут не декодироваться в `auth.py`, если `JWT_SECRET != SECRET_KEY`.

**Предложение:** Унифицировать использование одного секрета:

```python
# В main.py добавить:
JWT_SECRET = env_get("JWT_SECRET") or SECRET_KEY

# И изменить create_token:
def create_token(user_id: int, role: str):
    secret = JWT_SECRET or SECRET_KEY
    return jwt.encode({"sub": str(user_id), "role": role}, secret, algorithm=ALGORITHM)
```

### 4.3. Защищенные эндпоинты
✅ **Корректно защищены:**
- `/api/admin/managers` (GET, POST, PATCH, DELETE)
- `/api/admin/extend-requests`
- `/api/admin/manager-protections`
- `/api/admin/pending/{pid}/approve`
- `/api/admin/pending/{pid}/reject`
- `/api/admin/protections/{pid}/extend-any`
- `/api/users/{user_id}` (PATCH, DELETE)

**Проблема:** ⚠️ **Несоответствие заголовков токена**

- Фронтенд (`api.js:17`) отправляет: `config.headers.token = token`
- `HTTPBearer` ожидает: `Authorization: Bearer <token>`

**Предложение:** Либо изменить фронтенд на `Authorization: Bearer`, либо использовать кастомный `HTTPBearer` с заголовком `token`.

---

## 5. ЛОГИКА ЗАЩИТ (PROTECTIONS) И ИСТОРИИ

### 5.1. Дублирующий код

**Найдено в `backend/main.py:899-929`:**

После строки 897 есть дублирующий блок кода (строки 899-929), который никогда не выполнится (после `return`).

**Предложение:** Удалить строки 899-929.

### 5.2. Обращение к `add_history`
✅ **Корректно:** Все вызовы используют правильные поля и JSON payload

### 5.3. Логика создания/обновления защиты

**Потенциальная проблема в `main.py:690`:**
```python
sku_display = (payload.sku or (skus_in[0].sku if skus_in else "—")).strip()
```

✅ **Безопасно:** Есть проверка `if skus_in`, но лучше явно:
```python
sku_display = (payload.sku or (skus_in[0].sku if skus_in and len(skus_in) > 0 else "—")).strip()
```

**Логика расчета:**
✅ **Корректно:** `sku_display`, `total_area`, TTL считаются одинаково в `create_protection` и `update_protection`

---

## 6. AIOGRAM-БОТ И ФОНОВЫЕ ЗАДАЧИ

### 6.1. Создание бота
✅ **Корректно:** `bot = Bot(token=BOT_TOKEN)` создается один раз, использует токен из env

### 6.2. `check_expiring_protections()`

**Проблема:** ⚠️ **Возможен `tg_id = None`**

В строке 1445:
```python
recipients = [tg_id] + [a["tg_id"] for a in assistants if a["tg_id"]]
```

Если `tg_id = None`, то `bot.send_message(None, msg)` вызовет ошибку.

**Предложение:**
```python
recipients = []
if tg_id:
    recipients.append(tg_id)
recipients.extend([a["tg_id"] for a in assistants if a["tg_id"]])

for tid in recipients:
    if not tid:  # дополнительная проверка
        continue
    try:
        await bot.send_message(tid, msg)
        print(f"📩 Напоминание отправлено {tid}")
    except Exception as e:
        print(f"⚠️ Ошибка отправки напоминания {tid}: {e}")
```

### 6.3. Фоновые задачи
✅ **Корректно:** Создаются в `on_startup()` через `asyncio.get_event_loop().create_task(...)`

---

## 7. CORS И FRONTEND_URL

### 7.1. Конфигурация CORS
✅ **Корректно:**
- `FRONTEND_URL` берется из env (строка 41)
- Используется в `origins` (строка 75)
- Нет хардкода старых URL (кроме дефолта)

**Дефолт:** `"https://projectguard-frontend-prod-7-1.onrender.com"` - соответствует `render.yaml:21`

---

## 8. FRONTEND И VITE_API_URL

### 8.1. Использование API URL

**Проблема:** ⚠️ **Хардкод в `frontend/src/api.js:5`**

```javascript
export const API_BASE = "https://projectguard-backend.onrender.com";
```

**Не используется:** `import.meta.env.VITE_API_URL`

**Предложение:**
```javascript
export const API_BASE = import.meta.env.VITE_API_URL || "https://projectguard-backend.onrender.com";
```

### 8.2. Соответствие с render.yaml
✅ **render.yaml:31** задает `VITE_API_URL: https://projectguard-backend.onrender.com`

Но фронтенд не использует эту переменную, поэтому при билде она не подставится.

---

## 9. render.yaml И ДЕПЛОЙ НА RENDER

### 9.1. Бэкенд

✅ **Корректно:**
- `type: web`
- `env: python`
- `buildCommand: pip install -r backend/requirements.txt`
- `startCommand: uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
- `disk` с `mountPath: /var/data`
- `envVars`: `BOT_TOKEN`, `SECRET_KEY`, `JWT_SECRET`, `FRONTEND_URL`, `DB_PATH`

✅ **Соответствие:**
- `DB_PATH: /var/data/data.sqlite3` - соответствует коду
- `FRONTEND_URL: https://projectguard-frontend-prod-7-1.onrender.com` - соответствует дефолту в коде

### 9.2. Фронтенд

✅ **Корректно:**
- `buildCommand: cd frontend && npm install && npm run build`
- `staticPublishPath: frontend/dist`
- `VITE_API_URL: https://projectguard-backend.onrender.com`

⚠️ **Проблема:** Фронтенд не использует `VITE_API_URL`, поэтому переменная не применится при билде.

---

## 📝 ДОПОЛНИТЕЛЬНЫЕ НАЙДЕННЫЕ ПРОБЛЕМЫ

### 10. `/api/notify` - ошибки в запросе

**`backend/main.py:1741-1761`:**

```python
res = requests.post(
    f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
    json={
        "chat_id": tg_username,  # ❌ дубликат
        "chat_id": tg_username,  # ❌ дубликат
        "parse_mode": "HTML"      # ❌ отсутствует "text"
    },
)
```

**Предложение:**
```python
res = requests.post(
    f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
    json={
        "chat_id": tg_username,
        "text": message,  # ✅ добавить
        "parse_mode": "HTML"
    },
)
```

### 11. Дубликат миграции

**`backend/main.py:235-238`:**

```python
# === Managers ===
exec_safe("ALTER TABLE managers ADD COLUMN telegrams TEXT DEFAULT '[]'")

# === Managers ===  # ❌ дубликат комментария
exec_safe("ALTER TABLE managers ADD COLUMN telegrams TEXT DEFAULT '[]'")  # ❌ дубликат
```

**Предложение:** Удалить строки 237-238.

### 12. WEBAPP_URL хардкод

**`backend/main.py:1702`:**

```python
WEBAPP_URL = "https://projectguard-frontend.onrender.com"
```

**Предложение:** Использовать `FRONTEND_URL`:
```python
WEBAPP_URL = FRONTEND_URL
```

---

## ✅ ИТОГОВЫЙ ЧЕКЛИСТ

- [x] Структура бэкенда проверена
- [x] .env и конфиг проверены (найдены проблемы)
- [x] db.py и DB_PATH проверены (найдена проблема)
- [x] JWT/авторизация проверена (найдены проблемы)
- [x] Логика защит проверена (найден дубликат кода)
- [x] Aiogram-бот проверен (найдена проблема с tg_id=None)
- [x] CORS проверен (OK)
- [x] Frontend проверен (найдена проблема с VITE_API_URL)
- [x] render.yaml проверен (OK, но фронтенд не использует env)

---

## 🚀 РЕКОМЕНДАЦИИ ПО ПРИОРИТЕТАМ

### Критично (исправить перед деплоем):
1. Исправить несоответствие JWT-секретов
2. Удалить хардкод `SECRET_KEY` в `users.py`
3. Исправить ошибку в dev-mode авторизации
4. Исправить проблему с `tg_id = None` в `check_expiring_protections`
5. Исправить `/api/notify` (добавить `text`, убрать дубликат `chat_id`)

### Важно (исправить в ближайшее время):
6. Удалить дублирующий код в `update_protection`
7. Исправить фронтенд для использования `VITE_API_URL`
8. Заменить прямое подключение к SQLite на `get_conn()`
9. Исправить заголовок токена (Authorization vs token)

### Желательно:
10. Удалить дубликат миграции
11. Использовать `FRONTEND_URL` вместо хардкода `WEBAPP_URL`
12. Добавить явную проверку `len(skus_in) > 0`

---

**Конец отчета**

