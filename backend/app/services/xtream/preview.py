"""Preview (dry-run) — mostra o que uma sync iria fazer sem tocar no banco XUI."""
from __future__ import annotations
import hashlib
import json
from typing import Any

import httpx

from app.services.xtream import m3u_parser, xtream_api, xui_db


def _download(url: str) -> str:
    with httpx.Client(timeout=60.0, follow_redirects=True) as c:
        r = c.get(url); r.raise_for_status(); return r.text


def _load_source_content(src: dict) -> tuple[dict, str]:
    """Retorna (parsed, raw_content_for_hash)."""
    stype = src.get("source_type") or "xtream_api"
    if stype == "m3u_url":
        raw = _download(src["m3u_url"])
        return m3u_parser.parse_m3u(raw), raw
    if stype == "m3u_file":
        raw = src.get("m3u_content") or ""
        return m3u_parser.parse_m3u(raw), raw
    lives = xtream_api.as_m3u_items(src["host"], src["username"], src["password"], "live")
    vods = xtream_api.as_m3u_items(src["host"], src["username"], src["password"], "vod")
    parsed = {"canais": lives, "filmes": vods, "series": []}
    raw = json.dumps({"lives": len(lives), "vods": len(vods)}, sort_keys=True)
    return parsed, raw


def _existing_names_by_type(cur, type_id: int) -> set[str]:
    try:
        cur.execute("SELECT stream_display_name FROM streams WHERE type = %s AND (deleted IS NULL OR deleted=0)", (type_id,))
        return {(r[0] or "").strip().lower() for r in cur.fetchall() if r[0]}
    except Exception:
        return set()


def _existing_series_names(cur) -> set[str]:
    try:
        cur.execute("SELECT title FROM series")
        return {(r[0] or "").strip().lower() for r in cur.fetchall() if r[0]}
    except Exception:
        return set()


def _classify(items: list[dict], existing: set[str]) -> dict[str, Any]:
    to_ins, to_upd = [], []
    seen = set()
    for it in items:
        name = (it.get("nome") or it.get("name") or "").strip()
        if not name: continue
        low = name.lower()
        if low in seen: continue
        seen.add(low)
        if low in existing: to_upd.append(name)
        else: to_ins.append(name)
    return {
        "total": len(items), "to_insert": len(to_ins), "to_update": len(to_upd),
        "to_delete": 0, "unchanged": 0,
        "samples_insert": to_ins[:5], "samples_update": to_upd[:5], "samples_delete": [],
    }


def build_preview(src: dict, xui_conf: dict, mapping: dict) -> dict:
    """
    Roda um dry-run:
      - baixa/parseia a fonte
      - conecta no painel XUI e conta o que existe
      - retorna diffs por tipo (canais/filmes/séries) e hash do conteúdo
    """
    warnings: list[str] = []
    try:
        parsed, raw = _load_source_content(src)
    except Exception as e:
        return {"ok": False, "error": f"falha ao ler fonte: {e}",
                "content_hash": "", "unchanged_since_last": False,
                "total_parsed": {"canais": 0, "filmes": 0, "series": 0, "episodios": 0},
                "canais": {}, "filmes": {}, "series": {}, "warnings": warnings}

    content_hash = hashlib.sha256(raw.encode("utf-8", errors="ignore")).hexdigest()
    unchanged = (src.get("last_content_hash") == content_hash) and bool(content_hash)

    total_ep = sum(len(s.get("episodios") or []) for s in parsed.get("series") or [])

    canais_pv, filmes_pv, series_pv = {}, {}, {}
    try:
        with xui_db.cursor_from(xui_conf) as (_c, cur):
            existing_live = _existing_names_by_type(cur, 1)
            existing_movie = _existing_names_by_type(cur, 2)
            existing_series = _existing_series_names(cur)
            canais_pv = _classify(parsed["canais"], existing_live)
            filmes_pv = _classify(parsed["filmes"], existing_movie)
            series_pv = _classify(parsed["series"], existing_series)

            # mirror mode → estimar deletions (órfãos)
            mode_c = mapping.get("mode_canais") or mapping.get("mode")
            mode_f = mapping.get("mode_filmes") or mapping.get("mode")
            mode_s = mapping.get("mode_series") or mapping.get("mode")
            new_c = {(i.get("nome") or "").strip().lower() for i in parsed["canais"]}
            new_f = {(i.get("nome") or "").strip().lower() for i in parsed["filmes"]}
            new_s = {(i.get("nome") or "").strip().lower() for i in parsed["series"]}
            if mode_c == "mirror" or mapping.get("remove_orphans"):
                orph = list(existing_live - new_c); canais_pv["to_delete"] = len(orph); canais_pv["samples_delete"] = orph[:5]
            if mode_f == "mirror" or mapping.get("remove_orphans"):
                orph = list(existing_movie - new_f); filmes_pv["to_delete"] = len(orph); filmes_pv["samples_delete"] = orph[:5]
            if mode_s == "mirror" or mapping.get("remove_orphans"):
                orph = list(existing_series - new_s); series_pv["to_delete"] = len(orph); series_pv["samples_delete"] = orph[:5]
    except Exception as e:
        warnings.append(f"não foi possível ler painel de destino: {e}")

    return {
        "ok": True, "content_hash": content_hash, "unchanged_since_last": unchanged,
        "total_parsed": {
            "canais": len(parsed["canais"]), "filmes": len(parsed["filmes"]),
            "series": len(parsed["series"]), "episodios": total_ep,
        },
        "canais": canais_pv, "filmes": filmes_pv, "series": series_pv,
        "warnings": warnings, "error": None,
    }
