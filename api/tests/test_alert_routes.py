import pytest

from app import alert_routes, main
from app.config import get_settings
from app.mailer import MailError
from tests.conftest import make_settings


class FakeMailer:
    def __init__(self, fail=False):
        self.sent, self.fail = [], fail

    def send(self, to, subject, body):
        if self.fail:
            raise MailError("email could not be sent (SMTPAuthenticationError)")
        self.sent.append((to, subject, body))


def with_mail_configured():
    main.app.dependency_overrides[get_settings] = lambda: make_settings(
        smtp_user="me@gmail.com", smtp_password="app-password"
    )


def test_settings_start_empty_and_report_whether_the_server_can_send(client):
    assert client.get("/alerts/settings").json() == {"email": None, "email_configured": False}
    with_mail_configured()
    assert client.get("/alerts/settings").json()["email_configured"] is True


def test_the_address_can_be_saved_changed_and_cleared(client):
    r = client.put("/alerts/settings", json={"email": "  Me@Example.com "})
    assert r.status_code == 200 and r.json()["email"] == "Me@Example.com"
    assert client.get("/alerts/settings").json()["email"] == "Me@Example.com"
    assert client.put("/alerts/settings", json={"email": ""}).json()["email"] is None
    client.put("/alerts/settings", json={"email": "a@b.co"})
    assert client.put("/alerts/settings", json={"email": None}).json()["email"] is None


@pytest.mark.parametrize("bad", ["not-an-email", "a@b", "a b@c.com", "a@b.com\r\nBcc: x@y.com", "x" * 250 + "@a.com"])
def test_a_bad_address_is_rejected(client, bad):
    assert client.put("/alerts/settings", json={"email": bad}).status_code == 422


@pytest.mark.parametrize(
    "char",
    [",", ";", "<", ">", "(", ")", "[", "]", "\\", '"', ":", "\x00", "\x01", "\x1b", "\x1f", "\x7f"],
)
@pytest.mark.parametrize("template", ["a{}b@example.com", "me@exam{}ple.com"])
def test_a_character_that_could_change_the_recipients_is_rejected(client, char, template):
    r = client.put("/alerts/settings", json={"email": template.format(char)})
    assert r.status_code == 422, r.text
    assert client.get("/alerts/settings").json()["email"] is None


@pytest.mark.parametrize(
    "bad",
    [
        "me@mail.com,evil.example",  # a list: two recipients from one saved value
        "me,you@mail.com",
        "me;you@mail.com",
        "<me@mail.com>",
        "me@mail.com(comment)",
    ],
)
def test_a_value_that_reads_as_a_list_or_header_syntax_is_rejected(client, bad):
    assert client.put("/alerts/settings", json={"email": bad}).status_code == 422


@pytest.mark.parametrize("good", ["first.last+tag@sub.example.co.uk", "o'brien_1-2@example.io"])
def test_ordinary_addresses_are_still_accepted(client, good):
    assert client.put("/alerts/settings", json={"email": good}).json()["email"] == good


def test_each_account_has_its_own_address(client):
    bob = client.new_user("bob@example.com")
    client.put("/alerts/settings", json={"email": "alice@mail.com"})
    assert bob.get("/alerts/settings").json()["email"] is None
    bob.put("/alerts/settings", json={"email": "bob@mail.com"})
    assert client.get("/alerts/settings").json()["email"] == "alice@mail.com"


def test_the_endpoints_need_a_signed_in_user(anon):
    assert anon.get("/alerts/settings").status_code == 401
    assert anon.put("/alerts/settings", json={"email": None}).status_code == 401
    assert anon.post("/alerts/test").status_code == 401


def test_a_test_email_says_so_when_the_server_has_no_mail_settings(client):
    client.put("/alerts/settings", json={"email": "me@mail.com"})
    r = client.post("/alerts/test")
    assert r.status_code == 503 and "SMTP_USER" in r.json()["detail"]


def test_a_test_email_needs_a_saved_address(client):
    with_mail_configured()
    main.app.dependency_overrides[alert_routes.get_mailer] = lambda: FakeMailer()
    r = client.post("/alerts/test")
    assert r.status_code == 409


def test_a_test_email_is_sent_to_the_saved_address(client):
    with_mail_configured()
    mailer = FakeMailer()
    main.app.dependency_overrides[alert_routes.get_mailer] = lambda: mailer
    client.put("/alerts/settings", json={"email": "me@mail.com"})
    r = client.post("/alerts/test")
    assert r.status_code == 200 and r.json() == {"sent_to": "me@mail.com"}
    assert mailer.sent[0][0] == "me@mail.com" and "test" in mailer.sent[0][1].lower()


def test_a_failed_test_email_is_a_502_with_a_safe_message(client):
    with_mail_configured()
    main.app.dependency_overrides[alert_routes.get_mailer] = lambda: FakeMailer(fail=True)
    client.put("/alerts/settings", json={"email": "me@mail.com"})
    r = client.post("/alerts/test")
    assert r.status_code == 502
    assert "SMTPAuthenticationError" in r.json()["detail"] and "app-password" not in r.text
