"""Delete a user account. Their login tokens go with it. Recipes stay.

    uv run python scripts/delete_user.py <username>

Asks for confirmation. Users can also delete their own account in the app.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import auth, db  # noqa: E402
from app.config import load_settings  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("username")
    args = parser.parse_args()

    username = auth.normalize_username(args.username)
    answer = input(f"Konto '{username}' und alle Anmeldungen endgültig löschen? Tippe den Namen zur Bestätigung: ")
    if answer.strip().lower() != username:
        print("Abgebrochen.", file=sys.stderr)
        return 1

    settings = load_settings()
    db.init(settings.db_path)
    conn = db.connect(settings.db_path)
    try:
        deleted = auth.delete_user(conn, username)
    finally:
        conn.close()

    if not deleted:
        print(f"Kein Konto '{username}' gefunden.", file=sys.stderr)
        return 1
    print(f"Konto '{username}' gelöscht.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
