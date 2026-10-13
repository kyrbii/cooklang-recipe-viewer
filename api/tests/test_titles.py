from app.titles import MAX_TITLE_LENGTH, clean_title, recipe_title


def test_front_matter_title():
    text = "---\ntitle: Veganer Marmorkuchen\nservings: 4\n---\n\nMix @flour{200%g}."
    assert recipe_title(text, "Backen/Kuchen") == "Veganer Marmorkuchen"


def test_front_matter_title_quoted_and_indented():
    assert recipe_title('---\n  title: "Rote Bete"\n---\n', "x") == "Rote Bete"


def test_legacy_title_line():
    assert recipe_title(">> title: Linsensuppe\n\nCook @lentils{}.", "Suppe") == "Linsensuppe"


def test_legacy_line_overrides_front_matter_like_the_client():
    text = "---\ntitle: First\n---\n>> title: Second\n"
    assert recipe_title(text, "x") == "Second"


def test_legacy_title_ignores_line_comment():
    assert recipe_title(">> title: Pfannkuchen -- alt\n", "x") == "Pfannkuchen"


def test_title_key_in_body_text_is_not_a_title():
    assert recipe_title("title: not metadata\n", "Brot") == "Brot"


def test_fallback_to_file_name():
    assert recipe_title("Boil @water{}.", "Backen/Hefezopf") == "Hefezopf"


def test_bom_is_ignored():
    assert recipe_title("﻿---\ntitle: Mit BOM\n---\n", "x") == "Mit BOM"


def test_control_characters_and_whitespace_are_cleaned():
    assert clean_title("A\tB\x00C D   E ") == "A B C D E"


def test_title_is_capped():
    assert len(clean_title("x" * 500)) == MAX_TITLE_LENGTH


def test_empty_title_after_cleaning_falls_back():
    assert recipe_title("---\ntitle: \x00\x01\n---\n", "Folder/Name") == "Name"


def test_html_is_kept_as_text():
    # Escaping is the client's job, the title is returned as plain text
    assert recipe_title(">> title: <b>Bold</b>\n", "x") == "<b>Bold</b>"
