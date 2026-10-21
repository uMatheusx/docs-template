"""Rotas do Studio: páginas, doctree, histórico, revisões, modelos, importação e mídia.

Editores acessam o Studio; operações que alteram o que está publicado exigem administrador.
"""

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status

from ..auth import require_admin, require_editor
from ..batches import BatchService
from ..config import Settings, get_settings
from ..deps import get_batches, get_reviews, get_service, get_storage, get_templates
from ..library import TemplateService
from ..links import link_report
from ..reviews import ReviewService
from ..schemas import (
    Asset,
    Batch,
    BatchDetail,
    BatchInput,
    HistoryContent,
    HistoryEntry,
    ImportUrlRequest,
    LinkReport,
    MoveRequest,
    Page,
    PageCreate,
    PageUpdate,
    Review,
    ReviewComment,
    ReviewDecision,
    ReviewDetail,
    ReviewInput,
    ReviewMerge,
    Stats,
    Template,
    TemplateCreate,
    TreeNode,
    User,
)
from ..service import DocsService, not_found
from ..specs import detect_kind
from ..storage import Storage

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_editor)])


async def _read_upload(file: UploadFile, settings: Settings) -> bytes:
    limit = settings.max_upload_mb * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"Arquivo maior que {settings.max_upload_mb} MB")
    return data


# ---------------------------------------------------------------- visão geral
@router.get("/stats", response_model=Stats)
def stats(svc: DocsService = Depends(get_service)):
    return svc.stats()


@router.get("/link-report", response_model=LinkReport)
def links(storage: Storage = Depends(get_storage)):
    return link_report(storage)


@router.get("/tree", response_model=list[TreeNode])
def tree(svc: DocsService = Depends(get_service)):
    return svc.tree(include_drafts=True)


# ---------------------------------------------------------------- páginas
@router.post("/pages", response_model=Page, status_code=status.HTTP_201_CREATED)
def create_page(body: PageCreate, user: User = Depends(require_editor), svc: DocsService = Depends(get_service)):
    return svc.create_page(body, user.username)


@router.get("/pages/{page_id}", response_model=Page)
def get_page(page_id: str, svc: DocsService = Depends(get_service)):
    return svc.get_page(page_id, include_drafts=True)


@router.put("/pages/{page_id}", response_model=Page)
def update_page(
    page_id: str, body: PageUpdate, user: User = Depends(require_editor), svc: DocsService = Depends(get_service)
):
    return svc.update_page(page_id, body, user.username)


@router.delete("/pages/{page_id}", dependencies=[Depends(require_admin)])
def delete_page(page_id: str, svc: DocsService = Depends(get_service)):
    return {"deleted": svc.delete_page(page_id)}


@router.post("/pages/{page_id}/move", response_model=list[TreeNode])
def move_page(
    page_id: str, body: MoveRequest, user: User = Depends(require_admin), svc: DocsService = Depends(get_service)
):
    return svc.move_page(page_id, body.parent_id, body.index, user.username)


# ---------------------------------------------------------------- histórico
@router.get("/pages/{page_id}/history", response_model=list[HistoryEntry])
def history(page_id: str, storage: Storage = Depends(get_storage)):
    return storage.list_history(page_id)


@router.get("/pages/{page_id}/history/{version_id}", response_model=HistoryContent)
def history_version(page_id: str, version_id: str, storage: Storage = Depends(get_storage)):
    content = storage.get_history(page_id, version_id)
    if content is None:
        raise not_found("Versão")
    return {"id": version_id, "content": content}


@router.post("/pages/{page_id}/history/{version_id}/restore", response_model=Page)
def restore_version(
    page_id: str, version_id: str, user: User = Depends(require_admin), svc: DocsService = Depends(get_service)
):
    return svc.restore_version(page_id, version_id, user.username)


# ---------------------------------------------------------------- revisões
@router.get("/reviews", response_model=list[Review])
def list_reviews(
    state: str = Query(default="active", pattern="^(active|done|all)$"),
    page_id: str | None = None,
    reviews: ReviewService = Depends(get_reviews),
):
    return reviews.list(state, page_id)


@router.post("/pages/{page_id}/reviews", response_model=Review, status_code=status.HTTP_201_CREATED)
def submit_review(
    page_id: str, body: ReviewInput, user: User = Depends(require_editor), reviews: ReviewService = Depends(get_reviews)
):
    return reviews.submit(page_id, body, user)


@router.get("/reviews/{review_id}", response_model=ReviewDetail)
def review_detail(review_id: str, reviews: ReviewService = Depends(get_reviews)):
    return reviews.detail(review_id)


@router.post("/reviews/{review_id}/comments", response_model=Review)
def comment_review(
    review_id: str,
    body: ReviewComment,
    user: User = Depends(require_editor),
    reviews: ReviewService = Depends(get_reviews),
):
    return reviews.comment(review_id, body.body, user)


@router.post("/reviews/{review_id}/approve", response_model=Review)
def approve_review(
    review_id: str,
    body: ReviewDecision,
    user: User = Depends(require_editor),
    reviews: ReviewService = Depends(get_reviews),
):
    return reviews.approve(review_id, body.body, user)


@router.post("/reviews/{review_id}/request-changes", response_model=Review)
def request_changes(
    review_id: str,
    body: ReviewDecision,
    user: User = Depends(require_editor),
    reviews: ReviewService = Depends(get_reviews),
):
    return reviews.request_changes(review_id, body.body, user)


@router.post("/reviews/{review_id}/merge", response_model=Review)
def merge_review(
    review_id: str,
    body: ReviewMerge,
    user: User = Depends(require_editor),
    reviews: ReviewService = Depends(get_reviews),
):
    return reviews.merge(review_id, user, body.force, body.resolutions, body.semver)


@router.post("/reviews/{review_id}/close", response_model=Review)
def close_review(review_id: str, user: User = Depends(require_editor), reviews: ReviewService = Depends(get_reviews)):
    return reviews.close(review_id, user)


# ---------------------------------------------------------------- modelos de página
@router.get("/templates", response_model=list[Template])
def list_templates(templates: TemplateService = Depends(get_templates)):
    return templates.list()


@router.post("/templates", response_model=Template, status_code=status.HTTP_201_CREATED)
def create_template(
    body: TemplateCreate, user: User = Depends(require_editor), templates: TemplateService = Depends(get_templates)
):
    return templates.create(body, user)


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(
    template_id: str, user: User = Depends(require_editor), templates: TemplateService = Depends(get_templates)
):
    templates.delete(template_id, user)


# ---------------------------------------------------------------- importação
@router.post("/import/files", response_model=list[Page], status_code=status.HTTP_201_CREATED)
async def import_files(
    files: list[UploadFile] = File(...),
    parent_id: str | None = Form(default=None),
    user: User = Depends(require_editor),
    svc: DocsService = Depends(get_service),
    settings: Settings = Depends(get_settings),
):
    created = []
    for file in files:
        data = await _read_upload(file, settings)
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{file.filename} não é um arquivo UTF-8") from exc
        created.append(
            svc.import_file(file.filename or "importado.md", text, parent_id or None, user.username)
        )
    return created


@router.post("/import/url", response_model=Page, status_code=status.HTTP_201_CREATED)
def import_url(body: ImportUrlRequest, user: User = Depends(require_editor), svc: DocsService = Depends(get_service)):
    return svc.import_url(str(body.url), body.parent_id, user.username)


# ---------------------------------------------------------------- mídia
@router.get("/assets", response_model=list[Asset])
def list_assets(storage: Storage = Depends(get_storage)):
    return storage.list_assets()


@router.post("/assets", response_model=Asset, status_code=status.HTTP_201_CREATED)
async def upload_asset(
    file: UploadFile = File(...),
    user: User = Depends(require_editor),
    storage: Storage = Depends(get_storage),
    settings: Settings = Depends(get_settings),
):
    data = await _read_upload(file, settings)
    name = file.filename or "arquivo"
    spec_kind = None
    if name.lower().endswith((".yaml", ".yml", ".json")):
        try:
            spec_kind = detect_kind(data.decode("utf-8"))
        except UnicodeDecodeError:
            spec_kind = None
    return storage.put_asset(data, name, file.content_type or "", user.username, spec_kind)


@router.delete(
    "/assets/{asset_id}/{filename}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin)]
)
def delete_asset(asset_id: str, filename: str, storage: Storage = Depends(get_storage)):
    storage.delete_asset(asset_id, filename)


# ---------------------------------------------------------------- pacotes de revisão (várias páginas juntas)
@router.get("/review-batches", response_model=list[Batch])
def list_batches(
    state: str = Query(default="active", pattern="^(active|done|all)$"), batches: BatchService = Depends(get_batches)
):
    return batches.list(state)


@router.post("/review-batches", response_model=Batch, status_code=status.HTTP_201_CREATED)
def create_batch(body: BatchInput, user: User = Depends(require_editor), batches: BatchService = Depends(get_batches)):
    return batches.create(body, user)


@router.get("/review-batches/{batch_id}", response_model=BatchDetail)
def batch_detail(batch_id: str, batches: BatchService = Depends(get_batches)):
    return batches.detail(batch_id)


@router.post("/review-batches/{batch_id}/comments", response_model=Batch)
def comment_batch(
    batch_id: str,
    body: ReviewComment,
    user: User = Depends(require_editor),
    batches: BatchService = Depends(get_batches),
):
    return batches.comment(batch_id, body.body, user)


@router.post("/review-batches/{batch_id}/approve", response_model=Batch)
def approve_batch(
    batch_id: str,
    body: ReviewDecision,
    user: User = Depends(require_admin),
    batches: BatchService = Depends(get_batches),
):
    return batches.approve(batch_id, body.body, user)


@router.post("/review-batches/{batch_id}/request-changes", response_model=Batch)
def request_batch_changes(
    batch_id: str,
    body: ReviewDecision,
    user: User = Depends(require_admin),
    batches: BatchService = Depends(get_batches),
):
    return batches.request_changes(batch_id, body.body, user)


@router.post("/review-batches/{batch_id}/merge", response_model=Batch)
def merge_batch(batch_id: str, user: User = Depends(require_admin), batches: BatchService = Depends(get_batches)):
    return batches.merge(batch_id, user)


@router.post("/review-batches/{batch_id}/close", response_model=Batch)
def close_batch(batch_id: str, user: User = Depends(require_editor), batches: BatchService = Depends(get_batches)):
    return batches.close(batch_id, user)
