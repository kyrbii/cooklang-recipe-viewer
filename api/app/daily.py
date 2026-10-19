"""Daily recipes: today's picks from KptnCook, converted to Cooklang and kept for a few days.

They live in their own folder, apart from the real recipes. A person who likes one saves it, which
copies it into the recipe folder. The source is KptnCook's unofficial mobile API, so everything here
fails quietly: no key, no network or a changed response just means no daily recipes.
"""

import json
import re
import shutil
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

from .frontmatter import yaml_value
from .storage import MEDIA_TYPES, etag, sniff_photo

API_URL = "https://mobile.kptncook.com"
MAX_RECIPES = 3
MAX_PHOTO_BYTES = 10 * 1024 * 1024
KEEP_DAYS = 3
# After a failed attempt, wait this long before asking the API again
RETRY_SECONDS = 3600

_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_DATE_DIR = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_HEADERS = {
    "Accept": "application/vnd.kptncook.mobile-v8+json",
    "User-Agent": "Platform/Android/12.0.1 App/7.10.1",
    "hasIngredients": "yes",
}


# --- KptnCook JSON -> Cooklang -------------------------------------------------------------


def localized(value, languages=("de", "en", "es", "fr", "pt")) -> str:
    """Text from a KptnCook localized value: a plain string, or a dict per language
    (possibly nested in singular/plural/uncountable)."""
    if isinstance(value, str):
        return value.strip()
    if not isinstance(value, dict):
        return ""
    for key in ("singular", "uncountable", "plural"):
        nested = value.get(key)
        if isinstance(nested, (str, dict)):
            text = localized(nested, languages)
            if text:
                return text
    for lang in languages:
        text = value.get(lang)
        if isinstance(text, str) and text.strip():
            return text.strip()
    return ""


def _number(value) -> str:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return ""
    return f"{value:.2f}".rstrip("0").rstrip(".")


def _marker(name: str, quantity, unit: str) -> str:
    """`@name{qty%unit}`; braces keep multi-word names together."""
    amount = _number(quantity)
    if amount and unit:
        amount += f"%{unit}"
    return f"@{name}{{{amount}}}"


def _step_ingredients(step: dict) -> list[tuple[str, object, str]]:
    found = []
    for item in step.get("ingredients") or []:
        if not isinstance(item, dict):
            continue
        details = item.get("ingredient")
        name = localized(details.get("localizedTitle") or details.get("uncountableTitle") or details.get("numberTitle")) if isinstance(details, dict) else localized(details)
        name = re.sub(r"[@#~{}\n]", " ", name).strip()
        if not name:
            continue
        unit_value = item.get("unit")
        unit = ""
        if isinstance(unit_value, dict):
            unit = localized(unit_value.get("shortTitle")) or localized(unit_value.get("localizedTitle")) or str(unit_value.get("name") or "")
        elif isinstance(unit_value, str):
            unit = unit_value
        found.append((name, item.get("quantity", item.get("amount")), re.sub(r"[%{}\n]", "", unit).strip()))
    return found


def _timer(step: dict) -> str:
    timers = step.get("timers") or []
    timer = timers[0] if timers and isinstance(timers[0], dict) else None
    if not timer:
        return ""
    low, high = timer.get("minOrExact"), timer.get("max")
    if not isinstance(low, int) or low <= 0:
        return ""
    amount = f"{low}-{high}" if isinstance(high, int) and high > low else str(low)
    return f"~{{{amount}%minutes}}"


def _step_text(step: dict) -> str:
    text = localized(step.get("title")).replace("\r", "").strip()
    # A line starting with these would be read as a section, note or comment
    text = re.sub(r"\s*\n\s*", " ", text)
    text = text.replace("--", "–").replace("[-", "[")
    text = re.sub(r"^[=>]+\s*", "", text)
    for name, quantity, unit in _step_ingredients(step):
        marker = _marker(name, quantity, unit)
        pattern = re.compile(rf"(?<![\w@]){re.escape(name)}(?!\w)", re.IGNORECASE)
        if pattern.search(text):
            text = pattern.sub(lambda m: _marker(m.group(0), quantity, unit), text, count=1)
        else:
            text += f" ({marker})"
    timer = _timer(step)
    return f"{text} {timer}".strip() if timer else text


def to_cooklang(recipe: dict) -> str | None:
    """Cooklang text for one KptnCook recipe; None if it has no title or no steps."""
    title = localized(recipe.get("localizedTitle"))
    steps = [s for s in recipe.get("steps") or [] if isinstance(s, dict)]
    body = [text for text in (_step_text(s) for s in steps) if text]
    if not title or not body:
        return None

    meta = [("title", title), ("servings", recipe.get("fixedPortionCount") or 2)]
    minutes = sum(v for v in (recipe.get("preparationTime"), recipe.get("cookingTime")) if isinstance(v, int))
    if minutes > 0:
        meta.append(("time", f"{minutes} min"))
    tags = [t for t in recipe.get("activeTags") or [] if isinstance(t, str) and t.strip()]
    if tags:
        meta.append(("tags", "[" + ", ".join(yaml_value(t) for t in tags) + "]"))
    comment = localized(recipe.get("authorComment")).replace("\n", " ")
    if comment:
        meta.append(("description", comment))
    meta.append(("source", "KptnCook"))

    lines = ["---"]
    for key, value in meta:
        lines.append(f"{key}: {value}" if key in ("servings", "tags") else f"{key}: {yaml_value(str(value))}")
    lines.append("---")
    return "\n".join(lines) + "\n\n" + "\n\n".join(body) + "\n"


def recipe_id(recipe: dict) -> str | None:
    raw = recipe.get("_id")
    value = raw.get("$oid") if isinstance(raw, dict) else raw
    return value if isinstance(value, str) and _ID.match(value) else None


def cover_url(recipe: dict) -> str | None:
    for image in recipe.get("imageList") or []:
        if isinstance(image, dict) and image.get("type") == "cover" and isinstance(image.get("url"), str):
            return image["url"]
    return None


# --- Storage -------------------------------------------------------------------------------


@dataclass(frozen=True)
class DailyEntry:
    id: str
    title: str
    etag: str
    photo_version: str | None
    date: str


class DailyStore:
    """`<root>/<YYYY-MM-DD>/<id>.cook` plus an optional `<id>.jpg|png|webp` photo."""

    def __init__(self, root: Path):
        self.root = root
        self.last_attempt = 0.0

    def day_dir(self, day: date) -> Path:
        return self.root / day.isoformat()

    def has_day(self, day: date) -> bool:
        folder = self.day_dir(day)
        return folder.is_dir() and any(folder.glob("*.cook"))

    def entries(self, day: date) -> list[DailyEntry]:
        from .titles import recipe_title

        entries = []
        for file in sorted(self.day_dir(day).glob("*.cook")):
            data = file.read_bytes()
            photo = self.photo(file.stem, day)
            entries.append(
                DailyEntry(
                    id=file.stem,
                    title=recipe_title(data.decode("utf-8", errors="replace"), file.stem),
                    etag=etag(data),
                    photo_version=str(photo.stat().st_mtime_ns) if photo else None,
                    date=day.isoformat(),
                )
            )
        return entries

    def find(self, daily_id: str) -> tuple[Path, date] | None:
        """The newest kept day that has this recipe."""
        if not _ID.match(daily_id):
            return None
        for folder in sorted(self.days(), reverse=True):
            file = self.root / folder / f"{daily_id}.cook"
            if file.is_file():
                return file, date.fromisoformat(folder)
        return None

    def photo(self, daily_id: str, day: date) -> Path | None:
        for ext in MEDIA_TYPES:
            candidate = self.day_dir(day) / f"{daily_id}{ext}"
            if candidate.is_file():
                return candidate
        return None

    def days(self) -> list[str]:
        if not self.root.is_dir():
            return []
        return [p.name for p in self.root.iterdir() if p.is_dir() and _DATE_DIR.match(p.name)]

    def cleanup(self, today: date, keep_days: int = KEEP_DAYS) -> None:
        oldest = today - timedelta(days=keep_days - 1)
        for name in self.days():
            if date.fromisoformat(name) < oldest:
                shutil.rmtree(self.root / name, ignore_errors=True)

    def write(self, day: date, daily_id: str, cooklang: str, photo: tuple[bytes, str] | None) -> None:
        folder = self.day_dir(day)
        folder.mkdir(parents=True, exist_ok=True)
        if photo:
            (folder / f"{daily_id}{photo[1]}").write_bytes(photo[0])
        # The recipe file goes last: its presence marks the recipe as complete
        tmp = folder / f".{daily_id}.tmp"
        tmp.write_text(cooklang, encoding="utf-8")
        tmp.replace(folder / f"{daily_id}.cook")

    def refresh_due(self, today: date, now: float | None = None) -> bool:
        """True if today's recipes are missing and the last attempt is not too recent."""
        if self.has_day(today):
            return False
        return (now if now is not None else time.time()) - self.last_attempt >= RETRY_SECONDS


# --- Fetching ------------------------------------------------------------------------------


def _get(url: str, headers: dict, limit: int, timeout: float = 20) -> bytes:
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError("response too large")
    return data


def fetch_today(api_key: str) -> list[dict]:
    """Today's recipes as KptnCook JSON; an empty list on any failure."""
    try:
        data = _get(f"{API_URL}/recipes/de/{time.time()}?kptnkey={api_key}", _HEADERS, 10 * 1024 * 1024)
        payload = json.loads(data)
    except (urllib.error.URLError, OSError, ValueError):
        return []
    if isinstance(payload, dict):
        payload = payload.get("recipes") or []
    return [r for r in payload if isinstance(r, dict)] if isinstance(payload, list) else []


def fetch_photo(url: str, api_key: str) -> tuple[bytes, str] | None:
    if not url.startswith("https://"):
        return None
    try:
        data = _get(f"{url}?kptnkey={api_key}", _HEADERS, MAX_PHOTO_BYTES)
    except (urllib.error.URLError, OSError, ValueError):
        return None
    sniffed = sniff_photo(data)
    return (data, sniffed[0]) if sniffed else None


def refresh(store: DailyStore, api_key: str, today: date | None = None) -> int:
    """Fetches and stores today's recipes. Returns how many were stored."""
    today = today or date.today()
    store.last_attempt = time.time()
    stored = 0
    for recipe in fetch_today(api_key):
        if stored >= MAX_RECIPES:
            break
        daily_id, cooklang = recipe_id(recipe), None
        if daily_id:
            cooklang = to_cooklang(recipe)
        if not daily_id or not cooklang:
            continue
        url = cover_url(recipe)
        store.write(today, daily_id, cooklang, fetch_photo(url, api_key) if url else None)
        stored += 1
    store.cleanup(today)
    return stored
