# Clean-room recipe API: plan

A small, independent API that stores `.cook` files and serves them to the Rezepte app.
No compatibility with the CookCLI paths (`api/recipes/...`), no spaces, no registration endpoint.

## Scope

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/login` | none | Exchange username and password for a token |
| POST | `/logout` | token | Revoke the current token |
| GET | `/recipes` | public | List all recipes: path, title, ETag |
| GET | `/recipe/{path}` | public | Return raw `.cook` text and its `ETag` |
| PUT | `/recipe/{path}` | token | Create or overwrite a recipe, with conflict check (see below) |

Users are created only by a local script: `scripts/create_user.py`.
Images are out of scope for now.

## Decisions

1. **Python + FastAPI + uvicorn.** The registration script is Python, so both share one language and one user store.
2. **uv** as project and package manager: `pyproject.toml` and `uv.lock`, no `requirements.txt`. `.python-version` pins the interpreter.
3. **SQLite** (stdlib `sqlite3`) for users and tokens. One file, no server to run.
4. **Passwords:** `hashlib.scrypt` from the standard library. No extra dependency.
5. **Auth: bearer token.** `/login` returns a random 32-byte token, stored hashed in the `tokens` table with an expiry (default 30 days). The client sends `Authorization: Bearer <token>`. Tokens are used instead of cookies because the app may be on a different origin than the API.
6. **Reads are public.** `GET /recipes` and `GET /recipe/{path}` need no token. Only `PUT` and `POST /logout` require one.
7. **Paths** match the CookCLI convention: no `.cook` suffix in the URL. The server appends it.
8. **Storage:** `RECIPE_DIR` holds the `.cook` files as plain files. The directory tree mirrors the recipe paths.
9. **Writes are atomic:** temp file in the same directory, then `os.replace`.
10. **Path safety:** reject empty segments, `.`/`..`, leading dots, and anything that resolves outside `RECIPE_DIR`. Refuse symlinks.
11. **Recipe content is not parsed on the server**, with one exception: the title for the list (see below). The client parses everything else.
12. **Single worker.** Run uvicorn with one worker so the per-path write lock actually covers all writes.

## Titles in the list

- The title is the value of the `>> title:` metadata line in the recipe, if present.
- Fallback: the file name without `.cook`, as the client does today.
- Extraction is a small, line-based function: scan the leading `>>` lines for `title:`, trim the value. It does not parse steps, ingredients or cookware.
- Cleaning, applied to the extracted value before it goes into the list:
  - Strip control characters, including newlines and tabs. A title is one line.
  - Collapse runs of whitespace to a single space and trim the ends.
  - Cap at 200 characters.
  - If nothing is left after cleaning, use the file name fallback.
- These checks are for display quality. The security of titles comes from the client rendering them as text (React escapes by default; never use `dangerouslySetInnerHTML` or `innerHTML` for titles).
- Titles are computed when the list is requested. For a personal library this is fast. If it gets slow, cache by file mtime and size.

## Conflict check

Optimistic concurrency with a content hash as the version. The server stores the bytes exactly as sent, so no line-ending normalization is needed.

**Version:** `ETag` = quoted SHA-256 of the file's bytes, e.g. `"9f2a…"`.

**Reads**
- `GET /recipe/{path}` returns the text and `ETag: "<hash>"`.
- `GET /recipes` returns each entry with its `etag` field, so the list can tell whether a recipe changed.

**Writes**
- `PUT /recipe/{path}` with `If-Match: "<hash>"`: saved only if the file's current hash matches.
- New file (no file exists yet): no `If-Match` needed.
- Existing file without `If-Match`: rejected with `428 Precondition Required`. Overwriting blindly is not possible, which protects against the lost-update case.
- `If-Match` mismatch: `412 Precondition Failed`. The response carries the current text as body and the current `ETag` as header, so the client can show its existing conflict dialog with the server version.
- Success: `200` (or `201` for a new file) with the new `ETag`.

**Atomicity**
- A per-path `threading.Lock` wraps "read current hash, compare, write". With one worker process, two saves cannot interleave.

**Sketch**

```python
@app.put("/recipe/{path:path}")
async def put_recipe(path: str, request: Request, user=Depends(require_token)):
    file = storage.resolve(path)
    body = await request.body()
    with storage.lock_for(file):
        current = storage.read_bytes(file)            # None if new
        if current is not None:
            if_match = request.headers.get("if-match")
            if if_match is None:
                raise HTTPException(428, "If-Match required to overwrite")
            if if_match != etag(current):
                return Response(current, status_code=412, headers={"ETag": etag(current)})
        storage.write_atomic(file, body)
    return Response(status_code=200 if current is not None else 201,
                    headers={"ETag": etag(body)})

def etag(data: bytes) -> str:
    return '"' + hashlib.sha256(data).hexdigest() + '"'
```

**Client flow (later)**
- Keep the `ETag` from the last GET or PUT with the recipe.
- On save: send `If-Match` with that value.
- On `412`: show the existing conflict dialog, using the response body as the server version. Saving again means using the new `ETag` from that response.
- On `428`: treat as a bug in the client, since it always has the ETag.

## Layout

```
api/
  PLAN.md
  pyproject.toml          deps managed by uv (fastapi, uvicorn; dev: pytest, httpx)
  uv.lock
  .python-version         pinned interpreter
  .env.example            RECIPE_DIR, DB_PATH, TOKEN_TTL_DAYS
  app/
    main.py               routes
    auth.py               scrypt hashing, token create/verify/revoke
    db.py                 sqlite connection, schema creation
    storage.py            path resolver, atomic write, list, read, locks
    titles.py             title extraction from >> metadata lines
    config.py             env settings
  scripts/
    create_user.py        uv run python scripts/create_user.py <username>  (prompts for password)
  tests/
    test_storage.py       path traversal, atomic write, listing
    test_titles.py        title line, fallback to file name
    test_auth.py          login, bad password, token expiry, logout
    test_recipes.py       GET public, PUT with and without token
    test_conflict.py      428 without If-Match, 412 on stale hash, 200/201 on success
```

## Build order

1. `uv init` and dependencies, `db.py` schema: `users(username PK, password_hash, salt, created_at)`, `tokens(token_hash PK, username, expires_at)`.
2. `storage.py` with the path resolver, listing, atomic write and locks, plus tests.
3. `titles.py` with tests.
4. `auth.py` and `scripts/create_user.py`, then tests.
5. `main.py` routes and the conflict check, then tests with `httpx`.
6. Run locally, smoke test with `curl`.

## Running it

```bash
cd api
uv sync
uv run python scripts/create_user.py korbinian
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
uv run pytest
```

Behind Nginx Proxy Manager, same as `ai-import/`, with HTTPS at the proxy.

## Client changes (later, separate step)

- `cookApi.ts`: new paths (`/recipes`, `/recipe/{path}`), bearer token instead of Basic Auth, `ETag` kept per recipe and sent as `If-Match`.
- Conflict handling: replace the GET-compare-PUT sequence with a single PUT using `If-Match`.
- Settings: a login form instead of user and password fields. The token goes in `localStorage`.
- The `ai-import` service keeps its own Basic Auth unless you want it moved here too.

## Status

Planned, not started. Waiting for your go.
