"""Fluxo de revisão: propostas de alteração para páginas, com comentários, aprovação e aplicação.

A proposta guarda o conteúdo sugerido no S3 (pages/<id>/proposals/<rev>.md) e os metadados
no DynamoDB (item com record="review"). A página publicada não muda até a proposta ser aplicada.
"""

from __future__ import annotations

import uuid

from fastapi import HTTPException, status

from .config import Settings
from .merge3 import MergeResult, merge3
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

    def _merge_with_page(self, review: dict, page: dict) -> MergeResult | None:
        """Mescla a proposta com o texto atual. None se não há o que mesclar ou a versão-base não foi encontrada."""
        if not review.get("has_content") or page.get("version") == review["base_version"]:
            return None
        proposed = self.storage.get_text(self._proposal_key(review))
        base = self.storage.content_at_version(review["page_id"], review["base_version"])
        if proposed is None or base is None:
            return None
        return merge3(base, self.storage.get_content(review["page_id"]), proposed)

    def _merge_info(self, review: dict, page: dict | None) -> dict | None:
        if not page or review["status"] not in ACTIVE or not review.get("has_content"):
            return None
        info = {"base_version": review["base_version"], "current_version": page.get("version", 0)}
        if page.get("version") == review["base_version"]:
            return {**info, "state": "current"}
        result = self._merge_with_page(review, page)
        if result is None:
            return {**info, "state": "unavailable"}
        if result.clean:
            return {**info, "state": "clean", "merged_content": result.render()}
        conflicts = [
            {
                "index": i,
                "before": "".join(c.before),
                "base": "".join(c.base),
                "ours": "".join(c.ours),
                "theirs": "".join(c.theirs),
                "after": "".join(c.after),
            }
            for i, c in enumerate(result.conflicts)
        ]
        return {**info, "state": "conflicts", "conflicts": conflicts}

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
            "merge": self._merge_info(review, page),
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

    def merge(
        self, review_id: str, user: User, force: bool = False, resolutions: list[str] | None = None
    ) -> dict:
        review = self._get(review_id)
        if user.role != "admin":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Apenas administradores aplicam propostas.")
        if review["status"] != "approved":
            raise HTTPException(status.HTTP_409_CONFLICT, "A proposta precisa ser aprovada antes de ser aplicada.")
        page = self.storage.get_page(review["page_id"])
        if not page:
            raise not_found()
        content = self.storage.get_text(self._proposal_key(review)) if review.get("has_content") else None
        how = ""
        stale = page.get("version") != review["base_version"]
        if stale and content is not None and not force:
            # a página mudou depois da proposta: combina as duas mudanças em vez de sobrescrever
            result = self._merge_with_page(review, page)
            if result is None:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    f"A página mudou desde a proposta (v{review['base_version']} → v{page.get('version')}) e não foi "
                    "possível combinar as mudanças. Peça ao autor para atualizar ou aplique mesmo assim.",
                )
            if result.clean:
                content = result.render()
                how = f" Combinada automaticamente com as mudanças feitas na página desde a v{review['base_version']}."
            else:
                total = len(result.conflicts)
                if resolutions is None:
                    raise HTTPException(
                        status.HTTP_409_CONFLICT,
                        f"A página e a proposta mudaram os mesmos trechos ({total}): escolha uma opção para cada um.",
                    )
                if len(resolutions) != total:
                    raise HTTPException(
                        status.HTTP_400_BAD_REQUEST, f"Escolha uma opção para cada um dos {total} conflitos."
                    )
                content = result.render(resolutions)  # type: ignore[arg-type]
                how = f" Conflitos resolvidos por {user.username} ({total})" + '.'

        self.storage.put_text(self._base_key(review), self.storage.get_content(review["page_id"]))
        update = PageUpdate(
            **review.get("fields", {}),
            content=content,
            version=page.get("version"),
            note=f"Revisão #{review['number']}: {review['title']}"[:200],
        )
        saved = self.docs.update_page(review["page_id"], update, review["author"], via_review=True)
        review["status"] = "merged"
        review["merged_version"] = saved["version"]
        self._save(review, _event("merged", user.username, f"Aplicada como v{saved['version']}.{how}"))
        return self._decorate(review)

    def close(self, review_id: str, user: User) -> dict:
        review = self._get(review_id)
        if user.role != "admin" and review["author"] != user.username:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Só o autor ou um administrador pode fechar a proposta.")
        if review["status"] not in ACTIVE:
            raise HTTPException(status.HTTP_409_CONFLICT, "Esta proposta já foi encerrada.")
        review["status"] = "closed"
        return self._decorate(self._save(review, _event("closed", user.username)))
