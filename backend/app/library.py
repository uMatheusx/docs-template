"""Modelos de página personalizados (guardados no S3)."""

from __future__ import annotations

import re
import uuid

from fastapi import HTTPException, status

from .schemas import TemplateCreate, User
from .service import not_found
from .storage import Storage, utcnow

TEMPLATE_PREFIX = "templates/"


class TemplateService:
    def __init__(self, storage: Storage) -> None:
        self.storage = storage

    def list(self) -> list[dict]:
        items = [self.storage.get_json(key) for key in self.storage.list_keys(TEMPLATE_PREFIX)]
        return sorted((t for t in items if t), key=lambda t: t["name"].lower())

    def create(self, data: TemplateCreate, user: User) -> dict:
        template = {
            "id": uuid.uuid4().hex[:10],
            **data.model_dump(),
            "created_by": user.username,
            "created_at": utcnow(),
        }
        self.storage.put_json(f"{TEMPLATE_PREFIX}{template['id']}.json", template)
        return template

    def delete(self, template_id: str, user: User) -> None:
        if not re.fullmatch(r"[0-9a-f]{10}", template_id):
            raise not_found("Modelo")
        key = f"{TEMPLATE_PREFIX}{template_id}.json"
        template = self.storage.get_json(key)
        if not template:
            raise not_found("Modelo")
        if user.role != "admin" and template.get("created_by") != user.username:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Só quem criou o modelo ou um administrador pode excluí-lo.")
        self.storage.delete_key(key)
