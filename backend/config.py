"""Application configuration loaded from environment variables."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings for WLED Calendar."""

    wled_host: str = "192.168.68.200"
    db_path: str = "./data/wled_calendar.db"
    port: int = 8000
    timezone: str = "America/Boise"
    default_lat: float = 43.45
    default_lon: float = -112.03
    http_timeout: float = 10.0

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
