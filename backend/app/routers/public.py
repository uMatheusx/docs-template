"""Rotas de leitura (visualização da documentação)."""

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse

from ..auth import current_user, require_reader
from ..config import Settings, get_settings
from ..deps import get_service, get_storage
from ..schemas import Page, SearchResult, SiteInfo, TreeNode, User
from ..service import DocsService
from ..storage import Storage

router = APIRouter(prefix="/api", tags=["docs"])

INLINE_TYPES = ("image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/svg+xml", "application/pdf")


@router.get("/health")
def health(storage: Storage = Depends(get_storage)):
    return {"status": "ok", **storage.health()}


@router.get("/site", response_model=SiteInfo)
def site(settings: Settings = Depends(get_settings), user: User | None = Depends(current_user)):
    return {
        "name": settings.site_name,
        "public_read": settings.public_read,
        "review_self_approval": settings.review_self_approval,
        "user": user,
    }


@router.get("/tree", response_model=list[TreeNode])
def tree(user: User | None = Depends(require_reader), svc: DocsService = Depends(get_service)):
    # Administradores logados também enxergam rascunhos na visualização.
    return svc.tree(include_drafts=user is not None)


@router.get("/pages/by-path", response_model=Page)
def page_by_path(
    path: str = Query(default=""),
    user: User | None = Depends(require_reader),
    svc: DocsService = Depends(get_service),
):
    return svc.get_page_by_path(path, include_drafts=user is not None)


@router.get("/pages/{page_id}", response_model=Page)
def page(page_id: str, user: User | None = Depends(require_reader), svc: DocsService = Depends(get_service)):
    return svc.get_page(page_id, include_drafts=user is not None)


@router.get("/search", response_model=list[SearchResult])
def search(
    q: str = Query(min_length=1, max_length=200),
    limit: int = Query(default=20, ge=1, le=50),
    user: User | None = Depends(require_reader),
    svc: DocsService = Depends(get_service),
):
    return svc.search(q, include_drafts=user is not None, limit=limit)


@router.get("/assets/{asset_id}/{filename}", dependencies=[Depends(require_reader)])
def asset(asset_id: str, filename: str, request: Request, storage: Storage = Depends(get_storage)):
    obj = storage.get_asset(asset_id, filename)
    if obj is None:
        raise HTTPException(404, "Arquivo não encontrado")
    etag = obj.get("ETag", "")
    if etag and request.headers.get("if-none-match") == etag:
        obj["Body"].close()
        return Response(status_code=304)
    content_type = obj.get("ContentType") or "application/octet-stream"
    headers = {
        "Cache-Control": "public, max-age=31536000, immutable",
        "ETag": etag,
        "Content-Length": str(obj["ContentLength"]),
        "X-Content-Type-Options": "nosniff",
        # Evita que um SVG/HTML enviado execute scripts na origem da aplicação.
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    }
    if content_type.split(";")[0] not in INLINE_TYPES:
        headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return StreamingResponse(obj["Body"].iter_chunks(64 * 1024), media_type=content_type, headers=headers)
