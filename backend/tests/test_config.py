import pytest

from app.config import Settings, get_settings, insecure_settings

STRONG = {"jwt_secret": "x" * 40, "admin_password": "uma-senha-forte-o-bastante"}


def test_defaults_are_insecure():
    problems = insecure_settings(Settings(_env_file=None, admin_password="admin"))
    assert any("JWT_SECRET" in p for p in problems)
    assert any("ADMIN_PASSWORD" in p for p in problems)


def test_strong_values_pass():
    assert insecure_settings(Settings(_env_file=None, **STRONG)) == []


def test_weak_extra_users_are_flagged():
    settings = Settings(_env_file=None, **STRONG, users="ana:ana:editor,bruno:senha-bem-comprida-1:admin")
    assert insecure_settings(settings) == ["senha fraca para o usuário “ana” em USERS"]


def test_production_refuses_insecure_credentials(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("ADMIN_PASSWORD", "admin")
    with pytest.raises(RuntimeError, match="Credenciais inseguras em produção"):
        get_settings.__wrapped__()


def test_development_only_warns(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("ADMIN_PASSWORD", "admin")
    assert get_settings.__wrapped__().admin_password == "admin"
