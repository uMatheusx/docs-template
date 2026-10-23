"""Propostas de revisão: alterações em uma ou várias páginas, revisadas e aplicadas juntas (como um pull request).

Cada página da proposta é um item com o que muda nela (campos e/ou texto) e a versão em que a mudança se baseia.
O texto proposto fica no S3 (reviews/<id>/<page_id>.md); o resto, no item REVIEW do DynamoDB. As páginas só mudam
quando a proposta é aplicada, e aplicar é tudo ou nada: antes de mexer em qualquer página, confere se todas podem
ser aplicadas (conflitos resolvidos, versões escolhidas válidas).
"""

from __future__ import annotations

import uuid

from fastapi import HTTPException, status

from .config import Settings
from .merge3 import MergeResult, merge3
from .schemas import PageUpdate, ReviewInput, ReviewItemInput, ReviewMerge, User
from .semver import bump_semver, is_greater
from .service import DocsService, not_found
from .storage import utcnow
from .tree import build_tree, flatten

ACTIVE = ("open", "approved", "changes_requested")


def _event(type_: str, author: str, body: str = "") -> dict:
    return {"id": uuid.uuid4().hex[:10], "type": type_, "author": author, "body": body, "at": utcnow()}


def _proposal_key(review_id: str, page_id: str) -> str:
    return f"reviews/{review_id}/{page_id}.md"


def _base_key(review_id: str, page_id: str) -> str:
    """Texto da página logo antes de aplicar (mantém o diff legível depois do merge)."""
    return f"reviews/{review_id}/{page_id}.base.md"


def _base_label(item: dict) -> str:
    return item["base_semver"] or f"revisão {item['base_version']}"


def _quoted(titles: list[str]) -> str:
    return ", ".join(f"“{t}”" for t in titles)


class ReviewService:
    def __init__(self, docs: DocsService, settings: Settings) -> None:
        self.docs = docs
        self.storage = docs.storage
        self.settings = settings

    # ------------------------------------------------------------------ helpers
    def _pages_by_id(self) -> dict[str, dict]:
        tree = build_tree(self.storage.list_pages(), include_drafts=True)
        return {node["id"]: node for node, _ in flatten(tree)}

    def _decorate(self, review: dict, pages: dict[str, dict] | None = None) -> dict:
        pages = self._pages_by_id() if pages is None else pages
        items = []
        for item in review["items"]:
            page = pages.get(item["page_id"], {})
            items.append(
                {
                    **item,
                    "page_title": page.get("title", "(página removida)"),
                    "page_path": page.get("path", ""),
                    "page_published": page.get("published", True),
                }
            )
        return {**review, "items": items}

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
        return self._decorate(review)

    def _merge_with_page(self, item: dict, page: dict, current: str, proposed: str) -> MergeResult | None:
        """Mescla o texto proposto com o atual. None se a versão-base não foi encontrada."""
        base = self.storage.content_at_version(page["id"], item["base_version"], page=page)
        return None if base is None else merge3(base, current, proposed)

    @staticmethod
    def _semver_plan(item: dict, page: dict | None) -> dict:
        """Versão recomendada pelo tamanho da mudança, a que valerá agora e se a escolhida à mão perdeu a validade."""
        if not page:
            return {"recommended": "", "effective": "", "outdated": False}
        publishing = bool(item["fields"].get("published")) and not page.get("published", True)
        recommended = bump_semver(page["semver"], item["bump"], publishing=publishing)
        custom = item.get("semver")
        if custom and is_greater(custom, page["semver"]):
            return {"recommended": recommended, "effective": custom, "outdated": False}
        return {"recommended": recommended, "effective": recommended, "outdated": bool(custom)}

    def _merge_info(
        self, review: dict, item: dict, page: dict | None, current: str, proposed: str | None
    ) -> dict | None:
        if not page or review["status"] not in ACTIVE or proposed is None:
            return None
        info = {
            "base_version": item["base_version"],
            "current_version": page["version"],
            "base_semver": item["base_semver"],
            "current_semver": page["semver"],
        }
        if page["version"] == item["base_version"]:
            return {**info, "state": "current"}
        result = self._merge_with_page(item, page, current, proposed)
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

    def _item_detail(self, review: dict, item: dict) -> dict:
        page = self.storage.get_page(item["page_id"])
        current = self.storage.get_content(page) if page else ""
        proposed = self.storage.get_text(_proposal_key(review["id"], item["page_id"])) if item["has_content"] else None
        merge = self._merge_info(review, item, page, current, proposed)
        if review["status"] == "merged":
            current = self.storage.get_text(_base_key(review["id"], item["page_id"])) or current
        plan = self._semver_plan(item, page)
        return {
            "proposed_content": proposed if proposed is not None else current,
            "current_content": current,
            "current_version": (page or {}).get("version", 0),
            "current_semver": (page or {}).get("semver", ""),
            "next_semver": plan["effective"],
            "recommended_semver": plan["recommended"],
            "semver_outdated": plan["outdated"],
            "page_kind": (page or {}).get("kind", "doc"),
            "merge": merge,
        }

    # ------------------------------------------------------------------ leitura
    def list(self, state: str = "active", page_id: str | None = None) -> list[dict]:
        reviews = self.storage.list_reviews()
        if page_id:
            reviews = [r for r in reviews if any(i["page_id"] == page_id for i in r["items"])]
        if state == "active":
            reviews = [r for r in reviews if r["status"] in ACTIVE]
        elif state == "done":
            reviews = [r for r in reviews if r["status"] not in ACTIVE]
        pages = self._pages_by_id()
        return sorted((self._decorate(r, pages) for r in reviews), key=lambda r: r["updated_at"], reverse=True)

    def detail(self, review_id: str) -> dict:
        review = self._get(review_id)
        decorated = self._decorate(review)
        items = [
            {**shown, **self._item_detail(review, item)}
            for shown, item in zip(decorated["items"], review["items"], strict=True)
        ]
        return {**decorated, "items": items}

    # ------------------------------------------------------------------ escrita
    def _item(self, data: ReviewItemInput, page: dict) -> dict:
        # sem a versão x.y.z informada, a base é a atual (se coincide)
        base_semver = data.base_semver or (page["semver"] if page["version"] == data.base_version else "")
        return {
            "page_id": data.page_id,
            "base_version": data.base_version,
            "base_semver": base_semver,
            "bump": data.bump,
            "semver": data.semver,
            "fields": data.fields.model_dump(exclude_none=True),
            "has_content": data.content is not None,
            "merged_version": None,
            "merged_semver": None,
        }

    def submit(self, data: ReviewInput, user: User) -> dict:
        """Cria uma proposta — ou, se as páginas já estão numa proposta ativa do mesmo autor, atualiza essa."""
        ids = [i.page_id for i in data.items]
        if len(set(ids)) != len(ids):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cada página só pode aparecer uma vez na proposta.")
        items = []
        for entry in data.items:  # confere tudo antes de gravar qualquer coisa
            page = self.storage.get_page(entry.page_id)
            if not page:
                raise not_found()
            if entry.content is None and not entry.fields.model_dump(exclude_none=True):
                raise HTTPException(status.HTTP_400_BAD_REQUEST, f"A proposta não altera nada em “{page['title']}”.")
            if entry.semver and not is_greater(entry.semver, page["semver"]):
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST, f"A versão precisa ser maior que a atual ({page['semver']})."
                )
            items.append(self._item(entry, page))

        owners = {
            item["page_id"]: review
            for review in self.storage.list_reviews()
            if review["author"] == user.username and review["status"] in ACTIVE
            for item in review["items"]
        }
        claimed = {owners[p]["id"]: owners[p] for p in ids if p in owners}
        if len(claimed) > 1 or (claimed and any(p not in owners for p in ids)):
            numbers = ", ".join(f"#{r['number']}" for r in claimed.values())
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Parte destas páginas já está na sua proposta {numbers}: envie as alterações delas por lá, "
                "separadas das demais.",
            )

        now = utcnow()
        if claimed:
            review = next(iter(claimed.values()))
            whole = set(ids) == {i["page_id"] for i in review["items"]}
            if whole:  # reenviou a proposta inteira: o resumo também vale
                review.update(title=data.title, description=data.description)
            by_page = {i["page_id"]: i for i in items}
            review["items"] = [by_page.get(i["page_id"], i) for i in review["items"]]
            review["status"] = "open"
            event = _event("updated", user.username, "Atualizou a proposta.")
        else:
            review = {
                "id": f"rev_{uuid.uuid4().hex[:12]}",
                "number": self.storage.next_number("reviews"),
                "title": data.title,
                "description": data.description,
                "status": "open",
                "author": user.username,
                "created_at": now,
                "updated_at": now,
                "items": items,
                "events": [],
            }
            event = _event("created", user.username, data.description)
        for entry in data.items:
            if entry.content is not None:
                self.storage.put_text(_proposal_key(review["id"], entry.page_id), entry.content)
        return self._save(review, event)

    def comment(self, review_id: str, body: str, user: User) -> dict:
        review = self._get(review_id)
        return self._save(review, _event("comment", user.username, body.strip()))

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
        return self._save(review, _event("approved", user.username, body.strip()))

    def request_changes(self, review_id: str, body: str, user: User) -> dict:
        review = self._get(review_id)
        self._require_reviewer(review, user)
        if not body.strip():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Explique o que precisa mudar.")
        review["status"] = "changes_requested"
        return self._save(review, _event("changes_requested", user.username, body.strip()))

    def merge(self, review_id: str, user: User, options: ReviewMerge | None = None) -> dict:
        """Aplica todas as páginas, ou nenhuma: se alguma não puder ser aplicada agora, explica qual e por quê."""
        options = options or ReviewMerge()
        review = self._get(review_id)
        if user.role != "admin":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Apenas administradores aplicam propostas.")
        if review["status"] != "approved":
            raise HTTPException(status.HTTP_409_CONFLICT, "A proposta precisa ser aprovada antes de ser aplicada.")

        # 1. prepara cada página sem gravar nada
        plans, unavailable, conflicting = [], [], []
        for item in review["items"]:
            page = self.storage.get_page(item["page_id"])
            if not page:
                raise not_found()
            current = self.storage.get_content(page)
            content = self.storage.get_text(_proposal_key(review["id"], page["id"])) if item["has_content"] else None
            how = ""
            if content is not None and page["version"] != item["base_version"] and not options.force:
                # a página mudou depois da proposta: combina as duas mudanças em vez de sobrescrever
                result = self._merge_with_page(item, page, current, content)
                if result is None:
                    unavailable.append(page["title"])
                elif result.clean:
                    content = result.render()
                    how = f"Combinada automaticamente com as mudanças feitas na página desde a {_base_label(item)}."
                else:
                    total = len(result.conflicts)
                    choices = (options.resolutions or {}).get(page["id"])
                    if choices is None:
                        conflicting.append(f"“{page['title']}” ({total})")
                    elif len(choices) != total:
                        raise HTTPException(
                            status.HTTP_400_BAD_REQUEST,
                            f"Escolha uma opção para cada um dos {total} conflitos de “{page['title']}”.",
                        )
                    else:
                        content = result.render(choices)
                        how = f"Conflitos resolvidos por {user.username} ({total})."
            chosen = (options.semver or {}).get(page["id"])
            if chosen and not is_greater(chosen, page["semver"]):
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST, f"A versão precisa ser maior que a atual ({page['semver']})."
                )
            plans.append((item, page, current, content, how, chosen))
        if unavailable:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Nada foi aplicado. {_quoted(unavailable)} mudou desde a proposta e não foi possível combinar as "
                "mudanças. Peça ao autor para atualizar ou aplique mesmo assim.",
            )
        if conflicting:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Nada foi aplicado. A página e a proposta mudaram os mesmos trechos em {', '.join(conflicting)}: "
                "escolha uma opção para cada um.",
            )

        # 2. aplica
        applied = []
        for item, page, current, content, how, chosen in plans:
            self.storage.put_text(_base_key(review["id"], page["id"]), current)
            update = PageUpdate(
                **item["fields"],
                content=content,
                version=page["version"],
                note=f"Revisão #{review['number']}: {review['title']}"[:200],
            )
            # a versão que quem aplica escolheu vale sempre; sem ela, vale a da proposta se ainda for maior que a da
            # página, senão a recomendada pelo tamanho da mudança
            plan = self._semver_plan(item, page)
            chosen = chosen or (plan["effective"] if item.get("semver") and not plan["outdated"] else None)
            saved = self.docs.update_page(
                page["id"], update, review["author"], via_review=True, bump=item["bump"], semver=chosen
            )
            item["merged_version"] = saved["version"]
            item["merged_semver"] = saved["semver"]
            applied.append((page["title"], saved["semver"], how))

        review["status"] = "merged"
        if len(applied) == 1:
            _, semver, how = applied[0]
            body = f"Aplicada como {semver}." + (f" {how}" if how else "")
        else:
            body = "Aplicada: " + "; ".join(f"“{t}” como {v}" + (f" ({h})" if h else "") for t, v, h in applied) + "."
        return self._save(review, _event("merged", user.username, body))

    def close(self, review_id: str, user: User) -> dict:
        review = self._get(review_id)
        if user.role != "admin" and review["author"] != user.username:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Só o autor ou um administrador pode fechar a proposta.")
        if review["status"] not in ACTIVE:
            raise HTTPException(status.HTTP_409_CONFLICT, "Esta proposta já foi encerrada.")
        review["status"] = "closed"
        return self._save(review, _event("closed", user.username))
