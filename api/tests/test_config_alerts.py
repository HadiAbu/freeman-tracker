from app.config import Settings


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
