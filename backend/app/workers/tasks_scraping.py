"""Scraping de jogos — placeholder a portar do scraper_jogos.py legado."""
import logging
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.workers.tasks_scraping.scrape_jogos_do_dia", bind=True, max_retries=3)
def scrape_jogos_do_dia(self):
    logger.info("scrape_jogos_do_dia tick")
    # TODO: portar de scraper_jogos.py
    return {"ok": True, "jogos": 0}
