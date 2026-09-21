"""Native Strands byte storage and user-scoped cross-session memory.

Requires strands-agents==1.56.0; Hugging Face mode uses huggingface_hub==1.20.1.
Configuration is read from the environment only, on first factory use. No dotenv
or local Hugging Face credential files are loaded by this module.
"""

from __future__ import annotations

import asyncio
import builtins
import hashlib
import os
import re
import threading
from collections.abc import Callable
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, TypeVar
from weakref import WeakValueDictionary

from strands.memory import MemoryManagerConfig
from strands.memory.types import Metadata
from strands.storage import InMemoryStorage, Storage
from strands.storage.search import KeywordSearchStrategy
from strands.storage.storage import StorageSearchResult
from strands.types.exceptions import StorageError
from strands.vended_memory_stores.file_memory_store import FileMemoryStore

T = TypeVar("T")


def _path(value: str, *, prefix: bool = False) -> str:
    """Use slash-separated keys without allowing namespace traversal."""
    if not isinstance(value, str) or "\\" in value or "\x00" in value:
        raise StorageError("Storage keys must be strings without backslashes or NUL")
    normalized = re.sub(r"/+", "/", value).lstrip("/")
    if not prefix:
        normalized = normalized.rstrip("/")
    if any(part in (".", "..") for part in normalized.split("/")):
        raise StorageError("Relative path segments are not allowed in storage keys")
    if not prefix and not normalized:
        raise StorageError("Storage key must not be empty")
    return normalized


async def _run_sync(operation: Callable[[], T]) -> T:
    """Offload all blocking work, retaining write ownership on cancellation.

    Cancelling to_thread does not stop its worker. Wait until it finishes before
    propagating cancellation so a memory lock cannot be released mid-upload.
    """
    task = asyncio.create_task(asyncio.to_thread(operation))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        while not task.done():
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                continue
            except Exception:
                break
        if not task.cancelled():
            task.exception()  # Retrieve any worker failure; cancellation wins.
        raise


class HuggingFaceBucketStorage:
    """Storage backed by an existing HF Bucket, using the public synchronous API.

    Only EntryNotFoundError means a missing object. Authentication failures,
    missing buckets, generic 404s, transfer errors and local I/O failures surface
    as StorageError. Bucket creation is deliberately an external setup step.
    """

    def __init__(self, bucket_id: str, *, token: str | None = None, client: Any = None) -> None:
        from huggingface_hub import HfApi

        if not bucket_id or len(bucket_id.split("/")) != 2 or any(
            not part.strip() or part in (".", "..") for part in bucket_id.split("/")
        ):
            raise ValueError("HF_BUCKET_ID must be 'namespace/bucket-name'")
        self.bucket_id = bucket_id
        # False prevents HfApi from falling back to cached local credentials.
        self._token: str | bool = token or False
        self._client = client if client is not None else HfApi(token=self._token)

    async def write(self, key: str, data: bytes) -> None:
        key = _path(key)
        try:
            payload = bytes(data)
            await _run_sync(lambda: self._client.batch_bucket_files(
                self.bucket_id, add=[(payload, key)], token=self._token,
            ))
        except Exception as error:
            raise StorageError(f"HF Bucket write failed for {key!r}") from error

    async def read(self, key: str) -> bytes | None:
        from huggingface_hub.errors import EntryNotFoundError

        key = _path(key)

        def download() -> bytes:
            # The API downloads to disk. Keep creation/read/cleanup off-loop too,
            # use a fresh path, and never turn a missing local download into None.
            with TemporaryDirectory(prefix="panel-bucket-") as directory:
                target = Path(directory) / "object"
                self._client.download_bucket_files(
                    self.bucket_id, [(key, target)],
                    raise_on_missing_files=True, token=self._token,
                )
                return target.read_bytes()

        try:
            return await _run_sync(download)
        except EntryNotFoundError:
            return None
        except Exception as error:
            raise StorageError(f"HF Bucket read failed for {key!r}") from error

    async def delete(self, key: str) -> None:
        from huggingface_hub.errors import EntryNotFoundError

        key = _path(key)

        def delete() -> None:
            # paths-info omits missing files but fails on missing/inaccessible
            # buckets. Both obtaining and exhausting this lazy iterator are I/O.
            entries = builtins.list(self._client.get_bucket_paths_info(
                self.bucket_id, [key], token=self._token,
            ))
            if any(entry.path == key for entry in entries):
                self._client.batch_bucket_files(self.bucket_id, delete=[key], token=self._token)

        try:
            await _run_sync(delete)
        except EntryNotFoundError:
            pass
        except Exception as error:
            raise StorageError(f"HF Bucket delete failed for {key!r}") from error

    async def list(self, query: str = "") -> builtins.list[str]:
        from huggingface_hub import BucketFile

        prefix = _path(query, prefix=True)

        def listing() -> builtins.list[str]:
            return sorted({
                entry.path for entry in self._client.list_bucket_tree(
                    self.bucket_id, prefix=prefix or None, recursive=True, token=self._token,
                )
                if isinstance(entry, BucketFile) and entry.path.startswith(prefix)
            })

        try:
            return await _run_sync(listing)
        except Exception as error:
            raise StorageError(f"HF Bucket listing failed for prefix {prefix!r}") from error

    async def search(self, query: str) -> builtins.list[StorageSearchResult]:
        return await KeywordSearchStrategy().search(self, query)

    def namespace(self, prefix: str) -> _ScopedStorage:
        return _ScopedStorage(self, prefix)


class _ScopedStorage:
    """Search only scoped bytes, rather than searching all users then filtering.

    This is an ordinary native Storage implementation, not an SDK-marked view;
    FileMemoryStore and SnapshotSessionManager still add their own namespaces.
    """

    def __init__(self, storage: Storage, prefix: str) -> None:
        self._storage = storage
        normalized = _path(prefix, prefix=True).rstrip("/")
        self._prefix = f"{normalized}/" if normalized else ""

    async def write(self, key: str, data: bytes) -> None:
        await self._storage.write(self._prefix + _path(key), data)

    async def read(self, key: str) -> bytes | None:
        return await self._storage.read(self._prefix + _path(key))

    async def delete(self, key: str) -> None:
        await self._storage.delete(self._prefix + _path(key))

    async def list(self, query: str = "") -> builtins.list[str]:
        prefix = self._prefix + _path(query, prefix=True)
        return sorted(key[len(self._prefix):] for key in await self._storage.list(prefix)
                      if key.startswith(prefix))

    async def search(self, query: str) -> builtins.list[StorageSearchResult]:
        return await KeywordSearchStrategy().search(self, query)

    def namespace(self, prefix: str) -> _ScopedStorage:
        return _ScopedStorage(self._storage, self._prefix + _path(prefix, prefix=True))


_factory_lock = threading.Lock()
_storage: Storage | None = None
_memory_locks: WeakValueDictionary[str, Any] = WeakValueDictionary()
_memory_locks_guard = threading.Lock()


def get_panel_storage() -> Storage:
    """Return the process singleton; environment changes require a restart."""
    global _storage
    with _factory_lock:
        if _storage is None:
            mode = os.environ.get("PANEL_STORAGE", "memory").strip().lower()
            if mode == "memory":
                _storage = InMemoryStorage()
            elif mode == "huggingface":
                _storage = HuggingFaceBucketStorage(
                    os.environ.get("HF_BUCKET_ID", ""), token=os.environ.get("HF_TOKEN"),
                )
            else:
                raise ValueError("PANEL_STORAGE must be 'memory' or 'huggingface'")
        return _storage


def _user_scope(user_id: str) -> str:
    if not isinstance(user_id, str) or not user_id.strip():
        raise ValueError("user_id must be a non-empty string")
    # No lossy slugification: slash-containing IDs and Unicode remain distinct.
    return f"panel/users/{hashlib.sha256(user_id.encode('utf-8')).hexdigest()}"


def get_user_session_storage(user_id: str) -> Storage:
    """Pass to SnapshotSessionManager; its native session/id layout stays separate."""
    return _ScopedStorage(get_panel_storage(), _user_scope(user_id))


class SerializedFileMemoryStore(FileMemoryStore):
    """Serialize native add's full read/append/write across instances and loops.

    All writers of a user namespace must use this factory in ONE process. HF
    Buckets provide no compare-and-swap here; multiple workers can lose updates.
    The native implementation still owns slugging, merging and serialization.
    """

    def __init__(self, *, lock_key: str, storage: Storage) -> None:
        super().__init__(name="panel-memory", storage=storage, extraction=False)
        with _memory_locks_guard:
            lock = _memory_locks.get(lock_key)
            if lock is None:
                lock = threading.Lock()
                _memory_locks[lock_key] = lock
            self._process_lock = lock

    async def add(self, content: str, metadata: Metadata | None = None) -> str:
        # Nonblocking acquisition avoids blocking the event loop or exhausting
        # its executor with waiters while the lock holder needs an HF worker.
        while not self._process_lock.acquire(blocking=False):
            await asyncio.sleep(0.005)
        try:
            return await super().add(content, metadata)
        finally:
            self._process_lock.release()


def create_memory_config(user_id: str) -> MemoryManagerConfig:
    """Fresh native manager configuration sharing memory across a user's sessions.

    Explicit add/search tools and injection are enabled. Automatic model-based
    extraction is off; callers can choose it separately if desired.
    """
    scope = _user_scope(user_id)
    return MemoryManagerConfig(
        stores=[SerializedFileMemoryStore(
            lock_key=scope, storage=_ScopedStorage(get_panel_storage(), scope),
        )],
        search_tool_config=True,
        add_tool_config={"wait_for_writes": True},
        injection=True,
    )
