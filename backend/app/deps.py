from fastapi import Depends, Request

from .config import Settings, get_settings
from .library import TemplateService
from .reviews import ReviewService
from .service import DocsService
from .storage import Storage


def get_storage(request: Request) -> Storage:
    return request.app.state.storage


def get_service(request: Request) -> DocsService:
    return DocsService(request.app.state.storage)


def get_reviews(request: Request, settings: Settings = Depends(get_settings)) -> ReviewService:
    return ReviewService(DocsService(request.app.state.storage), settings)


def get_templates(request: Request) -> TemplateService:
    return TemplateService(request.app.state.storage)

