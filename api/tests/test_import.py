import io
import json
import urllib.error
import urllib.request
from email.message import Message

import pytest

from app import ai_import
from app.ai_import import GeminiConfig, ImportFailed

CONFIG = GeminiConfig(api_key="test-key", model="test-model")
RECIPE = "---\ntitle: Testrezept\n---\n\nMix @flour{200%g}."


class FakeResponse:
    def __init__(self, body: bytes, content_type: str = "text/html; charset=utf-8"):
        self.headers = {"Content-Type": content_type}
        self._body = io.BytesIO(body)

    def read(self, size: int = -1) -> bytes:
        return self._body.read(size)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def redirect(url: str, location: str) -> urllib.error.HTTPError:
    headers = Message()
    headers["Location"] = location
    return urllib.error.HTTPError(url, 302, "Found", headers, io.BytesIO())


@pytest.fixture
def public_dns(monkeypatch):
    monkeypatch.setattr(ai_import, "_resolve", lambda host: ["93.184.216.34"])


@pytest.fixture
def gemini_calls(monkeypatch):
    calls = []

    def fake(parts, config):
        calls.append(parts)
        return RECIPE

    monkeypatch.setattr(ai_import, "gemini", fake)
    return calls


# ---- URL safety ----


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/",
        "http://10.0.0.5/",
        "http://192.168.1.1/",
        "http://172.16.0.1/",
        "http://169.254.169.254/latest/meta-data",
        "http://100.64.0.1/",
        "http://198.18.0.1/",
        "http://0.0.0.0/",
        "http://[::1]/",
        "http://[fd00::1]/",
        "http://[fe80::1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://224.0.0.1/",
    ],
)
def test_private_addresses_are_refused(url):
    with pytest.raises(ImportFailed) as exc:
        ai_import.assert_public_url(url)
    assert exc.value.status == 400


def test_host_resolving_to_private_address_is_refused(monkeypatch):
    monkeypatch.setattr(ai_import, "_resolve", lambda host: ["93.184.216.34", "10.0.0.1"])
    with pytest.raises(ImportFailed) as exc:
        ai_import.assert_public_url("https://rebind.example/")
    assert exc.value.status == 400


@pytest.mark.parametrize(
    "url, status",
    [
        ("ftp://example.com/x", 400),
        ("file:///etc/passwd", 400),
        ("https://user:pw@example.com/", 400),
        ("not a url", 400),
        ("https://www.instagram.com/reel/abc", 422),
    ],
)
def test_bad_urls(url, status, public_dns):
    with pytest.raises(ImportFailed) as exc:
        ai_import.assert_public_url(url)
    assert exc.value.status == status


def test_public_url_is_allowed(public_dns):
    assert ai_import.assert_public_url("https://example.com/rezept") == "https://example.com/rezept"


# ---- Fetching ----


def test_redirect_to_private_address_is_refused(monkeypatch, public_dns):
    def fake_open(request, timeout):
        raise redirect(request.full_url, "http://127.0.0.1/admin")

    monkeypatch.setattr(ai_import, "_open", fake_open)
    with pytest.raises(ImportFailed) as exc:
        ai_import.fetch_page("https://example.com/")
    assert exc.value.status == 400


def test_relative_redirect_is_followed(monkeypatch, public_dns):
    seen = []

    def fake_open(request, timeout):
        seen.append(request.full_url)
        if len(seen) == 1:
            raise redirect(request.full_url, "/rezept/neu")
        return FakeResponse(b"<html>ok</html>")

    monkeypatch.setattr(ai_import, "_open", fake_open)
    html, final_url = ai_import.fetch_page("https://example.com/alt")
    assert html == "<html>ok</html>"
    assert final_url == "https://example.com/rezept/neu"


def test_too_many_redirects(monkeypatch, public_dns):
    monkeypatch.setattr(ai_import, "_open", lambda request, timeout: (_ for _ in ()).throw(redirect(request.full_url, "/again")))
    with pytest.raises(ImportFailed) as exc:
        ai_import.fetch_page("https://example.com/")
    assert exc.value.status == 502


def test_non_html_is_refused(monkeypatch, public_dns):
    monkeypatch.setattr(ai_import, "_open", lambda request, timeout: FakeResponse(b"%PDF", "application/pdf"))
    with pytest.raises(ImportFailed) as exc:
        ai_import.fetch_page("https://example.com/file.pdf")
    assert exc.value.status == 422


def test_page_size_is_capped(monkeypatch, public_dns):
    monkeypatch.setattr(ai_import, "_open", lambda request, timeout: FakeResponse(b"x" * (ai_import.MAX_PAGE + 100)))
    html, _ = ai_import.fetch_page("https://example.com/")
    assert len(html) == ai_import.MAX_PAGE


# ---- Page text and image ----

PAGE = """<html><head>
<meta property="og:title" content="Marmorkuchen">
<meta content="https://cdn.example.com/og.jpg" property="og:image">
<script type="application/ld+json">{"@graph": [{"@type": ["Recipe"], "name": "Marmorkuchen",
  "image": [{"url": "/img/kuchen.jpg"}]}]}</script>
<style>.x { color: red }</style><script>alert(1)</script>
</head><body><h1>Marmorkuchen</h1><p>Mehl&nbsp;und   Zucker</p></body></html>"""


def test_extract_page_text():
    text = ai_import.extract_page_text(PAGE)
    assert "Strukturierte Daten (JSON-LD):" in text
    assert "og:title: Marmorkuchen" in text
    assert "Seitentext:\nMarmorkuchen Mehl und Zucker" in text
    assert "alert(1)" not in text
    assert "color: red" not in text


def test_json_ld_image_wins_and_is_made_absolute():
    assert ai_import.find_page_image(PAGE, "https://example.com/rezept/1") == "https://example.com/img/kuchen.jpg"


def test_og_image_fallback():
    html = '<meta name="twitter:image" content="//cdn.example.com/t.jpg">'
    assert ai_import.find_page_image(html, "https://example.com/") == "https://cdn.example.com/t.jpg"


def test_no_image():
    assert ai_import.find_page_image("<html></html>", "https://example.com/") is None


def test_with_image_replaces_existing_front_matter_entry():
    text = "---\ntitle: A\nimage: old.jpg\n---\n\nStep."
    assert ai_import.with_image(text, "https://x.test/ä.jpg") == (
        '---\nimage: "https://x.test/ä.jpg"\ntitle: A\n---\n\nStep.'
    )


def test_with_image_adds_front_matter_when_there_is_none():
    assert ai_import.with_image("Step.", "https://x.test/a.jpg") == '---\nimage: "https://x.test/a.jpg"\n---\nStep.'


def test_with_image_converts_legacy_metadata():
    result = ai_import.with_image(">> title: A\n>> image: old.jpg\n\nStep.", "https://x.test/a.jpg")
    assert result == '---\nimage: "https://x.test/a.jpg"\ntitle: A\n---\n\nStep.'


def test_to_front_matter_converts_legacy_lines():
    text = ">> title: Torte: lecker\n>> servings: 4\n>> source: https://x.test/r\n\nMix @Mehl{200%g}."
    assert ai_import.to_front_matter(text) == (
        '---\ntitle: "Torte: lecker"\nservings: 4\nsource: https://x.test/r\n---\n\nMix @Mehl{200%g}.'
    )


def test_to_front_matter_leaves_modern_text_alone():
    text = "---\ntitle: A\n---\n\n> Tipp\n\nStep."
    assert ai_import.to_front_matter(text) == text
    assert ai_import.to_front_matter("> Notiz\n\nStep.") == "> Notiz\n\nStep."


def test_prompt_asks_for_front_matter_and_no_ingredient_list():
    assert "\n---\ntitle:" in ai_import.SYSTEM
    assert ">> title" not in ai_import.SYSTEM
    assert "NIE eine Zutatenliste" in ai_import.SYSTEM


def test_with_image_none_leaves_text_unchanged():
    assert ai_import.with_image("Step.", None) == "Step."


# ---- Gemini ----


def fake_gemini_response(monkeypatch, text: str):
    sent = {}

    def fake_urlopen(request, timeout):
        sent["url"] = request.full_url
        sent["headers"] = dict(request.header_items())
        sent["body"] = json.loads(request.data)
        body = {"candidates": [{"content": {"parts": [{"text": text}]}}]}
        return FakeResponse(json.dumps(body).encode(), "application/json")

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    return sent


def test_gemini_request_and_code_fence_stripping(monkeypatch):
    sent = fake_gemini_response(monkeypatch, "```cooklang\n" + RECIPE + "\n```")
    assert ai_import.gemini([{"text": "hi"}], CONFIG) == RECIPE
    assert "test-model:generateContent" in sent["url"]
    assert sent["headers"]["X-goog-api-key"] == "test-key"
    assert sent["body"]["systemInstruction"]["parts"][0]["text"] == ai_import.SYSTEM


def test_gemini_no_recipe(monkeypatch):
    fake_gemini_response(monkeypatch, "KEIN_REZEPT")
    with pytest.raises(ImportFailed) as exc:
        ai_import.gemini([{"text": "hi"}], CONFIG)
    assert exc.value.status == 422


def test_gemini_quota_error(monkeypatch):
    def fake_urlopen(request, timeout):
        raise urllib.error.HTTPError(request.full_url, 429, "Too Many", Message(), io.BytesIO(b"quota"))

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(ImportFailed) as exc:
        ai_import.gemini([{"text": "hi"}], CONFIG)
    assert exc.value.status == 502
    assert "Kontingent" in exc.value.message


def test_missing_api_key():
    with pytest.raises(ImportFailed) as exc:
        ai_import.gemini([{"text": "hi"}], GeminiConfig(api_key="", model="m"))
    assert exc.value.status == 500


def test_api_key_is_not_in_repr():
    assert "test-key" not in repr(CONFIG)


# ---- Endpoint ----


def test_import_requires_login(client):
    assert client.post("/import", json={"text": "Rezept"}).status_code == 401


def test_import_text(client, auth_headers, gemini_calls):
    res = client.post("/import", json={"text": "250 g Mehl verrühren"}, headers=auth_headers)
    assert res.status_code == 200
    assert res.json() == {"cooklang": RECIPE}
    assert "250 g Mehl verrühren" in gemini_calls[0][0]["text"]


def test_import_image(client, auth_headers, gemini_calls):
    res = client.post("/import", json={"image": "aGVsbG8=", "mimeType": "image/png"}, headers=auth_headers)
    assert res.status_code == 200
    assert gemini_calls[0][0] == {"inlineData": {"mimeType": "image/png", "data": "aGVsbG8="}}


def test_import_url_adds_page_image(client, auth_headers, gemini_calls, monkeypatch, public_dns):
    monkeypatch.setattr(ai_import, "_open", lambda request, timeout: FakeResponse(PAGE.encode()))
    res = client.post("/import", json={"url": "https://example.com/rezept/1"}, headers=auth_headers)
    assert res.status_code == 200
    assert 'image: "https://example.com/img/kuchen.jpg"' in res.json()["cooklang"]
    assert "Seitentext:" in gemini_calls[0][0]["text"]


@pytest.mark.parametrize(
    "body, status, message",
    [
        ({}, 400, "Bitte url, text oder image angeben."),
        ({"image": "x", "mimeType": "image/gif"}, 400, "Bildformat wird nicht unterstützt (JPG, PNG, WebP, HEIC)."),
        ({"text": "x" * 50_001}, 413, "Der Text ist zu lang."),
        ({"url": "http://127.0.0.1/"}, 400, "Diese Adresse ist nicht erlaubt."),
    ],
)
def test_import_errors(client, auth_headers, gemini_calls, body, status, message):
    res = client.post("/import", json=body, headers=auth_headers)
    assert res.status_code == status
    assert res.json() == {"detail": message}
    assert gemini_calls == []


def test_import_invalid_json(client, auth_headers):
    res = client.post("/import", content=b"{nope", headers={**auth_headers, "Content-Type": "application/json"})
    assert res.status_code == 400
    assert res.json() == {"detail": "Ungültiges JSON."}


def test_import_body_limit(client, auth_headers, settings):
    big = b'{"text": "' + b"x" * settings.max_import_bytes + b'"}'
    res = client.post("/import", content=big, headers={**auth_headers, "Content-Type": "application/json"})
    assert res.status_code == 413
