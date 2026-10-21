"""Regras de negócio da documentação: árvore, CRUD, movimentação, busca e importação."""

from __future__ import annotations

import re
import uuid

import httpx
from fastapi import HTTPException, status

from .markdown_utils import first_heading, fold, parse_frontmatter, slugify, to_search_text
from .schemas import PageCreate, PageUpdate
from .specs import detect_kind, parse_spec, spec_info
from .storage import Storage, VersionConflict, utcnow
from .tree import build_tree, descendants, flatten, sort_key


def not_found(what: str = "Página") -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, f"{what} não encontrada")


def _strip(node: dict) -> dict:
    return {k: v for k, v in node.items() if k not in ("children", "search_text")}


class DocsService:
    def __init__(self, storage: Storage) -> None:
        self.storage = storage

    # ------------------------------------------------------------------ leitura
    def tree(self, *, include_drafts: bool) -> list[dict]:
        return build_tree(self.storage.list_pages(), include_drafts=include_drafts)

    def _find(self, *, include_drafts: bool, page_id: str | None = None, path: str | None = None) -> dict:
        for node, ancestors in flatten(self.tree(include_drafts=include_drafts)):
            if (page_id and node["id"] == page_id) or (path is not None and node["path"] == path):
                page = _strip(node)
                page["breadcrumbs"] = [{"id": a["id"], "title": a["title"], "path": a["path"]} for a in ancestors]
                return page
        raise not_found()

    def get_page(self, page_id: str, *, include_drafts: bool) -> dict:
        page = self._find(page_id=page_id, include_drafts=include_drafts)
        page["content"] = self.storage.get_content(page_id)
        return page

    def get_page_by_path(self, path: str, *, include_drafts: bool) -> dict:
        page = self._find(path=path.strip("/"), include_drafts=include_drafts)
        page["content"] = self.storage.get_content(page["id"])
        return page

    def get_page_meta(self, path: str) -> dict:
        """Metadados de uma página publicada, sem ler o conteúdo no S3."""
        return self._find(path=path.strip("/"), include_drafts=False)

    def resolve_redirect(self, path: str, *, include_drafts: bool) -> str:
        """Endereço atual de uma página que já esteve em `path` (renomeada ou movida)."""
        page_id = self.storage.get_redirect(path.strip("/"))
        if not page_id:
            raise not_found()
        return self._find(page_id=page_id, include_drafts=include_drafts)["path"]

    def _paths(self) -> dict[str, str]:
        return {node["id"]: node["path"] for node, _ in flatten(self.tree(include_drafts=True))}

    def _remember_moved(self, before: dict[str, str]) -> None:
        """Grava um redirecionamento para cada página (e subpágina) cujo endereço mudou."""
        after = self._paths()
        for page_id, old_path in before.items():
            if after.get(page_id) not in (None, old_path):
                self.storage.put_redirect(old_path, page_id)

    def search(self, query: str, *, include_drafts: bool, limit: int = 20) -> list[dict]:
        # sem acentos dos dois lados: "autenticacao" encontra "Autenticação"
        terms = [t for t in re.split(r"\s+", fold(query).strip()) if t]
        if not terms:
            return []
        visible = {node["id"]: node for node, _ in flatten(self.tree(include_drafts=include_drafts))}
        results = []
        for page in self.storage.search_documents(_search_document):
            node = visible.get(page["id"])
            if not node:
                continue
            title = page["title_folded"]
            description = page["description_folded"]
            text = page["text"]
            lower = page["text_folded"]
            score = 0.0
            for term in terms:
                hits = lower.count(term)
                if term not in title and term not in description and not hits:
                    break
                score += 12 if title.startswith(term) else 8 if term in title else 0
                score += 4 if term in description else 0
                score += min(hits, 10) * 0.5
            else:
                results.append(
                    {
                        "id": page["id"],
                        "title": page["title"],
                        "path": node["path"],
                        "description": page.get("description", ""),
                        "snippet": _snippet(text, lower, terms),
                        "score": score,
                    }
                )
        results.sort(key=lambda r: r["score"], reverse=True)
        return results[:limit]

    def stats(self) -> dict:
        pages = self.storage.list_pages()
        paths = {node["id"]: node["path"] for node, _ in flatten(build_tree(pages, include_drafts=True))}
        recent = sorted(pages, key=lambda p: p.get("updated_at", ""), reverse=True)[:8]
        published = sum(1 for p in pages if p.get("published", True))
        return {
            "total": len(pages),
            "published": published,
            "drafts": len(pages) - published,
            "assets": sum(1 for _ in self.storage.list_assets()),
            "open_reviews": sum(
                1 for r in self.storage.list_reviews() if r["status"] in ("open", "approved", "changes_requested")
            ),
            "recent": [{**p, "path": paths.get(p["id"], p["slug"])} for p in recent],
        }

    # ------------------------------------------------------------------ escrita
    def create_page(self, data: PageCreate, author: str, *, internal: bool = False) -> dict:
        if not internal:
            # ninguém publica ao criar: a publicação passa por revisão (internal = carga inicial de exemplo)
            data = data.model_copy(update={"published": False})
        pages = self.storage.list_pages()
        if data.parent_id and not any(p["id"] == data.parent_id for p in pages):
            raise not_found("Página pai")
        siblings = [p for p in pages if p.get("parent_id") == data.parent_id]
        now = utcnow()
        page_id = uuid.uuid4().hex[:12]
        content = (
            data.content if data.content is not None else f"# {data.title}\n\nEscreva aqui o conteúdo da página.\n"
        )
        item = {
            "id": page_id,
            "title": data.title.strip(),
            "slug": _unique_slug(data.slug or data.title, siblings),
            "parent_id": data.parent_id,
            "order": max((p.get("order", 0) for p in siblings), default=-1) + 1,
            "icon": data.icon or None,
            "description": data.description,
            "published": data.published,
            "created_at": now,
            "updated_at": now,
            "updated_by": author,
            "version": 1,
            "note": "Página criada",
            "kind": data.kind,
            "search_text": to_search_text(content),
        }
        self.storage.put_content(page_id, content, author, version=1, note="Página criada", archive=False)
        self.storage.put_page(item)
        return self.get_page(page_id, include_drafts=True)

    def update_page(self, page_id: str, data: PageUpdate, author: str, *, via_review: bool = False) -> dict:
        """Salva alterações. Rascunhos mudam direto; páginas publicadas (e a publicação de um rascunho) só
        mudam por uma proposta de revisão aplicada (`via_review=True`), para qualquer papel."""
        current = self.storage.get_page(page_id)
        if not current:
            raise not_found()
        if not via_review:
            if current.get("published", True):
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN,
                    "Esta página está publicada: envie as alterações como proposta de revisão.",
                )
            if data.published:
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN, "Para publicar, envie uma proposta de revisão pedindo a publicação."
                )
        expected = data.version if data.version is not None else current.get("version", 1)
        if expected != current.get("version", 1):
            raise _conflict()

        fields = data.model_dump(exclude_unset=True, exclude={"version", "content"})
        before = self._paths() if "slug" in fields else None
        if fields.get("title"):
            fields["title"] = fields["title"].strip()
        if "slug" in fields:
            siblings = [
                p
                for p in self.storage.list_pages()
                if p.get("parent_id") == current.get("parent_id") and p["id"] != page_id
            ]
            fields["slug"] = _unique_slug(fields["slug"], siblings)
        if data.content is not None:
            fields["search_text"] = to_search_text(data.content)
        # a nota descreve só esta versão: sem nota, a anterior não deve "vazar" para cá
        note = (data.note or "").strip()
        fields.update(updated_at=utcnow(), updated_by=author, version=expected + 1, note=note)

        try:
            self.storage.update_page(page_id, fields, expected_version=expected)
        except VersionConflict:
            raise _conflict() from None
        if data.content is not None:
            self.storage.put_content(page_id, data.content, author, version=expected + 1, note=note)
        if before is not None:
            self._remember_moved(before)
        return self.get_page(page_id, include_drafts=True)

    def move_page(self, page_id: str, parent_id: str | None, index: int, author: str) -> list[dict]:
        pages = self.storage.list_pages()
        by_id = {p["id"]: p for p in pages}
        page = by_id.get(page_id)
        if not page:
            raise not_found()
        if parent_id:
            if parent_id not in by_id:
                raise not_found("Página pai")
            if parent_id in descendants(pages, page_id):
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST, "Não é possível mover uma página para dentro dela mesma"
                )

        siblings = sorted((p for p in pages if p.get("parent_id") == parent_id and p["id"] != page_id), key=sort_key)
        changes: dict[str, dict] = {}
        if page.get("parent_id") != parent_id:
            changes[page_id] = {"parent_id": parent_id, "slug": _unique_slug(page["slug"], siblings)}
        siblings.insert(min(index, len(siblings)), page)
        for order, sibling in enumerate(siblings):
            if sibling.get("order") != order or sibling["id"] == page_id:
                changes.setdefault(sibling["id"], {})["order"] = order
        changes[page_id].update(updated_at=utcnow(), updated_by=author)
        before = self._paths()
        for target_id, fields in changes.items():
            self.storage.update_page(target_id, fields)
        self._remember_moved(before)
        return self.tree(include_drafts=True)

    def delete_page(self, page_id: str) -> int:
        pages = self.storage.list_pages()
        if not any(p["id"] == page_id for p in pages):
            raise not_found()
        ids = descendants(pages, page_id)
        for target in reversed(ids):
            self.storage.delete_reviews_for_page(target)
            self.storage.delete_page(target)
        return len(ids)

    def restore_version(self, page_id: str, version_id: str, author: str) -> dict:
        content = self.storage.get_history(page_id, version_id)
        if content is None:
            raise not_found("Versão")
        page = self.storage.get_page(page_id)
        if page and page.get("published", True):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Esta página está publicada: carregue a versão no editor e envie como proposta de revisão.",
            )
        entry = next((e for e in self.storage.list_history(page_id) if e["id"] == version_id), None)
        label = f"v{entry['version']}" if entry and entry.get("version") else "uma versão anterior"
        return self.update_page(page_id, PageUpdate(content=content, note=f"Restaurada de {label}"), author)

    # ------------------------------------------------------------------ importação
    def import_file(
        self, filename: str, text: str, parent_id: str | None, author: str, *, internal: bool = False
    ) -> dict:
        """Markdown ou especificação OpenAPI/AsyncAPI (YAML/JSON)."""
        kind = detect_kind(text.lstrip("\ufeff"))
        if kind:
            return self.import_spec(filename, text.lstrip("\ufeff"), kind, parent_id, author, internal=internal)
        return self.import_markdown(filename, text, parent_id, author, internal=internal)

    def import_spec(
        self, filename: str, text: str, kind: str, parent_id: str | None, author: str, *, internal: bool = False
    ) -> dict:
        spec = parse_spec(text) or {}
        title, description = spec_info(spec)
        stem = re.sub(r"\.(ya?ml|json)$", "", filename.rsplit("/", 1)[-1], flags=re.I)
        return self.create_page(
            PageCreate(
                title=title,
                slug=slugify(stem) or None,
                parent_id=parent_id,
                icon="Plug" if kind == "openapi" else "Webhook",
                description=description,
                published=True,
                content=text,
                kind=kind,
            ),
            author,
            internal=internal,
        )

    def import_markdown(
        self, filename: str, text: str, parent_id: str | None, author: str, *, internal: bool = False
    ) -> dict:
        meta, body = parse_frontmatter(text.lstrip("﻿"))
        stem = re.sub(r"\.(md|markdown|mdx|txt)$", "", filename.rsplit("/", 1)[-1], flags=re.I)
        title = meta.get("title") or first_heading(body) or stem.replace("-", " ").replace("_", " ").strip().title()
        published = _truthy(meta["published"]) if "published" in meta else not _truthy(meta.get("draft", "false"))
        return self.create_page(
            PageCreate(
                title=title[:200] or "Sem título",
                slug=meta.get("slug") or slugify(stem) or None,
                parent_id=parent_id,
                icon=meta.get("icon"),
                description=meta.get("description", "")[:500],
                published=published,
                content=body.lstrip("\n"),
            ),
            author,
            internal=internal,
        )

    def import_url(self, url: str, parent_id: str | None, author: str, *, internal: bool = False) -> dict:
        url = _raw_github_url(url)
        try:
            with httpx.Client(
                timeout=10, follow_redirects=True, headers={"User-Agent": "AccountHubDocs/1.0"}
            ) as client:
                resp = client.get(url)
                resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Falha ao baixar {url}: {exc}") from exc
        if len(resp.content) > 2 * 1024 * 1024:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Arquivo maior que 2 MB")
        filename = url.split("?", 1)[0].rstrip("/").rsplit("/", 1)[-1] or "importado.md"
        return self.import_file(filename, resp.text, parent_id, author, internal=internal)


def _conflict() -> HTTPException:
    return HTTPException(
        status.HTTP_409_CONFLICT, "A página foi alterada por outra pessoa. Recarregue para ver a versão mais recente."
    )


def _truthy(value: str) -> bool:
    return value.strip().lower() not in ("false", "no", "0", "")


def _unique_slug(value: str, siblings: list[dict]) -> str:
    base = slugify(value)
    taken = {s["slug"] for s in siblings}
    slug, n = base, 2
    while slug in taken:
        slug, n = f"{base}-{n}", n + 1
    return slug


def _raw_github_url(url: str) -> str:
    match = re.match(r"https://github\.com/([^/]+)/([^/]+)/blob/(.+)", url)
    return f"https://raw.githubusercontent.com/{match[1]}/{match[2]}/{match[3]}" if match else url


def _search_document(page: dict) -> dict:
    """Página pronta para a busca: textos originais e versões dobradas (fold), de mesmo comprimento."""
    text = page.get("search_text", "")
    return {
        "id": page["id"],
        "title": page["title"],
        "description": page.get("description", ""),
        "text": text,
        "title_folded": fold(page["title"]),
        "description_folded": fold(page.get("description", "")),
        "text_folded": fold(text),
    }


def _snippet(text: str, lower: str, terms: list[str], radius: int = 90) -> str:
    positions = [lower.find(t) for t in terms if t in lower]
    if not positions:
        return text[: radius * 2] + ("…" if len(text) > radius * 2 else "")
    start = max(min(positions) - radius, 0)
    end = min(start + radius * 2, len(text))
    return ("…" if start else "") + text[start:end].strip() + ("…" if end < len(text) else "")
