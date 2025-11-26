# 🗄️ Миграция на PostgreSQL

## ✅ Выполненные изменения

### 1. `backend/db.py`

#### Подключение к БД
- ✅ Автоматическое определение типа БД через `DATABASE_URL`
- ✅ Если `DATABASE_URL` установлен → используется PostgreSQL
- ✅ Если `DATABASE_URL` отсутствует → используется SQLite (локальная разработка)

#### Функции адаптации запросов
- ✅ `_get_param_placeholder()` - возвращает `?` для SQLite, `%s` для PostgreSQL
- ✅ `_adapt_query()` - автоматически заменяет `?` на `%s` для PostgreSQL

#### Исправленные функции CRUD
- ✅ `get_user_by_id()` - использует `_adapt_query()`
- ✅ `get_user_by_tg_id()` - использует `_adapt_query()`
- ✅ `get_user_by_email()` - использует `_adapt_query()`
- ✅ `create_user()` - использует `_adapt_query()`, правильная обработка `lastrowid` для PostgreSQL
- ✅ `update_user()` - использует `_get_param_placeholder()` и `_adapt_query()`
- ✅ `get_all_users()` - использует `_adapt_query()`
- ✅ `upsert_user()` - использует `_adapt_query()`, правильная обработка ошибок для PostgreSQL

#### Инициализация таблиц (`init_db()`)
- ✅ **Protections**: Использует `SERIAL PRIMARY KEY` для PostgreSQL, `INTEGER PRIMARY KEY AUTOINCREMENT` для SQLite
- ✅ **Users**: Использует `SERIAL PRIMARY KEY` для PostgreSQL, `INTEGER PRIMARY KEY AUTOINCREMENT` для SQLite
- ✅ **Managers**: Использует `SERIAL PRIMARY KEY` для PostgreSQL, `INTEGER PRIMARY KEY AUTOINCREMENT` для SQLite
- ✅ **History**: Использует `SERIAL PRIMARY KEY` для PostgreSQL, `INTEGER PRIMARY KEY AUTOINCREMENT` для SQLite
- ✅ **tg_notifications**: Использует `SERIAL PRIMARY KEY` для PostgreSQL, `INTEGER PRIMARY KEY AUTOINCREMENT` для SQLite
- ✅ Миграция колонок: правильная проверка существующих колонок для PostgreSQL через `information_schema`
- ✅ Уникальный индекс для `email` в PostgreSQL (через `CREATE UNIQUE INDEX`)

#### Обработка ошибок
- ✅ Заменена `sqlite3.IntegrityError` на универсальную обработку ошибок
- ✅ Проверка строки ошибки на наличие "unique", "duplicate", "already exists"

### 2. `render.yaml`

- ✅ `DATABASE_URL` настроен для автоматического получения из базы `projectguard-db`
- ✅ Используется `fromDatabase` с `property: connectionString`
- ✅ `DB_PATH` оставлен как fallback для локальной разработки

### 3. `backend/requirements.txt`

- ✅ `psycopg2-binary==2.9.9` уже присутствует

## 🔧 Как это работает

### Локальная разработка (SQLite)
```bash
# Не устанавливаем DATABASE_URL
# Используется DB_PATH (по умолчанию: data.sqlite3)
python -m uvicorn backend.main:app --reload
```

### Production (PostgreSQL на Render)
```bash
# DATABASE_URL автоматически устанавливается из render.yaml
# Формат: postgresql://user:password@host:port/database
# Используется PostgreSQL через psycopg2
```

## 📝 Важные замечания

### 1. Типы данных
- **SQLite**: `INTEGER PRIMARY KEY AUTOINCREMENT`, `TEXT`, `REAL`
- **PostgreSQL**: `SERIAL PRIMARY KEY`, `TEXT`, `REAL`

### 2. Placeholders
- **SQLite**: `?` (например: `SELECT * FROM users WHERE id = ?`)
- **PostgreSQL**: `%s` (например: `SELECT * FROM users WHERE id = %s`)

### 3. Получение ID после INSERT
- **SQLite**: `cur.lastrowid`
- **PostgreSQL**: `RETURNING id` или дополнительный `SELECT` запрос

### 4. Обработка ошибок
- **SQLite**: `sqlite3.IntegrityError`
- **PostgreSQL**: `psycopg2.errors.UniqueViolation` или проверка строки ошибки

## 🚀 Деплой на Render

1. Убедитесь, что база данных `projectguard-db` создана в Render
2. `render.yaml` автоматически подключит `DATABASE_URL` к сервису `projectguard-backend`
3. При первом запуске `init_db()` создаст все необходимые таблицы
4. Данные будут сохраняться в PostgreSQL и не будут теряться при перезапуске

## ✅ Проверка

После деплоя проверьте:
1. Логи бэкенда на наличие ошибок подключения к БД
2. Что таблицы созданы: `SELECT * FROM information_schema.tables WHERE table_schema = 'public'`
3. Что данные сохраняются после перезапуска сервиса

