"""Where price alerts are sent, and a way to check the email setup works."""

import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from app.auth import current_user_id
from app.config import Settings, get_settings
from app.db import get_conn, one
from app.mailer import MailError, Mailer, SmtpMailer

router = APIRouter(prefix="/alerts", tags=["alerts"])

# Deliberately simple: one @, no spaces or control characters, a dot in the domain. A typo is
# caught by the test email, not by a clever regex.
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class AlertSettingsIn(BaseModel):
    email: Optional[str] = None  # empty or null turns alerts off for this account

    @field_validator("email")
    @classmethod
    def _valid(cls, v):
        if v is None:
            return None
        v = v.strip()
        if v == "":
            return None
        if len(v) > 254 or not _EMAIL.match(v):
            raise ValueError("Enter a valid email address.")
        return v


def get_mailer(settings: Settings = Depends(get_settings)) -> Mailer:
    if not settings.email_configured:
        raise HTTPException(
            503, "Email is not set up on the server: set SMTP_USER and SMTP_PASSWORD in api/.env."
        )
    return SmtpMailer(
        host=settings.smtp_host,
        port=settings.smtp_port,
        user=settings.smtp_user,
        password=settings.smtp_password,
        sender=settings.email_sender,
    )


def _current(conn, uid: int, settings: Settings) -> dict:
    row = one(conn.execute("SELECT alert_email FROM users WHERE id = ?", (uid,)))
    return {
        "email": row["alert_email"] if row else None,
        "email_configured": settings.email_configured,
    }


@router.get("/settings")
def read_settings(
    uid: int = Depends(current_user_id),
    conn=Depends(get_conn),
    settings: Settings = Depends(get_settings),
):
    return _current(conn, uid, settings)


@router.put("/settings")
def save_settings(
    body: AlertSettingsIn,
    uid: int = Depends(current_user_id),
    conn=Depends(get_conn),
    settings: Settings = Depends(get_settings),
):
    conn.execute("UPDATE users SET alert_email = ? WHERE id = ?", (body.email, uid))
    conn.commit()
    return _current(conn, uid, settings)


@router.post("/test")
def send_test_email(
    uid: int = Depends(current_user_id),
    conn=Depends(get_conn),
    mailer: Mailer = Depends(get_mailer),
):
    row = one(conn.execute("SELECT alert_email FROM users WHERE id = ?", (uid,)))
    email = row["alert_email"] if row else None
    if not email:
        raise HTTPException(409, "Save an alert email address first.")
    try:
        mailer.send(
            email,
            "Freeman test email",
            "This is a test from Freeman.\n\nPrice alerts for your watchlist will be sent to this address.",
        )
    except MailError as e:
        raise HTTPException(502, str(e))
    return {"sent_to": email}
