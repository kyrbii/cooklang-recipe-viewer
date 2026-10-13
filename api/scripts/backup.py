"""Write a backup of the database and all recipes and photos as one .tar.gz, and drop old backups.

    uv run python scripts/backup.py <target folder> [--keep 14]
    docker compose exec -T api python scripts/backup.py /backups

Safe while the server runs: the database is copied with SQLite's backup API, never as a plain file
copy, which could catch it in the middle of a write. File times are kept in the archive, because the
app sorts recipes by them.

Restore: stop the API, unpack the archive into the data folder (it contains api.db and recipes/),
start the API again.
"""

import argparse
import sqlite3
import sys
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import load_settings  # noqa: E402

PREFIX = "rezepte-backup-"


def backup(target: Path, keep: int) -> Path:
    settings = load_settings()
    target.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    archive = target / f"{PREFIX}{stamp}.tar.gz"
    partial = archive.with_name(archive.name + ".partial")

    with tempfile.TemporaryDirectory() as tmp:
        db_copy = Path(tmp) / "api.db"
        source = sqlite3.connect(settings.db_path)
        dest = sqlite3.connect(db_copy)
        try:
            source.backup(dest)
        finally:
            dest.close()
            source.close()

        # Written under a temporary name first, so an interrupted run never looks like a good backup
        with tarfile.open(partial, "w:gz") as tar:
            tar.add(db_copy, arcname="api.db")
            if settings.recipe_dir.is_dir():
                tar.add(settings.recipe_dir, arcname="recipes")
    partial.replace(archive)

    backups = sorted(target.glob(f"{PREFIX}*.tar.gz"))
    for old in backups[:-keep] if keep > 0 else []:
        old.unlink()
    return archive


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("target", type=Path, help="folder for the backup files")
    parser.add_argument("--keep", type=int, default=14, help="how many backups to keep (default 14)")
    args = parser.parse_args()

    archive = backup(args.target, args.keep)
    print(f"Backup written: {archive} ({archive.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
