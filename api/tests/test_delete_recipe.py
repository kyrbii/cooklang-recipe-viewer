from app.storage import etag


V1 = b"version one"
V2 = b"version two"


def create(client, headers, path="Suppen/Linsen", body=V1):
    res = client.put(f"/recipe/{path}", content=body, headers=headers)
    assert res.status_code == 201
    return res.headers["ETag"]


def test_delete_needs_login(client, auth_headers):
    tag = create(client, auth_headers)
    assert client.delete("/recipe/Suppen/Linsen", headers={"If-Match": tag}).status_code == 401
    assert client.get("/recipe/Suppen/Linsen").status_code == 200


def test_delete_needs_if_match(client, auth_headers):
    create(client, auth_headers)
    assert client.delete("/recipe/Suppen/Linsen", headers=auth_headers).status_code == 428
    assert client.get("/recipe/Suppen/Linsen").status_code == 200


def test_delete_with_current_etag(client, auth_headers):
    tag = create(client, auth_headers)
    res = client.delete("/recipe/Suppen/Linsen", headers={**auth_headers, "If-Match": tag})
    assert res.status_code == 204
    assert client.get("/recipe/Suppen/Linsen").status_code == 404


def test_stale_etag_returns_server_version(client, auth_headers):
    stale = create(client, auth_headers)
    client.put("/recipe/Suppen/Linsen", content=V2, headers={**auth_headers, "If-Match": stale})
    res = client.delete("/recipe/Suppen/Linsen", headers={**auth_headers, "If-Match": stale})
    assert res.status_code == 412
    assert res.content == V2
    assert client.get("/recipe/Suppen/Linsen").content == V2


def test_delete_missing_is_404(client, auth_headers):
    res = client.delete("/recipe/nope", headers={**auth_headers, "If-Match": etag(b"x")})
    assert res.status_code == 404


def test_delete_removes_empty_folders_only(client, auth_headers, settings):
    tag = create(client, auth_headers, path="A/B/Eins")
    create(client, auth_headers, path="A/Zwei")
    client.delete("/recipe/A/B/Eins", headers={**auth_headers, "If-Match": tag})
    assert not (settings.recipe_dir / "A" / "B").exists()
    assert (settings.recipe_dir / "A" / "Zwei.cook").exists()


def test_delete_leaves_the_recipe_root(client, auth_headers, settings):
    tag = create(client, auth_headers, path="Brot")
    client.delete("/recipe/Brot", headers={**auth_headers, "If-Match": tag})
    assert settings.recipe_dir.is_dir()
