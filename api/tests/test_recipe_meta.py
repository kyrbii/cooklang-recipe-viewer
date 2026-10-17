from app import auth, db

from .conftest import PASSWORD, USERNAME

RECIPE = b"Cook @lentils{200%g}.\n"


def listed(client):
    return {r["path"]: r for r in client.get("/recipes").json()["recipes"]}


def create(client, headers, path="Suppen/Linsen", body=RECIPE):
    res = client.put(f"/recipe/{path}", content=body, headers=headers)
    assert res.status_code == 201
    return res.headers["ETag"]


def second_user(settings, name="anna"):
    conn = db.connect(settings.db_path)
    auth.set_password(conn, name, PASSWORD, create=True)
    conn.close()
    return name


def login_headers(client, name):
    token = client.post("/login", json={"username": name, "password": PASSWORD}).json()["token"]
    return {"Authorization": f"Bearer {token}"}


def test_creator_is_the_user_who_created_the_recipe(client, auth_headers, settings):
    anna = second_user(settings)
    tag = create(client, auth_headers)
    # Overwriting, even by someone else, does not change who added the recipe
    res = client.put("/recipe/Suppen/Linsen", content=b"changed", headers={**login_headers(client, anna), "If-Match": tag})
    assert res.status_code == 200
    assert listed(client)["Suppen/Linsen"]["added_by"] == USERNAME


def test_recipe_without_record_has_no_creator(client, auth_headers, settings):
    create(client, auth_headers)
    # A recipe that was never recorded, e.g. copied in by hand
    conn = db.connect(settings.db_path)
    conn.execute("DELETE FROM recipe_creators")
    conn.commit()
    conn.close()
    assert listed(client)["Suppen/Linsen"]["added_by"] is None


def test_delete_forgets_creator_and_reviews(client, auth_headers):
    tag = create(client, auth_headers)
    client.put("/recipe-reviews/Suppen/Linsen", json={"rating": 5, "note": "gut"}, headers=auth_headers)
    client.delete("/recipe/Suppen/Linsen", headers={**auth_headers, "If-Match": tag})
    create(client, auth_headers)
    assert listed(client)["Suppen/Linsen"]["rating_count"] == 0
    assert client.get("/recipe-reviews/Suppen/Linsen").json()["reviews"] == []


def test_each_person_has_one_review_and_average_counts_ratings(client, auth_headers, settings):
    anna = second_user(settings)
    create(client, auth_headers)
    client.put("/recipe-reviews/Suppen/Linsen", json={"rating": 4, "note": "zu salzig"}, headers=auth_headers)
    client.put("/recipe-reviews/Suppen/Linsen", json={"rating": 5}, headers=login_headers(client, anna))
    # Changing a review replaces it, it does not add a second one
    res = client.put("/recipe-reviews/Suppen/Linsen", json={"rating": 3, "note": "zu salzig"}, headers=auth_headers)

    body = res.json()
    assert body["rating_count"] == 2
    assert body["rating_average"] == 4.0
    assert {r["username"]: r["rating"] for r in body["reviews"]} == {USERNAME: 3, anna: 5}
    assert listed(client)["Suppen/Linsen"]["rating_average"] == 4.0


def test_note_only_review_has_no_rating(client, auth_headers):
    create(client, auth_headers)
    body = client.put("/recipe-reviews/Suppen/Linsen", json={"note": "einfach"}, headers=auth_headers).json()
    assert body["rating_average"] is None
    assert body["rating_count"] == 0
    assert body["reviews"][0]["note"] == "einfach"


def test_empty_review_removes_it(client, auth_headers):
    create(client, auth_headers)
    client.put("/recipe-reviews/Suppen/Linsen", json={"rating": 2}, headers=auth_headers)
    body = client.put("/recipe-reviews/Suppen/Linsen", json={"rating": None, "note": "  "}, headers=auth_headers).json()
    assert body == {"reviews": [], "rating_average": None, "rating_count": 0}


def test_invalid_rating_and_long_note_are_refused(client, auth_headers):
    create(client, auth_headers)
    assert client.put("/recipe-reviews/Suppen/Linsen", json={"rating": 6}, headers=auth_headers).status_code == 422
    assert client.put("/recipe-reviews/Suppen/Linsen", json={"rating": 0}, headers=auth_headers).status_code == 422
    long_note = {"note": "x" * 2001}
    assert client.put("/recipe-reviews/Suppen/Linsen", json=long_note, headers=auth_headers).status_code == 422


def test_reviews_read_is_public_write_needs_login(client, auth_headers):
    create(client, auth_headers)
    assert client.get("/recipe-reviews/Suppen/Linsen").status_code == 200
    assert client.put("/recipe-reviews/Suppen/Linsen", json={"rating": 4}).status_code == 401


def test_review_of_missing_recipe_is_404(client, auth_headers):
    assert client.get("/recipe-reviews/gibt/es/nicht").status_code == 404
    assert client.put("/recipe-reviews/gibt/es/nicht", json={"rating": 4}, headers=auth_headers).status_code == 404


def test_deleting_account_removes_its_reviews_but_keeps_recipe(client, auth_headers, settings):
    anna = second_user(settings)
    create(client, auth_headers)
    client.put("/recipe-reviews/Suppen/Linsen", json={"rating": 5, "note": "top"}, headers=login_headers(client, anna))
    res = client.request("DELETE", "/account", json={"password": PASSWORD}, headers=login_headers(client, anna))
    assert res.status_code == 204
    assert client.get("/recipe-reviews/Suppen/Linsen").json()["reviews"] == []
    assert listed(client)["Suppen/Linsen"]["added_by"] == USERNAME
    assert client.get("/recipe/Suppen/Linsen").status_code == 200
