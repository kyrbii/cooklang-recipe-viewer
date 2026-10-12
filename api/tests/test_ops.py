import os
import sys
import tarfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import backup  # noqa: E402


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_security_headers(client):
    res = client.get("/recipes")
    assert res.headers["X-Content-Type-Options"] == "nosniff"
    assert res.headers["X-Robots-Tag"] == "noindex, nofollow"


def test_backup_contains_db_and_recipes_with_times(client, auth_headers, settings, tmp_path, monkeypatch):
    client.put("/recipe/Suppen/Linsen", content=b"Koche @Linsen{200%g}.", headers=auth_headers)
    recipe = settings.recipe_dir / "Suppen" / "Linsen.cook"
    os.utime(recipe, (1_700_000_000, 1_700_000_000))

    monkeypatch.setenv("RECIPE_DIR", str(settings.recipe_dir))
    monkeypatch.setenv("DB_PATH", str(settings.db_path))
    target = tmp_path / "backups"
    archive = backup.backup(target, keep=14)

    with tarfile.open(archive) as tar:
        names = tar.getnames()
        assert "api.db" in names
        assert tar.getmember("recipes/Suppen/Linsen.cook").mtime == 1_700_000_000
        tar.extractall(tmp_path / "restore", filter="data")
    assert (tmp_path / "restore" / "recipes" / "Suppen" / "Linsen.cook").read_bytes() == b"Koche @Linsen{200%g}."
    # The copied database still holds the user
    import sqlite3

    conn = sqlite3.connect(tmp_path / "restore" / "api.db")
    assert conn.execute("SELECT count(*) FROM users").fetchone()[0] == 1
    conn.close()


def test_backup_keeps_only_the_newest(settings, tmp_path, monkeypatch):
    monkeypatch.setenv("RECIPE_DIR", str(settings.recipe_dir))
    monkeypatch.setenv("DB_PATH", str(settings.db_path))
    target = tmp_path / "backups"
    target.mkdir()
    for day in range(1, 6):
        (target / f"{backup.PREFIX}2026010{day}-000000.tar.gz").write_bytes(b"old")
    (target / "unrelated.txt").write_text("stays")

    newest = backup.backup(target, keep=3)
    left = sorted(p.name for p in target.iterdir())
    assert left == sorted([f"{backup.PREFIX}20260104-000000.tar.gz", f"{backup.PREFIX}20260105-000000.tar.gz", newest.name, "unrelated.txt"])
