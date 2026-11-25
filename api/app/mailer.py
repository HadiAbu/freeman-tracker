"""Sending email over SMTP (Gmail by default). Behind a small interface so tests use a fake."""

import smtplib
import ssl
from email.message import EmailMessage
from typing import Protocol


class MailError(Exception):
    """An email could not be sent. The message is safe to log and to show: it never carries the
    password, the server's own wording, or the address."""


class Mailer(Protocol):
    def send(self, to: str, subject: str, body: str) -> None: ...


class SmtpMailer:
    def __init__(
        self,
        host: str,
        port: int,
        user: str,
        password: str,
        sender: str,
        timeout: float = 10.0,
        smtp_factory=smtplib.SMTP,
    ):
        self._host, self._port, self._timeout = host, port, timeout
        self._user, self._password, self._sender = user, password, sender
        self._factory = smtp_factory

    def send(self, to: str, subject: str, body: str) -> None:
        msg = EmailMessage()
        try:
            # EmailMessage refuses a header containing a newline: a second line of defence behind
            # alert_email.clean, so a stray CR/LF can never inject a header.
            msg["From"] = self._sender
            msg["To"] = to
            msg["Subject"] = subject
            msg.set_content(body)
        except ValueError:
            raise MailError("email could not be built (bad header)") from None
        failure: str | None = None
        try:
            with self._factory(self._host, self._port, timeout=self._timeout) as smtp:
                smtp.starttls(context=ssl.create_default_context())
                smtp.login(self._user, self._password)
                smtp.send_message(msg)
        except (smtplib.SMTPException, OSError, ValueError) as e:  # ValueError: e.g. a non-ASCII password
            failure = type(e).__name__
        if failure is not None:
            # Raised outside the except block so the original error (which may quote the server's
            # reply) is not attached as __context__.
            raise MailError(f"email could not be sent ({failure})")
