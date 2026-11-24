from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Turso: libsql://<db>-<org>.turso.io  (or a local file path for dev/tests)
    turso_database_url: str = "freeman-dev.db"
    turso_auth_token: str = ""
    # Single shared secret until real accounts exist. Required.
    api_key: str = ""
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


@lru_cache
def get_settings() -> Settings:
    return Settings()
