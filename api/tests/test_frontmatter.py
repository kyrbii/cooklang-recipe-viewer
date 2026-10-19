import importlib.util
import sys
from pathlib import Path

import pytest

from app.frontmatter import to_front_matter

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "migrate_frontmatter.py"


def test_leading_lines_become_front_matter():
    text = ">> title: Torte: lecker\n>> servings: 4\n>> source: https://x.test/r\n\nMix @Mehl{200%g}."
    assert to_front_matter(text) == (
        '---\ntitle: "Torte: lecker"\nservings: 4\nsource: https://x.test/r\n---\n\nMix @Mehl{200%g}.'
    )


def test_lines_between_steps_are_gathered_at_the_top():
    text = ">> title: A\n\nMix @Mehl{200%g}.\n\n>> servings: 4\n\nBake ~{20%min}.\n>> source: Oma\nServe."
    assert to_front_matter(text) == (
        "---\ntitle: A\nservings: 4\nsource: Oma\n---\n\nMix @Mehl{200%g}.\n\nBake ~{20%min}.\nServe."
    )


def test_extends_existing_front_matter_and_legacy_wins():
    text = "---\ntitle: Alt\ntags: [a, b]\nservings: 2\n---\n\nMix.\n>> title: Neu\n>> servings: 4\n"
    assert to_front_matter(text) == "---\ntags: [a, b]\ntitle: Neu\nservings: 4\n---\n\nMix.\n"


def test_replaces_a_multi_line_entry():
    text = "---\ntags:\n  - a\n  - b\ntitle: A\n---\n>> tags: c\nMix."
    assert to_front_matter(text) == "---\ntitle: A\ntags: c\n---\nMix."


def test_later_line_wins_over_earlier_one():
    assert to_front_matter(">> title: A\n>> Title: B\nMix.") == "---\nTitle: B\n---\nMix."


def test_keeps_crlf_and_bom():
    assert to_front_matter("﻿>> title: A\r\n\r\nMix.\r\n") == "﻿---\r\ntitle: A\r\n---\r\n\r\nMix.\r\n"


def test_text_without_legacy_lines_is_unchanged():
    for text in ["Mix.", "---\ntitle: A\n---\n\n> Tipp\n\nMix.", "> Notiz\n\nMix @Mehl{1}.\n", ""]:
        assert to_front_matter(text) == text


def test_is_idempotent():
    once = to_front_matter(">> title: A\n\nMix.\n>> servings: 4\n")
    assert to_front_matter(once) == once


@pytest.fixture
def recipes(tmp_path, monkeypatch):
    folder = tmp_path / "recipes"
    (folder / "Backen").mkdir(parents=True)
    (folder / "Backen" / "Marmor.cook").write_text(">> title: Marmor\n\nMix @Mehl{300%g}.\n>> servings: 4\n")
    (folder / "Neu.cook").write_text("---\ntitle: Neu\n---\n\nMix.\n")
    monkeypatch.setenv("RECIPE_DIR", str(folder))
    return folder


def run_script(args):
    spec = importlib.util.spec_from_file_location("migrate_frontmatter", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkey_argv = sys.argv
    sys.argv = ["migrate_frontmatter.py", *args]
    try:
        return module.main()
    finally:
        sys.argv = monkey_argv


def test_script_dry_run_changes_nothing(recipes, capsys):
    before = (recipes / "Backen" / "Marmor.cook").read_text()
    assert run_script([]) == 0
    out = capsys.readouterr().out
    assert "Backen/Marmor" in out and "Neu" not in out.replace("would be converted", "")
    assert "1 recipe(s) would be converted" in out
    assert (recipes / "Backen" / "Marmor.cook").read_text() == before
    assert not list(recipes.rglob("*.bak"))


def test_script_apply_converts_and_keeps_a_copy(recipes, capsys):
    original = (recipes / "Backen" / "Marmor.cook").read_text()
    assert run_script(["--apply"]) == 0
    assert (recipes / "Backen" / "Marmor.cook").read_text() == "---\ntitle: Marmor\nservings: 4\n---\n\nMix @Mehl{300%g}.\n"
    assert (recipes / "Backen" / "Marmor.cook.bak").read_text() == original
    assert (recipes / "Neu.cook").read_text() == "---\ntitle: Neu\n---\n\nMix.\n"
    assert run_script(["--apply"]) == 0
    assert "0 recipe(s) converted" in capsys.readouterr().out
