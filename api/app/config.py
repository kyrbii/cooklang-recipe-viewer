"""Settings from environment variables, read once at startup."""

import os
from dataclasses import dataclass, field
from pathlib import Path


# The API folder (the one that contains app/). Paths are resolved from here, never from the current
# directory: otherwise the server and scripts/create_user.py can end up using two different databases.
API_ROOT = Path(__file__).resolve().parent.parent


def _resolve(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else (API_ROOT / path).resolve()


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader: KEY=value lines, existing environment variables win."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


@dataclass(frozen=True)
class Settings:
    recipe_dir: Path
    db_path: Path
    token_ttl_days: int
    allowed_origins: list[str]
    max_recipe_bytes: int
    gemini_api_key: str = field(default="", repr=False)
    gemini_model: str = "gemini-3.5-flash-lite"
    # Photos arrive base64-encoded, the app limits uploads to 8 MB
    max_import_bytes: int = 12 * 1024 * 1024
    # Recipe photos from a phone camera: a few MB, 10 MB leaves room
    max_photo_bytes: int = 10 * 1024 * 1024
    # Daily recipes from KptnCook: off without a key. The folder defaults to "daily" next to the recipes.
    kptncook_api_key: str = field(default="", repr=False)
    daily_dir: Path | None = None


def load_settings() -> Settings:
    _load_dotenv(API_ROOT / ".env")
    origins = os.environ.get("ALLOWED_ORIGINS", "")
    return Settings(
        recipe_dir=_resolve(os.environ.get("RECIPE_DIR", "./data/recipes")),
        db_path=_resolve(os.environ.get("DB_PATH", "./data/api.db")),
        token_ttl_days=int(os.environ.get("TOKEN_TTL_DAYS", "30")),
        allowed_origins=[o.strip() for o in origins.split(",") if o.strip()],
        max_recipe_bytes=int(os.environ.get("MAX_RECIPE_BYTES", "1000000")),
        gemini_api_key=os.environ.get("GEMINI_API_KEY", ""),
        gemini_model=os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite"),
        max_import_bytes=int(os.environ.get("MAX_IMPORT_BYTES", str(12 * 1024 * 1024))),
        max_photo_bytes=int(os.environ.get("MAX_PHOTO_BYTES", str(10 * 1024 * 1024))),
        kptncook_api_key=os.environ.get("KPTNCOOK_API_KEY", ""),
        daily_dir=_resolve(os.environ["DAILY_DIR"]) if os.environ.get("DAILY_DIR") else None,
    )
