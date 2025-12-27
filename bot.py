# ⚠️ ВНИМАНИЕ: Этот файл НЕ должен запускаться!
# Бот запускается автоматически через backend/main.py
# Запуск этого файла создаст конфликт с основным ботом!

import os
from aiogram import Bot, Dispatcher, types
from aiogram.filters import CommandStart
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
import asyncio

# === Настройки ===
TOKEN = os.getenv("BOT_TOKEN")
WEBAPP_URL = os.getenv("FRONTEND_URL", "https://projectguard-frontend-prod-7-1.onrender.com")

if not TOKEN:
    raise RuntimeError("BOT_TOKEN is not set")

bot = Bot(token=TOKEN)
dp = Dispatcher()

@dp.message(CommandStart())
async def start(message: types.Message):
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="🚪 Войти в систему",
                    web_app=WebAppInfo(url=WEBAPP_URL)
                )
            ]
        ]
    )

    await message.answer(
        "Привет 👋\n\nЭто Aquafloor ProjectGuard — система защиты проектов.\n"
        "Нажми кнопку ниже, чтобы войти в:",
        reply_markup=keyboard
    )

async def main():
    print("✅ Bot запущен")
    await dp.start_polling(bot)

# ⚠️ НЕ ЗАПУСКАЙТЕ ЭТОТ ФАЙЛ!
# Бот уже запущен через backend/main.py
# Запуск этого файла создаст конфликт!

# if __name__ == "__main__":
#     asyncio.run(main())

