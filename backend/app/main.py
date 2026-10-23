import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .lib.seo import page_meta, render_index
from .routers import admin, auth, public
from .services.docs import DocsService
from .services.seed import seed_if_empty
from .storage import Storage

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger(__name__)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    storage = Storage(settings)
    if settings.auto_create_resources:
        await run_in_threadpool(storage.ensure_resources)
    if settings.seed_on_startup:
        await run_in_threadpool(seed_if_empty, DocsService(storage))
    app.state.storage = storage
    yield


# Swagger/OpenAPI ficam sob /api para não colidir com a rota /docs do frontend.
app = FastAPI(
    title=f"{settings.site_name} API",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.middleware("http")
async def timing(request: Request, call_next):
    """Tempo de cada requisição no cabeçalho Server-Timing (aparece no DevTools) e no log, se passar do limite."""
    start = time.perf_counter()
    response = await call_next(request)
    elapsed = (time.perf_counter() - start) * 1000
    response.headers["Server-Timing"] = f"app;dur={elapsed:.1f}"
    if elapsed >= settings.slow_request_ms:
        log.warning(
            "Requisição lenta: %s %s -> %s em %.0f ms", request.method, request.url.path, response.status_code, elapsed
        )
    return response


if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(auth.router)
app.include_router(public.router)
app.include_router(admin.router)


# ---------------------------------------------------------------- SPA (bundle do Vite)
dist = Path(settings.frontend_dist).resolve()
if (dist / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="static")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str, request: Request):
        if full_path.startswith("api/"):
            raise HTTPException(404, "Rota não encontrada")
        candidate = (dist / full_path).resolve()
        if full_path and candidate.is_file() and dist in candidate.parents:
            return FileResponse(candidate)
        html = (dist / "index.html").read_text(encoding="utf-8")
        base = settings.public_url.rstrip("/")
        url = f"{base}/{full_path}" if base else str(request.url.replace(query="", fragment=""))
        meta = await run_in_threadpool(_share_meta, full_path, url)
        body = render_index(html, meta, site_name=settings.site_name)
        return HTMLResponse(body, headers={"Cache-Control": "no-cache"})


def _share_meta(full_path: str, url: str) -> dict[str, str]:
    """Título e descrição para a prévia de links. Só páginas publicadas, e só se a leitura é pública."""
    title, description = None, settings.site_description
    path = full_path.strip("/")
    if settings.public_read and (path == "docs" or path.startswith("docs/")):
        page_path = path[len("docs") :].strip("/")
        if page_path:
            try:
                page = DocsService(app.state.storage).get_page_meta(page_path)
                title, description = page["title"], page.get("description") or settings.site_description
            except HTTPException:
                pass  # página inexistente ou rascunho: prévia genérica
    return page_meta(site_name=settings.site_name, title=title, description=description, url=url)
