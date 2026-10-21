"""Monta a árvore de documentação a partir da lista plana de páginas."""

from collections import defaultdict
from collections.abc import Iterator


def sort_key(page: dict) -> tuple:
    return (page.get("order", 0), page.get("title", "").lower())


def build_tree(pages: list[dict], *, include_drafts: bool) -> list[dict]:
    ids = {p["id"] for p in pages}
    by_parent: dict[str | None, list[dict]] = defaultdict(list)
    for page in pages:
        if not include_drafts and not page.get("published", True):
            continue
        parent = page.get("parent_id")
        by_parent[parent if parent in ids else None].append(page)

    def walk(parent_id: str | None, parent_path: str) -> list[dict]:
        nodes = []
        for page in sorted(by_parent.get(parent_id, []), key=sort_key):
            path = f"{parent_path}/{page['slug']}" if parent_path else page["slug"]
            node = {k: v for k, v in page.items() if k != "search_text"}
            node["path"] = path
            node["children"] = walk(page["id"], path)
            nodes.append(node)
        return nodes

    return walk(None, "")


def flatten(tree: list[dict], ancestors: tuple[dict, ...] = ()) -> Iterator[tuple[dict, tuple[dict, ...]]]:
    """Percorre a árvore em ordem de leitura, devolvendo (nó, ancestrais)."""
    for node in tree:
        yield node, ancestors
        yield from flatten(node["children"], (*ancestors, node))


def descendants(pages: list[dict], page_id: str) -> list[str]:
    children: dict[str | None, list[str]] = defaultdict(list)
    for page in pages:
        children[page.get("parent_id")].append(page["id"])
    result, stack = [], [page_id]
    while stack:
        current = stack.pop()
        result.append(current)
        stack.extend(children.get(current, []))
    return result
