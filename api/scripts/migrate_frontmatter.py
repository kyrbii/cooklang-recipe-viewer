"""Convert recipes from the deprecated `>> key: value` metadata lines to YAML front matter.

    uv run python scripts/migrate_frontmatter.py            # dry run: lists the recipes that would change
    uv run python scripts/migrate_frontmatter.py --apply    # rewrites them, keeping a copy as <name>.cook.bak

All `>>` lines of a recipe, wherever they stand, end up in one front matter block at the top. Recipes
without `>>` lines are not touched. Reads RECIPE_DIR from the environment or .env, like the server.
"""

import argparse
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import load_settings  # noqa: E402
from app.frontmatter import to_front_matter  # noqa: E402
from app.storage import InvalidPath, RecipeStore  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="write the changes (default: only list them)")
    args = parser.parse_args()

    store = RecipeStore(load_settings().recipe_dir)
    changed = 0
    for entry in store.list():
        try:
            path, file = store.resolve(entry.path)
        except InvalidPath:
            continue
        data = store.read_bytes(file)
        if data is None:
            continue
        old = data.decode("utf-8", errors="replace")
        new = to_front_matter(old)
        if new == old:
            continue
        changed += 1
        print(path)
        if args.apply:
            shutil.copy2(file, file.with_name(file.name + ".bak"))
            store.write_atomic(file, new.encode("utf-8"))

    verb = "converted" if args.apply else "would be converted (run with --apply)"
    print(f"{changed} recipe(s) {verb}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
