import os

os.environ.update(
    AWS_ACCESS_KEY_ID="test",
    AWS_SECRET_ACCESS_KEY="test",
    AWS_DEFAULT_REGION="us-east-1",
    AUTO_CREATE_RESOURCES="true",
    SEED_ON_STARTUP="true",
    ADMIN_USERNAME="admin",
    ADMIN_PASSWORD="secret",
    USERS="edna:senha-editora:editor,rui:senha-revisor:admin",
    CACHE_TTL_SECONDS="0",
    FRONTEND_DIST="__no_dist__",
)

import pytest
from fastapi.testclient import TestClient
from moto import mock_aws

PASSWORDS = {"admin": "secret", "edna": "senha-editora", "rui": "senha-revisor"}


@pytest.fixture
def client():
    with mock_aws():
        from app.main import app

        with TestClient(app) as c:
            yield c


def login(client, username: str):
    client.cookies.clear()
    resp = client.post("/api/auth/login", json={"username": username, "password": PASSWORDS[username]})
    assert resp.status_code == 200, resp.text
    return client


@pytest.fixture
def admin(client):
    return login(client, "admin")


def apply_change(client, page_id: str, *, content: str | None = None, fields: dict | None = None, bump: str = "patch"):
    """Muda uma página pelo caminho obrigatório: propor, aprovar (a própria proposta) e aplicar."""
    page = client.get(f"/api/admin/pages/{page_id}").json()
    review = client.post(
        f"/api/admin/pages/{page_id}/reviews",
        json={
            "title": "Alteração de teste",
            "description": "Feita pelo caminho de revisão.",
            "content": content,
            "fields": fields or {},
            "base_version": page["version"],
            "bump": bump,
        },
    )
    assert review.status_code == 201, review.text
    review_id = review.json()["id"]
    assert client.post(f"/api/admin/reviews/{review_id}/approve", json={}).status_code == 200
    merged = client.post(f"/api/admin/reviews/{review_id}/merge", json={})
    assert merged.status_code == 200, merged.text
    return client.get(f"/api/admin/pages/{page_id}").json()


def publish(client, page_id: str):
    return apply_change(client, page_id, fields={"published": True})


def find(tree, path):
    for node in tree:
        if node["path"] == path:
            return node
        found = find(node["children"], path)
        if found:
            return found
    return None
