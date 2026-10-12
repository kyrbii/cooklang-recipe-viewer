import os

import pytest

from app.storage import InvalidPath, RecipeStore, etag, if_match_satisfied, normalize_path


@pytest.fixture
def store(tmp_path):
    return RecipeStore(tmp_path / "recipes")


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("Kuchen", "Kuchen"),
        ("/Backen/Kuchen/", "Backen/Kuchen"),
        ("Backen/Kuchen.cook", "Backen/Kuchen"),
        ("Backen/Kuchen.COOK", "Backen/Kuchen"),
        ("Grüne Soße", "Grüne Soße"),
        (" Brot ", "Brot"),
    ],
)
def test_normalize_path(raw, expected):
    assert normalize_path(raw) == expected


@pytest.mark.parametrize(
    "raw",
    ["", "/", "..", "../x", "a/../b", "a//b", ".hidden", "a/.hidden", "a\\b", "a\x00b", "a /b", ".cook", "x" * 600],
)
def test_normalize_path_rejects(raw):
    with pytest.raises(InvalidPath):
        normalize_path(raw)


def test_resolve_stays_inside_root(store):
    path, file = store.resolve("Backen/Kuchen")
    assert path == "Backen/Kuchen"
    assert file == store.root / "Backen" / "Kuchen.cook"


def test_resolve_refuses_symlinked_folder(store, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    os.symlink(outside, store.root / "link")
    with pytest.raises(InvalidPath):
        store.resolve("link/secret")


def test_resolve_refuses_symlinked_file(store, tmp_path):
    target = tmp_path / "target.cook"
    target.write_text("x")
    os.symlink(target, store.root / "evil.cook")
    with pytest.raises(InvalidPath):
        store.resolve("evil")


def test_resolve_refuses_directory_named_like_a_recipe(store):
    (store.root / "odd.cook").mkdir()
    with pytest.raises(InvalidPath):
        store.resolve("odd")


def test_write_atomic_creates_folders_and_leaves_no_temp_files(store):
    _, file = store.resolve("Neu/Ordner/Rezept")
    store.write_atomic(file, b"hello")
    assert file.read_bytes() == b"hello"
    assert sorted(p.name for p in file.parent.iterdir()) == ["Rezept.cook"]


def test_read_missing_returns_none(store):
    _, file = store.resolve("missing")
    assert store.read_bytes(file) is None


def test_list_recipes_with_titles_and_etags(store, tmp_path):
    (store.root / "Backen").mkdir()
    (store.root / "Backen" / "Kuchen.cook").write_text("---\ntitle: Marmorkuchen\n---\n", encoding="utf-8")
    (store.root / "Brot.cook").write_text("Bake.", encoding="utf-8")
    (store.root / "notes.txt").write_text("not a recipe")
    (store.root / ".hidden.cook").write_text("hidden")
    (store.root / ".git").mkdir()
    (store.root / ".git" / "x.cook").write_text("hidden")
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "leak.cook").write_text("secret")
    os.symlink(outside, store.root / "linked")

    entries = store.list()
    assert [(e.path, e.title) for e in entries] == [("Backen/Kuchen", "Marmorkuchen"), ("Brot", "Brot")]
    assert entries[1].etag == etag(b"Bake.")


def test_list_survives_invalid_utf8(store):
    (store.root / "Kaputt.cook").write_bytes(b"\xff\xfe broken")
    assert [e.path for e in store.list()] == ["Kaputt"]


def test_if_match():
    tag = etag(b"x")
    assert if_match_satisfied(tag, tag)
    assert if_match_satisfied("W/" + tag, tag)
    assert if_match_satisfied('"other", ' + tag, tag)
    assert if_match_satisfied("*", tag)
    assert not if_match_satisfied('"other"', tag)
