"""HTTP routes. Reads are public, writing a recipe and the AI import need a login token."""

import asyncio
import json
import sqlite3
from collections.abc import Iterator
from dataclasses import asdict
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from . import ai_import, auth, collections, db, recipe_meta
from .config import Settings, load_settings
from pathlib import Path
from urllib.parse import quote

from .storage import MEDIA_TYPES, InvalidPath, RecipeStore, etag, if_match_satisfied, sniff_photo

TEXT = "text/plain; charset=utf-8"


def photo_url(path: str, version: str) -> str:
    """Relative URL of a recipe photo. Each segment is encoded, the version changes when the photo changes."""
    encoded = "/".join(quote(segment, safe="") for segment in path.split("/"))
    return f"recipe-photo/{encoded}?v={version}"


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
    # When the recipe file was last saved, unix milliseconds
    modified: int
    # Relative URL of the recipe photo, with a version parameter; None without a photo
    image: str | None = None
    # Who added the recipe; None for recipes that were never recorded
    added_by: str | None = None
    # Average of all ratings and how many people rated; None without any rating
    rating_average: float | None = None
    rating_count: int = 0


class ReviewItem(BaseModel):
    username: str
    rating: int | None
    note: str | None
    updated_at: int


class ReviewsResponse(BaseModel):
    reviews: list[ReviewItem]
    rating_average: float | None
    rating_count: int


class ReviewRequest(BaseModel):
    rating: int | None = Field(default=None, ge=1, le=5)
    note: str | None = Field(default=None, max_length=recipe_meta.NOTE_MAX_LENGTH)


class CollectionName(BaseModel):
    name: str = Field(min_length=1, max_length=collections.NAME_MAX_LENGTH)


class CollectionItem(BaseModel):
    id: int
    name: str
    # Who created it; None if that account is gone. Has no special rights
    created_by: str | None
    members: list[str]
    # Paths of the recipes in it, in the order they were added
    paths: list[str]


class CollectionList(BaseModel):
    collections: list[CollectionItem]


class PhotoResponse(BaseModel):
    path: str
    image: str


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

    app = FastAPI(title="stir API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["GET", "PUT", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "If-Match"],
        expose_headers=["ETag"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        # Photos and recipes are served with the type the server determined, never the browser's guess
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        # The recipes are public, but they should not end up in search engines
        response.headers.setdefault("X-Robots-Tag", "noindex, nofollow")
        return response

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
        recipe_meta.forget_user_reviews(conn, user)
        auth.delete_user(conn, user)
        return Response(status_code=204)

    @app.get("/health")
    def health(conn: Conn):
        """For the container health check: database answers and the recipe folder is there."""
        conn.execute("SELECT 1")
        if not settings.recipe_dir.is_dir():
            raise HTTPException(503, "recipe folder missing")
        return {"status": "ok"}

    @app.get("/recipes", response_model=RecipeList)
    def list_recipes(conn: Conn):
        creators = recipe_meta.creators(conn)
        ratings = recipe_meta.rating_summaries(conn)
        return RecipeList(
            recipes=[
                RecipeItem(
                    path=e.path,
                    title=e.title,
                    etag=e.etag,
                    modified=e.modified,
                    image=photo_url(e.path, e.photo_version) if e.photo_version else None,
                    added_by=creators.get(e.path),
                    rating_average=ratings.get(e.path, (None, 0))[0],
                    rating_count=ratings.get(e.path, (None, 0))[1],
                )
                for e in store.list()
            ]
        )

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
    async def put_recipe(path: str, request: Request, conn: Conn, user: Annotated[str, Depends(require_user)]):
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
            if current is None:
                # The first save creates the recipe, so this person is recorded as the one who added it
                recipe_meta.set_creator(conn, clean, user)
        new_tag = etag(data)
        return Response(
            SaveResponse(path=clean, etag=new_tag).model_dump_json(),
            status_code=201 if current is None else 200,
            media_type="application/json",
            headers={"ETag": new_tag},
        )

    @app.delete("/recipe/{path:path}", status_code=204)
    async def delete_recipe(path: str, request: Request, conn: Conn, _user: Annotated[str, Depends(require_user)]):
        """Deletes a recipe. Like saving, it needs If-Match, so a version changed elsewhere is not deleted."""
        clean, file = resolve(path)
        async with write_lock:
            current = await run_in_threadpool(store.read_bytes, file)
            if current is None:
                raise HTTPException(404, "recipe not found")
            if_match = (request.headers.get("if-match") or "").strip() or None
            if if_match is None:
                raise HTTPException(428, "If-Match required to delete a recipe")
            current_tag = etag(current)
            if not if_match_satisfied(if_match, current_tag):
                return Response(current, status_code=412, media_type=TEXT, headers={"ETag": current_tag})
            await run_in_threadpool(store.delete, file)
            recipe_meta.forget_recipe(conn, clean)
            collections.forget_recipe(conn, clean)
        return Response(status_code=204)

    def collection_item(c: collections.Collection) -> CollectionItem:
        return CollectionItem(**asdict(c))

    def member_collection(conn: sqlite3.Connection, collection_id: int, user: str) -> None:
        """Collections are private to their members: for anyone else they do not exist."""
        if not collections.is_member(conn, collection_id, user):
            raise HTTPException(404, "collection not found")

    def clean_name(name: str) -> str:
        name = " ".join(name.split())
        if not name:
            raise HTTPException(422, "name must not be empty")
        return name

    @app.get("/collections", response_model=CollectionList)
    def list_collections(conn: Conn, user: Annotated[str, Depends(require_user)]):
        return CollectionList(collections=[collection_item(c) for c in collections.for_user(conn, user)])

    @app.post("/collections", response_model=CollectionItem, status_code=201)
    def create_collection(body: CollectionName, conn: Conn, user: Annotated[str, Depends(require_user)]):
        collection_id = collections.create(conn, user, clean_name(body.name))
        return collection_item(collections.get(conn, collection_id))

    @app.patch("/collections/{collection_id}", response_model=CollectionItem)
    def rename_collection(
        collection_id: int, body: CollectionName, conn: Conn, user: Annotated[str, Depends(require_user)]
    ):
        member_collection(conn, collection_id, user)
        collections.rename(conn, collection_id, clean_name(body.name))
        return collection_item(collections.get(conn, collection_id))

    @app.delete("/collections/{collection_id}", status_code=204)
    def delete_collection(collection_id: int, conn: Conn, user: Annotated[str, Depends(require_user)]):
        """Deletes the collection for all its members. The recipes in it stay."""
        member_collection(conn, collection_id, user)
        collections.delete(conn, collection_id)
        return Response(status_code=204)

    @app.put("/collections/{collection_id}/recipes/{path:path}", status_code=204)
    def add_collection_recipe(
        collection_id: int, path: str, conn: Conn, user: Annotated[str, Depends(require_user)]
    ):
        member_collection(conn, collection_id, user)
        clean, file = resolve(path)
        if not file.is_file():
            raise HTTPException(404, "recipe not found")
        collections.add_recipe(conn, collection_id, clean)
        return Response(status_code=204)

    @app.delete("/collections/{collection_id}/recipes/{path:path}", status_code=204)
    def remove_collection_recipe(
        collection_id: int, path: str, conn: Conn, user: Annotated[str, Depends(require_user)]
    ):
        member_collection(conn, collection_id, user)
        clean, _ = resolve(path)
        collections.remove_recipe(conn, collection_id, clean)
        return Response(status_code=204)

    @app.put("/collections/{collection_id}/members/{username}", status_code=204)
    def add_collection_member(
        collection_id: int, username: str, conn: Conn, user: Annotated[str, Depends(require_user)]
    ):
        member_collection(conn, collection_id, user)
        name = auth.normalize_username(username)
        if conn.execute("SELECT 1 FROM users WHERE username = ?", (name,)).fetchone() is None:
            raise HTTPException(404, "user not found")
        collections.add_member(conn, collection_id, name)
        return Response(status_code=204)

    @app.delete("/collections/{collection_id}/members/{username}", status_code=204)
    def remove_collection_member(
        collection_id: int, username: str, conn: Conn, user: Annotated[str, Depends(require_user)]
    ):
        """Removes a member, or leaves the collection when it is the signed-in person. The last one to go deletes it."""
        member_collection(conn, collection_id, user)
        collections.remove_member(conn, collection_id, auth.normalize_username(username))
        return Response(status_code=204)

    def reviews_response(conn: sqlite3.Connection, path: str) -> ReviewsResponse:
        average, count = recipe_meta.rating_summaries(conn).get(path, (None, 0))
        return ReviewsResponse(
            reviews=[ReviewItem(**asdict(r)) for r in recipe_meta.reviews(conn, path)],
            rating_average=average,
            rating_count=count,
        )

    def existing_recipe(path: str) -> tuple[str, Path]:
        clean, file = resolve(path)
        if not file.is_file():
            raise HTTPException(404, "recipe not found")
        return clean, file

    @app.get("/recipe-reviews/{path:path}", response_model=ReviewsResponse)
    def get_reviews(path: str, conn: Conn):
        clean, _ = existing_recipe(path)
        return reviews_response(conn, clean)

    @app.put("/recipe-reviews/{path:path}", response_model=ReviewsResponse)
    def put_review(
        path: str,
        body: ReviewRequest,
        conn: Conn,
        user: Annotated[str, Depends(require_user)],
    ):
        """Sets the signed-in person's rating and note. Each person has one review per recipe."""
        clean, _ = existing_recipe(path)
        note = (body.note or "").strip() or None
        recipe_meta.save_review(conn, clean, user, body.rating, note)
        return reviews_response(conn, clean)

    @app.get("/recipe-photo/{path:path}")
    def get_photo(path: str):
        _, file = resolve(path)
        photo = store.find_photo(file)
        if photo is None:
            raise HTTPException(404, "no photo")
        data = photo.read_bytes()
        return Response(data, media_type=MEDIA_TYPES[photo.suffix], headers={"ETag": etag(data), "Cache-Control": "no-cache"})

    @app.put("/recipe-photo/{path:path}", response_model=PhotoResponse)
    async def put_photo(path: str, request: Request, _user: Annotated[str, Depends(require_user)]):
        """Sets the photo of an existing recipe. The file type is taken from its signature. Replaces any earlier photo."""
        clean, file = resolve(path)
        if not file.is_file():
            raise HTTPException(404, "recipe not found")
        data = await read_limited(request, settings.max_photo_bytes, "Das Foto ist zu groß.")
        sniffed = sniff_photo(data)
        if sniffed is None:
            raise HTTPException(415, "Nur JPG, PNG oder WebP.")
        ext, _ = sniffed
        async with write_lock:
            await run_in_threadpool(store.write_photo, file, data, ext)
        version = str(store.find_photo(file).stat().st_mtime_ns)
        return PhotoResponse(path=clean, image=photo_url(clean, version))

    @app.delete("/recipe-photo/{path:path}", status_code=204)
    async def delete_photo(path: str, _user: Annotated[str, Depends(require_user)]):
        _, file = resolve(path)
        async with write_lock:
            removed = await run_in_threadpool(store.delete_photo, file)
        if not removed:
            raise HTTPException(404, "no photo")
        return Response(status_code=204)

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
