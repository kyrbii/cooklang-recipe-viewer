from app import auth, db

from .conftest import PASSWORD, USERNAME

RECIPE = b"Cook @lentils{200%g}.\n"


def add_user(settings, name):
    conn = db.connect(settings.db_path)
    auth.set_password(conn, name, PASSWORD, create=True)
    conn.close()
    return name


def login_headers(client, name):
    token = client.post("/login", json={"username": name, "password": PASSWORD}).json()["token"]
    return {"Authorization": f"Bearer {token}"}


def create_recipe(client, headers, path="Suppen/Linsen"):
    assert client.put(f"/recipe/{path}", content=RECIPE, headers=headers).status_code == 201


def new_collection(client, headers, name="Wochenende"):
    res = client.post("/collections", json={"name": name}, headers=headers)
    assert res.status_code == 201
    return res.json()["id"]


def mine(client, headers):
    return client.get("/collections", headers=headers).json()["collections"]


def test_needs_login(client):
    assert client.get("/collections").status_code == 401
    assert client.post("/collections", json={"name": "x"}).status_code == 401


def test_creator_becomes_first_member(client, auth_headers):
    res = client.post("/collections", json={"name": "  Wochen   ende "}, headers=auth_headers)
    assert res.status_code == 201
    body = res.json()
    assert body["name"] == "Wochen ende"
    assert body["members"] == [USERNAME]
    assert body["created_by"] == USERNAME
    assert body["paths"] == []


def test_empty_name_is_refused(client, auth_headers):
    assert client.post("/collections", json={"name": "   "}, headers=auth_headers).status_code == 422
    assert client.post("/collections", json={"name": ""}, headers=auth_headers).status_code == 422
    assert client.post("/collections", json={"name": "x" * 101}, headers=auth_headers).status_code == 422


def test_recipes_are_added_removed_and_listed_in_order(client, auth_headers):
    create_recipe(client, auth_headers, "Suppen/Linsen")
    create_recipe(client, auth_headers, "Brot")
    cid = new_collection(client, auth_headers)
    assert client.put(f"/collections/{cid}/recipes/Suppen/Linsen", headers=auth_headers).status_code == 204
    assert client.put(f"/collections/{cid}/recipes/Brot", headers=auth_headers).status_code == 204
    # Adding twice changes nothing
    assert client.put(f"/collections/{cid}/recipes/Brot", headers=auth_headers).status_code == 204
    assert mine(client, auth_headers)[0]["paths"] == ["Suppen/Linsen", "Brot"]
    assert client.delete(f"/collections/{cid}/recipes/Suppen/Linsen", headers=auth_headers).status_code == 204
    assert mine(client, auth_headers)[0]["paths"] == ["Brot"]


def test_recipe_must_exist_and_path_must_be_valid(client, auth_headers):
    cid = new_collection(client, auth_headers)
    assert client.put(f"/collections/{cid}/recipes/Nope", headers=auth_headers).status_code == 404
    assert client.put(f"/collections/{cid}/recipes/a/../b", headers=auth_headers).status_code in (400, 404)
    assert client.put(f"/collections/{cid}/recipes/.hidden", headers=auth_headers).status_code == 400


def test_one_recipe_can_be_in_several_collections(client, auth_headers):
    create_recipe(client, auth_headers)
    a = new_collection(client, auth_headers, "A")
    b = new_collection(client, auth_headers, "B")
    client.put(f"/collections/{a}/recipes/Suppen/Linsen", headers=auth_headers)
    client.put(f"/collections/{b}/recipes/Suppen/Linsen", headers=auth_headers)
    assert [c["paths"] for c in mine(client, auth_headers)] == [["Suppen/Linsen"], ["Suppen/Linsen"]]


def test_deleting_a_recipe_takes_it_out_of_all_collections(client, auth_headers):
    create_recipe(client, auth_headers)
    cid = new_collection(client, auth_headers)
    client.put(f"/collections/{cid}/recipes/Suppen/Linsen", headers=auth_headers)
    tag = client.get("/recipe/Suppen/Linsen").headers["ETag"]
    assert client.delete("/recipe/Suppen/Linsen", headers={**auth_headers, "If-Match": tag}).status_code == 204
    assert mine(client, auth_headers)[0]["paths"] == []
    # A new recipe with the same name does not come back by itself
    create_recipe(client, auth_headers)
    assert mine(client, auth_headers)[0]["paths"] == []


def test_collections_are_private_to_their_members(client, auth_headers, settings):
    anna = login_headers(client, add_user(settings, "anna"))
    create_recipe(client, auth_headers)
    cid = new_collection(client, auth_headers)
    assert mine(client, anna) == []
    # For a non-member the collection does not exist, whatever they try
    assert client.patch(f"/collections/{cid}", json={"name": "x"}, headers=anna).status_code == 404
    assert client.delete(f"/collections/{cid}", headers=anna).status_code == 404
    assert client.put(f"/collections/{cid}/recipes/Suppen/Linsen", headers=anna).status_code == 404
    assert client.delete(f"/collections/{cid}/recipes/Suppen/Linsen", headers=anna).status_code == 404
    assert client.put(f"/collections/{cid}/members/anna", headers=anna).status_code == 404
    assert client.delete(f"/collections/{cid}/members/{USERNAME}", headers=anna).status_code == 404
    assert mine(client, auth_headers)[0]["members"] == [USERNAME]


def test_sharing_gives_every_member_the_same_rights(client, auth_headers, settings):
    anna = login_headers(client, add_user(settings, "anna"))
    tom_name = add_user(settings, "tom")
    tom = login_headers(client, tom_name)
    create_recipe(client, auth_headers)
    cid = new_collection(client, auth_headers)

    assert client.put(f"/collections/{cid}/members/Anna", headers=auth_headers).status_code == 204
    assert client.put(f"/collections/{cid}/members/anna", headers=auth_headers).status_code == 204
    assert mine(client, anna)[0]["members"] == [USERNAME, "anna"]

    # Anna is not just a reader: she fills the collection, renames it and invites Tom
    assert client.put(f"/collections/{cid}/recipes/Suppen/Linsen", headers=anna).status_code == 204
    assert client.patch(f"/collections/{cid}", json={"name": "Gemeinsam"}, headers=anna).json()["name"] == "Gemeinsam"
    assert client.put(f"/collections/{cid}/members/{tom_name}", headers=anna).status_code == 204

    for headers in (auth_headers, anna, tom):
        c = mine(client, headers)[0]
        assert c["name"] == "Gemeinsam"
        assert c["paths"] == ["Suppen/Linsen"]
        assert c["members"] == [USERNAME, "anna", "tom"]


def test_unknown_user_cannot_be_invited(client, auth_headers):
    cid = new_collection(client, auth_headers)
    assert client.put(f"/collections/{cid}/members/ghost", headers=auth_headers).status_code == 404


def test_a_person_can_be_in_several_collections_and_each_has_several_people(client, auth_headers, settings):
    anna = login_headers(client, add_user(settings, "anna"))
    a = new_collection(client, auth_headers, "A")
    b = new_collection(client, auth_headers, "B")
    c = new_collection(client, anna, "C")
    client.put(f"/collections/{a}/members/anna", headers=auth_headers)
    client.put(f"/collections/{b}/members/anna", headers=auth_headers)
    client.put(f"/collections/{c}/members/{USERNAME}", headers=anna)
    assert [x["name"] for x in mine(client, anna)] == ["A", "B", "C"]
    assert [x["name"] for x in mine(client, auth_headers)] == ["A", "B", "C"]


def test_leaving_keeps_the_collection_for_the_others(client, auth_headers, settings):
    anna = login_headers(client, add_user(settings, "anna"))
    cid = new_collection(client, auth_headers)
    client.put(f"/collections/{cid}/members/anna", headers=auth_headers)
    assert client.delete(f"/collections/{cid}/members/anna", headers=anna).status_code == 204
    assert mine(client, anna) == []
    assert mine(client, auth_headers)[0]["members"] == [USERNAME]


def test_any_member_can_remove_another(client, auth_headers, settings):
    anna = login_headers(client, add_user(settings, "anna"))
    cid = new_collection(client, auth_headers)
    client.put(f"/collections/{cid}/members/anna", headers=auth_headers)
    assert client.delete(f"/collections/{cid}/members/{USERNAME}", headers=anna).status_code == 204
    assert mine(client, auth_headers) == []
    assert mine(client, anna)[0]["members"] == ["anna"]


def test_last_member_leaving_deletes_the_collection(client, auth_headers, settings):
    cid = new_collection(client, auth_headers)
    client.put(f"/collections/{cid}/members/{USERNAME}", headers=auth_headers)
    assert client.delete(f"/collections/{cid}/members/{USERNAME}", headers=auth_headers).status_code == 204
    conn = db.connect(settings.db_path)
    assert conn.execute("SELECT COUNT(*) FROM collections").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM collection_recipes").fetchone()[0] == 0
    conn.close()


def test_delete_removes_it_for_everyone_but_keeps_the_recipes(client, auth_headers, settings):
    anna = login_headers(client, add_user(settings, "anna"))
    create_recipe(client, auth_headers)
    cid = new_collection(client, auth_headers)
    client.put(f"/collections/{cid}/members/anna", headers=auth_headers)
    client.put(f"/collections/{cid}/recipes/Suppen/Linsen", headers=auth_headers)
    assert client.delete(f"/collections/{cid}", headers=anna).status_code == 204
    assert mine(client, anna) == [] and mine(client, auth_headers) == []
    assert client.get("/recipe/Suppen/Linsen").status_code == 200


def test_deleting_an_account_leaves_shared_collections_to_the_others(client, auth_headers, settings):
    add_user(settings, "anna")
    anna = login_headers(client, "anna")
    shared = new_collection(client, auth_headers, "Gemeinsam")
    alone = new_collection(client, auth_headers, "Nur ich")
    client.put(f"/collections/{shared}/members/anna", headers=auth_headers)

    res = client.request("DELETE", "/account", json={"password": PASSWORD}, headers=auth_headers)
    assert res.status_code == 204

    # The shared one survives for Anna, the one nobody else was in is gone
    remaining = mine(client, anna)
    assert [c["name"] for c in remaining] == ["Gemeinsam"]
    assert remaining[0]["members"] == ["anna"]
    assert remaining[0]["created_by"] is None
    conn = db.connect(settings.db_path)
    assert conn.execute("SELECT COUNT(*) FROM collections WHERE id = ?", (alone,)).fetchone()[0] == 0
    conn.close()


def test_unknown_collection_is_404(client, auth_headers):
    assert client.patch("/collections/999", json={"name": "x"}, headers=auth_headers).status_code == 404
    assert client.delete("/collections/999", headers=auth_headers).status_code == 404
