"""Application configuration.

Settings are loaded from environment variables (and an optional local ``.env``)
and validated at import/startup time via pydantic-settings. Missing or invalid
*required* values fail fast rather than surfacing later as obscure runtime errors.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, computed_field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "staging", "production"]


def _strip_libpq_only_params(rest: str) -> str:
    """Drop libpq-only query params (``sslmode``, ``channel_binding``) that the
    pure-Python pg8000 driver does not understand. TLS for pg8000 is configured
    via connect_args in ``app.core.database`` instead."""
    base, sep, query = rest.partition("?")
    if not sep:
        return rest
    drop = {"sslmode", "channel_binding"}
    kept = [kv for kv in query.split("&") if kv.split("=", 1)[0].lower() not in drop]
    return base + ("?" + "&".join(kept) if kept else "")


class Settings(BaseSettings):
    """Typed, validated application settings."""

    model_config = SettingsConfigDict(
        # Load the repo-root .env when present; real deployments inject real env vars.
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ---- Application ----
    app_env: Environment = "development"
    app_name: str = "Rice Mill ERP"
    log_level: str = "INFO"
    log_json: bool = False

    # ---- HTTP ----
    backend_host: str = "0.0.0.0"
    backend_port: int = 8000
    cors_allow_origins: str = "http://localhost:3000"
    # Public origin of the frontend (e.g. the Cloudflare Pages URL). Used to build
    # absolute links printed into invoices — specifically the QR code that opens
    # the public invoice page. No trailing slash (normalised when used).
    public_app_base_url: str = "http://localhost:3000"

    # ---- Security / session ----
    secret_key: str = Field(min_length=16)
    session_cookie_name: str = "rmerp_session"
    session_cookie_secure: bool = False
    # "lax" for same-site dev; set "none" (with SESSION_COOKIE_SECURE=true) when
    # the frontend and backend are on different domains (e.g. Cloudflare Pages +
    # Render), so the browser sends the session cookie on cross-site requests.
    session_cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    session_ttl_seconds: int = 43_200

    # ---- PostgreSQL ----
    # A full SQLAlchemy URL. Accepts the production ``postgresql+psycopg://`` form
    # and ``sqlite://`` for hermetic tests. Validated by SQLAlchemy at connect time.
    database_url: str | None = None
    # SQLAlchemy driver for bare ``postgresql://`` URLs. "psycopg" (v3, native) is
    # the default; set DB_DRIVER=pg8000 to use the pure-Python driver locally when
    # the psycopg binary is blocked (e.g. Windows Smart App Control).
    db_driver: Literal["psycopg", "pg8000"] = "psycopg"
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str = "rice_mill_erp"
    postgres_user: str = "rice_mill"
    postgres_password: str = "rice_mill"

    # ---- Redis ----
    redis_url: str = "redis://localhost:6379/0"

    # ---- S3-compatible object storage ----
    s3_endpoint_url: str = "http://localhost:9000"
    s3_region: str = "us-east-1"
    s3_bucket: str = "rice-mill-documents"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_use_path_style: bool = True

    # ---- Document storage ----
    # Where uploaded/generated file bytes live: "db" (default — persists in
    # PostgreSQL, so no disk is needed on ephemeral hosts) or "local" (on-disk).
    document_storage_backend: Literal["db", "local"] = "db"
    document_storage_dir: str = "./document_storage"

    # ---- Observability ----
    sentry_dsn: str | None = None

    @field_validator("log_level")
    @classmethod
    def _normalise_log_level(cls, value: str) -> str:
        allowed = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
        upper = value.upper()
        if upper not in allowed:
            raise ValueError(f"log_level must be one of {sorted(allowed)}")
        return upper

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def sqlalchemy_database_uri(self) -> str:
        """Resolved database URL.

        Prefer an explicit ``DATABASE_URL``; otherwise assemble one from the
        discrete Postgres settings using the psycopg (v3) driver.
        """
        if self.database_url is not None:
            url = str(self.database_url)
            # Normalise bare libpq schemes (as emitted by managed Postgres such as
            # Neon/Heroku) to the configured SQLAlchemy driver. Without this,
            # SQLAlchemy defaults to psycopg2, which is not a dependency.
            for prefix in ("postgresql://", "postgres://"):
                if url.startswith(prefix):
                    rest = url[len(prefix) :]
                    if self.db_driver == "pg8000":
                        rest = _strip_libpq_only_params(rest)
                    return f"postgresql+{self.db_driver}://{rest}"
            return url
        return (
            f"postgresql+{self.db_driver}://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_allow_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance (single load per process)."""
    return Settings()
