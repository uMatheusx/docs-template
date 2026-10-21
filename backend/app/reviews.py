"""Fluxo de revisão: propostas de alteração para páginas, com comentários, aprovação e aplicação.

A proposta guarda o conteúdo sugerido no S3 (pages/<id>/proposals/<rev>.md) e os metadados
no DynamoDB (item com record="review"). A página publicada não muda até a proposta ser aplicada.
"""

from __future__ import annotations

import uuid

from fastapi import HTTPException, status

from .config import Settings
from .schemas import PageUpdate, ReviewInput, User
from .service import DocsService, not_found
from .storage import utcnow
from .tree import build_tree, flatten

ACTIVE = ("open", "approved", "changes_requested")


def _event(type_: str, author: str, body: str = "") -> dict:
    return {"id": uuid.uuid4().hex[:10], "type": type_, "author": author, "body": body, "at": utcnow()}


class ReviewService:
    def __init__(self, docs: DocsService, settings: Settings) -> None:
        self.docs = docs
        self.storage = docs.storage
        self.settings = settings

    # ------------------------------------------------------------------ helpers
    def _proposal_key(self, review: dict) -> str:
        return f"pages/{review['page_id']}/proposals/{review['id']}.md"

    def _base_key(self, review: dict) -> str:
        """Conteúdo da página logo antes de aplicar (mantém o diff legível depois do merge)."""
        return f"pages/{review['page_id']}/proposals/{review['id']}.base.md"

    def _pages_by_id(self) -> dict[str, dict]:
        tree = build_tree(self.storage.list_pages(), include_drafts=True)
        return {node["id"]: node for node, _ in flatten(tree)}

    def _decorate(self, review: dict, pages: dict[str, dict] | None = None) -> dict:
        page = (pages or self._pages_by_id()).get(review["page_id"], {})
        return {
            **review,
            "page_title": page.get("title", "(página removida)"),
            "page_path": page.get("path", ""),
            "page_published": page.get("published", True),
        }

    def _get(self, review_id: str) -> dict:
        review = self.storage.get_review(review_id)
        if not review:
            raise not_found("Revisão")
        return review

    def _save(self, review: dict, event: dict | None = None) -> dict:
        if event:
            review["events"] = [*review.get("events", []), event]
        review["updated_at"] = utcnow()
        self.storage.put_review(review)
        return review

    # ------------------------------------------------------------------ leitura
    def list(self, state: str = "active", page_id: str | None = None) -> list[dict]:
        reviews = self.storage.list_reviews(page_id)
        if state == "active":
            reviews = [r for r in reviews if r["status"] in ACTIVE]
        elif state == "done":
            reviews = [r for r in reviews if r["status"] not in ACTIVE]
        pages = self._pages_by_id()
        return sorted((self._decorate(r, pages) for r in reviews), key=lambda r: r["updated_at"], reverse=True)

    def detail(self, review_id: str) -> dict:
        review = self._get(review_id)
        page = self.storage.get_page(review["page_id"])
        current = self.storage.get_content(review["page_id"]) if page else ""
        if review["status"] == "merged":
            current = self.storage.get_text(self._base_key(review)) or current
        proposed = self.storage.get_text(self._proposal_key(review)) if review.get("has_content") else None
        return {
            **self._decorate(review),
            "proposed_content": proposed if proposed is not None else current,
            "current_content": current,
            "current_version": (page or {}).get("version", 0),
            "page_kind": (page or {}).get("kind", "doc"),
        }

    # ------------------------------------------------------------------ escrita
    def submit(self, page_id: str, data: ReviewInput, user: User) -> dict:
        """Cria uma proposta — ou atualiza a proposta ativa do mesmo autor para a mesma página."""
        page = self.storage.get_page(page_id)
        if not page:
            raise not_found()
        fields = data.fields.model_dump(exclude_none=True)
        if data.content is None and not fields:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "A proposta não altera nada.")

        existing = next(
            (r for r in self.storage.list_reviews(page_id) if r["author"] == user.username and r["status"] in ACTIVE),
            None,
        )
        now = utcnow()
        if existing:
            review = existing
            review.update(
                title=data.title.strip(),
                description=data.description.strip(),
                fields=fields,
                has_content=data.content is not None,
                base_version=data.base_version,
                status="open",
            )
            event = _event("updated", user.username, "Atualizou a proposta.")
        else:
            review = {
                "id": f"rev_{uuid.uuid4().hex[:12]}",
                "number": self.storage.next_number("reviews"),
                "page_id": page_id,
                "title": data.title.strip(),
                "description": data.description.strip(),
                "base_version": data.base_version,
                "fields": fields,
                "has_content": data.content is not None,
                "status": "open",
                "author": user.username,
                "created_at": now,
                "updated_at": now,
                "merged_version": None,
                "events": [],
            }
            event = _event("created", user.username, data.description.strip())
        if data.content is not None:
            self.storage.put_text(self._proposal_key(review), data.content)
        return self._decorate(self._save(review, event))

    def comment(self, review_id: str, body: str, user: User) -> dict:
        review = self._get(review_id)
        return self._decorate(self._save(review, _event("comment", user.username, body.strip())))

    def _require_reviewer(self, review: dict, user: User) -> None:
        if user.role != "admin":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Apenas administradores revisam propostas.")
        if review["author"] == user.username and not self.settings.review_self_approval:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Você não pode revisar a própria proposta.")
        if review["status"] not in ACTIVE:
            raise HTTPException(status.HTTP_409_CONFLICT, "Esta proposta já foi encerrada.")

    def approve(self, review_id: str, body: str, user: User) -> dict:
        review = self._get(review_id)
        self._require_reviewer(review, user)
        review["status"] = "approved"
        return self._decorate(self._save(review, _event("approved", user.username, body.strip())))

    def request_changes(self, review_id: str, body: str, user: User) -> dict:
        review = self._get(review_id)
        self._require_reviewer(review, user)
        if not body.strip():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Explique o que precisa mudar.")
        review["status"] = "changes_requested"
        return self._decorate(self._save(review, _event("changes_requested", user.username, body.strip())))

    def merge(self, review_id: str, user: User, force: bool = False) -> dict:
        review = self._get(review_id)
        if user.role != "admin":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Apenas administradores aplicam propostas.")
        if review["status"] != "approved":
            raise HTTPException(status.HTTP_409_CONFLICT, "A proposta precisa ser aprovada antes de ser aplicada.")
        page = self.storage.get_page(review["page_id"])
        if not page:
            raise not_found()
        if page.get("version") != review["base_version"] and not force:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"A página mudou desde a proposta (v{review['base_version']} → v{page.get('version')}). "
                "Peça ao autor para atualizar ou aplique mesmo assim.",
            )
        content = self.storage.get_text(self._proposal_key(review)) if review.get("has_content") else None
        self.storage.put_text(self._base_key(review), self.storage.get_content(review["page_id"]))
        update = PageUpdate(
            **review.get("fields", {}),
            content=content,
            version=page.get("version"),
            note=f"Revisão #{review['number']}: {review['title']}"[:200],
        )
        saved = self.docs.update_page(review["page_id"], update, review["author"], role="admin")
        review["status"] = "merged"
        review["merged_version"] = saved["version"]
        self._save(review, _event("merged", user.username, f"Aplicada como v{saved['version']}."))
        return self._decorate(review)

    def close(self, review_id: str, user: User) -> dict:
        review = self._get(review_id)
        if user.role != "admin" and review["author"] != user.username:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Só o autor ou um administrador pode fechar a proposta.")
        if review["status"] not in ACTIVE:
            raise HTTPException(status.HTTP_409_CONFLICT, "Esta proposta já foi encerrada.")
        review["status"] = "closed"
        return self._decorate(self._save(review, _event("closed", user.username)))
