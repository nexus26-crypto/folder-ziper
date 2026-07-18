"""Conexão + autodetecção de estrutura de painéis XUI ONE / Xtream Codes."""
from __future__ import annotations
import logging
from contextlib import contextmanager
from typing import Any
import mysql.connector

log = logging.getLogger(__name__)


def connect(config: dict) -> mysql.connector.MySQLConnection:
    return mysql.connector.connect(
        host=config["host"],
        user=config["db_user"],
        password=config["db_pass"],
        database=config["db_name"],
        port=int(config.get("port") or 3306),
        charset="utf8mb4",
        collation="utf8mb4_unicode_ci",
        connection_timeout=15,
    )


@contextmanager
def cursor_from(config: dict):
    conn = connect(config)
    cur = conn.cursor(buffered=True)
    try:
        yield conn, cur
    finally:
        try: cur.close()
        except Exception: pass
        try: conn.close()
        except Exception: pass


def detect_structure(cur, panel_type: str | None = None) -> dict[str, Any]:
    """Autodetect ou honra um panel_type manual: auto|xtream_codes|xui_one|xui_r22."""
    est = {"tabela_servidores": None, "tabela_streams_servers": None,
           "tem_series": False, "versao": "desconhecida", "panel_type": panel_type or "auto"}
    cur.execute("SHOW TABLES")
    tabs = [t[0].lower() for t in cur.fetchall()]
    if "streaming_servers" in tabs: est["tabela_servidores"] = "streaming_servers"
    elif "servers" in tabs: est["tabela_servidores"] = "servers"
    if "streams_servers" in tabs: est["tabela_streams_servers"] = "streams_servers"
    elif "stream_servers" in tabs: est["tabela_streams_servers"] = "stream_servers"
    est["tem_series"] = "series" in tabs

    # Override manual — usuário confirmou o tipo
    if panel_type == "xtream_codes":
        est["versao"] = "Xtream Codes (manual)"
        est["tabela_servidores"] = est["tabela_servidores"] or "streaming_servers"
    elif panel_type == "xui_one":
        est["versao"] = "XUI ONE (manual)"
        est["tabela_servidores"] = est["tabela_servidores"] or "streaming_servers"
    elif panel_type == "xui_r22":
        est["versao"] = "XUI ONE r22+ (manual)"
        est["tabela_servidores"] = est["tabela_servidores"] or "servers"
    else:
        # auto
        if "reg_users" in tabs: est["versao"] = "XUI ONE"
        elif "users" in tabs and "streaming_servers" in tabs: est["versao"] = "Xtream Codes"
        elif "users" in tabs and "servers" in tabs: est["versao"] = "XUI ONE r22+"
    return est



def test_connection(config: dict) -> dict:
    try:
        with cursor_from(config) as (_conn, cur):
            est = detect_structure(cur, config.get("panel_type"))
            return {
                "ok": True, "version": est["versao"], "structure": est,
                "servers": get_servers(cur, est), "bouquets": get_bouquets(cur),
                "categories": {
                    "live": get_categories(cur, "live"),
                    "movie": get_categories(cur, "movie"),
                    "series": get_categories(cur, "series"),
                },
            }
    except Exception as e:
        return {"ok": False, "error": str(e)}



def get_servers(cur, est: dict) -> list[dict]:
    tabelas = [est.get("tabela_servidores")] if est.get("tabela_servidores") else ["streaming_servers", "servers"]
    for tab in tabelas:
        if not tab: continue
        for col in ("server_name", "name", "server_ip"):
            try:
                cur.execute(f"SELECT id, {col} FROM {tab} ORDER BY id")
                rows = cur.fetchall()
                if rows:
                    return [{"id": 0, "nome": "Padrão (Auto)"}] + [
                        {"id": r[0], "nome": f"🖥️ {r[1]} (ID:{r[0]})"} for r in rows
                    ]
            except Exception: continue
    return [{"id": 0, "nome": "Padrão (Auto)"}]


def get_bouquets(cur) -> list[dict]:
    for col in ("bouquet_name", "name"):
        try:
            cur.execute(f"SELECT id, {col} FROM bouquets ORDER BY {col}")
            rows = cur.fetchall()
            if rows: return [{"id": r[0], "nome": r[1]} for r in rows]
        except Exception: continue
    return []


def get_categories(cur, tipo: str = "live") -> list[dict]:
    tipo_map = {"live": 1, "movie": 2, "series": 3}
    ct = tipo_map.get(tipo, 1)
    for q in (
        f"SELECT id, category_name FROM stream_categories WHERE category_type = '{tipo}' ORDER BY category_name",
        f"SELECT id, category_name FROM stream_categories WHERE category_type = {ct} ORDER BY category_name",
    ):
        try:
            cur.execute(q)
            rows = cur.fetchall()
            if rows: return [{"id": r[0], "nome": r[1]} for r in rows]
        except Exception: continue
    return []


def insert_stream_server(cur, stream_id: int, server_id: int) -> bool:
    if not server_id or server_id <= 0: return False
    for tab in ("streams_servers", "stream_servers"):
        try:
            cur.execute(f"INSERT INTO {tab} (stream_id, server_id) VALUES (%s, %s)", (stream_id, server_id))
            return True
        except Exception: continue
    return False


def ensure_category(cur, conn, nome: str, tipo: str) -> int | None:
    try:
        cur.execute("SELECT id FROM stream_categories WHERE category_name = %s AND category_type = %s", (nome, tipo))
        r = cur.fetchone()
        if r: return r[0]
        cur.execute("INSERT INTO stream_categories (category_type, category_name, is_adult) VALUES (%s, %s, 0)", (tipo, nome))
        conn.commit()
        return cur.lastrowid
    except Exception as e:
        log.warning(f"ensure_category err: {e}")
        return None


def load_existing_streams(cur, stream_type: int) -> dict:
    """Retorna:
       {'by_url': {nome_arquivo: id}, 'by_name': {nome_norm: id},
        'by_tmdb': {tmdb_id: id}, 'by_full_url': {url_completa: id},
        'all_ids': set}"""
    import json
    out = {"by_url": {}, "by_name": {}, "by_tmdb": {}, "by_full_url": {}, "all_ids": set()}
    try:
        cols = "id, stream_display_name, stream_source"
        extra = ""
        if stream_type == 2:
            cols += ", movie_propeties"
        cur.execute(f"SELECT {cols} FROM streams WHERE type = %s", (stream_type,))
        for row in cur.fetchall():
            sid = row[0]; name = row[1] or ""; src = row[2]; props = row[3] if len(row) > 3 else None
            out["all_ids"].add(sid)
            nn = _norm_name(name)
            if nn: out["by_name"][nn] = sid
            if src:
                try: urls = json.loads(src) if src.startswith("[") else [src]
                except Exception: urls = [src]
                for u in urls:
                    if not u: continue
                    nm = u.split("?")[0].split("/")[-1].strip().lower()
                    if nm: out["by_url"][nm] = sid
                    out["by_full_url"][u.strip()] = sid
            if props:
                try:
                    pj = json.loads(props) if isinstance(props, str) else props
                    tid = str(pj.get("tmdb_id") or "").strip()
                    if tid and tid not in ("0", "None"): out["by_tmdb"][tid] = sid
                except Exception: pass
    except Exception as e:
        log.warning(f"load_existing_streams err: {e}")
    return out


def load_existing_urls(cur, stream_type: int) -> set[str]:
    return set(load_existing_streams(cur, stream_type)["by_url"].keys())


def append_bouquet(cur, conn, bouquet_id: int, stream_ids: list[int]) -> int:
    import json
    if not bouquet_id or not stream_ids: return 0
    cur.execute("SELECT bouquet_channels FROM bouquets WHERE id = %s", (bouquet_id,))
    r = cur.fetchone()
    if not r: return 0
    existentes = []
    if r[0]:
        try: existentes = json.loads(r[0])
        except Exception: existentes = []
    novos = [sid for sid in stream_ids if sid not in existentes]
    existentes.extend(novos)
    cur.execute("UPDATE bouquets SET bouquet_channels = %s WHERE id = %s", (json.dumps(existentes), bouquet_id))
    conn.commit()
    return len(novos)


def append_bouquets(cur, conn, bouquet_ids: list[int], stream_ids: list[int]) -> int:
    total = 0
    for bid in bouquet_ids or []:
        total += append_bouquet(cur, conn, int(bid), stream_ids)
    return total


def append_series_bouquet(cur, conn, bouquet_id: int, series_ids: list[int]) -> int:
    import json
    if not bouquet_id or not series_ids: return 0
    cur.execute("SELECT bouquet_series FROM bouquets WHERE id = %s", (bouquet_id,))
    r = cur.fetchone()
    if not r: return 0
    existentes = []
    if r[0]:
        try: existentes = json.loads(r[0])
        except Exception: existentes = []
    novos = [sid for sid in series_ids if sid not in existentes]
    existentes.extend(novos)
    cur.execute("UPDATE bouquets SET bouquet_series = %s WHERE id = %s", (json.dumps(existentes), bouquet_id))
    conn.commit()
    return len(novos)


def append_series_bouquets(cur, conn, bouquet_ids: list[int], series_ids: list[int]) -> int:
    total = 0
    for bid in bouquet_ids or []:
        total += append_series_bouquet(cur, conn, int(bid), series_ids)
    return total


def delete_streams_of_type(cur, conn, stream_type: int) -> int:
    """Excluir TUDO daquele tipo (usado no modo delete_all)."""
    try:
        cur.execute("SELECT id FROM streams WHERE type = %s", (stream_type,))
        ids = [r[0] for r in cur.fetchall()]
        if not ids: return 0
        for tab in ("streams_servers", "stream_servers"):
            try: cur.execute(f"DELETE FROM {tab} WHERE stream_id IN ({','.join('%s'*len(ids))})", ids)
            except Exception: pass
        cur.execute(f"DELETE FROM streams WHERE id IN ({','.join('%s'*len(ids))})", ids)
        conn.commit()
        return len(ids)
    except Exception as e:
        log.warning(f"delete_streams_of_type err: {e}")
        return 0


def delete_all_series(cur, conn) -> int:
    try:
        cur.execute("SELECT stream_id FROM series_episodes")
        ep_ids = [r[0] for r in cur.fetchall()]
        if ep_ids:
            for tab in ("streams_servers", "stream_servers"):
                try: cur.execute(f"DELETE FROM {tab} WHERE stream_id IN ({','.join('%s'*len(ep_ids))})", ep_ids)
                except Exception: pass
            cur.execute(f"DELETE FROM streams WHERE id IN ({','.join('%s'*len(ep_ids))})", ep_ids)
        cur.execute("DELETE FROM series_episodes")
        cur.execute("SELECT COUNT(*) FROM series")
        n = cur.fetchone()[0]
        cur.execute("DELETE FROM series")
        conn.commit()
        return n
    except Exception as e:
        log.warning(f"delete_all_series err: {e}")
        return 0


def delete_orphan_streams(cur, conn, stream_type: int, keep_ids: set[int]) -> int:
    """Remove streams do tipo que não estão em keep_ids (modo mirror / remove_orphans)."""
    try:
        cur.execute("SELECT id FROM streams WHERE type = %s", (stream_type,))
        all_ids = [r[0] for r in cur.fetchall()]
        remove = [i for i in all_ids if i not in keep_ids]
        if not remove: return 0
        for tab in ("streams_servers", "stream_servers"):
            try: cur.execute(f"DELETE FROM {tab} WHERE stream_id IN ({','.join('%s'*len(remove))})", remove)
            except Exception: pass
        cur.execute(f"DELETE FROM streams WHERE id IN ({','.join('%s'*len(remove))})", remove)
        conn.commit()
        return len(remove)
    except Exception as e:
        log.warning(f"delete_orphan_streams err: {e}")
        return 0


def delete_orphan_series(cur, conn, keep_ids: set[int]) -> int:
    try:
        cur.execute("SELECT id FROM series")
        all_ids = [r[0] for r in cur.fetchall()]
        remove = [i for i in all_ids if i not in keep_ids]
        if not remove: return 0
        cur.execute(f"SELECT stream_id FROM series_episodes WHERE series_id IN ({','.join('%s'*len(remove))})", remove)
        ep_ids = [r[0] for r in cur.fetchall()]
        if ep_ids:
            for tab in ("streams_servers", "stream_servers"):
                try: cur.execute(f"DELETE FROM {tab} WHERE stream_id IN ({','.join('%s'*len(ep_ids))})", ep_ids)
                except Exception: pass
            cur.execute(f"DELETE FROM streams WHERE id IN ({','.join('%s'*len(ep_ids))})", ep_ids)
        cur.execute(f"DELETE FROM series_episodes WHERE series_id IN ({','.join('%s'*len(remove))})", remove)
        cur.execute(f"DELETE FROM series WHERE id IN ({','.join('%s'*len(remove))})", remove)
        conn.commit()
        return len(remove)
    except Exception as e:
        log.warning(f"delete_orphan_series err: {e}")
        return 0


def delete_duplicate_names(cur, conn, stream_type: int, names: set[str]) -> int:
    """Remove streams cujo display_name está em `names` (usado antes de sync)."""
    if not names: return 0
    try:
        placeholders = ",".join(["%s"] * len(names))
        cur.execute(f"SELECT id FROM streams WHERE type = %s AND stream_display_name IN ({placeholders})",
                    (stream_type, *names))
        ids = [r[0] for r in cur.fetchall()]
        if not ids: return 0
        for tab in ("streams_servers", "stream_servers"):
            try: cur.execute(f"DELETE FROM {tab} WHERE stream_id IN ({','.join('%s'*len(ids))})", ids)
            except Exception: pass
        cur.execute(f"DELETE FROM streams WHERE id IN ({','.join('%s'*len(ids))})", ids)
        conn.commit()
        return len(ids)
    except Exception as e:
        log.warning(f"delete_duplicate_names err: {e}")
        return 0


def update_stream_movie(cur, conn, stream_id: int, cat_id: int, name: str, url: str, cover: str, movie_props: str) -> bool:
    """Modo insert_update: atualiza dados do filme existente sem alterar categoria."""
    import json
    try:
        cur.execute(
            """UPDATE streams SET
                stream_display_name = %s,
                stream_source = %s,
                stream_icon = %s,
                movie_propeties = %s
               WHERE id = %s""",
            (name, json.dumps([url]), cover, movie_props, stream_id),
        )
        conn.commit()
        return True
    except Exception as e:
        log.warning(f"update_stream_movie err: {e}")
        return False


def _norm_name(s: str) -> str:
    import re, unicodedata
    if not s: return ""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "", s.lower())
    return s


def load_series_cache(cur) -> dict:
    cache = {"series_by_name": {}, "series_by_tmdb": {}, "episodes": set()}
    try:
        cur.execute("SELECT id, title, tmdb_id FROM series")
        for sid, title, tmdb in cur.fetchall():
            n = _norm_name(title or "")
            if n: cache["series_by_name"][n] = sid
            if tmdb and str(tmdb) not in ("0", "", "None"):
                cache["series_by_tmdb"][str(tmdb)] = sid
    except Exception: pass
    try:
        cur.execute("SELECT series_id, season_num, sort FROM series_episodes")
        for sid, season, sort in cur.fetchall():
            cache["episodes"].add((int(sid), int(season), int(sort)))
    except Exception: pass
    return cache


def find_series(cache: dict, nome: str, tmdb_id: str | None) -> int | None:
    if tmdb_id and str(tmdb_id) in cache["series_by_tmdb"]:
        return cache["series_by_tmdb"][str(tmdb_id)]
    return cache["series_by_name"].get(_norm_name(nome))


def remember_series(cache: dict, nome: str, tmdb_id: str | None, sid: int):
    n = _norm_name(nome)
    if n: cache["series_by_name"][n] = sid
    if tmdb_id: cache["series_by_tmdb"][str(tmdb_id)] = sid
