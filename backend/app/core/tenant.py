"""
Gerenciamento de schemas por tenant.

Cada tenant tem seu próprio schema Postgres (tenant_<slug>) contendo tabelas
isoladas de outros clientes. Migrations são idempotentes (rodam a cada boot).
"""
import re
import secrets
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, AsyncConnection


TENANT_SCHEMA_PREFIX = "tenant_"
_SLUG_RE = re.compile(r"[^a-z0-9_]")


def normalize_schema_name(name: str) -> str:
    clean = _SLUG_RE.sub("_", name.lower()).strip("_")
    if not clean:
        raise ValueError("Invalid schema name")
    if not clean.startswith(TENANT_SCHEMA_PREFIX):
        clean = TENANT_SCHEMA_PREFIX + clean
    return clean[:63]


def generate_schema_name() -> str:
    return TENANT_SCHEMA_PREFIX + secrets.token_hex(6)


async def create_tenant_schema(conn: AsyncConnection, schema: str) -> None:
    schema = normalize_schema_name(schema)
    await conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))

    # ---- channels (catálogo local do tenant, não do XUI) ----
    await conn.execute(text(f'''
        CREATE TABLE IF NOT EXISTS "{schema}".channels (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            category TEXT,
            group_name TEXT,
            logo_url TEXT,
            stream_url TEXT,
            epg_id TEXT,
            is_active BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    '''))
    await conn.execute(text(f'ALTER TABLE "{schema}".channels ADD COLUMN IF NOT EXISTS group_name TEXT;'))
    await conn.execute(text(f'CREATE INDEX IF NOT EXISTS channels_category_idx ON "{schema}".channels (category);'))

    # ---- xui_connections: painel XUI/Xtream de destino (multi-conexão) ----
    await conn.execute(text(f'''
        CREATE TABLE IF NOT EXISTS "{schema}".xui_connections (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            host TEXT NOT NULL,
            port INT NOT NULL DEFAULT 3306,
            db_name TEXT NOT NULL,
            db_user TEXT NOT NULL,
            db_pass_enc TEXT NOT NULL,
            is_default BOOLEAN NOT NULL DEFAULT false,
            last_test_at TIMESTAMPTZ,
            last_test_ok BOOLEAN,
            last_test_error TEXT,
            detected_version TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    '''))
    await conn.execute(text(f"ALTER TABLE \"{schema}\".xui_connections ADD COLUMN IF NOT EXISTS panel_type TEXT NOT NULL DEFAULT 'auto';"))

    # ---- xtream_sources: fonte de dados (M3U URL, M3U file, Xtream API) ----
    await conn.execute(text(f'''
        CREATE TABLE IF NOT EXISTS "{schema}".xtream_sources (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            host TEXT,
            username TEXT,
            password TEXT,
            kind TEXT NOT NULL DEFAULT 'live',
            is_active BOOLEAN NOT NULL DEFAULT true,
            last_sync_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    '''))
    # Ampliações idempotentes
    await conn.execute(text(f"ALTER TABLE \"{schema}\".xtream_sources ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'xtream_api';"))
    await conn.execute(text(f'ALTER TABLE "{schema}".xtream_sources ADD COLUMN IF NOT EXISTS m3u_url TEXT;'))
    await conn.execute(text(f'ALTER TABLE "{schema}".xtream_sources ADD COLUMN IF NOT EXISTS m3u_content TEXT;'))
    await conn.execute(text(f'ALTER TABLE "{schema}".xtream_sources ADD COLUMN IF NOT EXISTS xui_connection_id UUID;'))
    await conn.execute(text(f'ALTER TABLE "{schema}".xtream_sources ADD COLUMN IF NOT EXISTS mapping JSONB;'))
    await conn.execute(text(f'ALTER TABLE "{schema}".xtream_sources ADD COLUMN IF NOT EXISTS auto_sync BOOLEAN NOT NULL DEFAULT false;'))
    await conn.execute(text(f'ALTER TABLE "{schema}".xtream_sources ADD COLUMN IF NOT EXISTS auto_sync_cron TEXT;'))
    await conn.execute(text(f'ALTER TABLE "{schema}".xtream_sources ADD COLUMN IF NOT EXISTS last_auto_run_at TIMESTAMPTZ;'))
    await conn.execute(text(f'ALTER TABLE "{schema}".xtream_sources ADD COLUMN IF NOT EXISTS last_content_hash TEXT;'))
    await conn.execute(text(f'ALTER TABLE "{schema}".xtream_sources ADD COLUMN IF NOT EXISTS last_content_at TIMESTAMPTZ;'))
    # host/username/password/kind precisam virar NULLABLE (M3U puro não usa)
    await conn.execute(text(f'ALTER TABLE "{schema}".xtream_sources ALTER COLUMN host DROP NOT NULL;'))
    await conn.execute(text(f'ALTER TABLE "{schema}".xtream_sources ALTER COLUMN username DROP NOT NULL;'))
    await conn.execute(text(f'ALTER TABLE "{schema}".xtream_sources ALTER COLUMN password DROP NOT NULL;'))


    # ---- sync_jobs ----
    await conn.execute(text(f'''
        CREATE TABLE IF NOT EXISTS "{schema}".sync_jobs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            job_type TEXT NOT NULL,
            source_id UUID,
            status TEXT NOT NULL DEFAULT 'pending',
            progress INT NOT NULL DEFAULT 0,
            total_items INT NOT NULL DEFAULT 0,
            inserted INT NOT NULL DEFAULT 0,
            skipped INT NOT NULL DEFAULT 0,
            errors INT NOT NULL DEFAULT 0,
            log_tail TEXT,
            payload JSONB,
            result JSONB,
            error TEXT,
            started_at TIMESTAMPTZ,
            finished_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    '''))
    for col, typ in [
        ("total_items", "INT NOT NULL DEFAULT 0"),
        ("inserted", "INT NOT NULL DEFAULT 0"),
        ("skipped", "INT NOT NULL DEFAULT 0"),
        ("errors", "INT NOT NULL DEFAULT 0"),
        ("log_tail", "TEXT"),
    ]:
        await conn.execute(text(f'ALTER TABLE "{schema}".sync_jobs ADD COLUMN IF NOT EXISTS {col} {typ};'))
    await conn.execute(text(f'CREATE INDEX IF NOT EXISTS sync_jobs_status_idx ON "{schema}".sync_jobs (status, created_at DESC);'))

    # ---- banners ----
    await conn.execute(text(f'''
        CREATE TABLE IF NOT EXISTS "{schema}".banners (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            title TEXT NOT NULL,
            subtitle TEXT,
            theme TEXT NOT NULL DEFAULT 'dark',
            template TEXT NOT NULL DEFAULT 'default',
            logo_url TEXT,
            image_url TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    '''))


async def drop_tenant_schema(conn: AsyncConnection, schema: str) -> None:
    schema = normalize_schema_name(schema)
    await conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))


async def set_search_path(session: AsyncSession, schema: str) -> None:
    schema = normalize_schema_name(schema)
    await session.execute(text(f'SET search_path TO "{schema}", public'))


async def ensure_tenant_schema(schema: str) -> None:
    """Wrapper que abre uma conn nova pra criar/atualizar o schema. Idempotente."""
    from app.core.database import engine
    async with engine.begin() as conn:
        await create_tenant_schema(conn, schema)
