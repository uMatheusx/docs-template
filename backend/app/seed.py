"""Conteúdo inicial de exemplo, criado quando a tabela está vazia (SEED_ON_STARTUP=true)."""

import logging
from pathlib import Path

from .service import DocsService

log = logging.getLogger(__name__)
CONTENT_DIR = Path(__file__).parent / "seed_content"

# (arquivo, arquivo do pai)
MANIFEST: list[tuple[str, str | None]] = [
    ("introducao.md", None),
    ("primeiros-passos.md", None),
    ("instalacao.md", "primeiros-passos.md"),
    ("configuracao.md", "primeiros-passos.md"),
    ("arquitetura.md", None),
    ("guias.md", None),
    ("autenticacao.md", "guias.md"),
    ("contas-e-permissoes.md", "guias.md"),
    ("referencia-api.md", None),
    ("api-rest.yaml", "referencia-api.md"),
    ("eventos.yaml", "referencia-api.md"),
    ("guia-de-escrita.md", None),
    ("faq.md", None),
]


def seed_if_empty(service: DocsService) -> None:
    if service.storage.list_pages():
        return
    log.info("Tabela vazia: criando páginas de exemplo")
    ids: dict[str, str] = {}
    for filename, parent in MANIFEST:
        text = (CONTENT_DIR / filename).read_text(encoding="utf-8")
        page = service.import_file(filename, text, ids.get(parent) if parent else None, "seed")
        ids[filename] = page["id"]
