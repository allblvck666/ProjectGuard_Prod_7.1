# 🔄 Настройка Keep-Alive для Render (бесплатный тариф)

## Проблема
На бесплатном тарифе Render сервисы засыпают после 15 минут неактивности. Это приводит к:
- Долгой загрузке при первом запросе после простоя
- Потере активных соединений
- Неудобству для пользователей

## Решение

### 1. Внутренний Keep-Alive (уже настроен)
Приложение автоматически пингует само себя каждые 5 минут через endpoint `/api/ping`.

### 2. Внешний Keep-Alive (рекомендуется)
Для максимальной надежности рекомендуется настроить внешний сервис, который будет пингуть ваш API.

#### Вариант A: UptimeRobot (бесплатно)
1. Зарегистрируйтесь на https://uptimerobot.com
2. Добавьте новый монитор:
   - **Monitor Type**: HTTP(s)
   - **Friendly Name**: ProjectGuard Keep-Alive
   - **URL**: `https://projectguard-prod-7-1.onrender.com/api/ping`
   - **Monitoring Interval**: 5 minutes
   - **Alert Contacts**: (опционально)

#### Вариант B: Cron-job.org (бесплатно)
1. Зарегистрируйтесь на https://cron-job.org
2. Создайте новое задание:
   - **Title**: ProjectGuard Keep-Alive
   - **URL**: `https://projectguard-prod-7-1.onrender.com/api/ping`
   - **Schedule**: Every 5 minutes
   - **Request Method**: GET

#### Вариант C: EasyCron (бесплатно)
1. Зарегистрируйтесь на https://www.easycron.com
2. Создайте новое задание:
   - **URL**: `https://projectguard-prod-7-1.onrender.com/api/ping`
   - **Schedule**: `*/5 * * * *` (каждые 5 минут)
   - **HTTP Method**: GET

### 3. Проверка работы
После настройки проверьте:
```bash
curl https://projectguard-prod-7-1.onrender.com/api/ping
```

Должен вернуться ответ:
```json
{"ok": true, "timestamp": "2024-01-01T12:00:00", "status": "alive"}
```

## База данных PostgreSQL

### Настройка на Render
1. В панели Render создайте новую PostgreSQL базу данных:
   - **Name**: `projectguard-db`
   - **Plan**: Free
   - **Database**: `projectguard`
   - **User**: `projectguard_user`

2. В `render.yaml` уже настроена автоматическая привязка через `fromDatabase`

3. После деплоя проверьте логи:
   ```
   ✅ Подключение к PostgreSQL успешно
   ```

### Проверка подключения
Если видите в логах:
```
⚠️ Ошибка подключения к PostgreSQL: ..., используем SQLite
```

Это означает, что:
- PostgreSQL база не создана или не подключена
- Приложение использует SQLite как fallback (данные могут теряться при перезапуске)

### Решение
1. Убедитесь, что база данных `projectguard-db` создана в Render
2. Проверьте, что `DATABASE_URL` правильно установлен в переменных окружения
3. Перезапустите сервис после создания базы

## Итог
- ✅ Внутренний keep-alive работает автоматически
- ✅ PostgreSQL база настроена в `render.yaml`
- ⚠️ Рекомендуется добавить внешний keep-alive для максимальной надежности

