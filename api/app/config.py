from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# HS256 wants a key at least as long as its 256-bit hash (RFC 7518, section 3.2). A shorter secret
# can be guessed offline from one captured token.
MIN_JWT_SECRET_LENGTH = 32


class Settings(BaseSettings):
    # hide_input_in_errors: a validation error must never print the value it rejected, or a bad
    # JWT_SECRET would end up in the startup log.
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", hide_input_in_errors=True)

    # Turso: libsql://<db>-<org>.turso.io  (or a local file path for dev/tests)
    turso_database_url: str = "freeman-dev.db"
    turso_auth_token: str = ""
    # Signs access tokens (HS256). Required: with it empty every protected route answers 503
    # (fail closed). When set it must be at least MIN_JWT_SECRET_LENGTH characters or the server
    # refuses to start. e.g. python -c "import secrets; print(secrets.token_urlsafe(48))"
    jwt_secret: str = ""
    access_token_minutes: int = 15
    refresh_token_days: int = 30
    # Anyone can POST /auth/register when true. Off by default; create accounts with
    # `python -m scripts.create_user` instead.
    allow_registration: bool = False
    # Failed logins allowed per (email, client address) inside the window before a 429.
    login_max_failures: int = 5
    login_window_seconds: int = 900
    # --- market prices (uses FINNHUB_API_KEY above) ---
    price_cache_seconds: int = 120
    quote_timeout_seconds: float = 5.0
    # Comma-separated origins for the web build; native apps ignore CORS.
    cors_origins: str = ""
    # --- news analysis (all keys server-side only) ---
    openai_api_key: str = ""
    openai_model: str = ""  # no default: the user chooses the model in .env
    finnhub_api_key: str = ""
    analysis_cache_hours: int = 6
    analysis_refresh_min_minutes: int = 15
    analysis_daily_cap: int = 30
    news_timeout_seconds: float = 10.0
    llm_timeout_seconds: float = 45.0

    @field_validator("jwt_secret")
    @classmethod
    def _jwt_secret_long_enough(cls, value: str) -> str:
        # Empty stays legal: that is the fail-closed "auth not configured" state (503), not a weak key.
        if value and len(value) < MIN_JWT_SECRET_LENGTH:
            raise ValueError(
                f"JWT_SECRET is {len(value)} characters; it must be at least {MIN_JWT_SECRET_LENGTH}. "
                'Generate one with: python -c "import secrets; print(secrets.token_urlsafe(48))"'
            )
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
