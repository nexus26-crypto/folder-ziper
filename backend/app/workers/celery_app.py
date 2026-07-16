from celery import Celery
from celery.schedules import crontab

from app.core.config import settings


celery_app = Celery(
    "vyntrix",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=[
        "app.workers.tasks_sync",
        "app.workers.tasks_scraping",
        "app.workers.tasks_banner",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="America/Sao_Paulo",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=1800,
    task_soft_time_limit=1500,
    worker_prefetch_multiplier=1,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_routes={
        "app.workers.tasks_scraping.*": {"queue": "scraping"},
        "app.workers.tasks_sync.*": {"queue": "default"},
        "app.workers.tasks_banner.*": {"queue": "default"},
    },
    beat_schedule={
        "scrape-jogos-diario": {
            "task": "app.workers.tasks_scraping.scrape_jogos_do_dia",
            "schedule": crontab(hour=6, minute=0),
        },
        "sync-epg-hourly": {
            "task": "app.workers.tasks_sync.sync_epg_all_tenants",
            "schedule": crontab(minute=15),
        },
    },
)
