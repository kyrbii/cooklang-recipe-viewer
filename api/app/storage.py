"""Recipe files on disk: path safety, listing, reading, atomic writes, ETags."""

import hashlib
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path

from .titles import recipe_title

SUFFIX = ".cook"
MAX_PATH_LENGTH = 512
_BAD_SEGMENT = re.compile(r"[\x00-\x1f\x7f\\]")


class InvalidPath(ValueError):
    pass


@dataclass(frozen=True)
class RecipeEntry:
    path: str
    title: str
    etag: str


def etag(data: bytes) -> str:
    """Strong ETag: quoted SHA-256 of the exact stored bytes."""
    return '"' + hashlib.sha256(data).hexdigest() + '"'


def if_match_satisfied(header: str, current_etag: str) -> bool:
    """True if any tag in an If-Match header matches. Accepts W/ tags, since proxies
    with gzip turn strong ETags into weak ones, and `*`."""
    for tag in header.split(","):
        tag = tag.strip()
        if tag == "*":
            return True
        if tag.startswith("W/"):
            tag = tag[2:]
        if tag == current_etag:
            return True
    return False


def normalize_path(raw: str) -> str:
    """Recipe path as used in URLs: slash-separated, no leading slash, no .cook suffix."""
    path = raw.strip().strip("/")
    if path.lower().endswith(SUFFIX):
        path = path[: -len(SUFFIX)]
    if not path or len(path) > MAX_PATH_LENGTH:
        raise InvalidPath("invalid recipe path")
    for segment in path.split("/"):
        if not segment or segment.startswith(".") or segment != segment.strip() or _BAD_SEGMENT.search(segment):
            raise InvalidPath("invalid recipe path")
    return path


class RecipeStore:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def resolve(self, raw: str) -> tuple[str, Path]:
        """Validated recipe path and its file. Refuses anything outside the root and symlinks."""
        path = normalize_path(raw)
        *folders, name = path.split("/")
        file = self.root.joinpath(*folders, name + SUFFIX)
        current = self.root
        for part in file.relative_to(self.root).parts:
            current = current / part
            if current.is_symlink():
                raise InvalidPath("symlinks are not allowed")
        if not file.resolve().is_relative_to(self.root):
            raise InvalidPath("invalid recipe path")
        if file.exists() and not file.is_file():
            raise InvalidPath("not a recipe file")
        return path, file

    def read_bytes(self, file: Path) -> bytes | None:
        try:
            return file.read_bytes()
        except FileNotFoundError:
            return None

    def write_atomic(self, file: Path, data: bytes) -> None:
        """Write to a hidden temp file in the same folder, then rename over the target."""
        file.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=file.parent, prefix=".", suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, file)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    def delete(self, file: Path) -> None:
        """Removes the file, then empty folders above it, up to the recipe root."""
        file.unlink()
        folder = file.parent
        while folder != self.root and folder.is_relative_to(self.root) and not any(folder.iterdir()):
            folder.rmdir()
            folder = folder.parent

    def list(self) -> list[RecipeEntry]:
        """All recipes, sorted by path. Skips hidden entries and symlinks."""
        entries: list[RecipeEntry] = []
        for dirpath, dirnames, filenames in os.walk(self.root, followlinks=False):
            base = Path(dirpath)
            dirnames[:] = sorted(
                d for d in dirnames if not d.startswith(".") and not (base / d).is_symlink()
            )
            for name in filenames:
                file = base / name
                if name.startswith(".") or not name.endswith(SUFFIX) or file.is_symlink():
                    continue
                path = file.relative_to(self.root).as_posix()[: -len(SUFFIX)]
                try:
                    normalize_path(path)
                except InvalidPath:
                    continue
                data = file.read_bytes()
                text = data.decode("utf-8", errors="replace")
                entries.append(RecipeEntry(path=path, title=recipe_title(text, path), etag=etag(data)))
        entries.sort(key=lambda e: e.path)
        return entries
