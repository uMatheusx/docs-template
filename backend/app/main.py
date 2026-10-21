import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .routers import admin, auth, public
from .seed import seed_if_empty
from .service import DocsService
from .storage import Storage

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
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
    async def spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(404, "Rota não encontrada")
        candidate = (dist / full_path).resolve()
        if full_path and candidate.is_file() and dist in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(dist / "index.html", headers={"Cache-Control": "no-cache"})
