#!/bin/bash
echo "🚀 ProjectGuard Mini — автозапуск (frontend + backend)"

# === Настройки ===
FRONT_DIR="./frontend"
BACK_DIR="./backend"
BACK_REQ="$BACK_DIR/requirements.txt"
VENV_DIR="./venv"
HOST="0.0.0.0"
PORT=8000

# === Проверяем виртуальное окружение ===
if [ ! -d "$VENV_DIR" ]; then
  echo "⚠️  venv не найден. Создаю..."
  python3 -m venv venv
fi

source "$VENV_DIR/bin/activate"

# === Устанавливаем зависимости (если нужно) ===
if [ -f "$BACK_REQ" ]; then
  echo "📦 Проверяю зависимости Python..."
  pip install -q -r "$BACK_REQ"
fi

# === Сборка фронтенда ===
echo "🧩 Сборка фронтенда..."
cd "$FRONT_DIR"
npm install --silent
npm run build

# === Возврат в корень ===
cd ..

# === Запуск backend на 0.0.0.0 ===
echo "🚀 Запуск backend (FastAPI)..."
nohup uvicorn backend.main:app --host "$HOST" --port "$PORT" > backend.log 2>&1 &

# === Информация ===
IP=$(ipconfig getifaddr en0 2>/dev/null || echo "127.0.0.1")
echo "───────────────────────────────"
echo "✅ ProjectGuard Mini backend запущен!"
echo "🌐 Backend API доступен на:"
echo "💻  http://localhost:$PORT"
echo "📱  http://$IP:$PORT"
echo "🧩 Frontend для разработки запускается отдельно: cd frontend && npm run dev"
echo "───────────────────────────────"
