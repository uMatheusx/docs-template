"""Pacotes de revisão: várias propostas, de páginas diferentes, revisadas e aplicadas juntas (como um pull request).

Cada página do pacote é uma proposta comum (com seu diff, mesclagem e conflitos); o pacote guarda o título, a
descrição e a conversa em comum, e as ações (aprovar, pedir alterações, aplicar, fechar) valem para todas de uma vez.
Aplicar é tudo ou nada: antes de mexer em qualquer página, confere se todas podem ser aplicadas.
"""

from __future__ import annotations

import uuid

from fastapi import HTTPException, status

from .reviews import ACTIVE, ReviewService, _event
from .schemas import BatchInput, ReviewInput, User
from .service import not_found
from .storage import utcnow


class BatchService:
    def __init__(self, reviews: ReviewService) -> None:
        self.reviews = reviews
        self.storage = reviews.storage

    # ------------------------------------------------------------------ helpers
    def _get(self, batch_id: str) -> dict:
        batch = self.storage.get_batch(batch_id)
        if not batch:
            raise not_found("Pacote")
        return batch

    def _children(self, batch: dict) -> list[dict]:
        found = (self.storage.get_review(rid) for rid in batch["review_ids"])
        return [r for r in found if r and r.get("batch_id") == batch["id"]]

    @staticmethod
    def _status(children: list[dict]) -> str:
        active = [c for c in children if c["status"] in ACTIVE]
        if not active:
            return "merged" if any(c["status"] == "merged" for c in children) else "closed"
        if any(c["status"] == "changes_requested" for c in active):
            return "changes_requested"
        return "approved" if all(c["status"] == "approved" for c in active) else "open"

    def _save(self, batch: dict, event: dict | None = None) -> dict:
        if event:
            batch["events"] = [*batch.get("events", []), event]
        batch["updated_at"] = utcnow()
        self.storage.put_batch(batch)
        return batch

    def _summary(self, batch: dict, children: list[dict] | None = None) -> dict:
        children = self._children(batch) if children is None else children
        pages = self.reviews._pages_by_id()
        return {
            **batch,
            "status": self._status(children),
            "pages": [
                {
                    "review_id": c["id"],
                    "page_id": c["page_id"],
                    "page_title": pages.get(c["page_id"], {}).get("title", "(página removida)"),
                    "page_path": pages.get(c["page_id"], {}).get("path", ""),
                    "status": c["status"],
                }
                for c in children
            ],
        }

    def _active_children(self, batch: dict) -> list[dict]:
        active = [c for c in self._children(batch) if c["status"] in ACTIVE]
        if not active:
            raise HTTPException(status.HTTP_409_CONFLICT, "Este pacote já foi encerrado.")
        return active

    # ------------------------------------------------------------------ leitura
    def list(self, state: str = "active") -> list[dict]:
        out = []
        for batch in self.storage.list_batches():
            children = self._children(batch)
            if not children:
                continue
            summary = self._summary(batch, children)
            is_active = summary["status"] in ACTIVE
            if state == "all" or (state == "active") == is_active:
                out.append(summary)
        return sorted(out, key=lambda b: b["updated_at"], reverse=True)

    def detail(self, batch_id: str) -> dict:
        batch = self._get(batch_id)
        children = self._children(batch)
        if not children:
            raise not_found("Pacote")
        return {**self._summary(batch, children), "reviews": [self.reviews.detail(c["id"]) for c in children]}

    # ------------------------------------------------------------------ escrita
    def create(self, data: BatchInput, user: User) -> dict:
        page_ids = [i.page_id for i in data.items]
        if len(set(page_ids)) != len(page_ids):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cada página só pode aparecer uma vez no pacote.")
        for item in data.items:  # confere tudo antes de criar qualquer proposta
            if not self.storage.get_page(item.page_id):
                raise not_found()
            if item.content is None and not item.fields.model_dump(exclude_none=True):
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Uma das páginas do pacote não altera nada.")
        number = self.storage.next_number("reviews")
        batch_id = f"bat_{uuid.uuid4().hex[:12]}"
        review_ids = []
        for item in data.items:
            review = self.reviews.submit(
                item.page_id,
                ReviewInput(
                    title=data.title,
                    description=data.description,
                    content=item.content,
                    fields=item.fields,
                    base_version=item.base_version,
                    base_semver=item.base_semver,
                    bump=item.bump,
                ),
                user,
                number=number,
                batch_id=batch_id,
            )
            review_ids.append(review["id"])
        now = utcnow()
        batch = {
            "id": batch_id,
            "number": number,
            "title": data.title,
            "description": data.description,
            "author": user.username,
            "created_at": now,
            "updated_at": now,
            "review_ids": review_ids,
            "events": [],
        }
        return self._summary(self._save(batch, _event("created", user.username, data.description)))

    def comment(self, batch_id: str, body: str, user: User) -> dict:
        batch = self._get(batch_id)
        return self._summary(self._save(batch, _event("comment", user.username, body.strip())))

    def approve(self, batch_id: str, body: str, user: User) -> dict:
        batch = self._get(batch_id)
        for child in self._active_children(batch):
            self.reviews.approve(child["id"], body, user)
        return self._summary(self._save(batch, _event("approved", user.username, body.strip())))

    def request_changes(self, batch_id: str, body: str, user: User) -> dict:
        batch = self._get(batch_id)
        if not body.strip():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Explique o que precisa mudar.")
        for child in self._active_children(batch):
            self.reviews.request_changes(child["id"], body, user)
        return self._summary(self._save(batch, _event("changes_requested", user.username, body.strip())))

    def close(self, batch_id: str, user: User) -> dict:
        batch = self._get(batch_id)
        for child in self._active_children(batch):
            self.reviews.close(child["id"], user)
        return self._summary(self._save(batch, _event("closed", user.username)))

    def merge(self, batch_id: str, user: User) -> dict:
        """Aplica todas as páginas, ou nenhuma: se alguma não puder ser aplicada agora, explica qual e por quê."""
        batch = self._get(batch_id)
        if user.role != "admin":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Apenas administradores aplicam propostas.")
        active = self._active_children(batch)
        pages = self.reviews._pages_by_id()

        def title(child: dict) -> str:
            return f"“{pages.get(child['page_id'], {}).get('title', child['page_id'])}”"

        waiting = [title(c) for c in active if c["status"] != "approved"]
        if waiting:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Aprove o pacote antes de aplicar (ainda sem aprovação: {', '.join(waiting)}).",
            )
        blocked = []
        for child in active:
            page = self.storage.get_page(child["page_id"])
            info = self.reviews._merge_info(child, page)
            if info and info["state"] in ("conflicts", "unavailable"):
                blocked.append(title(child))
        if blocked:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Nada foi aplicado. A página mudou desde a proposta e as mudanças não se combinam sozinhas em: "
                f"{', '.join(blocked)}. Abra a proposta dessa página para resolver os conflitos.",
            )
        versions = []
        for child in active:
            merged = self.reviews.merge(child["id"], user)
            versions.append(f"{title(child)} {merged['merged_semver']}")
        return self._summary(
            self._save(batch, _event("merged", user.username, "Aplicado: " + ", ".join(versions) + "."))
        )
