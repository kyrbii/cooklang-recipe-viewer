import importlib.util
import sys
from pathlib import Path

import pytest

from app import auth, db, recipe_meta

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "set_creator.py"


@pytest.fixture
def run(tmp_path, monkeypatch, capsys):
    """Runs the script's main() with a temporary database and recipe folder."""
    recipes = tmp_path / "recipes"
    (recipes / "Backen").mkdir(parents=True)
    (recipes / "Backen" / "Marmor.cook").write_text("Cook @flour{300%g}.\n")
    (recipes / "Linsen.cook").write_text("Cook @lentils{200%g}.\n")
    db_path = tmp_path / "api.db"
    db.init(db_path)
    conn = db.connect(db_path)
    auth.set_password(conn, "korbinian", "pw-long-enough", create=True)
    auth.set_password(conn, "anna", "pw-long-enough", create=True)
    conn.close()
    monkeypatch.setenv("DB_PATH", str(db_path))
    monkeypatch.setenv("RECIPE_DIR", str(recipes))

    spec = importlib.util.spec_from_file_location("set_creator", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    def call(*args: str) -> int:
        monkeypatch.setattr(sys, "argv", ["set_creator.py", *args])
        return module.main()

    def creators() -> dict[str, str]:
        conn = db.connect(db_path)
        try:
            return recipe_meta.creators(conn)
        finally:
            conn.close()

    call.creators = creators
    call.capsys = capsys
    return call


def test_list_unknown_prints_recipes_without_creator(run):
    assert run("--list-unknown") == 0
    assert run.capsys.readouterr().out.split() == ["Backen/Marmor", "Linsen"]


def test_unknown_sets_only_recipes_without_creator(run):
    assert run("korbinian", "--unknown") == 0
    assert run.creators() == {"Backen/Marmor": "korbinian", "Linsen": "korbinian"}

    # Explicit path overrides the earlier value, --unknown no longer finds anything
    assert run("anna", "Linsen") == 0
    assert run.creators()["Linsen"] == "anna"
    assert run("anna", "--unknown") == 0
    assert run.creators() == {"Backen/Marmor": "korbinian", "Linsen": "anna"}


def test_unknown_user_is_refused(run):
    assert run("nobody", "--unknown") == 1
    assert run.creators() == {}


def test_missing_recipe_is_refused(run):
    assert run("anna", "Gibt/es/nicht") == 1
    assert run.creators() == {}


def test_missing_arguments_are_refused(run):
    with pytest.raises(SystemExit):
        run("anna")
