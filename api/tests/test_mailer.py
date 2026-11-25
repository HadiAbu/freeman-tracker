import smtplib

import pytest

from app.mailer import MailError, SmtpMailer


class FakeSMTP:
    log: list = []
    fail_on: str | None = None

    def __init__(self, host, port, timeout):
        FakeSMTP.log.append(("connect", host, port, timeout))

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self, context=None):
        FakeSMTP.log.append(("starttls",))
        if FakeSMTP.fail_on == "tls":
            raise smtplib.SMTPException("tls")

    def login(self, user, password):
        FakeSMTP.log.append(("login", user, password))
        if FakeSMTP.fail_on == "login":
            raise smtplib.SMTPAuthenticationError(535, b"bad credentials for hunter2")

    def send_message(self, msg):
        FakeSMTP.log.append(("send", msg))


@pytest.fixture(autouse=True)
def reset():
    FakeSMTP.log = []
    FakeSMTP.fail_on = None


def mailer():
    return SmtpMailer(
        host="smtp.gmail.com", port=587, user="me@gmail.com", password="hunter2",
        sender="me@gmail.com", timeout=10.0, smtp_factory=FakeSMTP,
    )


def test_it_connects_secures_the_link_logs_in_then_sends():
    mailer().send("you@example.com", "Subject here", "Body here")
    assert [e[0] for e in FakeSMTP.log] == ["connect", "starttls", "login", "send"]
    assert FakeSMTP.log[0] == ("connect", "smtp.gmail.com", 587, 10.0)
    msg = FakeSMTP.log[-1][1]
    assert (msg["From"], msg["To"], msg["Subject"]) == ("me@gmail.com", "you@example.com", "Subject here")
    assert "Body here" in msg.get_content()


def test_non_ascii_text_is_sent_as_utf8():
    mailer().send("you@example.com", "Sub", "lower $1 · upper $2")
    assert "lower $1 · upper $2" in FakeSMTP.log[-1][1].get_content()


def test_a_failed_login_becomes_a_mail_error_that_never_shows_the_password():
    FakeSMTP.fail_on = "login"
    with pytest.raises(MailError) as e:
        mailer().send("you@example.com", "s", "b")
    assert "hunter2" not in str(e.value)
    assert "SMTPAuthenticationError" in str(e.value)


def test_a_connection_failure_becomes_a_mail_error():
    def refuse(host, port, timeout):
        raise ConnectionRefusedError("nope")

    m = SmtpMailer("h", 587, "u", "p", "u", smtp_factory=refuse)
    with pytest.raises(MailError):
        m.send("you@example.com", "s", "b")


def test_a_header_with_a_newline_is_refused_not_sent():
    with pytest.raises(MailError):
        mailer().send("you@example.com", "Subject\r\nBcc: x@y.com", "b")
    assert not any(e[0] == "send" for e in FakeSMTP.log)


def test_a_non_ascii_credential_becomes_a_mail_error_that_never_shows_it():
    class AsciiFail(FakeSMTP):
        def login(self, user, password):
            raise UnicodeEncodeError("ascii", "pässword", 1, 2, "ordinal not in range")

    m = SmtpMailer("h", 587, "u", "pässword", "u", smtp_factory=AsciiFail)
    with pytest.raises(MailError) as e:
        m.send("you@example.com", "s", "b")
    assert "UnicodeEncodeError" in str(e.value)
    assert "pässword" not in str(e.value)
