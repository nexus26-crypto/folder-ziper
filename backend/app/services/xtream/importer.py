"""Importa items parseados (M3U ou Xtream API) para dentro do MySQL do XUI.

Portado de `app.py::processar_canais_task` / `processar_filmes_task`.
Sem TMDB nesta fase — pode ser adicionado no `enrichers`.
"""
from __future__ import annotations
import json
import time
from datetime import datetime
from typing import Callable, Iterable

from app.services.xtream import xui_db
from app.services.xtream.m3u_parser import extrair_nome_arquivo, extrair_extensao

BATCH = 100
ProgressCB = Callable[[int, int, str], None]  # (done, total, msg)


def _tick(cb: ProgressCB | None, done: int, total: int, msg: str = ""):
    if cb:
        try: cb(done, total, msg)
        except Exception: pass


def importar_canais(
    xui_config: dict,
    canais: list[dict],
    mapping_categoria: dict[str, int],
    bouquet_id: int | None = None,
    server_id: int = 0,
    criar_categorias: bool = True,
    progress: ProgressCB | None = None,
) -> dict:
    """mapping_categoria: nome_categoria -> id_categoria XUI (opcional se criar_categorias=True)."""
    inseridos = skipped = errors = 0
    ids_bouquet: list[int] = []
    log_lines: list[str] = []
    total = len(canais)
    with xui_db.cursor_from(xui_config) as (conn, cur):
        existing = xui_db.load_existing_urls(cur, stream_type=1)
        log_lines.append(f"cache: {len(existing)} canais existentes")
        for i, c in enumerate(canais):
            try:
                nm = extrair_nome_arquivo(c["url"])
                if nm and nm in existing:
                    skipped += 1
                    continue
                cat_id = mapping_categoria.get(c["categoria"])
                if not cat_id and criar_categorias and c.get("categoria"):
                    cat_id = xui_db.ensure_category(cur, conn, c["categoria"], "live")
                    if cat_id:
                        mapping_categoria[c["categoria"]] = cat_id
                if not cat_id:
                    skipped += 1
                    continue
                cur.execute(
                    """INSERT INTO streams
                       (category_id, stream_display_name, stream_source, stream_icon, type,
                        direct_source, added)
                       VALUES (%s,%s,%s,%s,1,1,%s)""",
                    (cat_id, c["nome"], json.dumps([c["url"]]), c.get("logo") or "",
                     int(datetime.now().timestamp())),
                )
                sid = cur.lastrowid
                if server_id > 0:
                    xui_db.insert_stream_server(cur, sid, server_id)
                if nm: existing.add(nm)
                ids_bouquet.append(sid)
                inseridos += 1
                if inseridos % BATCH == 0:
                    conn.commit()
                    _tick(progress, i + 1, total, f"canais: {inseridos} inseridos")
            except Exception as e:
                errors += 1
                log_lines.append(f"erro '{c.get('nome','?')}': {e}")
        conn.commit()
        added = 0
        if bouquet_id and ids_bouquet:
            added = xui_db.append_bouquet(cur, conn, bouquet_id, ids_bouquet)
        log_lines.append(f"bouquet {bouquet_id or '-'}: +{added}")
    _tick(progress, total, total, f"canais concluído: +{inseridos}")
    return {"inseridos": inseridos, "skipped": skipped, "errors": errors,
            "bouquet_added": len(ids_bouquet), "log": log_lines}


def importar_filmes(
    xui_config: dict,
    filmes: list[dict],
    mapping_categoria: dict[str, int],
    bouquet_id: int | None = None,
    server_id: int = 0,
    criar_categorias: bool = True,
    progress: ProgressCB | None = None,
) -> dict:
    inseridos = skipped = errors = 0
    ids_bouquet: list[int] = []
    log_lines: list[str] = []
    total = len(filmes)
    with xui_db.cursor_from(xui_config) as (conn, cur):
        existing = xui_db.load_existing_urls(cur, stream_type=2)
        log_lines.append(f"cache: {len(existing)} filmes existentes")
        for i, f in enumerate(filmes):
            try:
                nm = extrair_nome_arquivo(f["url"])
                if nm and nm in existing:
                    skipped += 1
                    continue
                cat_id = mapping_categoria.get(f["categoria"])
                if not cat_id and criar_categorias and f.get("categoria"):
                    cat_id = xui_db.ensure_category(cur, conn, f["categoria"], "movie")
                    if cat_id:
                        mapping_categoria[f["categoria"]] = cat_id
                if not cat_id:
                    skipped += 1
                    continue
                movie_props = json.dumps({
                    "name": f["nome"], "o_name": f["nome"],
                    "cover_big": f.get("logo") or "", "movie_image": f.get("logo") or "",
                    "release_date": "", "youtube_trailer": "", "director": "",
                    "actors": "", "cast": "", "description": "", "plot": "", "genre": "",
                    "backdrop_path": [f.get("logo")] if f.get("logo") else [],
                    "duration_secs": 0, "duration": "00:00:00", "video": [], "audio": [],
                    "bitrate": 0, "rating": "", "tmdb_id": "", "age": "", "mpaa_rating": "",
                    "rating_count_kinopoisk": 0, "country": "", "kinopoisk_url": "",
                })
                cur.execute(
                    """INSERT INTO streams
                       (category_id, stream_display_name, stream_source, stream_icon, type,
                        movie_propeties, direct_source, target_container, added)
                       VALUES (%s,%s,%s,%s,2,%s,1,%s,%s)""",
                    (cat_id, f["nome"], json.dumps([f["url"]]), f.get("logo") or "",
                     movie_props, extrair_extensao(f["url"]),
                     int(datetime.now().timestamp())),
                )
                sid = cur.lastrowid
                if server_id > 0:
                    xui_db.insert_stream_server(cur, sid, server_id)
                if nm: existing.add(nm)
                ids_bouquet.append(sid)
                inseridos += 1
                if inseridos % BATCH == 0:
                    conn.commit()
                    _tick(progress, i + 1, total, f"filmes: {inseridos} inseridos")
            except Exception as e:
                errors += 1
                log_lines.append(f"erro '{f.get('nome','?')}': {e}")
        conn.commit()
        added = 0
        if bouquet_id and ids_bouquet:
            added = xui_db.append_bouquet(cur, conn, bouquet_id, ids_bouquet)
        log_lines.append(f"bouquet {bouquet_id or '-'}: +{added}")
    _tick(progress, total, total, f"filmes concluído: +{inseridos}")
    return {"inseridos": inseridos, "skipped": skipped, "errors": errors,
            "bouquet_added": len(ids_bouquet), "log": log_lines}
