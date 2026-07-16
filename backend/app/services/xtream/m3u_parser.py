"""Parser M3U — portado de `app.py::parse_m3u_unificado` / detectar_tipo_conteudo / limpar_categoria."""
from __future__ import annotations
import re


def limpar_categoria(nome: str | None) -> str:
    if not nome:
        return "Sem Categoria"
    prefixos = [
        r"^series?\s*[\|:\-]\s*", r"^vod\s*[\|:\-]\s*",
        r"^filmes?\s*[\|:\-]\s*", r"^movies?\s*[\|:\-]\s*",
        r"^canais?\s*[\|:\-]\s*", r"^live\s*[\|:\-]\s*",
        r"^tv\s*[\|:\-]\s*", r"^\[.*?\]\s*",
    ]
    out = nome.strip()
    for p in prefixos:
        out = re.sub(p, "", out, flags=re.IGNORECASE).strip()
    return out or "Sem Categoria"


def detectar_tipo(nome: str, url: str, categoria: str) -> str:
    """Retorna 'filme'|'serie'|'canal'."""
    nl = (nome or "").lower()
    ul = (url or "").lower()
    cl = (categoria or "").lower()

    if "/series/" in ul or "/serie/" in ul: return "serie"
    if "/movie/" in ul or "/movies/" in ul or "/vod/" in ul or "/filme/" in ul: return "filme"
    if "/live/" in ul or ul.endswith(".ts") or ul.endswith(".m3u8"): return "canal"

    if any(x in cl for x in ("serie", "series", "novela", "anime", "temporada", "season")): return "serie"
    if any(x in cl for x in ("canal", "canais", "channel", "live", "tv", "aberto", "24h", "24/7")): return "canal"
    if any(x in cl for x in ("filme", "filmes", "movie", "movies", "vod", "lançamento", "lancamento", "dublado", "legendado", "4k", "uhd")): return "filme"

    for pad in (r"[Ss]\d+\s*[Ee]\d+", r"\d+x\d+", r"[Tt]\d+\s*[Ee]\d+", r"[Tt]emporada\s*\d+", r"[Ss]eason\s*\d+"):
        if re.search(pad, nome or ""):
            return "serie"

    if ul.endswith((".mp4", ".mkv", ".avi")): return "filme"
    return "filme"


def parse_m3u(content: str) -> dict:
    """Parseia M3U e retorna {'canais': [...], 'filmes': [...], 'series': [...]}."""
    out = {"canais": [], "filmes": [], "series": []}
    if not content:
        return out
    lines = content.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("#EXTINF"):
            info = line
            url = lines[i + 1].strip() if i + 1 < len(lines) else ""
            nome_m = re.search(r'tvg-name="([^"]+)"', info)
            cat_m = re.search(r'group-title="([^"]+)"', info)
            logo_m = re.search(r'tvg-logo="([^"]*)"', info)
            tipo_m = re.search(r'tvg-type="([^"]*)"', info)

            if nome_m:
                nome = nome_m.group(1).strip()
            else:
                alt = re.search(r",\s*(.+)$", info)
                nome = alt.group(1).strip() if alt else ""

            categoria = limpar_categoria(cat_m.group(1) if cat_m else None)
            logo = logo_m.group(1).strip() if logo_m else ""

            if nome and url and not url.startswith("#"):
                if tipo_m:
                    tt = tipo_m.group(1).lower()
                    if "movie" in tt or "vod" in tt: tipo = "filme"
                    elif "series" in tt or "serie" in tt: tipo = "serie"
                    elif "live" in tt or "channel" in tt: tipo = "canal"
                    else: tipo = detectar_tipo(nome, url, categoria)
                else:
                    tipo = detectar_tipo(nome, url, categoria)

                base = {"nome": nome, "categoria": categoria, "logo": logo, "url": url}
                if tipo == "filme":
                    out["filmes"].append(base)
                elif tipo == "serie":
                    m = (re.search(r"^(.*?)[\s\-–]*[Ss](\d+)\s*[Ee](\d+)", nome)
                         or re.search(r"^(.*?)[\s\-–]*(\d+)x(\d+)", nome)
                         or re.search(r"^(.*?)[\s\-–]*[Tt](\d+)\s*[Ee](\d+)", nome))
                    if m:
                        serie_nome = re.sub(r"[\s\-–]+$", "", m.group(1).strip()).strip()
                        temp, ep = int(m.group(2)), int(m.group(3))
                    else:
                        serie_nome, temp, ep = nome, 1, 1
                    out["series"].append({**base, "serie": serie_nome, "temp": temp, "ep": ep})
                else:
                    out["canais"].append(base)
            i += 2
        else:
            i += 1
    return out


def extrair_nome_arquivo(url: str) -> str:
    if not url: return ""
    try:
        return url.split("?")[0].split("/")[-1].strip().lower()
    except Exception:
        return ""


def extrair_extensao(url: str) -> str:
    try:
        m = re.search(r"\.([a-z0-9]+)(?:[\?&]|$)", url or "", re.IGNORECASE)
        return m.group(1).lower() if m else "mp4"
    except Exception:
        return "mp4"
