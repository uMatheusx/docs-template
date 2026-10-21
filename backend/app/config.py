import logging
from functools import lru_cache
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_JWT_SECRET = "change-me-in-production-please-use-32-chars"
# valores de exemplo conhecidos (código e .env.example): nunca aceitos em produção
INSECURE_JWT_SECRETS = {DEFAULT_JWT_SECRET, "troque-este-segredo-por-um-valor-aleatorio-longo"}
INSECURE_PASSWORDS = {"admin", "password", "senha", "troque-esta-senha", "outra-senha"}
MIN_JWT_SECRET_LENGTH = 32
MIN_PASSWORD_LENGTH = 12


class Settings(BaseSettings):
    """Configuração lida de variáveis de ambiente (ou de um arquivo .env)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    site_name: str = "Account Hub Docs"
    # "production" recusa subir com credenciais padrão ou fracas; "development" só avisa
    app_env: Literal["development", "production"] = "development"

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


def insecure_settings(settings: Settings) -> list[str]:
    """Problemas de credenciais que impedem a subida em produção."""
    problems = []
    if settings.jwt_secret in INSECURE_JWT_SECRETS or len(settings.jwt_secret) < MIN_JWT_SECRET_LENGTH:
        problems.append(f"JWT_SECRET padrão ou com menos de {MIN_JWT_SECRET_LENGTH} caracteres")
    if settings.admin_password in INSECURE_PASSWORDS or len(settings.admin_password) < MIN_PASSWORD_LENGTH:
        problems.append(f"ADMIN_PASSWORD padrão ou com menos de {MIN_PASSWORD_LENGTH} caracteres")
    for entry in filter(None, (e.strip() for e in settings.users.split(","))):
        name, _, rest = entry.partition(":")
        password = rest.partition(":")[0]
        if password in (*INSECURE_PASSWORDS, name) or len(password) < MIN_PASSWORD_LENGTH:
            problems.append(f"senha fraca para o usuário “{name}” em USERS")
    return problems


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    problems = insecure_settings(settings)
    if problems and settings.app_env == "production":
        raise RuntimeError("Credenciais inseguras em produção: " + "; ".join(problems))
    if problems:
        logging.getLogger(__name__).warning(
            "Credenciais inseguras (aceitas só em desenvolvimento): %s", "; ".join(problems)
        )
    return settings
