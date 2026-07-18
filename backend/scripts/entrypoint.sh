#!/bin/sh
set -e

CMD="${1:-api}"

case "$CMD" in
  api)
    echo "==> Rodando bootstrap (cria schema public + admin inicial)"
    python -m app.bootstrap
    echo "==> Iniciando API (gunicorn + uvicorn workers)"
    exec gunicorn app.main:app \
      -k uvicorn.workers.UvicornWorker \
      -w "${WEB_CONCURRENCY:-2}" \
      -b 0.0.0.0:8000 \
      --access-logfile - \
      --error-logfile -
    ;;
  worker)
    echo "==> Iniciando Celery worker (default queue)"
    exec celery -A app.workers.celery_app worker \
      -Q default \
      --loglevel=info \
      --autoscale=4,1

    ;;
  worker-scraping)
    echo "==> Iniciando Celery worker (scraping queue)"
    exec celery -A app.workers.celery_app worker \
      -Q scraping \
      --loglevel=info \
      --concurrency=1

    ;;
  beat)
    echo "==> Iniciando Celery beat scheduler"
    exec celery -A app.workers.celery_app beat --loglevel=info
    ;;
  flower)
    echo "==> Iniciando Flower"
    exec celery -A app.workers.celery_app flower \
      --port=5555 \
      --basic_auth="${FLOWER_USER}:${FLOWER_PASSWORD}"
    ;;
  shell)
    exec /bin/bash
    ;;
  *)
    exec "$@"
    ;;
esac
