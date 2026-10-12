# Clean-room recipe API

A small, independent API that stores `.cook` files and serves them to the Rezepte app.
No compatibility with the CookCLI paths (`api/recipes/...`), no spaces, no registration endpoint.

## Status

Backend implemented and tested (113 tests, plus a curl smoke test against the running server).
The app on this branch talks to the new API, by default at `http://localhost:8000` for local testing.
Tested in the browser: list, login, edit and save, conflict dialog, forced overwrite, new recipe, duplicate name refused.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/login` | none | `{username, password}` → `{token, username, expires_at}` |
| POST | `/logout` | token | Revoke the current token, `204` |
| DELETE | `/account` | token + password | Delete the account and its tokens, `204`. Recipes stay |
| GET | `/recipes` | public | `{recipes: [{path, title, etag}]}`, sorted by path |
| GET | `/recipe/{path}` | public | Raw `.cook` text, `ETag` header |
| PUT | `/recipe/{path}` | token | Create or overwrite, raw text body, conflict check |
| POST | `/import` | token | AI import: `{url}`, `{text}` or `{image, mimeType}` → `{cooklang}` |

Users are created only by `scripts/create_user.py`, removed by `scripts/delete_user.py` (admin) or `DELETE /account` (self-service). Images are out of scope for now.

Status codes: `400` invalid path, non-UTF-8 body or bad import input, `401` missing or invalid token, `404` unknown recipe,
`412` conflict, `413` body too large, `422` no recipe found or Instagram, `502` page or Gemini unreachable, `428` overwrite without `If-Match`, `429` too many failed logins.

## Decisions

1. **Python + FastAPI + uvicorn**, managed with **uv** (`pyproject.toml`, `uv.lock`, `.python-version` = 3.13).
2. **SQLite** for users and tokens, one connection per request (safe with FastAPI's thread pool).
3. **Passwords:** `hashlib.scrypt` (n=2^14, r=8, p=1), random 16-byte salt per user. Usernames are lowercase.
4. **Auth: bearer token.** 32 random bytes, stored as SHA-256, expiry `TOKEN_TTL_DAYS` (default 30). Resetting a password revokes all of that user's tokens.
5. **Login hardening:** unknown users and wrong passwords take the same time and return the same error. After 5 failures per client and username within 15 minutes, `429` with `Retry-After`.
6. **Reads are public.** Only `PUT` and `POST /logout` need a token.
7. **CORS:** origins from `ALLOWED_ORIGINS`. `ETag` is exposed, otherwise browser code could not read it. `Authorization`, `Content-Type` and `If-Match` are allowed request headers. No origin is allowed by default.
8. **Paths:** no `.cook` suffix in URLs (a trailing `.cook` is stripped). Rejected: empty segments, `.`/`..`, leading dots, backslashes, control characters, whitespace around a segment, anything over 512 characters, symlinks, and anything resolving outside `RECIPE_DIR`.
9. **Writes are atomic:** hidden temp file in the same folder, `fsync`, then `os.replace`.
10. **Body limits:** `MAX_RECIPE_BYTES` (default 1 MB), must be valid UTF-8. Bytes are stored exactly as sent.
11. **No parsing on the server** except the title for the list.
12. **Single worker.** One global `asyncio.Lock` covers "check ETag, write". This is correct only with one worker process.

## AI import

Ported from the former `ai-import/server.mjs` (Node). Same prompt, limits, timeouts and German messages.

- Output follows the official Cooklang syntax: `>>` metadata lines, `@?` for optional ingredients, `== Section ==`, `> ` for tips and notes, fractions such as `1/2` instead of `0.5`. The prompt lives in `app/ai_import.py` (`SYSTEM`).
- Input: `{url}` (web page), `{text}` (max 50 000 characters) or `{image, mimeType}` (base64, JPG/PNG/WebP/HEIC). Body max `MAX_IMPORT_BYTES` (12 MB).
- Web pages: JSON-LD, meta tags and page text go to Gemini. The title image (schema.org `Recipe.image`, then `og:image`/`twitter:image`) is written as a `>> image:` metadata line.
- SSRF protection: only http/https, no credentials in the URL, every resolved address must be public (`ipaddress.is_global`, IPv4-mapped IPv6 unwrapped). Redirects are followed by hand (max 4), each target is checked again. Instagram is refused with a hint (422).
- Needs a login token: every call uses Gemini quota.
- Config: `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-3.5-flash-lite`). The key is never logged.
- Known limit (same as the Node version): DNS is resolved for the check and again by the HTTP client, so a DNS rebinding attack between the two lookups is not prevented.

## Titles in the list

- Same order as the app's parser (`src/utils/cooklangParser.ts`): YAML front matter `title:` first, then legacy `>> title:` lines, a later line wins. Quotes are stripped, `--` comments are ignored.
- Fallback: the file name without `.cook`.
- Cleaning: control characters and line separators removed, whitespace collapsed, max 200 characters, fallback if empty.
- Titles are returned as plain text. The client must render them as text (React does by default; never `dangerouslySetInnerHTML`).
- Computed per list request. If the library grows large, cache by mtime and size.

## Conflict check

- `ETag` = quoted SHA-256 of the stored bytes. `GET /recipe` sends it as a header, `GET /recipes` per entry.
- `PUT` on an existing file needs `If-Match`, otherwise `428`.
- `If-Match` mismatch → `412`, body is the current server text, `ETag` header is its version. Retrying with that `ETag` succeeds.
- `If-Match` for a recipe that no longer exists → `412` with an empty body.
- New file without `If-Match` → `201`. Successful overwrite → `200`. Both return `{path, etag}` and the `ETag` header.
- Weak tags (`W/"…"`, as Nginx produces with gzip), lists of tags and `*` are accepted.

## Layout

```
api/
  PLAN.md
  pyproject.toml, uv.lock, .python-version
  .env.example            RECIPE_DIR, DB_PATH, TOKEN_TTL_DAYS, ALLOWED_ORIGINS, MAX_RECIPE_BYTES, GEMINI_*
  app/
    main.py               create_app(): routes, CORS, conflict check
    auth.py               scrypt, tokens, login throttle
    db.py                 connection, schema
    storage.py            path checks, list, read, atomic write, ETags
    titles.py             title extraction and cleaning
    ai_import.py          AI import: page fetch with SSRF checks, Gemini
    config.py             settings from environment and .env
  scripts/
    create_user.py        create user or --reset-password
  tests/                  113 tests: storage, titles, auth, recipes, conflict, CORS, AI import
```

## Running it

```bash
cd api
cp .env.example .env      # then set ALLOWED_ORIGINS to the app's URL
uv sync
uv run python scripts/create_user.py korbinian
uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 --workers 1
uv run pytest
```

In the desktop app, the `api` entry in `.claude/launch.json` starts the server.
Production: behind Nginx Proxy Manager with HTTPS. If the throttle should see real client IPs,
run uvicorn with `--proxy-headers --forwarded-allow-ips=<proxy address>`.

## Next steps

1. ~~Client switch~~ done: new paths, bearer token, `If-Match` from remembered ETags, `412` → existing conflict dialog. Sync downloads only recipes whose ETag changed.
2. ~~Settings login form~~ done.
3. **Images**, when wanted: `GET /files/{path}`, same path rules. Images from external URLs in the recipe metadata already work.
4. **Deployment:** systemd unit or Docker service, `.env` on the server, backup of `RECIPE_DIR` and `DB_PATH`, migrate the existing recipe folder from CookCLI, set `DEFAULT_SERVER_URL` in the app (or `VITE_` variable) to the public URL.
5. ~~AI import~~ moved into this API as `POST /import`. The separate `ai-import/` service is removed on this branch (still on `main` and the `cookcli-final` tag).
