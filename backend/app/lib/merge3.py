"""Mesclagem de três vias de texto, por linhas (como o `git merge`).

Recebe o texto-base (a versão em que a proposta se baseou), o texto atual da página ("ours") e o texto
proposto ("theirs"). Trechos que só um dos lados mudou entram sozinhos; trechos que os dois mudaram de
formas diferentes viram conflitos, que quem revisa resolve um a um.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Literal

Choice = Literal["ours", "theirs", "both"]
CONTEXT_LINES = 2


@dataclass
class Conflict:
    base: list[str]
    ours: list[str]
    theirs: list[str]
    before: list[str] = field(default_factory=list)
    after: list[str] = field(default_factory=list)


@dataclass
class MergeResult:
    # cada parte é uma lista de linhas (texto estável) ou um Conflict
    parts: list[list[str] | Conflict]

    @property
    def conflicts(self) -> list[Conflict]:
        return [p for p in self.parts if isinstance(p, Conflict)]

    @property
    def clean(self) -> bool:
        return not self.conflicts

    def render(self, resolutions: list[Choice] | None = None) -> str:
        """Texto final. Com conflitos, exige uma escolha por conflito (na ordem em que aparecem)."""
        conflicts = self.conflicts
        if conflicts and (resolutions is None or len(resolutions) != len(conflicts)):
            raise ValueError("É preciso escolher uma opção para cada conflito.")
        chosen = iter(resolutions or [])
        out: list[str] = []
        for part in self.parts:
            if isinstance(part, Conflict):
                choice = next(chosen)
                if choice == "ours":
                    out += part.ours
                elif choice == "theirs":
                    out += part.theirs
                elif choice == "both":
                    out += _both(part.ours, part.theirs)
                else:
                    raise ValueError(f"Opção inválida: {choice}")
            else:
                out += part
        return "".join(out)


def _both(ours: list[str], theirs: list[str]) -> list[str]:
    """Os dois trechos, um depois do outro (garante quebra de linha entre eles)."""
    if ours and not ours[-1].endswith("\n"):
        ours = [*ours[:-1], ours[-1] + "\n"]
    return [*ours, *theirs]


def _lines(text: str) -> list[str]:
    return text.splitlines(keepends=True)


def _matching(base: list[str], other: list[str]) -> list[tuple[int, int, int]]:
    blocks = SequenceMatcher(None, base, other, autojunk=False).get_matching_blocks()
    return [(b.a, b.b, b.size) for b in blocks if b.size]


def _sync_regions(base: list[str], ours: list[str], theirs: list[str]):
    """Trechos do texto-base que continuam iguais nos dois lados: (início_base, início_ours, início_theirs, tamanho)."""
    ma, mb = _matching(base, ours), _matching(base, theirs)
    ia = ib = 0
    while ia < len(ma) and ib < len(mb):
        a_base, a_match, a_len = ma[ia]
        b_base, b_match, b_len = mb[ib]
        start, end = max(a_base, b_base), min(a_base + a_len, b_base + b_len)
        if start < end:
            yield start, a_match + (start - a_base), b_match + (start - b_base), end - start
        if a_base + a_len < b_base + b_len:
            ia += 1
        else:
            ib += 1
    yield len(base), len(ours), len(theirs), 0


def merge3(base: str, ours: str, theirs: str) -> MergeResult:
    b, o, t = _lines(base), _lines(ours), _lines(theirs)
    parts: list[list[str] | Conflict] = []
    zb = zo = zt = 0
    for ib, io, it, size in _sync_regions(b, o, t):
        chunk_b, chunk_o, chunk_t = b[zb:ib], o[zo:io], t[zt:it]
        if chunk_o != chunk_b or chunk_t != chunk_b:  # região instável: alguém mexeu aqui
            if chunk_o == chunk_t:
                parts.append(chunk_o)  # os dois fizeram a mesma mudança
            elif chunk_o == chunk_b:
                parts.append(chunk_t)  # só a proposta mudou
            elif chunk_t == chunk_b:
                parts.append(chunk_o)  # só a página mudou
            else:
                parts.append(Conflict(base=chunk_b, ours=chunk_o, theirs=chunk_t))
        elif chunk_b:
            parts.append(chunk_b)
        if size:
            parts.append(b[ib : ib + size])
        zb, zo, zt = ib + size, io + size, it + size

    # contexto de cada conflito (linhas estáveis vizinhas), para mostrar onde ele está
    for i, part in enumerate(parts):
        if isinstance(part, Conflict):
            prev = parts[i - 1] if i > 0 and not isinstance(parts[i - 1], Conflict) else []
            nxt = parts[i + 1] if i + 1 < len(parts) and not isinstance(parts[i + 1], Conflict) else []
            part.before = list(prev[-CONTEXT_LINES:]) if isinstance(prev, list) else []
            part.after = list(nxt[:CONTEXT_LINES]) if isinstance(nxt, list) else []
    return MergeResult(_coalesce(parts))


def _coalesce(parts: list[list[str] | Conflict]) -> list[list[str] | Conflict]:
    """Junta trechos estáveis vizinhos (o contexto já foi extraído)."""
    out: list[list[str] | Conflict] = []
    for part in parts:
        if isinstance(part, list) and out and isinstance(out[-1], list):
            out[-1] = out[-1] + part
        elif part or isinstance(part, Conflict):
            out.append(part)
    return out
