from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import sqlite3
from backend.db import get_conn

security = HTTPBearer(auto_error=False)

# Простая проверка роли через токен или просто костыльно (для теста)

