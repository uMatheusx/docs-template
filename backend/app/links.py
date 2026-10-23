"""Verificação de links internos e imagens quebrados em todas as páginas."""

from __future__ import annotations

import re
from urllib.parse import unquote

from .storage import Storage, utcnow
from .tree import build_tree, flatten

LINK_RE = re.compile(r"(!?)\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\s*\)")
FENCE_RE = re.compile(r"^(```|~~~).*?^\1\s*$", re.M | re.S)
# referência de API incorporada: ```openapi / ```asyncapi com `ref: /docs/...`
EMBED_RE = re.compile(r"^(```|~~~)(openapi|asyncapi)[^\n]*\n(.*?)^\1\s*$", re.M | re.S)
REF_RE = re.compile(r"^\s*ref:\s*[\"']?([^\s\"'#]+)", re.M)


def _blank_fences(text: str) -> str:
    """Remove blocos de código mantendo as quebras de linha (para numerar as linhas certo)."""
    return FENCE_RE.sub(lambda m: "\n" * m.group(0).count("\n"), text)


def link_report(storage: Storage) -> dict:
    pages = storage.list_pages()
    nodes = [node for node, _ in flatten(build_tree(pages, include_drafts=True))]
    by_path = {n["path"]: n for n in nodes}
    asset_keys = {a["key"] for a in storage.list_assets()}
    issues: list[dict] = []
    checked = 0

    for node in nodes:
        if node.get("kind", "doc") != "doc":
            continue
        checked += 1
        raw = storage.get_content(node)
        for embed in EMBED_RE.finditer(raw):
            ref = REF_RE.search(embed.group(3))
            if not ref:
                continue
            target = ref.group(1)
            path = unquote(target.removeprefix("/docs").split("?", 1)[0]).strip("/")
            dest = by_path.get(path)
            issue = {
                "page_id": node["id"],
                "page_title": node["title"],
                "page_path": node["path"],
                "target": target,
                "text": f"Referência {embed.group(2)}",
                "line": raw.count("\n", 0, embed.start(3) + ref.start(1)) + 1,
            }
            if dest is None or dest.get("kind", "doc") != embed.group(2):
                issues.append({**issue, "kind": "broken_link"})
            elif node.get("published", True) and not dest.get("published", True):
                issues.append({**issue, "kind": "draft_link"})
        text = _blank_fences(raw)
        for match in LINK_RE.finditer(text):
            is_image, label, target = match.group(1) == "!", match.group(2), match.group(3)
            issue = {
                "page_id": node["id"],
                "page_title": node["title"],
                "page_path": node["path"],
                "target": target,
                "text": label[:120],
                "line": text.count("\n", 0, match.start()) + 1,
            }
            if target.startswith("/docs"):
                path = unquote(target[len("/docs") :].split("#", 1)[0].split("?", 1)[0]).strip("/")
                if path.startswith("v/"):  # links antigos de releases redirecionam para a versão atual
                    continue
                if not path:
                    continue
                dest = by_path.get(path)
                if dest is None:
                    issues.append({**issue, "kind": "broken_link"})
                elif node.get("published", True) and not dest.get("published", True):
                    issues.append({**issue, "kind": "draft_link"})
            elif target.startswith("/api/assets/"):
                key = "assets/" + unquote(target[len("/api/assets/") :].split("?", 1)[0])
                if key not in asset_keys:
                    issues.append({**issue, "kind": "broken_image" if is_image else "broken_asset"})

    return {"checked_at": utcnow(), "pages_checked": checked, "issues": issues}
