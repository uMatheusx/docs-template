"""Versões das páginas no formato x.y.z (versionamento semântico).

Por dentro, cada gravação continua tendo um número de revisão inteiro (controle de edições simultâneas e
mesclagem); a versão x.y.z é o que as pessoas veem e escolhem:

- patch (x.y.Z): correção, ajuste de texto, link, formatação;
- minor (x.Y.0): conteúdo novo que não invalida o que já existia;
- major (X.0.0): reescrita ou mudança que quebra quem seguia a versão anterior.

Páginas nascem em 0.1.0 (rascunho); a primeira publicação vira 1.0.0.
"""

from __future__ import annotations

import re
from typing import Literal

Bump = Literal["patch", "minor", "major"]
BUMPS: tuple[Bump, ...] = ("patch", "minor", "major")
SEMVER_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")

DRAFT_START = "0.1.0"
FIRST_RELEASE = "1.0.0"


def parse(version: str) -> tuple[int, int, int]:
    match = SEMVER_RE.match(version or "")
    if not match:
        raise ValueError(f"Versão inválida: {version!r}")
    major, minor, patch = (int(g) for g in match.groups())
    return major, minor, patch


def is_valid(version: str | None) -> bool:
    return bool(version and SEMVER_RE.match(version))


def is_greater(candidate: str, current: str) -> bool:
    """candidate > current, comparando número a número (1.10.0 > 1.9.0)."""
    return parse(candidate) > parse(current)


def legacy_semver(revision: int) -> str:
    """Versão de quem foi gravado antes do x.y.z: a revisão n vira 1.0.(n-1)."""
    return f"1.0.{max(int(revision), 1) - 1}"


def bump_semver(current: str, kind: Bump = "patch", *, publishing: bool = False) -> str:
    """Próxima versão. A primeira publicação de uma página ainda 0.x vira 1.0.0, qualquer que seja o tipo."""
    major, minor, patch = parse(current)
    if publishing and major == 0:
        return FIRST_RELEASE
    if kind == "major":
        return f"{major + 1}.0.0"
    if kind == "minor":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"
