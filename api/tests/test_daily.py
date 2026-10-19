from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app import daily
from app.main import create_app

JPEG = b"\xff\xd8\xff" + b"0" * 20

RECIPE = {
    "_id": {"$oid": "5d7a1b2c3e4f5a6b7c8d9e0f"},
    "localizedTitle": {"de": "Cremige Pasta", "en": "Creamy pasta"},
    "authorComment": {"de": "Schnell gemacht"},
    "preparationTime": 10,
    "cookingTime": 20,
    "fixedPortionCount": 2,
    "activeTags": ["vegetarisch", "schnell"],
    "imageList": [{"name": "c", "type": "cover", "url": "https://img.test/c.jpg"}],
    "steps": [
        {
            "title": {"de": "Nudeln in Salzwasser kochen."},
            "ingredients": [
                {
                    "quantity": 200,
                    "unit": {"shortTitle": {"de": "g"}},
                    "ingredient": {"localizedTitle": {"de": "Nudeln"}},
                }
            ],
            "timers": [{"minOrExact": 8, "max": 10}],
        },
        {
            "title": {"de": "Alles vermengen."},
            "ingredients": [
                {"quantity": 1.5, "ingredient": {"localizedTitle": {"de": "Sahne"}}},
            ],
        },
    ],
}


def test_to_cooklang():
    text = daily.to_cooklang(RECIPE)
    assert text.startswith("---\ntitle: Cremige Pasta\nservings: 2\ntime: 30 min\n")
    assert "tags: [vegetarisch, schnell]" in text
    assert "source: KptnCook" in text
    # The ingredient is marked where it appears in the step, and the timer is added to the step
    assert "@Nudeln{200%g} in Salzwasser kochen. ~{8-10%minutes}" in text
    # Not mentioned in the step text: appended, still inline
    assert "Alles vermengen. (@Sahne{1.5})" in text
    # No ingredient list and no legacy metadata
    assert ">>" not in text


def test_to_cooklang_rejects_incomplete():
    assert daily.to_cooklang({"localizedTitle": {"de": "x"}, "steps": []}) is None
    assert daily.to_cooklang({"steps": [{"title": {"de": "a"}}]}) is None


def test_step_text_cannot_inject_syntax():
    recipe = {**RECIPE, "steps": [{"title": {"de": "== Abschnitt\n> Notiz -- Kommentar"}}]}
    body = daily.to_cooklang(recipe).split("---\n\n", 1)[1]
    assert not body.startswith(("=", ">"))
    assert "--" not in body


def test_recipe_id_and_cover():
    assert daily.recipe_id(RECIPE) == "5d7a1b2c3e4f5a6b7c8d9e0f"
    assert daily.recipe_id({"_id": {"$oid": "../etc"}}) is None
    assert daily.cover_url(RECIPE) == "https://img.test/c.jpg"


def test_store_cleanup_keeps_recent_days(tmp_path):
    store = daily.DailyStore(tmp_path)
    today = date(2026, 10, 19)
    for offset in range(5):
        store.write(today - timedelta(days=offset), "a", "---\ntitle: A\n---\n\nx\n", None)
    store.cleanup(today)
    assert sorted(store.days()) == ["2026-10-17", "2026-10-18", "2026-10-19"]


@pytest.fixture
def kptn(settings, monkeypatch):
    calls = []

    def fake_today(key):
        calls.append(key)
        return [RECIPE]

    monkeypatch.setattr(daily, "fetch_today", fake_today)
    monkeypatch.setattr(daily, "fetch_photo", lambda url, key: (JPEG, ".jpg"))
    from dataclasses import replace

    app = create_app(replace(settings, kptncook_api_key="key"))
    return TestClient(app), calls


def test_daily_list_fetches_once_and_serves(kptn):
    client, calls = kptn
    res = client.get("/daily")
    assert [r["title"] for r in res.json()["recipes"]] == ["Cremige Pasta"]
    assert res.json()["recipes"][0]["image"].startswith("daily-photo/5d7a1b2c3e4f5a6b7c8d9e0f")
    client.get("/daily")
    assert calls == ["key"]
    assert "Nudeln" in client.get("/daily/5d7a1b2c3e4f5a6b7c8d9e0f").text
    assert client.get("/daily-photo/5d7a1b2c3e4f5a6b7c8d9e0f").content == JPEG
    assert client.get("/daily/nope").status_code == 404
    assert client.get("/daily/..%2Fx").status_code in (404, 422)


def test_daily_without_key_is_empty(client):
    assert client.get("/daily").json() == {"recipes": []}


def test_failed_fetch_is_not_retried_at_once(settings, monkeypatch):
    from dataclasses import replace

    calls = []
    monkeypatch.setattr(daily, "fetch_today", lambda key: calls.append(key) or [])
    client = TestClient(create_app(replace(settings, kptncook_api_key="key")))
    assert client.get("/daily").json() == {"recipes": []}
    client.get("/daily")
    assert len(calls) == 1


def test_save_needs_login_and_copies(kptn, auth_headers):
    client, _ = kptn
    client.get("/daily")
    url = "/daily/5d7a1b2c3e4f5a6b7c8d9e0f/save"
    assert client.post(url).status_code == 401
    res = client.post(url, headers=auth_headers)
    assert res.status_code == 201
    assert res.json()["path"] == "Cremige Pasta"
    assert "Nudeln" in client.get("/recipe/Cremige Pasta").text
    assert client.get("/recipe-photo/Cremige Pasta").content == JPEG
    listed = client.get("/recipes").json()["recipes"][0]
    assert listed["added_by"] == "tester"
    # Saving again never overwrites
    assert client.post(url, headers=auth_headers).json()["path"] == "Cremige Pasta 2"


def test_fetch_failures_return_nothing(monkeypatch):
    import http.client

    def boom(*args, **kwargs):
        raise http.client.InvalidURL("bad")

    monkeypatch.setattr(daily.urllib.request, "urlopen", boom)
    assert daily.fetch_today("<your key>") == []
    assert daily.fetch_photo("https://img.test/x.jpg", "k") is None
