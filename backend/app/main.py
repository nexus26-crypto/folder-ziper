import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.responses import JSONResponse

from app.core.config import settings
from app.api.v1.router import api_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("vyntrix")

limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Starting {settings.APP_NAME} in {settings.APP_ENV}")
    # Garante tabelas novas em todos os tenants existentes (idempotente).
    try:
        from sqlalchemy import select
        from app.core.database import AsyncSessionLocal
        from app.models.public import Tenant
        from app.core.tenant import ensure_tenant_schema
        async with AsyncSessionLocal() as db:
            tenants = (await db.execute(select(Tenant))).scalars().all()
        for t in tenants:
            await ensure_tenant_schema(t.schema_name)
        logger.info(f"ensured schema for {len(tenants)} tenant(s)")
    except Exception as e:
        logger.warning(f"tenant schema sync skipped: {e}")
    yield
    logger.info("Shutting down")


app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request, exc):
    return JSONResponse(status_code=429, content={"detail": "Too many requests"})


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health", tags=["system"])
async def health():
    return {"status": "ok", "app": settings.APP_NAME, "env": settings.APP_ENV}


app.include_router(api_router)
