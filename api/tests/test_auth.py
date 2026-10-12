import time

import pytest

from app import auth, db

from .conftest import PASSWORD, USERNAME


def test_login_returns_token(client):
    res = client.post("/login", json={"username": USERNAME, "password": PASSWORD})
    assert res.status_code == 200
    body = res.json()
    assert body["username"] == USERNAME
    assert len(body["token"]) >= 40
    assert body["expires_at"] > time.time()


def test_login_username_is_case_insensitive(client):
    res = client.post("/login", json={"username": "  TESTER ", "password": PASSWORD})
    assert res.status_code == 200


def test_wrong_password_and_unknown_user_look_the_same(client):
    wrong = client.post("/login", json={"username": USERNAME, "password": "nope-nope"})
    unknown = client.post("/login", json={"username": "nobody", "password": "nope-nope"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


def test_login_is_throttled_after_repeated_failures(client):
    for _ in range(5):
        assert client.post("/login", json={"username": USERNAME, "password": "wrong-pass"}).status_code == 401
    res = client.post("/login", json={"username": USERNAME, "password": PASSWORD})
    assert res.status_code == 429
    assert int(res.headers["Retry-After"]) > 0


def test_tokens_are_stored_hashed(client, settings, token):
    conn = db.connect(settings.db_path)
    stored = [row["token_hash"] for row in conn.execute("SELECT token_hash FROM tokens")]
    conn.close()
    assert token not in stored


def test_logout_revokes_token(client, auth_headers):
    assert client.post("/logout", headers=auth_headers).status_code == 204
    assert client.post("/logout", headers=auth_headers).status_code == 401


def test_expired_token_is_rejected(client, settings, token, auth_headers):
    conn = db.connect(settings.db_path)
    with conn:
        conn.execute("UPDATE tokens SET expires_at = ?", (int(time.time()) - 1,))
    conn.close()
    res = client.put("/recipe/x", content=b"x", headers=auth_headers)
    assert res.status_code == 401


def test_reset_password_revokes_tokens(client, settings, token):
    conn = db.connect(settings.db_path)
    auth.set_password(conn, USERNAME, "a new password", create=False)
    assert auth.user_for_token(conn, token) is None
    conn.close()


def test_set_password_validation(settings):
    db.init(settings.db_path)
    conn = db.connect(settings.db_path)
    with pytest.raises(ValueError):
        auth.set_password(conn, "bad name!", "long enough", create=True)
    with pytest.raises(ValueError):
        auth.set_password(conn, "someone", "short", create=True)
    with pytest.raises(ValueError):
        auth.set_password(conn, "ghost", "long enough", create=False)
    auth.set_password(conn, "someone", "long enough", create=True)
    with pytest.raises(ValueError):
        auth.set_password(conn, "someone", "long enough", create=True)
    conn.close()


def test_no_registration_endpoint(client):
    assert client.post("/register", json={"username": "a", "password": "b"}).status_code in (404, 405)
