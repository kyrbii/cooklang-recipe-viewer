"""Collections: named groups of recipes that belong to several people at once.

All members are equal: any member can rename, fill, empty or delete the collection and invite or remove
others. Recipes stay public and in their folder, a collection only stores their paths.
"""

import sqlite3
import time
from dataclasses import dataclass

NAME_MAX_LENGTH = 100

SCHEMA = """
CREATE TABLE IF NOT EXISTS collections (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    created_by TEXT REFERENCES users(username) ON DELETE SET NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS collection_members (
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    username      TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    added_at      INTEGER NOT NULL,
    PRIMARY KEY (collection_id, username)
);
CREATE INDEX IF NOT EXISTS collection_members_username ON collection_members(username);
CREATE TABLE IF NOT EXISTS collection_recipes (
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    path          TEXT NOT NULL,
    added_at      INTEGER NOT NULL,
    PRIMARY KEY (collection_id, path)
);
CREATE INDEX IF NOT EXISTS collection_recipes_path ON collection_recipes(path);
-- A collection without members could never be opened again. This also covers deleted accounts,
-- because the foreign key removes their memberships and fires the trigger for each of them.
CREATE TRIGGER IF NOT EXISTS collections_drop_orphans
AFTER DELETE ON collection_members
BEGIN
    DELETE FROM collections
    WHERE id = OLD.collection_id
      AND NOT EXISTS (SELECT 1 FROM collection_members WHERE collection_id = OLD.collection_id);
END;
"""


@dataclass(frozen=True)
class Collection:
    id: int
    name: str
    created_by: str | None
    members: list[str]
    paths: list[str]


def _now() -> int:
    return int(time.time() * 1000)


def is_member(conn: sqlite3.Connection, collection_id: int, username: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM collection_members WHERE collection_id = ? AND username = ?", (collection_id, username)
    ).fetchone()
    return row is not None


def create(conn: sqlite3.Connection, username: str, name: str) -> int:
    """New collection with its creator as the first member."""
    now = _now()
    with conn:
        cursor = conn.execute(
            "INSERT INTO collections (name, created_by, created_at) VALUES (?, ?, ?)", (name, username, now)
        )
        collection_id = cursor.lastrowid
        conn.execute(
            "INSERT INTO collection_members (collection_id, username, added_at) VALUES (?, ?, ?)",
            (collection_id, username, now),
        )
    return collection_id


def rename(conn: sqlite3.Connection, collection_id: int, name: str) -> None:
    with conn:
        conn.execute("UPDATE collections SET name = ? WHERE id = ?", (name, collection_id))


def delete(conn: sqlite3.Connection, collection_id: int) -> None:
    with conn:
        conn.execute("DELETE FROM collections WHERE id = ?", (collection_id,))


def get(conn: sqlite3.Connection, collection_id: int) -> Collection | None:
    return next(iter(_load(conn, "c.id = ?", (collection_id,))), None)


def for_user(conn: sqlite3.Connection, username: str) -> list[Collection]:
    """Every collection the person is a member of, by name."""
    return _load(
        conn,
        "c.id IN (SELECT collection_id FROM collection_members WHERE username = ?)",
        (username,),
    )


def _load(conn: sqlite3.Connection, where: str, params: tuple) -> list[Collection]:
    rows = conn.execute(
        f"SELECT c.id, c.name, c.created_by FROM collections c WHERE {where} ORDER BY c.name COLLATE NOCASE, c.id",
        params,
    ).fetchall()
    ids = [row["id"] for row in rows]
    if not ids:
        return []
    marks = ",".join("?" * len(ids))
    members: dict[int, list[str]] = {i: [] for i in ids}
    for row in conn.execute(
        f"SELECT collection_id, username FROM collection_members WHERE collection_id IN ({marks}) "
        "ORDER BY added_at, username",
        ids,
    ):
        members[row["collection_id"]].append(row["username"])
    paths: dict[int, list[str]] = {i: [] for i in ids}
    for row in conn.execute(
        f"SELECT collection_id, path FROM collection_recipes WHERE collection_id IN ({marks}) "
        "ORDER BY added_at, path",
        ids,
    ):
        paths[row["collection_id"]].append(row["path"])
    return [Collection(r["id"], r["name"], r["created_by"], members[r["id"]], paths[r["id"]]) for r in rows]


def add_recipe(conn: sqlite3.Connection, collection_id: int, path: str) -> None:
    with conn:
        conn.execute(
            "INSERT OR IGNORE INTO collection_recipes (collection_id, path, added_at) VALUES (?, ?, ?)",
            (collection_id, path, _now()),
        )


def remove_recipe(conn: sqlite3.Connection, collection_id: int, path: str) -> None:
    with conn:
        conn.execute("DELETE FROM collection_recipes WHERE collection_id = ? AND path = ?", (collection_id, path))


def add_member(conn: sqlite3.Connection, collection_id: int, username: str) -> None:
    with conn:
        conn.execute(
            "INSERT OR IGNORE INTO collection_members (collection_id, username, added_at) VALUES (?, ?, ?)",
            (collection_id, username, _now()),
        )


def remove_member(conn: sqlite3.Connection, collection_id: int, username: str) -> None:
    """Removes a member. The trigger deletes the collection when the last one goes."""
    with conn:
        conn.execute(
            "DELETE FROM collection_members WHERE collection_id = ? AND username = ?", (collection_id, username)
        )


def forget_recipe(conn: sqlite3.Connection, path: str) -> None:
    """Takes a deleted recipe out of every collection, so a new recipe with the same name starts clean."""
    with conn:
        conn.execute("DELETE FROM collection_recipes WHERE path = ?", (path,))
