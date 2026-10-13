"""Create a user or reset a password. There is no registration endpoint, this is the only way.

    uv run python scripts/create_user.py <username>
    uv run python scripts/create_user.py <username> --reset-password

Reads DB_PATH from the environment or .env, like the server.
"""

import argparse
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import auth, db  # noqa: E402
from app.config import load_settings  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("username")
    parser.add_argument(
        "--reset-password",
        action="store_true",
        help="set a new password for an existing user and log out all their sessions",
    )
    args = parser.parse_args()

    password = getpass.getpass("Password: ")
    if password != getpass.getpass("Repeat password: "):
        print("Passwords do not match.", file=sys.stderr)
        return 1

    settings = load_settings()
    db.init(settings.db_path)
    conn = db.connect(settings.db_path)
    try:
        auth.set_password(conn, args.username, password, create=not args.reset_password)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    finally:
        conn.close()

    action = "Password reset for" if args.reset_password else "Created user"
    print(f"{action} '{auth.normalize_username(args.username)}' in {settings.db_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
