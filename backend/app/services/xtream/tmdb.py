"""Cliente TMDB — portado do legado.

- limpar_nome_tmdb: remove anos/qualidades/tags do título antes da busca
- buscar_info_tmdb_filme / _serie: pega poster, sinopse, gênero, rating
- buscar_em_lote: ThreadPoolExecutor pra paralelizar
- cache em memória por processo (dura enquanto o worker vive)

TMDB API key: passa via arg ou usa env TMDB_API_KEY. Se não houver, retorna vazio.
"""
from __future__ import annotations
import os
import re
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
import httpx

log = logging.getLogger(__name__)

TMDB_BASE = "https://api.themoviedb.org/3"
TMDB_IMG = "https://image.tmdb.org/t/p"
TMDB_WORKERS = 10
_CACHE: dict[str, dict] = {}
_GENRE_MOVIE: dict[int, str] = {}
_GENRE_TV: dict[int, str] = {}


def _key(api_key: str | None) -> str | None:
    return api_key or os.getenv("TMDB_API_KEY") or None


_RE_YEAR_1 = re.compile(r"\s*[\(\[\{]\s*\d{4}\s*[\)\]\}]")
_RE_YEAR_2 = re.compile(r"\s*-\s*\d{4}(\s|$)")
_RE_YEAR_3 = re.compile(r"\s+\d{4}\s*$")
_RE_YEAR_4 = re.compile(r"\s+\d{4}\s+")
_RE_SXX = re.compile(r"\s*[sS]\d+\s*[eE]\d+.*$")
_RE_TXX = re.compile(r"\s*[tT]\d+\s*[eE]\d+.*$")
_RE_TEMP = re.compile(r"\s*[Tt]emporada\s*\d+.*$")
_RE_SEASON = re.compile(r"\s*[Ss]eason\s*\d+.*$")
_RE_NXN = re.compile(r"\s*-\s*\d+x\d+.*$")

_QUALIDADES = [
    r"4K\s*UHD", r"4K", r"UHD", r"2160p", r"1080p", r"720p", r"480p", r"360p",
    r"FHD", r"HD", r"SD", r"HDTV", r"HDRip", r"HDRIP",
    r"WEB-DL", r"WEBDL", r"WEB DL", r"WEBRip", r"WEBRIP", r"WEB",
    r"BluRay", r"BRRip", r"BRRIP", r"BDRip", r"BDRIP", r"Blu-Ray",
    r"DVDRip", r"DVDRIP", r"DVDScr", r"DVDSCR", r"DVD",
    r"CAMRip", r"CAMRIP", r"CAM", r"TS", r"TC", r"TELESYNC",
    r"HDR10", r"HDR", r"DV", r"Dolby Vision",
    r"x264", r"x265", r"H264", r"H265", r"HEVC", r"AVC",
    r"AAC", r"AC3", r"DTS", r"ATMOS", r"REMUX", r"REPACK",
]
_QUAL_RE = [re.compile(r"\s*[\[\(]?\s*" + q + r"\s*[\]\)]?\s*", re.IGNORECASE) for q in _QUALIDADES]

_TAGS = [
    r"\[L\]", r"\[D\]", r"\[DUB\]", r"\[LEG\]", r"\[DUAL\]", r"\[DUBLADO\]", r"\[LEGENDADO\]",
    r"\[PT\]", r"\[BR\]", r"\[PT-BR\]", r"\[EN\]", r"\[ESP\]",
    r"\[NACIONAL\]", r"\[NAC\]", r"\[COMPLETO\]",
    r"DUBLADO", r"LEGENDADO", r"DUAL AUDIO", r"DUAL", r"DUB", r"LEG",
    r"PT-BR", r"PTBR", r"PORTUGUES",
]
_TAG_RE = [re.compile(t, re.IGNORECASE) for t in _TAGS]


def limpar_nome_tmdb(nome: str) -> str:
    if not nome:
        return ""
    n = re.sub(r"[._]", " ", nome)
    n = _RE_YEAR_1.sub("", n)
    n = _RE_YEAR_2.sub(" ", n)
    n = _RE_YEAR_3.sub("", n)
    n = _RE_YEAR_4.sub(" ", n)
    # season/episode markers antes de qualidades
    n = _RE_SXX.sub("", n)
    n = _RE_TXX.sub("", n)
    n = _RE_TEMP.sub("", n)
    n = _RE_SEASON.sub("", n)
    n = _RE_NXN.sub("", n)
    for r in _QUAL_RE: n = r.sub(" ", n)
    for r in _TAG_RE: n = r.sub(" ", n)
    n = re.sub(r"\s+", " ", n).strip(" -_[]{}()")
    return n


def _client() -> httpx.Client:
    return httpx.Client(timeout=8.0)


def _load_genres(kind: str, api_key: str | None) -> dict[int, str]:
    global _GENRE_MOVIE, _GENRE_TV
    ref = _GENRE_MOVIE if kind == "movie" else _GENRE_TV
    if ref:
        return ref
    key = _key(api_key)
    if not key:
        return {}
    try:
        with _client() as c:
            r = c.get(f"{TMDB_BASE}/genre/{kind}/list",
                      params={"api_key": key, "language": "pt-BR"})
            r.raise_for_status()
            data = {g["id"]: g["name"] for g in r.json().get("genres", [])}
        if kind == "movie": _GENRE_MOVIE = data
        else: _GENRE_TV = data
        return data
    except Exception as e:
        log.warning(f"tmdb genres {kind}: {e}")
        return {}


def _search(kind: str, nome: str, api_key: str | None, language: str = "pt-BR") -> dict:
    key = _key(api_key)
    empty = {"tmdb_id": "", "plot": "", "release_date": "", "rating": "",
             "genre": "", "poster_url": "", "backdrop_url": ""}
    if not key or not nome:
        return empty
    limpo = limpar_nome_tmdb(nome)
    ck = f"{kind}:{language}:{limpo.lower()}"
    if ck in _CACHE:
        return _CACHE[ck]
    try:
        endpoint = "search/movie" if kind == "movie" else "search/tv"
        with _client() as c:
            r = c.get(f"{TMDB_BASE}/{endpoint}",
                      params={"api_key": key, "query": limpo, "language": language})
            r.raise_for_status()
            data = r.json()
        results = data.get("results") or []
        if not results:
            _CACHE[ck] = empty
            return empty
        item = results[0]
        genres = _load_genres(kind, api_key)
        out = {
            "tmdb_id": str(item.get("id") or ""),
            "plot": (item.get("overview") or "").strip(),
            "release_date": item.get("release_date") or item.get("first_air_date") or "",
            "rating": item.get("vote_average") or "",
            "genre": ", ".join(genres.get(gid, "") for gid in item.get("genre_ids", []) if genres.get(gid)),
            "poster_url": f"{TMDB_IMG}/w500{item['poster_path']}" if item.get("poster_path") else "",
            "backdrop_url": f"{TMDB_IMG}/w780{item['backdrop_path']}" if item.get("backdrop_path") else "",
        }
        _CACHE[ck] = out
        return out
    except Exception as e:
        log.debug(f"tmdb {kind} '{nome}': {e}")
        _CACHE[ck] = empty
        return empty


def buscar_filme(nome: str, api_key: str | None = None, language: str = "pt-BR") -> dict:
    return _search("movie", nome, api_key, language)


def buscar_serie(nome: str, api_key: str | None = None, language: str = "pt-BR") -> dict:
    return _search("tv", nome, api_key, language)


def buscar_em_lote(nomes: list[str], kind: str = "movie", api_key: str | None = None,
                   language: str = "pt-BR", on_progress=None) -> dict[str, dict]:
    out: dict[str, dict] = {}
    if not nomes:
        return out
    fn = buscar_filme if kind == "movie" else buscar_serie
    with ThreadPoolExecutor(max_workers=TMDB_WORKERS) as ex:
        futs = {ex.submit(fn, n, api_key, language): n for n in nomes}
        done = 0
        for f in as_completed(futs):
            n = futs[f]
            try:
                out[n] = f.result()
            except Exception:
                out[n] = {}
            done += 1
            if on_progress and done % 10 == 0:
                try: on_progress(done, len(nomes))
                except Exception: pass
    return out

