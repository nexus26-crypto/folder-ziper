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


MAX_LOG_LINES = 2000  # cap log_tail para não estourar TEXT do postgres


def _job_update(schema: str, job_id: str, **fields):
    """UPDATE incremental em sync_jobs. Concatena log_tail se vier (string ou lista)."""
    log_line = fields.pop("log_line", None)
    sets, params = [], {"id": job_id}
    for k, v in fields.items():
        sets.append(f"{k} = :{k}")
        params[k] = v
    if log_line is not None:
        if isinstance(log_line, (list, tuple)):
            lines = list(log_line)
        else:
            lines = [log_line]
        ts = datetime.now().strftime('%H:%M:%S')
        chunk = "".join(f"[{ts}] {ln}\n" for ln in lines if ln)
        if chunk:
            # append + trim ao final para manter só as últimas MAX_LOG_LINES linhas
            sets.append(
                "log_tail = array_to_string("
                "(string_to_array(COALESCE(log_tail,'') || :log_chunk, E'\\n'))"
                f"[GREATEST(1, array_length(string_to_array(COALESCE(log_tail,'') || :log_chunk, E'\\n'), 1) - {MAX_LOG_LINES}):], E'\\n')"
            )
            params["log_chunk"] = chunk
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
def run_source_sync(self, tenant_schema: str, job_id: str, source_id: str, force: bool = False):
    """Task principal — dispara sync para uma fonte já registrada."""
    import hashlib
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
            raise RuntimeError("nenhum painel Xtream/XUI cadastrado")

        xui_conf = {
            "host": xui["host"], "port": xui["port"],
            "db_name": xui["db_name"], "db_user": xui["db_user"], "db_pass": xui["db_pass"],
            "panel_type": xui.get("panel_type") or "auto",
        }

        # Obter items da fonte
        stype = src.get("source_type") or "xtream_api"
        _job_update(tenant_schema, job_id, log_line=f"fonte tipo={stype} · painel={xui_conf['panel_type']}")

        raw_content = ""
        if stype == "m3u_url":
            _job_update(tenant_schema, job_id, log_line=f"baixando {src.get('m3u_url')}")
            raw_content = _download_m3u(src["m3u_url"])
            parsed = m3u_parser.parse_m3u(raw_content)
        elif stype == "m3u_file":
            raw_content = src.get("m3u_content") or ""
            parsed = m3u_parser.parse_m3u(raw_content)
        else:  # xtream_api
            _job_update(tenant_schema, job_id, log_line="puxando player_api…")
            lives = xtream_api.as_m3u_items(src["host"], src["username"], src["password"], "live")
            vods = xtream_api.as_m3u_items(src["host"], src["username"], src["password"], "vod")
            parsed = {"canais": lives, "filmes": vods, "series": []}
            raw_content = json.dumps({"live_count": len(lives), "vod_count": len(vods)}, sort_keys=True)

        # -------- Incremental: skip se conteúdo idêntico à última rodada --------
        content_hash = hashlib.sha256(raw_content.encode("utf-8", errors="ignore")).hexdigest()
        prev_hash = src.get("last_content_hash")
        if prev_hash == content_hash and not force:
            _job_update(tenant_schema, job_id, status="success", progress=100,
                        finished_at=datetime.now(timezone.utc),
                        log_line=f"⚡ conteúdo idêntico à última sync (hash {content_hash[:8]}), pulando. Use force=true pra rodar.",
                        result=json.dumps({"skipped_incremental": True, "content_hash": content_hash}))
            return
        with _sync_engine().begin() as conn:
            conn.execute(
                text(f'UPDATE "{tenant_schema}".xtream_sources SET last_content_hash=:h, last_content_at=:ts WHERE id=:id'),
                {"h": content_hash, "ts": datetime.now(timezone.utc), "id": source_id},
            )

        total = len(parsed["canais"]) + len(parsed["filmes"]) + len(parsed["series"])
        _job_update(tenant_schema, job_id, total_items=total,
                    log_line=f"parse: {len(parsed['canais'])} canais · {len(parsed['filmes'])} filmes · {len(parsed['series'])} séries · hash={content_hash[:8]}")



        def _as_list(v):
            if v is None or v == "": return []
            if isinstance(v, list): return [int(x) for x in v if x]
            return [int(v)]

        map_live = {k: int(v) for k, v in (mapping.get("live") or {}).items()}
        map_movie = {k: int(v) for k, v in (mapping.get("movie") or {}).items()}
        map_series = {k: int(v) for k, v in (mapping.get("series") or {}).items()}
        bq_canais = _as_list(mapping.get("bouquets_canais") or mapping.get("bouquet_canais"))
        bq_filmes = _as_list(mapping.get("bouquets_filmes") or mapping.get("bouquet_filmes"))
        bq_series = _as_list(mapping.get("bouquets_series") or mapping.get("bouquet_series"))
        server_id = int(mapping.get("server_id") or 0)
        criar_cats = bool(mapping.get("criar_categorias", True))
        usar_tmdb = bool(mapping.get("usar_tmdb", False))
        tmdb_key = mapping.get("tmdb_api_key") or None
        tmdb_lang = mapping.get("tmdb_language") or "pt-BR"
        mode_canais = mapping.get("mode_canais") or mapping.get("mode") or "insert_only"
        mode_filmes = mapping.get("mode_filmes") or mapping.get("mode") or "insert_only"
        mode_series = mapping.get("mode_series") or mapping.get("mode") or "insert_only"
        opts = {
            "skip_tmdb_existing": bool(mapping.get("skip_tmdb_existing")),
            "dedup_by_full_url": bool(mapping.get("dedup_by_full_url")),
            "dedup_by_url_only": bool(mapping.get("dedup_by_url_only")),
            "delete_dupes_before": bool(mapping.get("delete_dupes_before")),
            "remove_orphans": bool(mapping.get("remove_orphans")),
        }

        totals = {"inseridos": 0, "atualizados": 0, "skipped": 0, "errors": 0, "orphans_removed": 0}
        breakdown = {
            "canais": {"inserted": 0, "updated": 0, "skipped": 0, "deleted": 0, "errors": 0},
            "filmes": {"inserted": 0, "updated": 0, "skipped": 0, "deleted": 0, "errors": 0},
            "series": {"inserted": 0, "updated": 0, "skipped": 0, "deleted": 0, "errors": 0},
        }
        category_offsets = {
            "canais": 0,
            "filmes": len(parsed["canais"]),
            "series": len(parsed["canais"]) + len(parsed["filmes"]),
        }

        def progress_for(category: str):
            last_reported = {"value": -1}

            def _progress(done, _category_total, msg):
                overall_done = min(total, category_offsets[category] + max(0, int(done)))
                pct = min(99, int((overall_done / max(total, 1)) * 100))
                if pct >= last_reported["value"] + 1:
                    last_reported["value"] = pct
                    _job_update(tenant_schema, job_id, progress=pct, log_line=msg)

            return _progress

        def save_category(category: str, result: dict):
            breakdown[category] = {
                "inserted": result.get("inseridos", 0),
                "updated": result.get("atualizados", 0),
                "skipped": result.get("skipped", 0),
                "deleted": result.get("orphans_removed", 0),
                "errors": result.get("errors", 0),
            }
            _job_update(
                tenant_schema, job_id,
                inserted=totals["inseridos"], skipped=totals["skipped"], errors=totals["errors"],
                result=json.dumps(breakdown),
            )

        if parsed["canais"]:
            _job_update(tenant_schema, job_id, log_line=f"canais modo={mode_canais}")
            r = importer.importar_canais(
                xui_conf, parsed["canais"], map_live,
                bouquet_ids=bq_canais, server_id=server_id,
                criar_categorias=criar_cats, mode=mode_canais, opts=opts, progress=progress_for("canais"),
            )
            for k in totals:
                if k in r: totals[k] += r[k]
            save_category("canais", r)
            _job_update(tenant_schema, job_id,
                        log_line=f"canais: +{r['inseridos']} ~{r.get('atualizados',0)} skip={r['skipped']} err={r['errors']} orph=-{r.get('orphans_removed',0)}")

        if parsed["filmes"]:
            if usar_tmdb:
                _job_update(tenant_schema, job_id, log_line=f"TMDB filmes: {len(parsed['filmes'])} títulos ({tmdb_lang})")
                importer.enrich_filmes_com_tmdb(parsed["filmes"], api_key=tmdb_key,
                                                 language=tmdb_lang, progress=progress_for("filmes"))
            _job_update(tenant_schema, job_id, log_line=f"filmes modo={mode_filmes}")
            r = importer.importar_filmes(
                xui_conf, parsed["filmes"], map_movie,
                bouquet_ids=bq_filmes, server_id=server_id,
                criar_categorias=criar_cats, mode=mode_filmes, opts=opts, progress=progress_for("filmes"),
            )
            for k in totals:
                if k in r: totals[k] += r[k]
            save_category("filmes", r)
            _job_update(tenant_schema, job_id,
                        log_line=f"filmes: +{r['inseridos']} ~{r.get('atualizados',0)} skip={r['skipped']} err={r['errors']} orph=-{r.get('orphans_removed',0)}")

        if parsed["series"]:
            _job_update(tenant_schema, job_id, log_line=f"séries modo={mode_series}")
            r = importer.importar_series(
                xui_conf, parsed["series"], map_series,
                bouquet_ids=bq_series, server_id=server_id,
                criar_categorias=criar_cats, mode=mode_series, opts=opts,
                usar_tmdb=usar_tmdb, tmdb_api_key=tmdb_key, tmdb_language=tmdb_lang,
                progress=progress_for("series"),
            )
            for k in totals:
                if k in r: totals[k] += r[k]
            save_category("series", r)
            _job_update(tenant_schema, job_id,
                        log_line=f"séries: +{r['inseridos']} eps, {r['series_criadas']} novas, skip={r['skipped']} err={r['errors']} orph=-{r.get('orphans_removed',0)}")




        elapsed = round(time.time() - started, 1)
        _job_update(
            tenant_schema, job_id, status="success", progress=100,
            inserted=totals["inseridos"], skipped=totals["skipped"], errors=totals["errors"],
            finished_at=datetime.now(timezone.utc),
            result=json.dumps({**breakdown, "summary": totals, "elapsed_s": elapsed}),
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
