import time

from app.storage import etag

from .conftest import USERNAME

RECIPE = "---\ntitle: Linsensuppe\n---\n\nCook @lentils{200%g}.\n".encode()


def test_reads_are_public(client):
    assert client.get("/recipes").json() == {"recipes": []}
    assert client.get("/recipe/missing").status_code == 404


def test_put_requires_login(client):
    res = client.put("/recipe/Suppe", content=RECIPE)
    assert res.status_code == 401
    assert res.headers["WWW-Authenticate"] == "Bearer"
    assert client.put("/recipe/Suppe", content=RECIPE, headers={"Authorization": "Bearer nope"}).status_code == 401


def test_create_read_and_list(client, auth_headers):
    res = client.put("/recipe/Suppen/Linsen", content=RECIPE, headers=auth_headers)
    assert res.status_code == 201
    assert res.json() == {"path": "Suppen/Linsen", "etag": etag(RECIPE)}
    assert res.headers["ETag"] == etag(RECIPE)

    got = client.get("/recipe/Suppen/Linsen")
    assert got.status_code == 200
    assert got.content == RECIPE
    assert got.headers["content-type"] == "text/plain; charset=utf-8"
    assert got.headers["ETag"] == etag(RECIPE)

    listed = client.get("/recipes").json()["recipes"]
    assert len(listed) == 1
    modified = listed[0].pop("modified")
    assert listed[0] == {
        "path": "Suppen/Linsen",
        "title": "Linsensuppe",
        "etag": etag(RECIPE),
        "image": None,
        "added_by": USERNAME,
        "rating_average": None,
        "rating_count": 0,
    }
    assert isinstance(modified, int) and abs(modified / 1000 - time.time()) < 60


def test_cook_suffix_and_unicode_paths(client, auth_headers):
    assert client.put("/recipe/Grüne%20Soße.cook", content=b"x", headers=auth_headers).status_code == 201
    assert client.get("/recipe/Grüne Soße").content == b"x"


def test_bytes_are_stored_exactly(client, auth_headers):
    body = b"Line one\r\nLine two\r\n"
    client.put("/recipe/crlf", content=body, headers=auth_headers)
    assert client.get("/recipe/crlf").content == body


def test_invalid_paths_are_rejected(client, auth_headers):
    assert client.get("/recipe/.hidden").status_code == 400
    assert client.get("/recipe/a/..%2F..%2Fetc").status_code in (400, 404)
    assert client.put("/recipe/a/.x", content=b"x", headers=auth_headers).status_code == 400


def test_body_must_be_utf8(client, auth_headers):
    assert client.put("/recipe/bad", content=b"\xff\xfe", headers=auth_headers).status_code == 400


def test_body_size_limit(client, auth_headers):
    assert client.put("/recipe/big", content=b"x" * 10_001, headers=auth_headers).status_code == 413


def test_cors_exposes_etag(client):
    res = client.get("/recipes", headers={"Origin": "http://app.test"})
    assert res.headers["access-control-allow-origin"] == "http://app.test"
    assert "etag" in res.headers["access-control-expose-headers"].lower()

    preflight = client.options(
        "/recipe/x",
        headers={
            "Origin": "http://app.test",
            "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "authorization, if-match, content-type",
        },
    )
    assert preflight.status_code == 200


def test_cors_rejects_unknown_origin(client):
    res = client.get("/recipes", headers={"Origin": "http://evil.test"})
    assert "access-control-allow-origin" not in res.headers
