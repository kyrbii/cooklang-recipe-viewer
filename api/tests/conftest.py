import pytest
from fastapi.testclient import TestClient

from app import auth, db
from app.config import Settings
from app.main import create_app

USERNAME = "tester"
PASSWORD = "correct horse battery"


@pytest.fixture
def settings(tmp_path):
    return Settings(
        recipe_dir=tmp_path / "recipes",
        db_path=tmp_path / "api.db",
        token_ttl_days=30,
        allowed_origins=["http://app.test"],
        max_recipe_bytes=10_000,
    )


@pytest.fixture
def client(settings):
    app = create_app(settings)
    conn = db.connect(settings.db_path)
    auth.set_password(conn, USERNAME, PASSWORD, create=True)
    conn.close()
    return TestClient(app)


@pytest.fixture
def token(client):
    res = client.post("/login", json={"username": USERNAME, "password": PASSWORD})
    assert res.status_code == 200
    return res.json()["token"]


@pytest.fixture
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}
