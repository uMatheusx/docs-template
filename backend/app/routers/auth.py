from fastapi import APIRouter, Depends, HTTPException, Response, status

from ..auth import COOKIE_NAME, authenticate, create_token, require_admin
from ..config import Settings, get_settings
from ..schemas import LoginRequest, LoginResponse, User

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, response: Response, settings: Settings = Depends(get_settings)):
    user = authenticate(body.username, body.password, settings)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuário ou senha inválidos")
    token, expires_at = create_token(user, settings)
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=settings.jwt_expires_minutes * 60,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/",
    )
    return {"user": user, "token": token, "expires_at": expires_at}


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")


@router.get("/me", response_model=User)
def me(user: User = Depends(require_admin)):
    return user
