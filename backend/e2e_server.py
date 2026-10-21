"""Backend descartável para os testes de ponta a ponta (Playwright).

DynamoDB e S3 simulados em memória (moto), páginas de exemplo e usuários de teste.
Cada execução começa do zero. Uso: python e2e_server.py  (porta em E2E_API_PORT, padrão 8020)
"""

import os

os.environ.update(
    AWS_ACCESS_KEY_ID="e2e",
    AWS_SECRET_ACCESS_KEY="e2e",
    AWS_DEFAULT_REGION="us-east-1",
    DYNAMODB_ENDPOINT_URL="",
    S3_ENDPOINT_URL="",
    AUTO_CREATE_RESOURCES="true",
    SEED_ON_STARTUP="true",
    CACHE_TTL_SECONDS="0",
    FRONTEND_DIST="__no_dist__",
    APP_ENV="development",
    PUBLIC_READ="true",
    REVIEW_SELF_APPROVAL="true",
    # credenciais só deste ambiente de teste (repetidas em frontend/e2e/fixtures.ts)
    ADMIN_USERNAME="admin",
    ADMIN_PASSWORD="e2e-admin-senha",
    USERS="edna:e2e-editora-senha:editor",
    JWT_SECRET="e2e-segredo-somente-para-testes-automatizados",
)

import uvicorn
from moto import mock_aws

if __name__ == "__main__":
    with mock_aws():
        from app.main import app

        uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("E2E_API_PORT", "8020")), log_level="warning")
