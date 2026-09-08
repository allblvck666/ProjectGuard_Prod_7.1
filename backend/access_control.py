"""Admission and activity checks shared by HTTP, bot and background operations."""
from fastapi import HTTPException


ACCESS_PENDING_MESSAGE = "Заявка на доступ отправлена администратору. После одобрения нажмите «Проверить доступ»."


def has_account_access(user):
    return bool(user and user.get("access_status") == "approved"
                and user.get("is_active", 1) not in (0, "0", False))


def require_account_access(user):
    if not user:
        raise HTTPException(403, {"code": "access_blocked", "message": "Нет доступа к приложению."})
    status = user.get("access_status")
    if status == "pending":
        raise HTTPException(403, {"code": "access_pending", "message": ACCESS_PENDING_MESSAGE})
    if status == "rejected":
        raise HTTPException(403, {"code": "access_rejected", "message": "Заявка на доступ отклонена. Обратитесь к администратору."})
    if status != "approved":
        # A missing migration or unknown state must never reopen registration.
        raise HTTPException(503, "Проверка доступа временно недоступна. Попробуйте позже.")
    if not has_account_access(user):
        raise HTTPException(403, {"code": "access_blocked", "message": "Ваш аккаунт заблокирован. Обратитесь к администратору."})
    return user
