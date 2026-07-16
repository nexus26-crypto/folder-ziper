"""Geração de banner — placeholder a portar do banner_gerador.py legado."""
import logging
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.workers.tasks_banner.gerar_banner", bind=True)
def gerar_banner(self, tenant_schema: str, canal_id: str, options: dict):
    logger.info(f"[{tenant_schema}] gerar_banner canal={canal_id}")
    # TODO: portar de banner_gerador.py
    return {"ok": True}
