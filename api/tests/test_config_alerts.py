import pytest
from pydantic import ValidationError

from app.config import Settings


@pytest.mark.parametrize(
    "field,bad",
    [
        ("alert_check_seconds", 0),
        ("alert_check_seconds", 9),
        ("alert_cooldown_seconds", 0),
        ("alert_cooldown_seconds", 59),
    ],
)
def test_intervals_below_the_minimum_are_rejected(field, bad):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **{field: bad})


@pytest.mark.parametrize(
    "field,smallest", [("alert_check_seconds", 10), ("alert_cooldown_seconds", 60)]
)
def test_the_minimum_interval_is_accepted(field, smallest):
    assert getattr(Settings(_env_file=None, **{field: smallest}), field) == smallest


@pytest.mark.parametrize("field", ["alert_check_seconds", "alert_cooldown_seconds"])
def test_a_rejected_interval_is_not_printed(field):
    with pytest.raises(ValidationError) as e:
        Settings(_env_file=None, **{field: -987654})
    assert "-987654" not in str(e.value) and "input_value" not in str(e.value)


def test_defaults_match_the_design():
    s = Settings(_env_file=None)
    assert (s.smtp_host, s.smtp_port) == ("smtp.gmail.com", 587)
    assert s.alert_check_seconds == 120
    assert s.alert_cooldown_seconds == 3600


def test_email_is_configured_only_with_a_user_and_a_password():
    assert not Settings(smtp_user="", smtp_password="", _env_file=None).email_configured
    assert not Settings(smtp_user="me@gmail.com", smtp_password="", _env_file=None).email_configured
    assert Settings(
        smtp_user="me@gmail.com", smtp_password="app-password", _env_file=None
    ).email_configured


def test_the_sender_defaults_to_the_smtp_user():
    assert Settings(smtp_user="me@gmail.com", _env_file=None).email_sender == "me@gmail.com"
    assert (
        Settings(smtp_user="me@gmail.com", smtp_from="alerts@x.com", _env_file=None).email_sender
        == "alerts@x.com"
    )
