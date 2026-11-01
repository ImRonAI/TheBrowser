"""View, add, edit and delete the signed-in user's long-term memory (``core/memory.py``).

Identity is the Projects path (``project_identity``): the owner is the verified Supabase user, never
a ``user_id`` from the request. Every store is a native ``FileMemoryStore``; this surface reads and
writes the same storage namespace the store uses (``<user scope>/memory/<store>/``).
Loopback only: never add ``/memory`` to the ngrok allowlist.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from strands.memory import MemoryManager
from strands.memory.types import MemorySearchOptions
from strands.storage import Storage
from strands.types.exceptions import StorageError

from agent.api.core.memory import CATEGORIES, DESCRIPTIONS, MemoryScope, scope_store_name, user_stores
from agent.api.core.panel_storage import get_user_session_storage
from agent.api.core.projects import ProjectIdentity, project_identity

router = APIRouter()
Identity = Annotated[ProjectIdentity, Depends(project_identity)]
MAX_ENTRY_CHARS = 20_000


def _require_loopback(request: Request) -> None:
    host = request.client.host if request.client else ""
    if host not in ("127.0.0.1", "::1", "localhost", "testclient"):
        raise HTTPException(403, "memory is a loopback-only surface")


def _owner(request: Request, identity: ProjectIdentity) -> str:
    _require_loopback(request)
    if identity.guest:
        raise HTTPException(401, "Sign in to view and edit memory")
    return identity.user_id


def _store_name(store: str) -> str:
    if store in CATEGORIES:
        return store
    for kind in ("project", "issue"):
        prefix = f"{kind}-"
        if store.startswith(prefix):
            try:
                return scope_store_name(kind, store[len(prefix):])
            except ValueError as error:
                raise HTTPException(422, str(error)) from error
    raise HTTPException(422, f"store must be one of {CATEGORIES} or project-<id> / issue-<id>")


def _view(user_id: str, store: str) -> Storage:
    """The exact namespace ``FileMemoryStore(name=store, storage=<user storage>)`` reads and writes."""
    storage: Storage = get_user_session_storage(user_id).namespace(f"memory/{store}")
    return storage


def _key(key: str) -> str:
    if not key.endswith(".md") or "/" in key.strip("/") or key.startswith("."):
        raise HTTPException(422, "key must be a single <name>.md file")
    return key


class EntryCreate(BaseModel):
    store: str
    content: str = Field(min_length=1, max_length=MAX_ENTRY_CHARS)


class EntryUpdate(BaseModel):
    store: str
    key: str
    content: str = Field(min_length=1, max_length=MAX_ENTRY_CHARS)


@router.get("/memory/stores")
async def memory_stores(request: Request, identity: Identity) -> dict[str, Any]:
    """The user's stores, with entry counts (project/issue stores appear once they hold entries)."""
    user_id = _owner(request, identity)
    root = get_user_session_storage(user_id)
    keys = await root.list("memory/")
    counts: dict[str, int] = {}
    for key in keys:
        parts = key.split("/")
        if len(parts) == 3 and parts[2].endswith(".md"):
            counts[parts[1]] = counts.get(parts[1], 0) + 1
    stores = [{"name": name, "description": DESCRIPTIONS[name], "count": counts.get(name, 0)} for name in CATEGORIES]
    stores += [{"name": name, "description": "", "count": count}
               for name, count in sorted(counts.items()) if name not in CATEGORIES and name != "learned-skills"]
    return {"stores": stores}


@router.get("/memory/entries")
async def memory_entries(request: Request, identity: Identity, store: str) -> dict[str, Any]:
    user_id = _owner(request, identity)
    name = _store_name(store)
    view = _view(user_id, name)
    entries = []
    for key in sorted(await view.list("")):
        if not key.endswith(".md"):
            continue
        data = await view.read(key)
        if data is not None:
            entries.append({"store": name, "key": key, "content": data.decode("utf-8", errors="replace")})
    return {"store": name, "entries": entries}


@router.post("/memory/entries")
async def memory_add(request: Request, identity: Identity, body: EntryCreate) -> dict[str, Any]:
    """Add through the native ``FileMemoryStore.add`` (heading slug → file, facts merged under it)."""
    user_id = _owner(request, identity)
    name = _store_name(body.store)
    scope = MemoryScope(project_id=name[8:] if name.startswith("project-") else None,
                        issue_id=name[6:] if name.startswith("issue-") else None)
    store = next(s for s in user_stores(user_id, scope, extraction=False) if s.name == name)
    key = await store.add(body.content)
    return {"store": name, "key": key}


@router.put("/memory/entries")
async def memory_update(request: Request, identity: Identity, body: EntryUpdate) -> dict[str, Any]:
    user_id = _owner(request, identity)
    name = _store_name(body.store)
    view = _view(user_id, name)
    key = _key(body.key)
    if await view.read(key) is None:
        raise HTTPException(404, "memory entry not found")
    try:
        await view.write(key, body.content.encode("utf-8"))
    except StorageError as error:
        raise HTTPException(503, f"memory storage failed: {error}") from error
    return {"store": name, "key": key}


@router.delete("/memory/entries")
async def memory_delete(request: Request, identity: Identity, store: str, key: str) -> dict[str, Any]:
    user_id = _owner(request, identity)
    name = _store_name(store)
    view = _view(user_id, name)
    checked = _key(key)
    if await view.read(checked) is None:
        raise HTTPException(404, "memory entry not found")
    await view.delete(checked)
    return {"store": name, "key": checked, "deleted": True}


@router.get("/memory/search")
async def memory_search(request: Request, identity: Identity, q: str, max_results: int = 10) -> dict[str, Any]:
    """The same native ``MemoryManager.search`` the agents' ``search_memory`` tool runs."""
    user_id = _owner(request, identity)
    if not q.strip():
        raise HTTPException(422, "q is required")
    manager = MemoryManager(stores=list(user_stores(user_id, extraction=False)), injection=False)
    results = await manager.search(q, MemorySearchOptions(max_search_results=max(1, min(max_results, 50))))
    return {"results": [{"store": entry.store_name, "content": entry.content,
                         "key": (entry.metadata or {}).get("path")} for entry in results]}
