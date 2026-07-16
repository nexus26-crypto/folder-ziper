"""Conexão + autodetecção de estrutura de painéis XUI ONE / Xtream Codes.

Portado do legado (`app.py::detectar_estrutura_banco`, `obter_bouquets_auto`,
`obter_categorias_auto`, `inserir_stream_servidor`).
"""
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


def detect_structure(cur) -> dict[str, Any]:
    """Autodetecta estrutura (retorna dict com tabelas/colunas + versão)."""
    est = {
        "tabela_servidores": None,
        "tabela_streams_servers": None,
        "tem_series": False,
        "versao": "desconhecida",
    }
    cur.execute("SHOW TABLES")
    tabs = [t[0].lower() for t in cur.fetchall()]

    if "streaming_servers" in tabs:
        est["tabela_servidores"] = "streaming_servers"
    elif "servers" in tabs:
        est["tabela_servidores"] = "servers"

    if "streams_servers" in tabs:
        est["tabela_streams_servers"] = "streams_servers"
    elif "stream_servers" in tabs:
        est["tabela_streams_servers"] = "stream_servers"

    est["tem_series"] = "series" in tabs

    if "reg_users" in tabs:
        est["versao"] = "XUI ONE"
    elif "users" in tabs and "streaming_servers" in tabs:
        est["versao"] = "Xtream Codes"
    elif "users" in tabs and "servers" in tabs:
        est["versao"] = "XUI Moderno"
    return est


def test_connection(config: dict) -> dict:
    """Testa conexão e retorna {ok, version, servers, bouquets, categories}."""
    try:
        with cursor_from(config) as (_conn, cur):
            est = detect_structure(cur)
            servers = get_servers(cur, est)
            bouquets = get_bouquets(cur)
            cats_live = get_categories(cur, "live")
            cats_movie = get_categories(cur, "movie")
            cats_series = get_categories(cur, "series")
            return {
                "ok": True,
                "version": est["versao"],
                "structure": est,
                "servers": servers,
                "bouquets": bouquets,
                "categories": {"live": cats_live, "movie": cats_movie, "series": cats_series},
            }
    except Exception as e:
        return {"ok": False, "error": str(e)}


def get_servers(cur, est: dict) -> list[dict]:
    servidores = [{"id": 0, "nome": "Padrão (Auto)"}]
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
            except Exception:
                continue
    return servidores


def get_bouquets(cur) -> list[dict]:
    for col in ("bouquet_name", "name"):
        try:
            cur.execute(f"SELECT id, {col} FROM bouquets ORDER BY {col}")
            rows = cur.fetchall()
            if rows:
                return [{"id": r[0], "nome": r[1]} for r in rows]
        except Exception:
            continue
    return []


def get_categories(cur, tipo: str = "live") -> list[dict]:
    tipo_map = {"live": 1, "movie": 2, "series": 3}
    ct = tipo_map.get(tipo, 1)
    queries = [
        f"SELECT id, category_name FROM stream_categories WHERE category_type = '{tipo}' ORDER BY category_name",
        f"SELECT id, category_name FROM stream_categories WHERE category_type = {ct} ORDER BY category_name",
    ]
    for q in queries:
        try:
            cur.execute(q)
            rows = cur.fetchall()
            if rows:
                return [{"id": r[0], "nome": r[1]} for r in rows]
        except Exception:
            continue
    return []


def insert_stream_server(cur, stream_id: int, server_id: int) -> bool:
    if not server_id or server_id <= 0:
        return False
    for tab in ("streams_servers", "stream_servers"):
        try:
            cur.execute(f"INSERT INTO {tab} (stream_id, server_id) VALUES (%s, %s)", (stream_id, server_id))
            return True
        except Exception:
            continue
    return False


def ensure_category(cur, conn, nome: str, tipo: str) -> int | None:
    """Cria (se não existir) e retorna id. tipo: 'live'|'movie'|'series'."""
    try:
        cur.execute(
            "SELECT id FROM stream_categories WHERE category_name = %s AND category_type = %s",
            (nome, tipo),
        )
        r = cur.fetchone()
        if r:
            return r[0]
        cur.execute(
            "INSERT INTO stream_categories (category_type, category_name, is_adult) VALUES (%s, %s, 0)",
            (tipo, nome),
        )
        conn.commit()
        return cur.lastrowid
    except Exception as e:
        log.warning(f"ensure_category err: {e}")
        return None


def load_existing_urls(cur, stream_type: int) -> set[str]:
    """Retorna nome-de-arquivo (dedup key) dos streams existentes daquele tipo."""
    import json, re
    urls: set[str] = set()
    try:
        cur.execute("SELECT stream_source FROM streams WHERE type = %s", (stream_type,))
        for (src,) in cur.fetchall():
            if not src: continue
            try:
                raw = json.loads(src) if src.startswith("[") else [src]
            except Exception:
                raw = [src]
            for u in raw:
                if not u: continue
                nm = u.split("?")[0].split("/")[-1].strip().lower()
                if nm:
                    urls.add(nm)
    except Exception:
        pass
    return urls


def append_bouquet(cur, conn, bouquet_id: int, stream_ids: list[int]) -> int:
    """Adiciona stream_ids ao bouquet (dedup). Retorna quantos foram adicionados."""
    import json
    if not bouquet_id or not stream_ids:
        return 0
    cur.execute("SELECT bouquet_channels FROM bouquets WHERE id = %s", (bouquet_id,))
    r = cur.fetchone()
    if not r:
        return 0
    existentes = []
    if r[0]:
        try:
            existentes = json.loads(r[0])
        except Exception:
            existentes = []
    novos = [sid for sid in stream_ids if sid not in existentes]
    existentes.extend(novos)
    cur.execute("UPDATE bouquets SET bouquet_channels = %s WHERE id = %s", (json.dumps(existentes), bouquet_id))
    conn.commit()
    return len(novos)


def append_series_bouquet(cur, conn, bouquet_id: int, series_ids: list[int]) -> int:
    """Bouquet de séries usa a coluna bouquet_series."""
    import json
    if not bouquet_id or not series_ids:
        return 0
    cur.execute("SELECT bouquet_series FROM bouquets WHERE id = %s", (bouquet_id,))
    r = cur.fetchone()
    if not r:
        return 0
    existentes = []
    if r[0]:
        try: existentes = json.loads(r[0])
        except Exception: existentes = []
    novos = [sid for sid in series_ids if sid not in existentes]
    existentes.extend(novos)
    cur.execute("UPDATE bouquets SET bouquet_series = %s WHERE id = %s", (json.dumps(existentes), bouquet_id))
    conn.commit()
    return len(novos)


def _norm_name(s: str) -> str:
    import re, unicodedata
    if not s: return ""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "", s.lower())
    return s


def load_series_cache(cur) -> dict:
    """Carrega cache de séries e episódios existentes.
    Retorna:
      {'series_by_name': {norm: id}, 'series_by_tmdb': {tmdb: id},
       'episodes': set((series_id, season, sort))}
    """
    cache = {"series_by_name": {}, "series_by_tmdb": {}, "episodes": set()}
    try:
        cur.execute("SELECT id, title, tmdb_id FROM series")
        for sid, title, tmdb in cur.fetchall():
            n = _norm_name(title or "")
            if n: cache["series_by_name"][n] = sid
            if tmdb and str(tmdb) not in ("0", "", "None"):
                cache["series_by_tmdb"][str(tmdb)] = sid
    except Exception:
        pass
    try:
        cur.execute("SELECT series_id, season_num, sort FROM series_episodes")
        for sid, season, sort in cur.fetchall():
            cache["episodes"].add((int(sid), int(season), int(sort)))
    except Exception:
        pass
    return cache


def find_series(cache: dict, nome: str, tmdb_id: str | None) -> int | None:
    if tmdb_id and str(tmdb_id) in cache["series_by_tmdb"]:
        return cache["series_by_tmdb"][str(tmdb_id)]
    n = _norm_name(nome)
    return cache["series_by_name"].get(n)


def remember_series(cache: dict, nome: str, tmdb_id: str | None, sid: int):
    n = _norm_name(nome)
    if n: cache["series_by_name"][n] = sid
    if tmdb_id: cache["series_by_tmdb"][str(tmdb_id)] = sid
