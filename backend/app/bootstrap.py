"""
Bootstrap idempotente executado antes da API subir:
- Cria tabelas do schema `public`
- Cria o primeiro platform_admin se não existir
"""
import asyncio
import logging
from sqlalchemy import select

from app.core.database import engine, AsyncSessionLocal, Base
from app.core.config import settings
from app.core.security import hash_password
from app.models.public import PlatformUser  # noqa: F401  garante o import

logger = logging.getLogger("bootstrap")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")


async def run() -> None:
    # 1. Tabelas do schema public
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("public schema OK")

    # 2. Primeiro platform_admin
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(PlatformUser).where(PlatformUser.email == settings.BOOTSTRAP_ADMIN_EMAIL)
        )
        if result.scalar_one_or_none():
            logger.info(f"admin {settings.BOOTSTRAP_ADMIN_EMAIL} já existe")
            return

        admin = PlatformUser(
            tenant_id=None,
            email=settings.BOOTSTRAP_ADMIN_EMAIL,
            password_hash=hash_password(settings.BOOTSTRAP_ADMIN_PASSWORD),
            full_name="Platform Admin",
            role="platform_admin",
        )
        db.add(admin)
        await db.commit()
        logger.info(f"criado admin: {settings.BOOTSTRAP_ADMIN_EMAIL}")


if __name__ == "__main__":
    asyncio.run(run())
