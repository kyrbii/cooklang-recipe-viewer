from app.storage import etag

V1 = b"version one"
V2 = b"version two"
V3 = b"version three"


def create(client, headers, body=V1):
    res = client.put("/recipe/r", content=body, headers=headers)
    assert res.status_code == 201
    return res.headers["ETag"]


def test_overwrite_without_if_match_is_refused(client, auth_headers):
    create(client, auth_headers)
    res = client.put("/recipe/r", content=V2, headers=auth_headers)
    assert res.status_code == 428
    assert client.get("/recipe/r").content == V1


def test_empty_if_match_counts_as_missing(client, auth_headers):
    create(client, auth_headers)
    res = client.put("/recipe/r", content=V2, headers={**auth_headers, "If-Match": "  "})
    assert res.status_code == 428


def test_matching_if_match_saves(client, auth_headers):
    tag = create(client, auth_headers)
    res = client.put("/recipe/r", content=V2, headers={**auth_headers, "If-Match": tag})
    assert res.status_code == 200
    assert res.headers["ETag"] == etag(V2)
    assert client.get("/recipe/r").content == V2


def test_weak_etag_from_proxy_is_accepted(client, auth_headers):
    tag = create(client, auth_headers)
    res = client.put("/recipe/r", content=V2, headers={**auth_headers, "If-Match": "W/" + tag})
    assert res.status_code == 200


def test_stale_if_match_returns_server_version(client, auth_headers):
    stale = create(client, auth_headers)
    client.put("/recipe/r", content=V2, headers={**auth_headers, "If-Match": stale})

    res = client.put("/recipe/r", content=V3, headers={**auth_headers, "If-Match": stale})
    assert res.status_code == 412
    assert res.content == V2
    assert res.headers["ETag"] == etag(V2)
    assert client.get("/recipe/r").content == V2

    # Retrying with the ETag from the conflict response succeeds
    retry = client.put("/recipe/r", content=V3, headers={**auth_headers, "If-Match": res.headers["ETag"]})
    assert retry.status_code == 200


def test_if_match_on_deleted_recipe_is_a_conflict(client, auth_headers, settings):
    tag = create(client, auth_headers)
    (settings.recipe_dir / "r.cook").unlink()
    res = client.put("/recipe/r", content=V2, headers={**auth_headers, "If-Match": tag})
    assert res.status_code == 412
    assert res.content == b""
    assert client.get("/recipe/r").status_code == 404


def test_list_etag_works_as_if_match(client, auth_headers):
    create(client, auth_headers)
    listed = client.get("/recipes").json()["recipes"][0]["etag"]
    res = client.put("/recipe/r", content=V2, headers={**auth_headers, "If-Match": listed})
    assert res.status_code == 200
