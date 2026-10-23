"""Especificações OpenAPI / AsyncAPI: detecção e metadados."""

from __future__ import annotations

import re

import yaml


def parse_spec(text: str) -> dict | None:
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError:
        return None
    return data if isinstance(data, dict) else None


def detect_kind(text: str) -> str | None:
    """'openapi' / 'asyncapi' quando o texto é uma especificação; senão None."""
    head = text.lstrip("﻿ \n\r\t{")[:200]
    if not re.match(r"[\"']?(openapi|asyncapi|swagger)[\"']?\s*:", head):
        return None
    spec = parse_spec(text)
    if not spec:
        return None
    if "asyncapi" in spec:
        return "asyncapi"
    if "openapi" in spec or "swagger" in spec:
        return "openapi"
    return None


def spec_info(spec: dict) -> tuple[str, str]:
    info = spec.get("info") or {}
    title = str(info.get("title") or "Referência da API").strip()
    description = str(info.get("description") or "").strip().split("\n")[0]
    return title[:200], description[:500]
