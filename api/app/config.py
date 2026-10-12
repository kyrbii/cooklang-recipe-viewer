"""Settings from environment variables, read once at startup."""

import os
from dataclasses import dataclass, field
from pathlib import Path


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


def load_settings() -> Settings:
    _load_dotenv(Path(".env"))
    origins = os.environ.get("ALLOWED_ORIGINS", "")
    return Settings(
        recipe_dir=Path(os.environ.get("RECIPE_DIR", "./data/recipes")).resolve(),
        db_path=Path(os.environ.get("DB_PATH", "./data/api.db")).resolve(),
        token_ttl_days=int(os.environ.get("TOKEN_TTL_DAYS", "30")),
        allowed_origins=[o.strip() for o in origins.split(",") if o.strip()],
        max_recipe_bytes=int(os.environ.get("MAX_RECIPE_BYTES", "1000000")),
        gemini_api_key=os.environ.get("GEMINI_API_KEY", ""),
        gemini_model=os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite"),
        max_import_bytes=int(os.environ.get("MAX_IMPORT_BYTES", str(12 * 1024 * 1024))),
    )
