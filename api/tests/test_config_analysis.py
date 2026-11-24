from app.config import Settings
from app.db import connect, init_schema, rows


# `_env_file=None` everywhere: the real freeman-api/.env holds real keys and must never leak into tests.
def test_analysis_settings_defaults_match_the_spec():
    s = Settings(jwt_secret="k", _env_file=None)
    assert s.analysis_cache_hours == 6
    assert s.analysis_refresh_min_minutes == 15
    assert s.analysis_daily_cap == 30
    assert s.news_timeout_seconds == 10.0
    assert s.llm_timeout_seconds == 45.0
    assert s.openai_api_key == "" and s.openai_model == "" and s.finnhub_api_key == ""


def test_analysis_settings_read_from_environment(monkeypatch):
    monkeypatch.setenv("OPENAI_MODEL", "some-model")
    monkeypatch.setenv("ANALYSIS_DAILY_CAP", "5")
    s = Settings(jwt_secret="k", _env_file=None)
    assert s.openai_model == "some-model" and s.analysis_daily_cap == 5


def test_schema_creates_analyses_table(tmp_path):
    conn = connect(str(tmp_path / "t.db"))
    init_schema(conn)
    cols = {r["name"] for r in rows(conn.execute("PRAGMA table_info(analyses)"))}
    assert {"ticker", "position_hash", "personalized", "created_at", "expires_at", "model", "payload"} <= cols
    assert "status" not in cols
