"""Modelos de página personalizados."""

from __future__ import annotations

import re
import uuid

from fastapi import HTTPException, status

from ..schemas import TemplateCreate, User
from ..storage import Storage, utcnow
from .docs import not_found


class TemplateService:
    def __init__(self, storage: Storage) -> None:
        self.storage = storage

    def list(self) -> list[dict]:
        return sorted(self.storage.list_templates(), key=lambda t: t["name"].lower())

    def create(self, data: TemplateCreate, user: User) -> dict:
        template = {
            "id": uuid.uuid4().hex[:10],
            **data.model_dump(),
            "created_by": user.username,
            "created_at": utcnow(),
        }
        self.storage.put_template(template)
        return template

    def delete(self, template_id: str, user: User) -> None:
        if not re.fullmatch(r"[0-9a-f]{10}", template_id):
            raise not_found("Modelo")
        template = self.storage.get_template(template_id)
        if not template:
            raise not_found("Modelo")
        if user.role != "admin" and template.get("created_by") != user.username:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Só quem criou o modelo ou um administrador pode excluí-lo.")
        self.storage.delete_template(template_id)
