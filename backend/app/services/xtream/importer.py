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
                tm = (f.get("_tmdb") or {}) if isinstance(f.get("_tmdb"), dict) else {}
                cover = tm.get("poster_url") or f.get("logo") or ""
                backdrop = tm.get("backdrop_url") or f.get("logo") or ""
                movie_props = json.dumps({
                    "name": f["nome"], "o_name": f["nome"],
                    "cover_big": cover, "movie_image": cover,
                    "release_date": tm.get("release_date", ""),
                    "youtube_trailer": "", "director": "",
                    "actors": "", "cast": "",
                    "description": tm.get("plot", ""), "plot": tm.get("plot", ""),
                    "genre": tm.get("genre", ""),
                    "backdrop_path": [backdrop] if backdrop else [],
                    "duration_secs": 0, "duration": "00:00:00", "video": [], "audio": [],
                    "bitrate": 0,
                    "rating": str(tm.get("rating", "")) if tm.get("rating") else "",
                    "tmdb_id": tm.get("tmdb_id", ""),
                    "age": "", "mpaa_rating": "",
                    "rating_count_kinopoisk": 0, "country": "", "kinopoisk_url": "",
                })
                cur.execute(
                    """INSERT INTO streams
                       (category_id, stream_display_name, stream_source, stream_icon, type,
                        movie_propeties, direct_source, target_container, added)
                       VALUES (%s,%s,%s,%s,2,%s,1,%s,%s)""",
                    (cat_id, f["nome"], json.dumps([f["url"]]), cover,
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


def enrich_filmes_com_tmdb(filmes: list[dict], api_key: str | None = None,
                            progress: ProgressCB | None = None) -> None:
    """Popula f['_tmdb'] com {tmdb_id, plot, genre, rating, poster_url, backdrop_url}
    consultando TMDB em paralelo (mesmos itens; mutação in-place)."""
    from app.services.xtream import tmdb as tmdb_mod
    nomes = list({f["nome"] for f in filmes if f.get("nome")})
    if not nomes: return
    def _p(done, tot):
        if progress: progress(done, tot, f"TMDB filmes {done}/{tot}")
    result = tmdb_mod.buscar_em_lote(nomes, kind="movie", api_key=api_key, on_progress=_p)
    for f in filmes:
        f["_tmdb"] = result.get(f["nome"]) or {}


def importar_series(
    xui_config: dict,
    episodios: list[dict],
    mapping_categoria: dict[str, int],
    bouquet_id: int | None = None,
    server_id: int = 0,
    criar_categorias: bool = True,
    usar_tmdb: bool = False,
    tmdb_api_key: str | None = None,
    progress: ProgressCB | None = None,
) -> dict:
    """Importa episódios de séries. Cada item deve ter: serie, temp, ep, nome, categoria, logo, url."""
    from collections import defaultdict
    from app.services.xtream import tmdb as tmdb_mod

    inseridos = skipped = errors = 0
    series_criadas = 0
    series_ids_bouquet: list[int] = []
    log_lines: list[str] = []
    total = len(episodios)

    grupos: dict[tuple, list[dict]] = defaultdict(list)
    for ep in episodios:
        grupos[(ep.get("serie") or ep.get("nome"), ep.get("categoria") or "Sem Categoria")].append(ep)
    log_lines.append(f"{total} episódios em {len(grupos)} séries")

    tmdb_map: dict[str, dict] = {}
    if usar_tmdb:
        nomes = list({k[0] for k in grupos.keys()})
        def _p(d, t): _tick(progress, d, t, f"TMDB séries {d}/{t}")
        log_lines.append(f"TMDB: buscando {len(nomes)} títulos…")
        tmdb_map = tmdb_mod.buscar_em_lote(nomes, kind="tv", api_key=tmdb_api_key, on_progress=_p)
        log_lines.append(f"TMDB: {sum(1 for v in tmdb_map.values() if v.get('tmdb_id'))} matches")

    with xui_db.cursor_from(xui_config) as (conn, cur):
        cache = xui_db.load_series_cache(cur)
        log_lines.append(f"cache: {len(cache['series_by_name'])} séries, {len(cache['episodes'])} episódios existentes")

        done_eps = 0
        for (serie_nome, categoria), eps in grupos.items():
            try:
                cat_id = mapping_categoria.get(categoria)
                if not cat_id and criar_categorias:
                    cat_id = xui_db.ensure_category(cur, conn, categoria, "series")
                    if cat_id: mapping_categoria[categoria] = cat_id
                if not cat_id:
                    skipped += len(eps); done_eps += len(eps)
                    continue

                info = tmdb_map.get(serie_nome, {}) if usar_tmdb else {}
                tmdb_id = info.get("tmdb_id") or ""

                serie_id = xui_db.find_series(cache, serie_nome, tmdb_id)
                if not serie_id:
                    capa = info.get("poster_url") or (eps[0].get("logo") or "")
                    backdrop = json.dumps([info.get("backdrop_url") or capa])
                    cur.execute("""
                        INSERT INTO series
                            (title, category_id, cover, cover_big, backdrop_path,
                             plot, cast, rating, genre, youtube_trailer, tmdb_id)
                        VALUES (%s,%s,%s,%s,%s,%s,'',%s,%s,'',%s)
                    """, (
                        serie_nome, cat_id, capa, capa, backdrop,
                        info.get("plot", ""),
                        str(info.get("rating", "")) if info.get("rating") else "",
                        info.get("genre", ""),
                        tmdb_id if tmdb_id else 0,
                    ))
                    serie_id = cur.lastrowid
                    series_criadas += 1
                    xui_db.remember_series(cache, serie_nome, tmdb_id, serie_id)

                if serie_id and serie_id not in series_ids_bouquet:
                    series_ids_bouquet.append(serie_id)

                eps.sort(key=lambda x: (int(x.get("temp") or 1), int(x.get("ep") or 1)))
                for ep in eps:
                    done_eps += 1
                    temp = int(ep.get("temp") or 1); num = int(ep.get("ep") or 1)
                    if (serie_id, temp, num) in cache["episodes"]:
                        skipped += 1
                        continue
                    props = json.dumps({
                        "release_date": "", "plot": info.get("plot", ""),
                        "duration_secs": 0, "duration": "00:00:00",
                        "movie_image": ep.get("logo") or "",
                        "video": [], "audio": [], "bitrate": 0,
                        "rating": str(info.get("rating", "")) if info.get("rating") else "",
                        "season": str(temp), "tmdb_id": tmdb_id or "",
                        "genre": info.get("genre", ""),
                        "actors": "", "youtube_trailer": "",
                    })
                    cur.execute("""
                        INSERT INTO streams
                            (stream_display_name, stream_source, stream_icon, type,
                             movie_propeties, direct_source, target_container, added)
                        VALUES (%s,%s,%s,5,%s,1,%s,%s)
                    """, (
                        ep.get("nome") or f"{serie_nome} S{temp:02d}E{num:02d}",
                        json.dumps([ep["url"]]),
                        ep.get("logo") or "",
                        props,
                        extrair_extensao(ep["url"]),
                        int(datetime.now().timestamp()),
                    ))
                    stream_id = cur.lastrowid
                    cur.execute("""
                        INSERT INTO series_episodes (season_num, sort, series_id, stream_id)
                        VALUES (%s,%s,%s,%s)
                    """, (temp, num, serie_id, stream_id))
                    if server_id > 0:
                        xui_db.insert_stream_server(cur, stream_id, server_id)
                    cache["episodes"].add((serie_id, temp, num))
                    inseridos += 1
                    if inseridos % BATCH == 0:
                        conn.commit()
                        _tick(progress, done_eps, total, f"séries: {inseridos} eps inseridos")
            except Exception as e:
                errors += 1
                log_lines.append(f"erro série '{serie_nome}': {e}")
        conn.commit()

        added = 0
        if bouquet_id and series_ids_bouquet:
            added = xui_db.append_series_bouquet(cur, conn, bouquet_id, series_ids_bouquet)
        log_lines.append(f"bouquet series {bouquet_id or '-'}: +{added} (séries novas: {series_criadas})")
    _tick(progress, total, total, f"séries concluído: +{inseridos} eps")
    return {"inseridos": inseridos, "skipped": skipped, "errors": errors,
            "series_criadas": series_criadas, "bouquet_added": added if bouquet_id else 0,
            "log": log_lines}
