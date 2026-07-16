"""Tasks Celery de sincronização — implementação real (M3U + Xtream API)."""
from __future__ import annotations
import logging
import time
import json
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import create_engine, text

from app.workers.celery_app import celery_app
from app.core.config import settings
from app.core.crypto import decrypt
from app.services.xtream import m3u_parser, xtream_api, importer

log = logging.getLogger(__name__)

# Engine síncrona dedicada ao worker (Celery não roda asyncio bem em prod)
_engine = create_engine(settings.database_url_sync, pool_pre_ping=True, future=True)


def _sync_engine():
    return _engine


def _job_update(schema: str, job_id: str, **fields):
    """UPDATE incremental em sync_jobs. Concatena log_tail se vier."""
    log_line = fields.pop("log_line", None)
    sets, params = [], {"id": job_id}
    for k, v in fields.items():
        sets.append(f"{k} = :{k}")
        params[k] = v
    if log_line:
        sets.append("log_tail = COALESCE(log_tail,'') || :log_line")
        params["log_line"] = f"[{datetime.now().strftime('%H:%M:%S')}] {log_line}\n"
    if not sets:
        return
    q = f'UPDATE "{schema}".sync_jobs SET {", ".join(sets)} WHERE id = :id'
    with _sync_engine().begin() as conn:
        conn.execute(text(q), params)


def _load_source(schema: str, source_id: str) -> dict | None:
    with _sync_engine().connect() as conn:
        r = conn.execute(
            text(f'SELECT * FROM "{schema}".xtream_sources WHERE id = :id'),
            {"id": source_id},
        ).mappings().first()
        return dict(r) if r else None


def _load_xui(schema: str, xui_id: str | None) -> dict | None:
    if not xui_id:
        with _sync_engine().connect() as conn:
            r = conn.execute(
                text(f'SELECT * FROM "{schema}".xui_connections WHERE is_default = true LIMIT 1')
            ).mappings().first()
    else:
        with _sync_engine().connect() as conn:
            r = conn.execute(
                text(f'SELECT * FROM "{schema}".xui_connections WHERE id = :id'),
                {"id": xui_id},
            ).mappings().first()
    if not r: return None
    r = dict(r)
    r["db_pass"] = decrypt(r["db_pass_enc"])
    return r


def _download_m3u(url: str) -> str:
    with httpx.Client(timeout=120.0, follow_redirects=True) as c:
        r = c.get(url)
        r.raise_for_status()
        return r.text


@celery_app.task(name="app.workers.tasks_sync.run_source_sync", bind=True, max_retries=1)
def run_source_sync(self, tenant_schema: str, job_id: str, source_id: str):
    """Task principal — dispara sync para uma fonte já registrada."""
    started = time.time()
    _job_update(tenant_schema, job_id, status="running",
                started_at=datetime.now(timezone.utc), log_line="start")
    try:
        src = _load_source(tenant_schema, source_id)
        if not src:
            raise RuntimeError("source não encontrada")

        mapping = (src.get("mapping") or {}) if isinstance(src.get("mapping"), dict) else json.loads(src.get("mapping") or "{}")
        xui = _load_xui(tenant_schema, str(src.get("xui_connection_id")) if src.get("xui_connection_id") else None)
        if not xui:
            raise RuntimeError("nenhum XUI cadastrado ou selecionado")

        xui_conf = {
            "host": xui["host"], "port": xui["port"],
            "db_name": xui["db_name"], "db_user": xui["db_user"], "db_pass": xui["db_pass"],
        }

        # Obter items da fonte
        stype = src.get("source_type") or "xtream_api"
        _job_update(tenant_schema, job_id, log_line=f"fonte tipo={stype}")

        if stype == "m3u_url":
            _job_update(tenant_schema, job_id, log_line=f"baixando {src.get('m3u_url')}")
            content = _download_m3u(src["m3u_url"])
            parsed = m3u_parser.parse_m3u(content)
        elif stype == "m3u_file":
            parsed = m3u_parser.parse_m3u(src.get("m3u_content") or "")
        else:  # xtream_api
            _job_update(tenant_schema, job_id, log_line="puxando player_api…")
            lives = xtream_api.as_m3u_items(src["host"], src["username"], src["password"], "live")
            vods = xtream_api.as_m3u_items(src["host"], src["username"], src["password"], "vod")
            parsed = {"canais": lives, "filmes": vods, "series": []}

        total = len(parsed["canais"]) + len(parsed["filmes"]) + len(parsed["series"])
        _job_update(tenant_schema, job_id, total_items=total,
                    log_line=f"parse: {len(parsed['canais'])} canais, {len(parsed['filmes'])} filmes, {len(parsed['series'])} series")

        map_live = {k: int(v) for k, v in (mapping.get("live") or {}).items()}
        map_movie = {k: int(v) for k, v in (mapping.get("movie") or {}).items()}
        bouquet_canais = mapping.get("bouquet_canais") or None
        bouquet_filmes = mapping.get("bouquet_filmes") or None
        server_id = int(mapping.get("server_id") or 0)
        criar_cats = bool(mapping.get("criar_categorias", True))

        totals = {"inseridos": 0, "skipped": 0, "errors": 0}
        state = {"done": 0}

        def prog(done, tot, msg):
            state["done"] += 1
            if state["done"] % 5 == 0:
                pct = int((done / max(tot, 1)) * 100)
                _job_update(tenant_schema, job_id, progress=pct, log_line=msg)

        if parsed["canais"]:
            r = importer.importar_canais(
                xui_conf, parsed["canais"], map_live,
                bouquet_id=int(bouquet_canais) if bouquet_canais else None,
                server_id=server_id, criar_categorias=criar_cats, progress=prog,
            )
            for k in totals: totals[k] += r[k]
            _job_update(tenant_schema, job_id, log_line=f"canais: +{r['inseridos']} skip={r['skipped']} err={r['errors']}")

        if parsed["filmes"]:
            r = importer.importar_filmes(
                xui_conf, parsed["filmes"], map_movie,
                bouquet_id=int(bouquet_filmes) if bouquet_filmes else None,
                server_id=server_id, criar_categorias=criar_cats, progress=prog,
            )
            for k in totals: totals[k] += r[k]
            _job_update(tenant_schema, job_id, log_line=f"filmes: +{r['inseridos']} skip={r['skipped']} err={r['errors']}")

        if parsed["series"]:
            _job_update(tenant_schema, job_id, log_line=f"séries ({len(parsed['series'])}): não implementado nesta fase — ignorado")

        elapsed = round(time.time() - started, 1)
        _job_update(
            tenant_schema, job_id, status="success", progress=100,
            inserted=totals["inseridos"], skipped=totals["skipped"], errors=totals["errors"],
            finished_at=datetime.now(timezone.utc),
            result=json.dumps({**totals, "elapsed_s": elapsed}),
            log_line=f"concluído em {elapsed}s",
        )
        with _sync_engine().begin() as conn:
            conn.execute(text(f'UPDATE "{tenant_schema}".xtream_sources SET last_sync_at = now() WHERE id = :id'),
                         {"id": source_id})
        return {"ok": True, **totals}
    except Exception as e:
        log.exception("sync failed")
        _job_update(tenant_schema, job_id, status="failed", error=str(e)[:500],
                    finished_at=datetime.now(timezone.utc), log_line=f"FAIL: {e}")
        raise


@celery_app.task(name="app.workers.tasks_sync.autosync_tick")
def autosync_tick():
    """Roda de minuto em minuto (Celery Beat). Enfileira sources com auto_sync
    cuja expressão cron bate no minuto atual."""
    from croniter import croniter
    from app.core.database import engine  # só para listar tenants via async? melhor SQL sync abaixo.
    # Listar tenants a partir do schema public
    with _sync_engine().connect() as conn:
        tenants = conn.execute(text("SELECT schema_name FROM public.tenants WHERE status = 'active'")).all()

    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    fired = 0
    for (schema,) in tenants:
        try:
            with _sync_engine().connect() as conn:
                rows = conn.execute(text(
                    f'SELECT id, auto_sync_cron FROM "{schema}".xtream_sources '
                    f"WHERE auto_sync = true AND is_active = true"
                )).mappings().all()
            for r in rows:
                cron_expr = r["auto_sync_cron"] or "0 3 * * *"
                try:
                    itr = croniter(cron_expr, now)
                    prev = itr.get_prev(datetime)
                    if prev.replace(second=0, microsecond=0) == now:
                        # Cria job e enfileira
                        with _sync_engine().begin() as c2:
                            job = c2.execute(text(
                                f'INSERT INTO "{schema}".sync_jobs (job_type, source_id, status) '
                                f"VALUES ('auto_sync', :sid, 'queued') RETURNING id"
                            ), {"sid": str(r["id"])}).scalar_one()
                            c2.execute(text(f'UPDATE "{schema}".xtream_sources SET last_auto_run_at = now() WHERE id = :id'),
                                       {"id": str(r["id"])})
                        run_source_sync.delay(schema, str(job), str(r["id"]))
                        fired += 1
                except Exception as e:
                    log.warning(f"autosync {schema}/{r['id']}: {e}")
        except Exception as e:
            log.warning(f"autosync scan {schema}: {e}")
    return {"fired": fired}


# Compat: task antiga chamada em algum lugar
@celery_app.task(name="app.workers.tasks_sync.sync_xtream_full")
def sync_xtream_full(tenant_schema: str, credentials: dict):
    log.info(f"[{tenant_schema}] legacy sync_xtream_full — no-op (use run_source_sync)")
    return {"ok": True}


@celery_app.task(name="app.workers.tasks_sync.sync_epg_all_tenants")
def sync_epg_all_tenants():
    return {"ok": True}
