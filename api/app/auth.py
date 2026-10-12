"""Password hashing, login tokens and login throttling.

Users are created only by scripts/create_user.py, there is no registration endpoint.
"""

import hashlib
import hmac
import re
import secrets
import sqlite3
import threading
import time
from collections import defaultdict, deque

USERNAME_PATTERN = re.compile(r"^[a-z0-9_.-]{1,64}$")
MIN_PASSWORD_LENGTH = 8

# scrypt cost: about 16 MB of memory and tens of milliseconds per hash
_SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}
# Hashed for unknown users, so a wrong username takes as long as a wrong password
_DUMMY_SALT = secrets.token_bytes(16)


def normalize_username(username: str) -> str:
    return username.strip().lower()


def hash_password(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, **_SCRYPT)


def set_password(conn: sqlite3.Connection, username: str, password: str, *, create: bool) -> None:
    """Create a user or replace an existing user's password. Replacing revokes all their tokens."""
    username = normalize_username(username)
    if not USERNAME_PATTERN.match(username):
        raise ValueError("username may contain only a-z, 0-9, '_', '.', '-' (max 64)")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"password must be at least {MIN_PASSWORD_LENGTH} characters")
    salt = secrets.token_bytes(16)
    password_hash = hash_password(password, salt)
    exists = conn.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone()
    if create and exists:
        raise ValueError(f"user '{username}' already exists")
    if not create and not exists:
        raise ValueError(f"user '{username}' does not exist")
    with conn:
        if create:
            conn.execute(
                "INSERT INTO users (username, password_hash, salt, created_at) VALUES (?, ?, ?, ?)",
                (username, password_hash, salt, int(time.time())),
            )
        else:
            conn.execute(
                "UPDATE users SET password_hash = ?, salt = ? WHERE username = ?",
                (password_hash, salt, username),
            )
            conn.execute("DELETE FROM tokens WHERE username = ?", (username,))


def verify_password(conn: sqlite3.Connection, username: str, password: str) -> bool:
    row = conn.execute(
        "SELECT password_hash, salt FROM users WHERE username = ?", (normalize_username(username),)
    ).fetchone()
    if row is None:
        hash_password(password, _DUMMY_SALT)
        return False
    return hmac.compare_digest(hash_password(password, row["salt"]), row["password_hash"])


def _token_hash(token: str) -> str:
    # Tokens are 256 random bits, so a fast hash is enough
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def issue_token(conn: sqlite3.Connection, username: str, ttl_days: int) -> tuple[str, int]:
    """New login token and its expiry (unix seconds). Also clears expired tokens."""
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    expires_at = now + ttl_days * 86400
    with conn:
        conn.execute("DELETE FROM tokens WHERE expires_at <= ?", (now,))
        conn.execute(
            "INSERT INTO tokens (token_hash, username, expires_at) VALUES (?, ?, ?)",
            (_token_hash(token), normalize_username(username), expires_at),
        )
    return token, expires_at


def user_for_token(conn: sqlite3.Connection, token: str) -> str | None:
    row = conn.execute(
        "SELECT username FROM tokens WHERE token_hash = ? AND expires_at > ?",
        (_token_hash(token), int(time.time())),
    ).fetchone()
    return row["username"] if row else None


def revoke_token(conn: sqlite3.Connection, token: str) -> None:
    with conn:
        conn.execute("DELETE FROM tokens WHERE token_hash = ?", (_token_hash(token),))


class LoginThrottle:
    """Blocks a (client, username) pair after too many failed logins within a window.

    Kept in memory: a restart clears it, which is fine for a single small server.
    """

    def __init__(self, max_failures: int = 5, window_seconds: int = 15 * 60):
        self.max_failures = max_failures
        self.window = window_seconds
        self._failures: dict[tuple[str, str], deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()  # login runs in FastAPI's thread pool

    def _recent(self, key: tuple[str, str], now: float) -> deque[float]:
        failures = self._failures[key]
        while failures and failures[0] <= now - self.window:
            failures.popleft()
        return failures

    def retry_after(self, client: str, username: str) -> int:
        """Seconds until the next attempt is allowed, 0 if allowed now."""
        now = time.monotonic()
        key = (client, normalize_username(username))
        with self._lock:
            failures = self._recent(key, now)
            if len(failures) < self.max_failures:
                if not failures:
                    self._failures.pop(key, None)
                return 0
            return max(1, int(failures[0] + self.window - now) + 1)

    def record_failure(self, client: str, username: str) -> None:
        now = time.monotonic()
        with self._lock:
            self._recent((client, normalize_username(username)), now).append(now)

    def reset(self, client: str, username: str) -> None:
        with self._lock:
            self._failures.pop((client, normalize_username(username)), None)
