import pytest
from pydantic import ValidationError

from app.config import MIN_JWT_SECRET_LENGTH, Settings, get_settings


def settings(secret: str) -> Settings:
    return Settings(jwt_secret=secret, _env_file=None)


def test_a_short_secret_is_rejected_with_a_message_that_says_how_to_fix_it():
    with pytest.raises(ValidationError) as e:
        settings("x" * (MIN_JWT_SECRET_LENGTH - 1))
    message = str(e.value)
    assert f"at least {MIN_JWT_SECRET_LENGTH}" in message
    assert "token_urlsafe" in message


def test_the_rejected_secret_is_never_printed():
    # What a startup traceback or log line shows is str() / repr() of the error. (`errors()` still
    # carries the raw input for code that asks for it; nothing logs that.)
    secret = "do-not-leak-" + "z" * 5  # 17 characters, too short
    with pytest.raises(ValidationError) as e:
        settings(secret)
    assert secret not in str(e.value)
    assert secret not in repr(e.value)


def test_a_secret_of_exactly_the_minimum_length_is_accepted():
    assert settings("k" * MIN_JWT_SECRET_LENGTH).jwt_secret == "k" * MIN_JWT_SECRET_LENGTH


def test_empty_is_still_allowed_so_the_server_can_fail_closed_with_a_503():
    assert settings("").jwt_secret == ""


def test_the_server_refuses_to_load_settings_from_a_short_secret_in_the_environment(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "too-short")
    get_settings.cache_clear()
    try:
        with pytest.raises(ValidationError):
            get_settings()
    finally:
        monkeypatch.delenv("JWT_SECRET")
        get_settings.cache_clear()
