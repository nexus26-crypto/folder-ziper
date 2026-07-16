# VyntrixSync Backend

Backend multi-tenant do VyntrixSync SaaS — FastAPI + Celery + PostgreSQL + Redis, empacotado em Docker Compose para rodar 100% na sua VPS.

## Stack

- **FastAPI** (Python 3.12) — API REST assíncrona
- **PostgreSQL 16** — schema-per-tenant (isolamento forte)
- **Redis 7** — broker Celery + cache
- **Celery** — workers de background (scraping, sync Xtream, geração de banner)
- **Celery Beat** — jobs agendados
- **Nginx** — reverse proxy + SSL + serve o frontend React
- **Docker Compose** — orquestração

## Estrutura

```
backend/
├── app/
│   ├── main.py                 # FastAPI app + middleware tenant
│   ├── core/                   # config, db, security, tenant resolver
│   ├── models/                 # SQLAlchemy (public + tenant)
│   ├── schemas/                # Pydantic
│   ├── api/v1/                 # endpoints REST
│   ├── services/               # regra de negócio (scrapers, banner, xtream)
│   └── workers/                # Celery tasks
├── nginx/nginx.conf
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── .env.example
└── scripts/entrypoint.sh
```

## Setup local (dev)

```bash
cp .env.example .env
# edite as senhas em .env

docker compose up -d --build
docker compose logs -f api
```

API disponível em `http://localhost:8000` — docs em `http://localhost:8000/docs`.

## Deploy na VPS

### 1. Requisitos na VPS
```bash
# Ubuntu 22.04+
apt update && apt install -y docker.io docker-compose-plugin git
```

### 2. Clone e configure
```bash
git clone <seu-repo> /opt/vyntrixsync
cd /opt/vyntrixsync/backend
cp .env.example .env
nano .env   # ajuste POSTGRES_PASSWORD, JWT_SECRET, DOMAIN, etc.
```

### 3. SSL com Let's Encrypt (certbot)
```bash
apt install -y certbot
certbot certonly --standalone -d app.seudominio.com
# certificados vão para /etc/letsencrypt/live/app.seudominio.com/
```

Ajuste `nginx/nginx.conf` com seu domínio real, depois:

### 4. Sobe tudo
```bash
docker compose up -d --build
```

### 5. Serviços disponíveis
- `https://app.seudominio.com/` → frontend (build React)
- `https://app.seudominio.com/api/` → FastAPI
- `https://app.seudominio.com/api/docs` → Swagger
- Flower (monitoramento Celery): túnel SSH → `localhost:5555`

## Multi-tenant: como funciona

- Schema `public` contém: `tenants`, `platform_users`
- Cada cliente novo → criado schema `tenant_<uuid_curto>` com tabelas próprias (users, channels, etc.)
- Toda requisição autenticada resolve o tenant via JWT → `SET search_path TO tenant_xxx, public`
- Backup por cliente: `pg_dump -n tenant_xxx`

## Backup automático

Script `scripts/backup.sh` faz dump diário para `/opt/backups/`. Adicione ao cron do host:

```
0 3 * * * /opt/vyntrixsync/backend/scripts/backup.sh
```

## Comandos úteis

```bash
docker compose logs -f api           # logs da API
docker compose logs -f worker        # logs do Celery
docker compose exec api bash         # shell no container
docker compose exec postgres psql -U vyntrix vyntrix  # SQL
docker compose restart api           # reinicia após mudar .env
```
