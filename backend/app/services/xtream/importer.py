"""Importa items parseados (M3U ou Xtream API) para dentro do MySQL do XUI.

Modos suportados:
- insert_only   → só insere se não existir (padrão / recomendado)
- insert_update → insere e atualiza dados quando já existe (não muda categoria)
- delete_all    → apaga TUDO do tipo antes e recria (força insert_only depois)
- mirror        → espelha origem: insere/atualiza + REMOVE órfãos ao final

Opções avançadas:
- skip_tmdb_existing        → pula item se já existe outro com mesmo tmdb_id
- dedup_by_full_url         → dedup usando URL completa (útil pra conteúdo próprio)
- dedup_by_url_only         → ignora título, dedup só por URL da fonte
- delete_dupes_before       → deleta itens com nome idêntico no destino antes
- remove_orphans            → remove órfãos ao final (implicit em mirror)
"""
from __future__ import annotations
import json
from datetime import datetime
from typing import Callable

from app.services.xtream import xui_db
from app.services.xtream.m3u_parser import extrair_nome_arquivo, extrair_extensao

BATCH = 100
ProgressCB = Callable[[int, int, str], None]
LogItemCB = Callable[[str], None]


def _tick(cb: ProgressCB | None, done: int, total: int, msg: str = ""):
    if cb:
        try: cb(done, total, msg)
        except Exception: pass


def _emit(cb: LogItemCB | None, line: str):
    if cb:
        try: cb(line)
        except Exception: pass


def _dedup_key(item: dict, opts: dict) -> tuple[str, str] | None:
    """Retorna (kind, value) para lookup em `existing`. None = sem chave."""
    url = item.get("url") or ""
    if opts.get("dedup_by_full_url") or opts.get("dedup_by_url_only"):
        return ("by_full_url", url.strip()) if url else None
    nm = extrair_nome_arquivo(url)
    return ("by_url", nm) if nm else None


def _find_existing(existing: dict, item: dict, opts: dict) -> int | None:
    key = _dedup_key(item, opts)
    if key and existing.get(key[0], {}).get(key[1]):
        return existing[key[0]][key[1]]
    if opts.get("dedup_by_url_only"): return None
    nn = xui_db._norm_name(item.get("nome") or "")
    if nn and nn in existing.get("by_name", {}):
        return existing["by_name"][nn]
    return None


def _build_movie_props(nome: str, tmdb: dict, cover: str, backdrop: str) -> str:
    return json.dumps({
        "name": nome, "o_name": nome,
        "cover_big": cover, "movie_image": cover,
        "release_date": tmdb.get("release_date", ""),
        "youtube_trailer": "", "director": "", "actors": "", "cast": "",
        "description": tmdb.get("plot", ""), "plot": tmdb.get("plot", ""),
        "genre": tmdb.get("genre", ""),
        "backdrop_path": [backdrop] if backdrop else [],
        "duration_secs": 0, "duration": "00:00:00", "video": [], "audio": [],
        "bitrate": 0,
        "rating": str(tmdb.get("rating", "")) if tmdb.get("rating") else "",
        "tmdb_id": tmdb.get("tmdb_id", ""),
        "age": "", "mpaa_rating": "",
        "rating_count_kinopoisk": 0, "country": "", "kinopoisk_url": "",
    })


def importar_canais(
    xui_config: dict, canais: list[dict],
    mapping_categoria: dict[str, int],
    bouquet_ids: list[int] | None = None,
    server_id: int = 0, criar_categorias: bool = True,
    mode: str = "insert_only", opts: dict | None = None,
    progress: ProgressCB | None = None,
    log_item: LogItemCB | None = None,
) -> dict:
    opts = opts or {}
    inseridos = skipped = errors = atualizados = 0
    ids_bouquet: list[int] = []
    touched_ids: set[int] = set()
    total = len(canais)

    with xui_db.cursor_from(xui_config) as (conn, cur):
        if mode == "delete_all":
            n = xui_db.delete_streams_of_type(cur, conn, 1)
            _tick(progress, 0, total, f"delete_all canais: -{n}")
            _emit(log_item, f"[REMOVIDOS] canais existentes: {n}")
            mode = "insert_only"

        if opts.get("delete_dupes_before"):
            names = {c["nome"] for c in canais if c.get("nome")}
            n = xui_db.delete_duplicate_names(cur, conn, 1, names)
            _tick(progress, 0, total, f"dedup por nome: -{n}")
            _emit(log_item, f"[DEDUP] canais removidos por nome duplicado: {n}")

        existing = xui_db.load_existing_streams(cur, 1)

        for i, c in enumerate(canais):
            nome = c.get("nome") or "?"
            categoria = c.get("categoria") or "-"
            idx = i + 1
            try:
                existing_id = _find_existing(existing, c, opts)
                cat_id = mapping_categoria.get(c.get("categoria") or "")
                if not cat_id and criar_categorias and c.get("categoria"):
                    cat_id = xui_db.ensure_category(cur, conn, c["categoria"], "live")
                    if cat_id: mapping_categoria[c["categoria"]] = cat_id
                if not cat_id:
                    skipped += 1
                    _emit(log_item, f"[IGNORADO] {idx}/{total} {nome} — sem categoria mapeada")
                    continue

                if existing_id:
                    touched_ids.add(existing_id)
                    if mode == "insert_only" or mode == "mirror":
                        skipped += 1
                        ids_bouquet.append(existing_id)
                        _emit(log_item, f"[IGNORADO] {idx}/{total} {nome} ({existing_id}) — já existe")
                        continue
                    if mode == "insert_update":
                        try:
                            cur.execute(
                                """UPDATE streams SET
                                    stream_display_name = %s, stream_source = %s, stream_icon = %s
                                   WHERE id = %s""",
                                (c["nome"], json.dumps([c["url"]]), c.get("logo") or "", existing_id),
                            )
                            atualizados += 1
                            ids_bouquet.append(existing_id)
                            _emit(log_item, f"[ATUALIZADO] {idx}/{total} {nome} ({existing_id}) [{categoria}]")
                            continue
                        except Exception as e:
                            errors += 1
                            _emit(log_item, f"[ERRO] {idx}/{total} {nome} — {e}")
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
                touched_ids.add(sid)
                if server_id > 0:
                    xui_db.insert_stream_server(cur, sid, server_id)
                ids_bouquet.append(sid)
                inseridos += 1
                nn = xui_db._norm_name(c["nome"])
                if nn: existing["by_name"][nn] = sid
                _emit(log_item, f"[INSERIDO] {idx}/{total} {nome} ({sid}) [{categoria}]")
                if inseridos % BATCH == 0:
                    conn.commit()
                    _tick(progress, i + 1, total, f"canais: +{inseridos} ~{atualizados}")
            except Exception as e:
                errors += 1
                _emit(log_item, f"[ERRO] {idx}/{total} {nome} — {e}")
        conn.commit()

        orphans_removed = 0
        if mode == "mirror" or opts.get("remove_orphans"):
            orphans_removed = xui_db.delete_orphan_streams(cur, conn, 1, touched_ids)
            if orphans_removed:
                _emit(log_item, f"[ÓRFÃOS] canais removidos: {orphans_removed}")

        bq_added = xui_db.append_bouquets(cur, conn, bouquet_ids or [], ids_bouquet)

    _tick(progress, total, total, f"canais concluído: +{inseridos} ~{atualizados}")
    return {"inseridos": inseridos, "atualizados": atualizados, "skipped": skipped,
            "errors": errors, "bouquet_added": bq_added, "orphans_removed": orphans_removed}


def importar_filmes(
    xui_config: dict, filmes: list[dict],
    mapping_categoria: dict[str, int],
    bouquet_ids: list[int] | None = None,
    server_id: int = 0, criar_categorias: bool = True,
    mode: str = "insert_only", opts: dict | None = None,
    progress: ProgressCB | None = None,
    log_item: LogItemCB | None = None,
) -> dict:
    opts = opts or {}
    inseridos = skipped = errors = atualizados = 0
    ids_bouquet: list[int] = []
    touched_ids: set[int] = set()
    total = len(filmes)

    with xui_db.cursor_from(xui_config) as (conn, cur):
        if mode == "delete_all":
            n = xui_db.delete_streams_of_type(cur, conn, 2)
            _tick(progress, 0, total, f"delete_all filmes: -{n}")
            _emit(log_item, f"[REMOVIDOS] filmes existentes: {n}")
            mode = "insert_only"
        if opts.get("delete_dupes_before"):
            names = {f["nome"] for f in filmes if f.get("nome")}
            n = xui_db.delete_duplicate_names(cur, conn, 2, names)
            _tick(progress, 0, total, f"dedup por nome: -{n}")
            _emit(log_item, f"[DEDUP] filmes removidos por nome duplicado: {n}")

        existing = xui_db.load_existing_streams(cur, 2)

        for i, f in enumerate(filmes):
            nome = f.get("nome") or "?"
            categoria = f.get("categoria") or "-"
            idx = i + 1
            try:
                tm = (f.get("_tmdb") or {}) if isinstance(f.get("_tmdb"), dict) else {}
                tmdb_id = str(tm.get("tmdb_id") or "").strip()

                if opts.get("skip_tmdb_existing") and tmdb_id and tmdb_id in existing.get("by_tmdb", {}):
                    skipped += 1
                    touched_ids.add(existing["by_tmdb"][tmdb_id])
                    _emit(log_item, f"[IGNORADO] {idx}/{total} {nome} — TMDB {tmdb_id} já existe")
                    continue

                existing_id = None
                if tmdb_id and tmdb_id in existing.get("by_tmdb", {}):
                    existing_id = existing["by_tmdb"][tmdb_id]
                if not existing_id:
                    existing_id = _find_existing(existing, f, opts)

                cat_id = mapping_categoria.get(f.get("categoria") or "")
                if not cat_id and criar_categorias and f.get("categoria"):
                    cat_id = xui_db.ensure_category(cur, conn, f["categoria"], "movie")
                    if cat_id: mapping_categoria[f["categoria"]] = cat_id
                if not cat_id:
                    skipped += 1
                    _emit(log_item, f"[IGNORADO] {idx}/{total} {nome} — sem categoria mapeada")
                    continue

                cover = tm.get("poster_url") or f.get("logo") or ""
                backdrop = tm.get("backdrop_url") or f.get("logo") or ""
                movie_props = _build_movie_props(f["nome"], tm, cover, backdrop)

                if existing_id:
                    touched_ids.add(existing_id)
                    if mode == "insert_only" or mode == "mirror":
                        skipped += 1
                        ids_bouquet.append(existing_id)
                        _emit(log_item, f"[IGNORADO] {idx}/{total} {nome} ({existing_id}) — título já existe")
                        continue
                    if mode == "insert_update":
                        xui_db.update_stream_movie(cur, conn, existing_id, cat_id,
                                                    f["nome"], f["url"], cover, movie_props)
                        atualizados += 1
                        ids_bouquet.append(existing_id)
                        _emit(log_item, f"[ATUALIZADO] {idx}/{total} {nome} ({existing_id}) [{categoria}]")
                        continue

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
                touched_ids.add(sid)
                if server_id > 0:
                    xui_db.insert_stream_server(cur, sid, server_id)
                ids_bouquet.append(sid)
                inseridos += 1
                nn = xui_db._norm_name(f["nome"])
                if nn: existing["by_name"][nn] = sid
                if tmdb_id: existing["by_tmdb"][tmdb_id] = sid
                _emit(log_item, f"[INSERIDO] {idx}/{total} {nome} ({sid}) [{categoria}]" + (f" TMDB:{tmdb_id}" if tmdb_id else ""))
                if inseridos % BATCH == 0:
                    conn.commit()
                    _tick(progress, i + 1, total, f"filmes: +{inseridos} ~{atualizados}")
            except Exception as e:
                errors += 1
                _emit(log_item, f"[ERRO] {idx}/{total} {nome} — {e}")
        conn.commit()

        orphans_removed = 0
        if mode == "mirror" or opts.get("remove_orphans"):
            orphans_removed = xui_db.delete_orphan_streams(cur, conn, 2, touched_ids)
            if orphans_removed:
                _emit(log_item, f"[ÓRFÃOS] filmes removidos: {orphans_removed}")

        bq_added = xui_db.append_bouquets(cur, conn, bouquet_ids or [], ids_bouquet)

    _tick(progress, total, total, f"filmes concluído: +{inseridos} ~{atualizados}")
    return {"inseridos": inseridos, "atualizados": atualizados, "skipped": skipped,
            "errors": errors, "bouquet_added": bq_added, "orphans_removed": orphans_removed}


def enrich_filmes_com_tmdb(filmes: list[dict], api_key: str | None = None,
                            language: str = "pt-BR",
                            progress: ProgressCB | None = None) -> None:
    from app.services.xtream import tmdb as tmdb_mod
    nomes = list({f["nome"] for f in filmes if f.get("nome")})
    if not nomes: return
    def _p(done, tot):
        if progress: progress(done, tot, f"TMDB filmes {done}/{tot}")
    result = tmdb_mod.buscar_em_lote(nomes, kind="movie", api_key=api_key,
                                      language=language, on_progress=_p)
    for f in filmes:
        f["_tmdb"] = result.get(f["nome"]) or {}


def importar_series(
    xui_config: dict, episodios: list[dict],
    mapping_categoria: dict[str, int],
    bouquet_ids: list[int] | None = None,
    server_id: int = 0, criar_categorias: bool = True,
    mode: str = "insert_only", opts: dict | None = None,
    usar_tmdb: bool = False, tmdb_api_key: str | None = None,
    tmdb_language: str = "pt-BR",
    progress: ProgressCB | None = None,
    log_item: LogItemCB | None = None,
) -> dict:
    from collections import defaultdict
    from app.services.xtream import tmdb as tmdb_mod
    opts = opts or {}

    inseridos = skipped = errors = 0
    series_criadas = 0
    series_ids_bouquet: list[int] = []
    touched_series: set[int] = set()
    total = len(episodios)

    grupos: dict[tuple, list[dict]] = defaultdict(list)
    for ep in episodios:
        grupos[(ep.get("serie") or ep.get("nome"), ep.get("categoria") or "Sem Categoria")].append(ep)

    tmdb_map: dict[str, dict] = {}
    if usar_tmdb:
        nomes = list({k[0] for k in grupos.keys()})
        def _p(d, t): _tick(progress, d, t, f"TMDB séries {d}/{t}")
        tmdb_map = tmdb_mod.buscar_em_lote(nomes, kind="tv", api_key=tmdb_api_key,
                                            language=tmdb_language, on_progress=_p)

    with xui_db.cursor_from(xui_config) as (conn, cur):
        if mode == "delete_all":
            n = xui_db.delete_all_series(cur, conn)
            _tick(progress, 0, total, f"delete_all séries: -{n}")
            _emit(log_item, f"[REMOVIDOS] séries existentes: {n}")
            mode = "insert_only"

        cache = xui_db.load_series_cache(cur)
        done_eps = 0
        for (serie_nome, categoria), eps in grupos.items():
            try:
                cat_id = mapping_categoria.get(categoria)
                if not cat_id and criar_categorias:
                    cat_id = xui_db.ensure_category(cur, conn, categoria, "series")
                    if cat_id: mapping_categoria[categoria] = cat_id
                if not cat_id:
                    skipped += len(eps); done_eps += len(eps)
                    _emit(log_item, f"[IGNORADO] série {serie_nome} — sem categoria mapeada ({len(eps)} eps)")
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
                    """, (serie_nome, cat_id, capa, capa, backdrop,
                          info.get("plot", ""),
                          str(info.get("rating", "")) if info.get("rating") else "",
                          info.get("genre", ""),
                          tmdb_id if tmdb_id else 0))
                    serie_id = cur.lastrowid
                    series_criadas += 1
                    xui_db.remember_series(cache, serie_nome, tmdb_id, serie_id)
                    _emit(log_item, f"[SÉRIE NOVA] {serie_nome} ({serie_id}) [{categoria}]" + (f" TMDB:{tmdb_id}" if tmdb_id else ""))

                touched_series.add(serie_id)
                if serie_id not in series_ids_bouquet:
                    series_ids_bouquet.append(serie_id)

                eps.sort(key=lambda x: (int(x.get("temp") or 1), int(x.get("ep") or 1)))
                for ep in eps:
                    done_eps += 1
                    temp = int(ep.get("temp") or 1); num = int(ep.get("ep") or 1)
                    ep_label = f"{serie_nome} S{temp:02d}E{num:02d}"
                    if (serie_id, temp, num) in cache["episodes"]:
                        skipped += 1
                        _emit(log_item, f"[IGNORADO] {done_eps}/{total} {ep_label} — já existe")
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
                    """, (ep.get("nome") or ep_label,
                          json.dumps([ep["url"]]),
                          ep.get("logo") or "", props,
                          extrair_extensao(ep["url"]),
                          int(datetime.now().timestamp())))
                    stream_id = cur.lastrowid
                    cur.execute("""INSERT INTO series_episodes (season_num, sort, series_id, stream_id)
                                   VALUES (%s,%s,%s,%s)""", (temp, num, serie_id, stream_id))
                    if server_id > 0:
                        xui_db.insert_stream_server(cur, stream_id, server_id)
                    cache["episodes"].add((serie_id, temp, num))
                    inseridos += 1
                    _emit(log_item, f"[INSERIDO] {done_eps}/{total} {ep_label} ({stream_id})")
                    if inseridos % BATCH == 0:
                        conn.commit()
                        _tick(progress, done_eps, total, f"séries: +{inseridos} eps")
            except Exception as e:
                errors += 1
                _emit(log_item, f"[ERRO] série {serie_nome} — {e}")
        conn.commit()

        orphans_removed = 0
        if mode == "mirror" or opts.get("remove_orphans"):
            orphans_removed = xui_db.delete_orphan_series(cur, conn, touched_series)
            if orphans_removed:
                _emit(log_item, f"[ÓRFÃOS] séries removidas: {orphans_removed}")

        bq_added = xui_db.append_series_bouquets(cur, conn, bouquet_ids or [], series_ids_bouquet)

    _tick(progress, total, total, f"séries concluído: +{inseridos} eps")
    return {"inseridos": inseridos, "skipped": skipped, "errors": errors,
            "series_criadas": series_criadas, "bouquet_added": bq_added,
            "orphans_removed": orphans_removed}
