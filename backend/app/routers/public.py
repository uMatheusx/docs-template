"""Rotas de leitura (visualização da documentação)."""

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse

from ..auth import current_user, require_reader
from ..config import Settings, get_settings
from ..deps import get_service, get_storage
from ..schemas import Page, SearchResult, SiteInfo, TreeNode, User
from ..services.docs import DocsService
from ..storage import Storage

router = APIRouter(prefix="/api", tags=["docs"])

INLINE_TYPES = ("image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/svg+xml", "application/pdf")


def _not_modified(request: Request, response: Response, storage: Storage, user: User | None) -> Response | None:
    """ETag das leituras de páginas: o contador da árvore muda a cada gravação, então o mesmo valor = mesma resposta.

    Quem está logado também vê rascunhos: a resposta é outra (sufixo próprio) e só o navegador dela guarda (private).
    """
    etag = f'W/"{storage.tree_version()}-{"d" if user else "p"}"'
    cache = "private, no-cache" if user else "no-cache"
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": cache})
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = cache
    return None


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
def tree(
    request: Request,
    response: Response,
    user: User | None = Depends(require_reader),
    svc: DocsService = Depends(get_service),
):
    if cached := _not_modified(request, response, svc.storage, user):
        return cached
    # Quem está logado também enxerga rascunhos na visualização.
    return svc.tree(include_drafts=user is not None)


@router.get("/pages/by-path", response_model=Page)
def page_by_path(
    request: Request,
    response: Response,
    path: str = Query(default=""),
    user: User | None = Depends(require_reader),
    svc: DocsService = Depends(get_service),
):
    if cached := _not_modified(request, response, svc.storage, user):
        return cached
    return svc.get_page_by_path(path, include_drafts=user is not None)


@router.get("/redirects")
def redirect(
    path: str = Query(min_length=1),
    user: User | None = Depends(require_reader),
    svc: DocsService = Depends(get_service),
) -> dict[str, str]:
    """Endereço atual de uma página renomeada ou movida (404 se nunca existiu ou foi excluída)."""
    return {"path": svc.resolve_redirect(path, include_drafts=user is not None)}


@router.get("/pages/{page_id}", response_model=Page)
def page(
    page_id: str,
    request: Request,
    response: Response,
    user: User | None = Depends(require_reader),
    svc: DocsService = Depends(get_service),
):
    if cached := _not_modified(request, response, svc.storage, user):
        return cached
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
