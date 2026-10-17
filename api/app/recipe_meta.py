"""Who added a recipe, and each person's rating and note. Kept beside the recipe files, keyed by recipe path."""

import sqlite3
import time
from dataclasses import dataclass

NOTE_MAX_LENGTH = 2000

SCHEMA = """
CREATE TABLE IF NOT EXISTS recipe_creators (
    path       TEXT PRIMARY KEY,
    username   TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS recipe_reviews (
    path       TEXT NOT NULL,
    username   TEXT NOT NULL,
    rating     INTEGER CHECK (rating BETWEEN 1 AND 5),
    note       TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (path, username)
);
"""


@dataclass(frozen=True)
class Review:
    username: str
    rating: int | None
    note: str | None
    updated_at: int


def creators(conn: sqlite3.Connection) -> dict[str, str]:
    """Path → username of the person who added the recipe. Recipes without an entry are not listed."""
    return {row["path"]: row["username"] for row in conn.execute("SELECT path, username FROM recipe_creators")}


def set_creator(conn: sqlite3.Connection, path: str, username: str) -> None:
    """Records who added a recipe. Replaces an earlier entry, used when a recipe is created."""
    with conn:
        conn.execute(
            "INSERT OR REPLACE INTO recipe_creators (path, username, created_at) VALUES (?, ?, ?)",
            (path, username, int(time.time() * 1000)),
        )


def rating_summaries(conn: sqlite3.Connection) -> dict[str, tuple[float, int]]:
    """Path → (average rating, number of ratings) for recipes that have at least one rating."""
    rows = conn.execute(
        "SELECT path, AVG(rating) AS average, COUNT(rating) AS count FROM recipe_reviews "
        "WHERE rating IS NOT NULL GROUP BY path"
    )
    return {row["path"]: (round(row["average"], 2), row["count"]) for row in rows}


def reviews(conn: sqlite3.Connection, path: str) -> list[Review]:
    rows = conn.execute(
        "SELECT username, rating, note, updated_at FROM recipe_reviews WHERE path = ? ORDER BY updated_at DESC",
        (path,),
    )
    return [Review(row["username"], row["rating"], row["note"], row["updated_at"]) for row in rows]


def save_review(
    conn: sqlite3.Connection, path: str, username: str, rating: int | None, note: str | None
) -> None:
    """Stores one person's rating and note. Without either, the review is removed."""
    with conn:
        if rating is None and not note:
            conn.execute("DELETE FROM recipe_reviews WHERE path = ? AND username = ?", (path, username))
            return
        conn.execute(
            "INSERT OR REPLACE INTO recipe_reviews (path, username, rating, note, updated_at) VALUES (?, ?, ?, ?, ?)",
            (path, username, rating, note, int(time.time() * 1000)),
        )


def forget_recipe(conn: sqlite3.Connection, path: str) -> None:
    """Removes the creator and all reviews of a deleted recipe, so a new recipe with the same name starts clean."""
    with conn:
        conn.execute("DELETE FROM recipe_creators WHERE path = ?", (path,))
        conn.execute("DELETE FROM recipe_reviews WHERE path = ?", (path,))


def forget_user_reviews(conn: sqlite3.Connection, username: str) -> None:
    """Removes a deleted account's ratings and notes. The recipes themselves stay."""
    with conn:
        conn.execute("DELETE FROM recipe_reviews WHERE username = ?", (username,))
