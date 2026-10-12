"""AI recipe import: web page, text or photo → Cooklang via Gemini.

Ported from the former ai-import/server.mjs with the same prompt, limits and messages.
The server fetches arbitrary URLs, so every target (including each redirect) must be a public address.
"""

import ipaddress
import json
import logging
import re
import socket
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlsplit

log = logging.getLogger(__name__)

MAX_PAGE = 2 * 1024 * 1024
MAX_TEXT = 50_000
MAX_REDIRECTS = 4
FETCH_TIMEOUT = 15
GEMINI_TIMEOUT = 90
IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic"}
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

SYSTEM = """Du bist ein Assistent, der Rezepte in Cooklang umwandelt.
Antworte ausschließlich mit gültigem Cooklang-Code, ohne Erklärungen und ohne Markdown-Zäune.
Schreibe alle Texte, Zutaten und Kochschritte auf Deutsch.
Zutaten: @Name{Menge%Einheit}, z. B. @Mehl{250%g}. Ohne Menge: @Salz{}.
Kochgeschirr: #Topf{}. Timer: ~{15%min}.
Metadaten als YAML-Frontmatter am Anfang: title, servings, source (falls bekannt).
Wenn der Inhalt kein Rezept enthält, antworte nur mit: KEIN_REZEPT"""


class ImportFailed(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass(frozen=True)
class GeminiConfig:
    api_key: str = field(repr=False)
    model: str


# ---- SSRF protection ----


def _resolve(host: str) -> list[str]:
    """All addresses a host name resolves to. Separate function so tests can replace it."""
    try:
        return [info[4][0] for info in socket.getaddrinfo(host, None)]
    except socket.gaierror as exc:
        raise ImportFailed(502, "Die Seite ist nicht erreichbar.") from exc


def is_public_address(raw: str) -> bool:
    try:
        addr = ipaddress.ip_address(raw.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return addr.is_global and not addr.is_multicast


def assert_public_url(raw: str) -> str:
    try:
        url = urlsplit(raw)
        host = url.hostname
    except ValueError:
        host = None
    if not host:
        raise ImportFailed(400, "Ungültige URL.")
    if url.scheme not in ("http", "https"):
        raise ImportFailed(400, "Nur http- und https-URLs sind erlaubt.")
    if url.username or url.password:
        raise ImportFailed(400, "URLs mit Zugangsdaten sind nicht erlaubt.")
    if re.search(r"(^|\.)instagram\.com$", host, re.IGNORECASE):
        raise ImportFailed(
            422,
            "Instagram lässt den Abruf nicht zu. Kopiere die Beschreibung des Reels in den Reiter „Text“ "
            "oder lade einen Screenshot als Foto hoch.",
        )
    try:
        addresses = [str(ipaddress.ip_address(host))]
    except ValueError:
        addresses = _resolve(host)
    if not addresses or not all(is_public_address(a) for a in addresses):
        raise ImportFailed(400, "Diese Adresse ist nicht erlaubt.")
    return url.geturl()


# ---- Fetching the page ----


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Redirects are followed by hand, so each target can be checked first."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def _open(request: urllib.request.Request, timeout: float):
    """Separate function so tests can replace the network."""
    return _opener.open(request, timeout=timeout)


def fetch_page(start: str) -> tuple[str, str]:
    """HTML of the page and its final URL."""
    url = assert_public_url(start)
    for _ in range(MAX_REDIRECTS):
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; RezepteImport/1.0)",
                "Accept": "text/html,application/xhtml+xml",
            },
        )
        try:
            res = _open(request, FETCH_TIMEOUT)
        except urllib.error.HTTPError as err:
            location = err.headers.get("Location") if err.headers else None
            if 300 <= err.code < 400 and location:
                url = assert_public_url(urljoin(url, location))
                continue
            raise ImportFailed(502, f"Die Seite ist nicht erreichbar (HTTP {err.code}).") from err
        except (urllib.error.URLError, TimeoutError, OSError) as err:
            raise ImportFailed(502, "Die Seite ist nicht erreichbar.") from err

        with res:
            content_type = res.headers.get("Content-Type", "")
            if "html" not in content_type and "text" not in content_type:
                raise ImportFailed(422, "Die URL zeigt keine Webseite an.")
            return res.read(MAX_PAGE).decode("utf-8", errors="replace"), url
    raise ImportFailed(502, "Zu viele Weiterleitungen.")


_JSON_LD = re.compile(r"<script[^>]*application/ld\+json[^>]*>([\s\S]*?)</script>", re.IGNORECASE)
_META_TEXT = re.compile(
    r"""<meta[^>]+(?:property|name)=["'](og:title|og:description|description)["'][^>]*content=["']([^"']*)["']""",
    re.IGNORECASE,
)


def extract_page_text(html: str) -> str:
    # Many recipe pages carry structured data (schema.org/Recipe), which is the most reliable source
    json_ld = "\n".join(m.group(1).strip() for m in _JSON_LD.finditer(html))
    meta = "\n".join(f"{m.group(1)}: {m.group(2)}" for m in _META_TEXT.finditer(html))
    body = re.sub(r"<(script|style|noscript)[\s\S]*?</\1>", " ", html, flags=re.IGNORECASE)
    body = re.sub(r"<[^>]+>", " ", body)
    body = body.replace("&nbsp;", " ")
    body = re.sub(r"\s+", " ", body).strip()

    sections = [
        json_ld and f"Strukturierte Daten (JSON-LD):\n{json_ld}",
        meta and f"Meta-Tags:\n{meta}",
        f"Seitentext:\n{body}",
    ]
    return "\n\n".join(s for s in sections if s)[:MAX_TEXT]


# ---- Title image from the page ----


def _as_list(value) -> list:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def find_page_image(html: str, page_url: str) -> str | None:
    def to_absolute(value) -> str | None:
        if isinstance(value, dict):
            value = value.get("url") or value.get("@id")
        if not isinstance(value, str) or not value.strip():
            return None
        absolute = urljoin(page_url, value.strip())
        return absolute if urlsplit(absolute).scheme in ("http", "https") else None

    # 1. schema.org/Recipe in JSON-LD (image may be a string, an object or a list)
    for match in _JSON_LD.finditer(html):
        try:
            data = json.loads(match.group(1).strip())
        except ValueError:
            continue
        graph = data.get("@graph", []) if isinstance(data, dict) else []
        for node in _as_list(data) + _as_list(graph):
            if not isinstance(node, dict) or "Recipe" not in _as_list(node.get("@type")):
                continue
            for image in _as_list(node.get("image")):
                absolute = to_absolute(image)
                if absolute:
                    return absolute

    # 2. Open Graph / Twitter Card (attributes in any order)
    for tag in re.findall(r"<meta[^>]*>", html, re.IGNORECASE):
        key = re.search(r"""(?:property|name)=["']([^"']+)["']""", tag, re.IGNORECASE)
        if not key or key.group(1) not in ("og:image", "twitter:image"):
            continue
        content = re.search(r"""content=["']([^"']*)["']""", tag, re.IGNORECASE)
        absolute = to_absolute(content.group(1) if content else None)
        if absolute:
            return absolute
    return None


def with_image(cooklang: str, image_url: str | None) -> str:
    """Sets `image:` in the YAML front matter, adding front matter if there is none."""
    if not image_url:
        return cooklang
    line = f"image: {json.dumps(image_url, ensure_ascii=False)}"
    front_matter = re.match(r"^---\r?\n([\s\S]*?)\r?\n---\r?\n?", cooklang)
    if not front_matter:
        return f"---\n{line}\n---\n\n{cooklang}"
    yaml_lines = [l for l in front_matter.group(1).split("\n") if not re.match(r"^image\s*:", l, re.IGNORECASE)]
    yaml = "\n".join(yaml_lines + [line])
    return f"---\n{yaml}\n---\n{cooklang[front_matter.end():]}"


# ---- Gemini ----


def gemini(parts: list[dict], config: GeminiConfig) -> str:
    if not config.api_key:
        raise ImportFailed(500, "GEMINI_API_KEY ist auf dem Server nicht gesetzt.")

    payload = json.dumps(
        {"systemInstruction": {"parts": [{"text": SYSTEM}]}, "contents": [{"role": "user", "parts": parts}]}
    ).encode("utf-8")
    request = urllib.request.Request(
        GEMINI_URL.format(model=config.model),
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json", "x-goog-api-key": config.api_key},
    )
    try:
        with urllib.request.urlopen(request, timeout=GEMINI_TIMEOUT) as res:
            data = json.loads(res.read())
    except urllib.error.HTTPError as err:
        log.error("Gemini-Fehler: %s %s", err.code, err.read()[:2000].decode("utf-8", errors="replace"))
        hint = " Das Kontingent ist erschöpft, bitte später erneut versuchen." if err.code == 429 else ""
        raise ImportFailed(502, f"Gemini-Fehler (HTTP {err.code}).{hint}") from err
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as err:
        log.error("Gemini nicht erreichbar: %s", err)
        raise ImportFailed(502, "Gemini ist nicht erreichbar.") from err

    candidates = data.get("candidates") or [{}]
    text = "".join(p.get("text", "") for p in (candidates[0].get("content") or {}).get("parts", []))
    cooklang = re.sub(r"^\s*```[a-zA-Z]*\s*", "", text)
    cooklang = re.sub(r"\s*```\s*$", "", cooklang).strip()

    if not cooklang or cooklang == "KEIN_REZEPT":
        raise ImportFailed(422, "In diesem Inhalt wurde kein Rezept gefunden.")
    return cooklang


# ---- Entry point ----


def handle_import(body: dict, config: GeminiConfig) -> dict:
    if body.get("url"):
        html, final_url = fetch_page(str(body["url"]))
        parts = [{"text": f"Wandle das Rezept aus dieser Webseite in Cooklang um.\n\n{extract_page_text(html)}"}]
        return {"cooklang": with_image(gemini(parts, config), find_page_image(html, final_url))}

    if body.get("text"):
        text = str(body["text"])
        if len(text) > MAX_TEXT:
            raise ImportFailed(413, "Der Text ist zu lang.")
        parts = [{"text": f"Wandle folgenden Rezepttext in Cooklang um:\n\n{text}"}]
    elif body.get("image"):
        if body.get("mimeType") not in IMAGE_TYPES:
            raise ImportFailed(400, "Bildformat wird nicht unterstützt (JPG, PNG, WebP, HEIC).")
        parts = [
            {"inlineData": {"mimeType": body["mimeType"], "data": str(body["image"])}},
            {"text": "Wandle das Rezept auf diesem Bild in Cooklang um."},
        ]
    else:
        raise ImportFailed(400, "Bitte url, text oder image angeben.")
    return {"cooklang": gemini(parts, config)}
