"""Native Strands byte storage (Hugging Face Buckets or in-memory) and user-scoped thread sessions.

Long-term memory lives in ``core/memory.py`` on top of :func:`get_user_session_storage`.

Requires strands-agents==1.56.0; Hugging Face mode uses huggingface_hub==1.20.1.
Configuration is read from the environment only, on first factory use. No dotenv
or local Hugging Face credential files are loaded by this module.
"""

from __future__ import annotations

import asyncio
import builtins
import hashlib
import os
import threading
from collections import OrderedDict
from collections.abc import Callable
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, TypeVar

from strands.session import SnapshotSessionManager
from strands.storage import InMemoryStorage, LocalFileStorage, Storage
from strands.storage.search import KeywordSearchStrategy, SearchStrategy
from strands.storage.search.bm25 import Bm25SearchStrategy
from strands.storage.storage import (
    StorageSearchResult,
    _NamespacedStorage,
    _normalize_key,
    _normalize_prefix,
)
from strands.types.exceptions import StorageError

T = TypeVar("T")


def _path(value: str, *, prefix: bool = False) -> str:
    """Delegate to the native SDK key/prefix normalizers, also rejecting NUL and '.' segments."""
    if not isinstance(value, str) or "\x00" in value:
        raise StorageError("Storage keys must be strings without backslashes or NUL")
    normalized = _normalize_prefix(value) if prefix else _normalize_key(value)
    if "." in normalized.split("/"):
        raise StorageError("Relative path segments are not allowed in storage keys")
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


#: Default bound of the content-addressed read cache (bytes of cached object data).
DEFAULT_CACHE_BYTES = 64 * 1024 * 1024


class HuggingFaceBucketStorage:
    """Native ``Storage`` over an HF Bucket, using the public synchronous API.

    Only EntryNotFoundError means a missing object. Authentication failures,
    missing buckets, generic 404s, transfer errors and local I/O failures surface
    as StorageError.

    Like ``InMemoryStorage(search_strategy=)``, ``write`` indexes through the
    ``SearchStrategy`` and ``search`` delegates to it (default
    ``KeywordSearchStrategy``). Reads are cached by the bucket's content hash
    (``BucketFile.xet_hash``) as reported by the latest ``list_bucket_tree``: a
    key whose hash is unchanged is served from memory; our own writes and deletes
    invalidate immediately, and a foreign writer is seen on the next listing.
    """

    def __init__(self, bucket_id: str, *, token: str | None = None, client: Any = None,
                 search_strategy: SearchStrategy[Any] | None = None,
                 cache_bytes: int = DEFAULT_CACHE_BYTES) -> None:
        from huggingface_hub import HfApi

        if not bucket_id or len(bucket_id.split("/")) != 2 or any(
            not part.strip() or part in (".", "..") for part in bucket_id.split("/")
        ):
            raise ValueError("HF_BUCKET_ID must be 'namespace/bucket-name'")
        if cache_bytes < 0:
            raise ValueError("cache_bytes must be >= 0")
        self.bucket_id = bucket_id
        # False prevents HfApi from falling back to cached local credentials.
        self._token: str | bool = token or False
        self._client = client if client is not None else HfApi(token=self._token)
        self._search_strategy: SearchStrategy[Any] = search_strategy or KeywordSearchStrategy()
        self._cache_bytes = cache_bytes
        # key -> (xet_hash, data); insertion order is the LRU order.
        self._cache: OrderedDict[str, tuple[str, bytes]] = OrderedDict()
        self._cached_bytes = 0
        # key -> xet_hash from the most recent listing (None when never listed).
        self._hashes: dict[str, str] | None = None
        self._cache_lock = threading.Lock()

    # --- cache -------------------------------------------------------------------

    def _remember(self, key: str, digest: str, data: bytes) -> None:
        if self._cache_bytes == 0 or len(data) > self._cache_bytes:
            return
        with self._cache_lock:
            previous = self._cache.pop(key, None)
            if previous is not None:
                self._cached_bytes -= len(previous[1])
            self._cache[key] = (digest, data)
            self._cached_bytes += len(data)
            while self._cached_bytes > self._cache_bytes and self._cache:
                _, (_, evicted) = self._cache.popitem(last=False)
                self._cached_bytes -= len(evicted)

    def _forget(self, key: str) -> None:
        with self._cache_lock:
            previous = self._cache.pop(key, None)
            if previous is not None:
                self._cached_bytes -= len(previous[1])
            if self._hashes is not None:
                self._hashes.pop(key, None)

    def _cached(self, key: str) -> bytes | None:
        """The cached bytes when the latest listing still reports the same content hash."""
        with self._cache_lock:
            if self._hashes is None or key not in self._cache:
                return None
            digest = self._hashes.get(key)
            cached_digest, data = self._cache[key]
            if digest is None or digest != cached_digest:
                self._cache.pop(key)
                self._cached_bytes -= len(data)
                return None
            self._cache.move_to_end(key)
            return data

    def _record_listing(self, files: builtins.list[Any], prefix: str) -> None:
        with self._cache_lock:
            hashes = dict(self._hashes or {})
            for key in [key for key in hashes if key.startswith(prefix)]:
                hashes.pop(key)
            for entry in files:
                digest = getattr(entry, "xet_hash", None)
                if digest:
                    hashes[entry.path] = str(digest)
            self._hashes = hashes

    def ensure_bucket(self) -> None:
        """Create the bucket (private) when it does not exist yet; blocking, call once at startup.

        Raises:
            StorageError: If the bucket cannot be created or inspected.
        """
        try:
            self._client.create_bucket(self.bucket_id, private=True, exist_ok=True, token=self._token)
        except Exception as error:
            raise StorageError(f"HF Bucket {self.bucket_id!r} is unavailable") from error

    # --- Storage -----------------------------------------------------------------

    async def write(self, key: str, data: bytes) -> None:
        key = _path(key)
        payload = bytes(data)
        self._forget(key)
        try:
            await _run_sync(lambda: self._client.batch_bucket_files(
                self.bucket_id, add=[(payload, key)], token=self._token,
            ))
        except Exception as error:
            raise StorageError(f"HF Bucket write failed for {key!r}") from error
        await self._search_strategy.index(self, key, payload)

    async def read(self, key: str) -> bytes | None:
        from huggingface_hub.errors import EntryNotFoundError

        key = _path(key)
        cached = self._cached(key)
        if cached is not None:
            return cached

        def download() -> tuple[bytes, str | None]:
            # The API downloads to disk. Keep creation/read/cleanup off-loop too,
            # use a fresh path, and never turn a missing local download into None.
            with TemporaryDirectory(prefix="panel-bucket-") as directory:
                target = Path(directory) / "object"
                self._client.download_bucket_files(
                    self.bucket_id, [(key, target)],
                    raise_on_missing_files=True, token=self._token,
                )
                data = target.read_bytes()
            with self._cache_lock:
                digest = self._hashes.get(key) if self._hashes is not None else None
            return data, digest

        try:
            data, digest = await _run_sync(download)
        except EntryNotFoundError:
            self._forget(key)
            return None
        except Exception as error:
            raise StorageError(f"HF Bucket read failed for {key!r}") from error
        if digest:
            self._remember(key, digest, data)
        return data

    async def delete(self, key: str) -> None:
        from huggingface_hub.errors import EntryNotFoundError

        key = _path(key)
        self._forget(key)

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

        def listing() -> builtins.list[Any]:
            return [
                entry for entry in self._client.list_bucket_tree(
                    self.bucket_id, prefix=prefix or None, recursive=True, token=self._token,
                )
                if isinstance(entry, BucketFile) and entry.path.startswith(prefix)
            ]

        try:
            files = await _run_sync(listing)
        except Exception as error:
            raise StorageError(f"HF Bucket listing failed for prefix {prefix!r}") from error
        self._record_listing(files, prefix)
        return sorted({entry.path for entry in files})

    async def search(self, query: str) -> builtins.list[StorageSearchResult]:
        return await self._search_strategy.search(self, query)

    def namespace(self, prefix: str) -> _ScopedStorage:
        return _ScopedStorage(self, prefix)


class _ScopedStorage(_NamespacedStorage):
    """Search only scoped bytes, rather than searching all users then filtering.

    Subclasses the native SDK ``_NamespacedStorage`` while leaving ``_namespaced``
    unset so ``FileMemoryStore``, ``SnapshotSessionManager``, and ``ContextOffloader``
    still add their own namespaces. When backed by a host-indexed strategy (such as
    ``Bm25SearchStrategy`` on ``LocalFileStorage``), delegates to the indexed parent
    search; otherwise reuses a single ``KeywordSearchStrategy`` over the scoped prefix.
    """

    _namespaced = None
    _keyword_strategy = KeywordSearchStrategy()

    def __init__(self, storage: Storage, prefix: str) -> None:
        super().__init__(storage, _path(prefix, prefix=True))

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
        strategy = getattr(self._storage, "_search_strategy", None)
        if strategy is not None and getattr(strategy, "requires_host_fs", False):
            return await super().search(query)
        return await self._keyword_strategy.search(self, query)

    def namespace(self, prefix: str) -> _ScopedStorage:
        return _ScopedStorage(self._storage, self._prefix + _path(prefix, prefix=True))


_factory_lock = threading.Lock()
_storage: Storage | None = None


def get_panel_storage() -> Storage:
    """Return the process singleton; environment changes require a restart.

    ``PANEL_STORAGE=huggingface`` is the production authority: it requires ``HF_TOKEN``
    and ``HF_BUCKET_ID`` and ensures the bucket exists (blocking HF call on first use;
    ``main.py`` warms it in the lifespan so misconfiguration fails at boot).
    ``PANEL_STORAGE=local`` (or ``file``) uses native ``LocalFileStorage`` with SQLite
    FTS5 ``Bm25SearchStrategy``.

    Raises:
        ValueError: On an unknown mode, a malformed bucket id or a missing token.
        StorageError: When the bucket cannot be created or reached.
    """
    global _storage
    with _factory_lock:
        if _storage is None:
            mode = os.environ.get("PANEL_STORAGE", "memory").strip().lower()
            if mode == "memory":
                _storage = InMemoryStorage()
            elif mode in ("local", "file"):
                base_dir = os.environ.get("PANEL_STORAGE_DIR", "").strip() or str(Path.home() / ".ron" / "storage")
                _storage = LocalFileStorage(base_dir, search_strategy=Bm25SearchStrategy())
            elif mode == "huggingface":
                token = os.environ.get("HF_TOKEN", "").strip()
                if not token:
                    raise ValueError("PANEL_STORAGE=huggingface requires HF_TOKEN")
                hf_storage = HuggingFaceBucketStorage(os.environ.get("HF_BUCKET_ID", ""), token=token)
                hf_storage.ensure_bucket()
                _storage = hf_storage
            else:
                raise ValueError("PANEL_STORAGE must be 'memory', 'local', or 'huggingface'")
        return _storage


def _user_scope(user_id: str) -> str:
    if not isinstance(user_id, str) or not user_id.strip():
        raise ValueError("user_id must be a non-empty string")
    # No lossy slugification: slash-containing IDs and Unicode remain distinct.
    return f"panel/users/{hashlib.sha256(user_id.encode('utf-8')).hexdigest()}"


def get_user_session_storage(user_id: str) -> Storage:
    """Pass to SnapshotSessionManager; its native session/id layout stays separate."""
    return _ScopedStorage(get_panel_storage(), _user_scope(user_id))


def thread_agent_id(user_id: str) -> str:
    """The one native ``agent_id`` every Ron agent uses for a user's threads.

    ``SnapshotSessionManager`` keys snapshots by ``session/<session_id>/scopes/agent/<agent_id>``, so
    the Chat ``Agent`` and the Live ``BidiAgent`` can only share a thread (and the Chat agent can only
    take over a Live thread) when they construct with the same ``agent_id``.
    """
    return "panel-" + hashlib.sha256(user_id.encode()).hexdigest()[:32]


class ThreadSessionManager(SnapshotSessionManager):
    """``SnapshotSessionManager`` for a thread shared by more than one agent kind.

    The stock manager captures ``take_snapshot(preset="session", include=["system_prompt"])`` so a
    rehydrated agent "behaves identically to the original". A Ron thread is opened by the Chat
    ``Agent`` and the Live ``BidiAgent``, whose prompts differ (the Live addendum, music, etc.), so
    the prompt must stay with the agent, not the thread: this captures the plain native ``"session"``
    preset (``messages`` + ``state`` for a BidiAgent; plus conversation-manager, interrupt and model
    state for an Agent) through the same ``take_snapshot`` API. Nothing else is overridden.
    """

    def _capture(self, agent: Any) -> Any:
        return agent.take_snapshot(preset="session")


def thread_session_manager(user_id: str, session_id: str, **kwargs: Any) -> ThreadSessionManager:
    """The native session manager for one of this user's threads (same key for every agent kind)."""
    return ThreadSessionManager(session_id, storage=get_user_session_storage(user_id), **kwargs)
