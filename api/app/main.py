"""HTTP routes. Reads are public, writing a recipe and the AI import need a login token."""

import asyncio
import json
import sqlite3
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from . import ai_import, auth, db
from .config import Settings, load_settings
from .storage import InvalidPath, RecipeStore, etag, if_match_satisfied

TEXT = "text/plain; charset=utf-8"


class LoginRequest(BaseModel):
    username: str
    password: str


class DeleteAccountRequest(BaseModel):
    password: str


class LoginResponse(BaseModel):
    token: str
    username: str
    expires_at: int


class RecipeItem(BaseModel):
    path: str
    title: str
    etag: str


class RecipeList(BaseModel):
    recipes: list[RecipeItem]


class SaveResponse(BaseModel):
    path: str
    etag: str


class ImportResponse(BaseModel):
    cooklang: str


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    db.init(settings.db_path)
    store = RecipeStore(settings.recipe_dir)
    throttle = auth.LoginThrottle()
    # One lock for all writes: the hash check and the write must not interleave.
    # Correct only with a single worker process (see PLAN.md).
    write_lock = asyncio.Lock()
    bearer = HTTPBearer(auto_error=False)
    gemini_config = ai_import.GeminiConfig(api_key=settings.gemini_api_key, model=settings.gemini_model)

    app = FastAPI(title="Rezepte API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["GET", "PUT", "POST", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "If-Match"],
        expose_headers=["ETag"],
    )

    def get_conn() -> Iterator[sqlite3.Connection]:
        conn = db.connect(settings.db_path)
        try:
            yield conn
        finally:
            conn.close()

    Conn = Annotated[sqlite3.Connection, Depends(get_conn)]
    Credentials = Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]

    def unauthorized() -> HTTPException:
        return HTTPException(401, "login required", headers={"WWW-Authenticate": "Bearer"})

    def require_user(credentials: Credentials, conn: Conn) -> str:
        if credentials is None:
            raise unauthorized()
        username = auth.user_for_token(conn, credentials.credentials)
        if username is None:
            raise unauthorized()
        return username

    def resolve(path: str):
        try:
            return store.resolve(path)
        except InvalidPath as exc:
            raise HTTPException(400, str(exc)) from exc

    @app.post("/login", response_model=LoginResponse)
    def login(body: LoginRequest, request: Request, conn: Conn):
        client = request.client.host if request.client else "unknown"
        wait = throttle.retry_after(client, body.username)
        if wait:
            raise HTTPException(429, "too many failed logins", headers={"Retry-After": str(wait)})
        if not auth.verify_password(conn, body.username, body.password):
            throttle.record_failure(client, body.username)
            raise HTTPException(401, "invalid username or password")
        throttle.reset(client, body.username)
        username = auth.normalize_username(body.username)
        token, expires_at = auth.issue_token(conn, username, settings.token_ttl_days)
        return LoginResponse(token=token, username=username, expires_at=expires_at)

    @app.post("/logout", status_code=204)
    def logout(credentials: Credentials, conn: Conn, _user: Annotated[str, Depends(require_user)]):
        auth.revoke_token(conn, credentials.credentials)
        return Response(status_code=204)

    @app.delete("/account", status_code=204)
    def delete_account(
        body: DeleteAccountRequest,
        request: Request,
        conn: Conn,
        user: Annotated[str, Depends(require_user)],
    ):
        """Deletes the signed-in account. The password is asked again, so a stolen token alone is not enough."""
        client = request.client.host if request.client else "unknown"
        wait = throttle.retry_after(client, user)
        if wait:
            raise HTTPException(429, "too many failed attempts", headers={"Retry-After": str(wait)})
        if not auth.verify_password(conn, user, body.password):
            throttle.record_failure(client, user)
            raise HTTPException(403, "password does not match")
        throttle.reset(client, user)
        auth.delete_user(conn, user)
        return Response(status_code=204)

    @app.get("/recipes", response_model=RecipeList)
    def list_recipes():
        return RecipeList(recipes=[RecipeItem(**vars(e)) for e in store.list()])

    @app.get("/recipe/{path:path}")
    def get_recipe(path: str):
        _, file = resolve(path)
        data = store.read_bytes(file)
        if data is None:
            raise HTTPException(404, "recipe not found")
        return Response(data, media_type=TEXT, headers={"ETag": etag(data), "Cache-Control": "no-cache"})

    async def read_limited(request: Request, limit: int, too_large: str) -> bytes:
        """Request body, refusing anything over `limit` bytes without reading it all first."""
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > limit:
            raise HTTPException(413, too_large)
        chunks: list[bytes] = []
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > limit:
                raise HTTPException(413, too_large)
            chunks.append(chunk)
        return b"".join(chunks)

    @app.put("/recipe/{path:path}", response_model=SaveResponse)
    async def put_recipe(path: str, request: Request, _user: Annotated[str, Depends(require_user)]):
        clean, file = resolve(path)
        data = await read_limited(request, settings.max_recipe_bytes, "recipe too large")
        try:
            data.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise HTTPException(400, "recipe must be UTF-8 text") from exc
        if_match = (request.headers.get("if-match") or "").strip() or None
        async with write_lock:
            current = await run_in_threadpool(store.read_bytes, file)
            if current is None:
                if if_match is not None:
                    # The client expected a version, but the recipe is gone
                    return Response(b"", status_code=412, media_type=TEXT)
            else:
                if if_match is None:
                    raise HTTPException(428, "If-Match required to overwrite an existing recipe")
                current_tag = etag(current)
                if not if_match_satisfied(if_match, current_tag):
                    return Response(current, status_code=412, media_type=TEXT, headers={"ETag": current_tag})
            await run_in_threadpool(store.write_atomic, file, data)
        new_tag = etag(data)
        return Response(
            SaveResponse(path=clean, etag=new_tag).model_dump_json(),
            status_code=201 if current is None else 200,
            media_type="application/json",
            headers={"ETag": new_tag},
        )

    @app.post("/import", response_model=ImportResponse)
    async def import_recipe(request: Request, _user: Annotated[str, Depends(require_user)]):
        """Web page, text or photo → Cooklang. Needs a login, since every call uses Gemini quota."""
        raw = await read_limited(request, settings.max_import_bytes, "Die Datei ist zu groß (max. 8 MB).")
        try:
            body = json.loads(raw or b"{}")
        except ValueError as exc:
            raise HTTPException(400, "Ungültiges JSON.") from exc
        if not isinstance(body, dict):
            raise HTTPException(400, "Bitte url, text oder image angeben.")
        try:
            # Network calls block, so they run in the thread pool
            return await run_in_threadpool(ai_import.handle_import, body, gemini_config)
        except ai_import.ImportFailed as exc:
            raise HTTPException(exc.status, exc.message) from exc

    return app
