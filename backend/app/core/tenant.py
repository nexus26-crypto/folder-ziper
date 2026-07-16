"""
Gerenciamento de schemas por tenant.

Cada tenant tem seu próprio schema Postgres (tenant_<slug>) contendo tabelas
isoladas de outros clientes. Estas funções criam/dropam schemas e definem o
search_path da conexão para escopo do tenant durante a request.
"""
import re
import secrets
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, AsyncConnection


TENANT_SCHEMA_PREFIX = "tenant_"
_SLUG_RE = re.compile(r"[^a-z0-9_]")


def normalize_schema_name(name: str) -> str:
    """Sanitiza o nome do schema para evitar SQL injection."""
    clean = _SLUG_RE.sub("_", name.lower()).strip("_")
    if not clean:
        raise ValueError("Invalid schema name")
    if not clean.startswith(TENANT_SCHEMA_PREFIX):
        clean = TENANT_SCHEMA_PREFIX + clean
    return clean[:63]  # limite do Postgres


def generate_schema_name() -> str:
    return TENANT_SCHEMA_PREFIX + secrets.token_hex(6)


async def create_tenant_schema(conn: AsyncConnection, schema: str) -> None:
    """Cria o schema e as tabelas do tenant. Usa DDL em SQL cru para simplicidade."""
    schema = normalize_schema_name(schema)
    await conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))

    # Tabelas por tenant — expandir conforme necessário
    await conn.execute(text(f'''
        CREATE TABLE IF NOT EXISTS "{schema}".users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            full_name TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'member',
            is_active BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    '''))
    await conn.execute(text(f'''
        CREATE TABLE IF NOT EXISTS "{schema}".channels (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            category TEXT,
            logo_url TEXT,
            stream_url TEXT,
            epg_id TEXT,
            is_active BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    '''))
    await conn.execute(text(f'''
        CREATE TABLE IF NOT EXISTS "{schema}".sync_jobs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            job_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            progress INT NOT NULL DEFAULT 0,
            payload JSONB,
            result JSONB,
            error TEXT,
            started_at TIMESTAMPTZ,
            finished_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    '''))


async def drop_tenant_schema(conn: AsyncConnection, schema: str) -> None:
    schema = normalize_schema_name(schema)
    await conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))


async def set_search_path(session: AsyncSession, schema: str) -> None:
    """Escopa a sessão atual ao schema do tenant."""
    schema = normalize_schema_name(schema)
    await session.execute(text(f'SET search_path TO "{schema}", public'))
