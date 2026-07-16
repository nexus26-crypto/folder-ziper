"""Tasks de sincronização. Placeholders — a lógica real será portada do app.py legado na Fase 2."""
import logging
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.workers.tasks_sync.sync_xtream_full", bind=True, max_retries=3)
def sync_xtream_full(self, tenant_schema: str, credentials: dict):
    logger.info(f"[{tenant_schema}] sync_xtream_full start")
    # TODO: portar de app.py legado
    return {"ok": True, "tenant": tenant_schema}


@celery_app.task(name="app.workers.tasks_sync.sync_epg_all_tenants")
def sync_epg_all_tenants():
    logger.info("sync_epg_all_tenants tick")
    # TODO: iterar tenants ativos e disparar sync_epg
    return {"ok": True}
