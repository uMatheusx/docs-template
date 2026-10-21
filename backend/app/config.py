import logging
from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_JWT_SECRET = "change-me-in-production-please-use-32-chars"


class Settings(BaseSettings):
    """Configuração lida de variáveis de ambiente (ou de um arquivo .env)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    site_name: str = "Account Hub Docs"

    # AWS
    aws_region: str = "us-east-1"
    dynamodb_table: str = "accounthub-docs-pages"
    dynamodb_endpoint_url: str | None = None
    s3_bucket: str = "accounthub-docs"
    s3_endpoint_url: str | None = None
    auto_create_resources: bool = False
    seed_on_startup: bool = False
    cache_ttl_seconds: float = 5.0

    # Autenticação
    admin_username: str = "admin"
    admin_password: str = "admin"
    jwt_secret: str = DEFAULT_JWT_SECRET
    jwt_expires_minutes: int = 12 * 60
    cookie_secure: bool = False
    public_read: bool = True
    # Usuários extras: "nome:senha:papel,nome2:senha2:papel" (papéis: admin, editor)
    users: str = ""
    # Permite que o autor de uma proposta também a aprove (útil com um único admin)
    review_self_approval: bool = False

    # HTTP
    frontend_dist: str = "../frontend/dist"
    cors_origins: list[str] = []
    max_upload_mb: int = 10

    @field_validator("dynamodb_endpoint_url", "s3_endpoint_url", mode="before")
    @classmethod
    def _empty_to_none(cls, value: str | None) -> str | None:
        return value or None


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if settings.jwt_secret == DEFAULT_JWT_SECRET or settings.admin_password == "admin":
        logging.getLogger(__name__).warning("Usando credenciais padrão: defina ADMIN_PASSWORD e JWT_SECRET!")
    return settings
