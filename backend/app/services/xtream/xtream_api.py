"""Cliente Xtream API (`player_api.php`) — importa lives/VOD de outro painel."""
from __future__ import annotations
import httpx


def _base(host: str) -> str:
    h = (host or "").strip().rstrip("/")
    if not h.startswith(("http://", "https://")):
        h = "http://" + h
    return h


def _call(host: str, user: str, pw: str, action: str | None = None, **extra) -> list | dict:
    params = {"username": user, "password": pw}
    if action:
        params["action"] = action
    params.update(extra)
    r = httpx.get(f"{_base(host)}/player_api.php", params=params, timeout=30.0)
    r.raise_for_status()
    try:
        return r.json()
    except Exception:
        return []


def user_info(host, user, pw) -> dict:
    return _call(host, user, pw) or {}


def live_streams(host, user, pw) -> list[dict]:
    return _call(host, user, pw, action="get_live_streams") or []


def vod_streams(host, user, pw) -> list[dict]:
    return _call(host, user, pw, action="get_vod_streams") or []


def live_categories(host, user, pw) -> list[dict]:
    return _call(host, user, pw, action="get_live_categories") or []


def vod_categories(host, user, pw) -> list[dict]:
    return _call(host, user, pw, action="get_vod_categories") or []


def build_stream_url(host: str, user: str, pw: str, stream_id: int, ext: str = "ts", kind: str = "live") -> str:
    h = _base(host)
    if kind == "live":
        return f"{h}/live/{user}/{pw}/{stream_id}.{ext}"
    if kind == "vod":
        return f"{h}/movie/{user}/{pw}/{stream_id}.{ext}"
    return f"{h}/series/{user}/{pw}/{stream_id}.{ext}"


def as_m3u_items(host, user, pw, kind: str = "live") -> list[dict]:
    """Converte lista Xtream API em items compatíveis com o importer."""
    if kind == "live":
        cats = {str(c.get("category_id")): c.get("category_name", "Sem Categoria") for c in live_categories(host, user, pw)}
        streams = live_streams(host, user, pw)
        ext = "ts"
    else:
        cats = {str(c.get("category_id")): c.get("category_name", "Sem Categoria") for c in vod_categories(host, user, pw)}
        streams = vod_streams(host, user, pw)
        ext = ""
    items = []
    for s in streams:
        sid = s.get("stream_id")
        if not sid: continue
        item_ext = s.get("container_extension") or ext or "ts"
        items.append({
            "nome": s.get("name") or s.get("title") or f"stream_{sid}",
            "categoria": cats.get(str(s.get("category_id")), "Sem Categoria"),
            "logo": s.get("stream_icon") or s.get("cover") or "",
            "url": build_stream_url(host, user, pw, sid, item_ext, kind="live" if kind == "live" else "vod"),
        })
    return items
