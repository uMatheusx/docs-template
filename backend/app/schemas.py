from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, HttpUrl, StringConstraints, ValidationInfo, field_validator

PageKind = Literal["doc", "openapi", "asyncapi"]


class PageMeta(BaseModel):
    id: str
    title: str
    slug: str
    parent_id: str | None = None
    order: int = 0
    icon: str | None = None
    description: str = ""
    published: bool = True
    created_at: str
    updated_at: str
    updated_by: str = ""
    # revisão interna (controle de edições simultâneas) e versão x.y.z exibida às pessoas
    version: int = 1
    semver: str = "1.0.0"
    note: str = ""
    kind: PageKind = "doc"
    path: str


class TreeNode(PageMeta):
    children: list[TreeNode] = []


class Page(PageMeta):
    content: str
    breadcrumbs: list[Crumb] = []


class Crumb(BaseModel):
    id: str
    title: str
    path: str


class PageCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    slug: str | None = Field(default=None, max_length=80)
    parent_id: str | None = None
    icon: str | None = Field(default=None, max_length=60)
    description: str = Field(default="", max_length=500)
    published: bool = True
    content: str | None = None
    kind: PageKind = "doc"


class PageUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    slug: str | None = Field(default=None, min_length=1, max_length=80)
    icon: str | None = Field(default=None, max_length=60)
    description: str | None = Field(default=None, max_length=500)
    published: bool | None = None
    content: str | None = None
    note: str | None = Field(default=None, max_length=200, description="Descrição da alteração (fica no histórico)")
    version: int | None = Field(default=None, description="Versão esperada (controle otimista de concorrência)")


class MoveRequest(BaseModel):
    parent_id: str | None = None
    index: int = Field(ge=0)


class ImportUrlRequest(BaseModel):
    url: HttpUrl
    parent_id: str | None = None


class LoginRequest(BaseModel):
    username: str
    password: str


class User(BaseModel):
    username: str
    role: Literal["admin", "editor"] = "admin"


class LoginResponse(BaseModel):
    user: User
    token: str
    expires_at: int


class SearchResult(BaseModel):
    id: str
    title: str
    path: str
    description: str = ""
    snippet: str = ""
    score: float


class HistoryEntry(BaseModel):
    id: str
    author: str
    size: int
    version: int
    semver: str
    note: str = ""
    created_at: str
    archived_at: str


class HistoryContent(BaseModel):
    id: str
    content: str


class Asset(BaseModel):
    id: str
    name: str
    key: str
    url: str
    size: int
    content_type: str | None = None
    last_modified: str
    # contrato OpenAPI/AsyncAPI reconhecido no envio (pode ser referenciado nas páginas)
    spec_kind: Literal["openapi", "asyncapi"] | None = None


class Stats(BaseModel):
    total: int
    published: int
    drafts: int
    assets: int
    open_reviews: int = 0
    recent: list[PageMeta]


class SiteInfo(BaseModel):
    name: str
    public_read: bool
    review_self_approval: bool = False
    user: User | None = None


# ---------------------------------------------------------------- links quebrados
class LinkIssue(BaseModel):
    page_id: str
    page_title: str
    page_path: str
    kind: Literal["broken_link", "draft_link", "broken_image", "broken_asset"]
    target: str
    text: str = ""
    line: int


class LinkReport(BaseModel):
    checked_at: str
    pages_checked: int
    issues: list[LinkIssue]


# ---------------------------------------------------------------- revisões
ReviewStatus = Literal["open", "approved", "changes_requested", "merged", "closed"]
Bump = Literal["patch", "minor", "major"]
Semver = Annotated[str, StringConstraints(pattern=r"^\d+\.\d+\.\d+$")]


class ReviewFields(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    slug: str | None = Field(default=None, min_length=1, max_length=80)
    icon: str | None = Field(default=None, max_length=60)
    description: str | None = Field(default=None, max_length=500)
    published: bool | None = None


class ReviewItemInput(BaseModel):
    """O que muda numa página da proposta."""

    page_id: str
    content: str | None = None
    fields: ReviewFields = ReviewFields()
    base_version: int
    # versão x.y.z em que o rascunho se baseia (informativa; a mesclagem usa base_version)
    base_semver: Semver | None = None
    # tamanho da mudança: define a versão recomendada quando a proposta for aplicada
    bump: Bump = "patch"
    # versão escolhida à mão no lugar da recomendada (precisa ser maior que a atual)
    semver: Semver | None = None


class ReviewInput(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    # obrigatória: quem revisa precisa saber o que mudou e por quê
    description: str = Field(min_length=1, max_length=2000)
    items: list[ReviewItemInput] = Field(min_length=1, max_length=100)

    @field_validator("title", "description")
    @classmethod
    def _not_blank(cls, value: str, info: ValidationInfo) -> str:
        value = value.strip()
        if not value:
            message = "Descreva o que mudou e por quê." if info.field_name == "description" else "Informe um resumo."
            raise ValueError(message)
        return value


class ReviewEvent(BaseModel):
    id: str
    type: Literal["created", "updated", "comment", "approved", "changes_requested", "merged", "closed"]
    author: str
    body: str = ""
    at: str


class ReviewItem(BaseModel):
    page_id: str
    page_title: str = ""
    page_path: str = ""
    page_published: bool = True
    base_version: int
    base_semver: str = ""
    bump: Bump = "patch"
    semver: str | None = None
    fields: ReviewFields
    has_content: bool
    merged_version: int | None = None
    merged_semver: str | None = None


class Review(BaseModel):
    """Proposta de alteração em uma ou várias páginas, revisada e aplicada junta (como um pull request)."""

    id: str
    number: int
    title: str
    description: str = ""
    status: ReviewStatus
    author: str
    created_at: str
    updated_at: str
    items: list[ReviewItem]
    events: list[ReviewEvent] = []


class MergeConflict(BaseModel):
    """Trecho que a página e a proposta mudaram de formas diferentes desde a versão-base."""

    index: int
    before: str = ""
    base: str
    ours: str
    theirs: str
    after: str = ""


class MergeInfo(BaseModel):
    """Situação de uma página da proposta frente à versão atual dela.

    - current: a página não mudou desde a proposta
    - clean: mudou, mas as alterações se combinam sozinhas (merged_content é o resultado)
    - conflicts: os dois lados mexeram nos mesmos trechos; quem revisa escolhe um por um
    - unavailable: não foi possível recuperar a versão-base para mesclar
    """

    state: Literal["current", "clean", "conflicts", "unavailable"]
    base_version: int
    current_version: int
    base_semver: str = ""
    current_semver: str = ""
    conflicts: list[MergeConflict] = []
    merged_content: str | None = None


class ReviewItemDetail(ReviewItem):
    proposed_content: str
    current_content: str
    current_version: int
    current_semver: str = ""
    # versão que a página terá se a proposta for aplicada agora (a escolhida à mão, se ainda valer)
    next_semver: str = ""
    # a recomendada pelo tamanho da mudança
    recommended_semver: str = ""
    # a versão escolhida à mão deixou de ser maior que a da página (ela avançou depois da proposta)
    semver_outdated: bool = False
    page_kind: PageKind = "doc"
    merge: MergeInfo | None = None


class ReviewDetail(Review):
    items: list[ReviewItemDetail]


class ReviewComment(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class ReviewDecision(BaseModel):
    body: str = Field(default="", max_length=4000)


class ReviewMerge(BaseModel):
    # força o texto proposto por cima das páginas, sem mesclar
    force: bool = False
    # por página: uma escolha por conflito, na ordem em que aparecem em merge.conflicts
    resolutions: dict[str, list[Literal["ours", "theirs", "both"]]] | None = None
    # por página: versão escolhida por quem aplica, no lugar da sugerida (precisa ser maior que a atual)
    semver: dict[str, Semver] | None = None


# ---------------------------------------------------------------- modelos de página
class Template(BaseModel):
    id: str
    name: str
    description: str = ""
    icon: str | None = None
    kind: PageKind = "doc"
    content: str
    created_by: str = ""
    created_at: str = ""


class TemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=300)
    icon: str | None = Field(default=None, max_length=60)
    kind: PageKind = "doc"
    content: str = Field(max_length=200_000)


Page.model_rebuild()
TreeNode.model_rebuild()
