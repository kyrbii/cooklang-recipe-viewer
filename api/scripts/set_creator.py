"""Record who added existing recipes. Only needed for recipes that were there before creators were tracked.

    uv run python scripts/set_creator.py --list-unknown
    uv run python scripts/set_creator.py <username> --unknown
    uv run python scripts/set_creator.py <username> "Backen/Marmorkuchen" "Suppen/Linsen"

--unknown sets every recipe without a creator. Paths given explicitly are set even if they already have one.
Reads DB_PATH and RECIPE_DIR from the environment or .env, like the server.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import auth, db, recipe_meta  # noqa: E402
from app.config import load_settings  # noqa: E402
from app.storage import InvalidPath, RecipeStore  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("username", nargs="?", help="the user who added the recipes")
    parser.add_argument("paths", nargs="*", help="recipe paths, e.g. Backen/Marmorkuchen")
    parser.add_argument("--unknown", action="store_true", help="set all recipes that have no creator yet")
    parser.add_argument("--list-unknown", action="store_true", help="print recipes that have no creator and exit")
    args = parser.parse_args()

    settings = load_settings()
    db.init(settings.db_path)
    store = RecipeStore(settings.recipe_dir)
    conn = db.connect(settings.db_path)
    try:
        known = recipe_meta.creators(conn)
        all_paths = [entry.path for entry in store.list()]

        if args.list_unknown:
            for path in all_paths:
                if path not in known:
                    print(path)
            return 0

        if not args.username:
            parser.error("username is required unless --list-unknown is given")
        if not args.unknown and not args.paths:
            parser.error("give recipe paths or --unknown")

        username = auth.normalize_username(args.username)
        if conn.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone() is None:
            print(f"Error: no user '{username}'. Create the account with create_user.py first.", file=sys.stderr)
            return 1

        targets: list[str] = []
        if args.unknown:
            targets += [path for path in all_paths if path not in known]
        for raw in args.paths:
            try:
                clean, file = store.resolve(raw)
            except InvalidPath as exc:
                print(f"Error: {raw}: {exc}", file=sys.stderr)
                return 1
            if not file.is_file():
                print(f"Error: no recipe '{clean}'", file=sys.stderr)
                return 1
            targets.append(clean)

        for path in targets:
            recipe_meta.set_creator(conn, path, username)
            print(f"{path} → {username}")
        print(f"{len(targets)} recipe(s) set to '{username}'.")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
