from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "Stock Daily Analyzer API"
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]


settings = Settings()
