import re
import unicodedata
from functools import lru_cache

FRONTMATTER_RE = re.compile(r"\A---\s*\r?\n(.*?)\r?\n---\s*(?:\r?\n|\Z)", re.S)
HEADING_RE = re.compile(r"^#\s+(.+?)\s*#*\s*$", re.M)
FENCE_RE = re.compile(r"^(```|~~~)\s*([\w-]*).*?^\1\s*$", re.M | re.S)


def slugify(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    value = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return value[:80] or "pagina"


@lru_cache(maxsize=4096)
def _fold_char(char: str) -> str:
    decomposed = unicodedata.normalize("NFKD", char.lower())
    return decomposed[0] if decomposed else char


def fold(text: str) -> str:
    """Minúsculas e sem acentos, com o mesmo comprimento do original.

    Cada caractere vira exatamente um, então uma posição encontrada no texto dobrado
    vale também no texto original (usado para montar o trecho dos resultados de busca).
    """
    return "".join(_fold_char(char) for char in text)


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """Front matter YAML simples (`chave: valor`) no topo do arquivo."""
    match = FRONTMATTER_RE.match(text)
    if not match:
        return {}, text
    data: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if ":" not in line or line.lstrip().startswith("#"):
            continue
        key, value = line.split(":", 1)
        data[key.strip().lower()] = value.strip().strip("\"'")
    return data, text[match.end() :]


def first_heading(text: str) -> str | None:
    match = HEADING_RE.search(FENCE_RE.sub("", text))
    return match.group(1).strip() if match else None


def to_search_text(markdown: str, limit: int = 30_000) -> str:
    """Texto puro aproximado para busca (remove sintaxe markdown e diagramas)."""

    def fence(match: re.Match) -> str:
        if match.group(2) == "mermaid":
            return " "
        body = match.group(0).split("\n", 1)[-1]
        return body.rsplit("\n", 1)[0]

    _, text = parse_frontmatter(markdown)
    text = FENCE_RE.sub(fence, text)
    text = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[#>*_`|~]+", " ", text)
    text = re.sub(r"-{3,}", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]
