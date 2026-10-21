"""Autenticação por JWT (cookie httpOnly para o navegador ou Bearer para CI/scripts).

Papéis:
- admin: tudo (publicar, excluir, mover, aprovar revisões)
- editor: cria e edita rascunhos; páginas publicadas só mudam por proposta de revisão
"""

import hmac
import logging
import time

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import Settings, get_settings
from .schemas import User

COOKIE_NAME = "ah_docs_token"
ALGORITHM = "HS256"
ROLES = ("admin", "editor")
bearer = HTTPBearer(auto_error=False)
log = logging.getLogger(__name__)


def configured_users(settings: Settings) -> list[tuple[str, str, str]]:
    """Admin principal (ADMIN_USERNAME/ADMIN_PASSWORD) + usuários extras de USERS."""
    users = [(settings.admin_username, settings.admin_password, "admin")]
    for entry in (e.strip() for e in settings.users.split(",")):
        if not entry:
            continue
        parts = entry.split(":")
        if len(parts) != 3 or not parts[0] or not parts[1] or parts[2] not in ROLES:
            log.warning("Entrada inválida em USERS (use nome:senha:papel): %r", parts[0] if parts else entry)
            continue
        users.append((parts[0], parts[1], parts[2]))
    return users


def authenticate(username: str, password: str, settings: Settings) -> User | None:
    match = None
    for name, secret, role in configured_users(settings):
        # compara todos (tempo constante) e fica com o primeiro que casar
        ok = hmac.compare_digest(username.encode(), name.encode()) & hmac.compare_digest(
            password.encode(), secret.encode()
        )
        if ok and match is None:
            match = User(username=name, role=role)
    return match


def create_token(user: User, settings: Settings) -> tuple[str, int]:
    expires_at = int(time.time()) + settings.jwt_expires_minutes * 60
    token = jwt.encode({"sub": user.username, "role": user.role, "exp": expires_at}, settings.jwt_secret, ALGORITHM)
    return token, expires_at


def current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    settings: Settings = Depends(get_settings),
) -> User | None:
    token = credentials.credentials if credentials else request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None
    role = payload.get("role", "admin")
    return User(username=payload["sub"], role=role) if role in ROLES else None


def _unauthorized() -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, "Autenticação necessária", {"WWW-Authenticate": "Bearer"})


def require_editor(user: User | None = Depends(current_user)) -> User:
    """Qualquer usuário do Studio (admin ou editor)."""
    if not user:
        raise _unauthorized()
    return user


def require_admin(user: User | None = Depends(current_user)) -> User:
    if not user:
        raise _unauthorized()
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Apenas administradores podem fazer isso")
    return user


def require_reader(
    user: User | None = Depends(current_user), settings: Settings = Depends(get_settings)
) -> User | None:
    if not settings.public_read and not user:
        raise _unauthorized()
    return user
