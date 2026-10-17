from app.storage import etag, sniff_photo


JPEG = b"\xff\xd8\xff\xe0" + b"jpeg-body"
PNG = b"\x89PNG\r\n\x1a\n" + b"png-body"
WEBP = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"webp-body"


def make_recipe(client, headers, path="Backen/Kuchen"):
    res = client.put(f"/recipe/{path}", content=b">> title: Kuchen\n\nBake.", headers=headers)
    assert res.status_code == 201


def test_sniff_by_signature_only():
    assert sniff_photo(JPEG) == (".jpg", "image/jpeg")
    assert sniff_photo(PNG) == (".png", "image/png")
    assert sniff_photo(WEBP) == (".webp", "image/webp")
    assert sniff_photo(b"GIF89a....") is None
    assert sniff_photo(b"<html>not an image</html>") is None


def test_upload_get_and_list_photo(client, auth_headers):
    make_recipe(client, auth_headers)
    res = client.put("/recipe-photo/Backen/Kuchen", content=JPEG, headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["path"] == "Backen/Kuchen"
    assert res.json()["image"].startswith("recipe-photo/Backen/Kuchen?v=")

    got = client.get("/recipe-photo/Backen/Kuchen")
    assert got.status_code == 200
    assert got.content == JPEG
    assert got.headers["content-type"] == "image/jpeg"
    assert got.headers["ETag"] == etag(JPEG)

    listed = client.get("/recipes").json()["recipes"][0]
    assert listed["image"] == res.json()["image"]


def test_photo_version_changes_on_replace(client, auth_headers):
    make_recipe(client, auth_headers)
    first = client.put("/recipe-photo/Backen/Kuchen", content=JPEG, headers=auth_headers).json()["image"]
    second = client.put("/recipe-photo/Backen/Kuchen", content=PNG, headers=auth_headers).json()["image"]
    assert first != second
    assert client.get("/recipe-photo/Backen/Kuchen").headers["content-type"] == "image/png"


def test_replacing_with_another_type_leaves_one_file(client, auth_headers, settings):
    make_recipe(client, auth_headers)
    client.put("/recipe-photo/Backen/Kuchen", content=JPEG, headers=auth_headers)
    client.put("/recipe-photo/Backen/Kuchen", content=WEBP, headers=auth_headers)
    photos = sorted(p.name for p in (settings.recipe_dir / "Backen").iterdir() if p.suffix != ".cook")
    assert photos == ["Kuchen.webp"]


def test_photo_needs_existing_recipe(client, auth_headers):
    assert client.put("/recipe-photo/nope", content=JPEG, headers=auth_headers).status_code == 404


def test_photo_needs_login(client, auth_headers):
    make_recipe(client, auth_headers)
    assert client.put("/recipe-photo/Backen/Kuchen", content=JPEG).status_code == 401
    assert client.delete("/recipe-photo/Backen/Kuchen").status_code == 401


def test_non_image_is_refused(client, auth_headers):
    make_recipe(client, auth_headers)
    res = client.put("/recipe-photo/Backen/Kuchen", content=b"<script>x</script>", headers=auth_headers)
    assert res.status_code == 415


def test_photo_size_limit(client, auth_headers, settings):
    make_recipe(client, auth_headers)
    big = b"\xff\xd8\xff" + b"x" * settings.max_photo_bytes
    assert client.put("/recipe-photo/Backen/Kuchen", content=big, headers=auth_headers).status_code == 413


def test_delete_photo(client, auth_headers):
    make_recipe(client, auth_headers)
    client.put("/recipe-photo/Backen/Kuchen", content=JPEG, headers=auth_headers)
    assert client.delete("/recipe-photo/Backen/Kuchen", headers=auth_headers).status_code == 204
    assert client.get("/recipe-photo/Backen/Kuchen").status_code == 404
    assert client.get("/recipes").json()["recipes"][0]["image"] is None
    assert client.delete("/recipe-photo/Backen/Kuchen", headers=auth_headers).status_code == 404


def test_deleting_recipe_deletes_photo(client, auth_headers, settings):
    make_recipe(client, auth_headers)
    client.put("/recipe-photo/Backen/Kuchen", content=JPEG, headers=auth_headers)
    tag = client.get("/recipe/Backen/Kuchen").headers["ETag"]
    client.delete("/recipe/Backen/Kuchen", headers={**auth_headers, "If-Match": tag})
    assert not (settings.recipe_dir / "Backen").exists()


def test_photo_path_safety(client, auth_headers):
    assert client.get("/recipe-photo/..%2F..%2Fetc%2Fpasswd").status_code in (400, 404)
    assert client.put("/recipe-photo/.hidden", content=JPEG, headers=auth_headers).status_code == 400
