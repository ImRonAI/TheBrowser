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
from dataclasses import dataclass
from datetime import datetime
from typing import Any, TypeVar
from weakref import WeakValueDictionary

from strands import tool
from strands.memory import MemoryManagerConfig
from strands.memory.types import MemoryEntry, Metadata, SearchOptions
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


# --- Journal entry grammar -------------------------------------------------------
#: Topics the panel/think agents journal under; the dreaming pass keeps them verbatim.
ENTRY_TOPICS = ("ToDo's", "LearnedAboutUser", "Feedback", "UserStatement", "WorthyMemory")
#: Nested-filter names the agent may order freely in ``search_memories``.
FILTER_NAMES = ("since", "until", "tags", "topic", "subject")
_TAG = re.compile(r"<(topic_name|subject|created_at)>(.*?)<\1/>", re.S)
_TAGS = re.compile(r"<tags>(.*?)</tags>", re.S)


@dataclass(frozen=True)
class ParsedEntry:
    topic: str
    subject: str
    created_at: str
    tags: list[str]
    body: str

    @property
    def key(self) -> str:
        stamp = self.created_at.replace("-", "").replace(":", "")
        return f"{_slug(self.topic)}/{stamp}-{_slug(self.subject)}.md"


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:60]


def _strip_heading(content: str) -> str:
    """Drop an optional leading ``# Topic | Subject`` heading line (the native add_memory slug line)."""
    text = content.strip()
    if text.startswith("#"):
        first, _, rest = text.partition("\n")
        if rest.lstrip().startswith("<start_entry>"):
            return rest.strip()
    return text


def is_entry(content: str) -> bool:
    return _strip_heading(content).startswith("<start_entry>")


def parse_entry(content: str) -> ParsedEntry:
    """Validate and parse one ``<start_entry>...<end_entry/>`` journal entry."""
    text = _strip_heading(content)
    if not text.startswith("<start_entry>") or not text.endswith("<end_entry/>"):
        raise ValueError("entry must begin with <start_entry> and end with <end_entry/>")
    fields = {name: value.strip() for name, value in _TAG.findall(text)}
    topic = fields.get("topic_name", "")
    if topic not in ENTRY_TOPICS:
        raise ValueError(f"topic_name must be one of {ENTRY_TOPICS}, got {topic!r}")
    subject = fields.get("subject", "")
    if not 2 <= len(subject.split()) <= 8:
        raise ValueError("subject must be two to eight words")
    created = fields.get("created_at", "")
    try:
        datetime.strptime(created, "%Y-%m-%dT%H:%M:%S")
    except ValueError:
        raise ValueError("created_at must be YYYY-MM-DDTHH:MM:SS") from None
    raw_tags = _TAGS.search(text)
    tags = [t.strip() for t in raw_tags.group(1).replace("\n", " ").split(",") if t.strip()] if raw_tags else []
    body = _TAGS.sub("", _TAG.sub("", text[len("<start_entry>"):-len("<end_entry/>")])).strip()
    return ParsedEntry(topic=topic, subject=subject, created_at=created, tags=tags, body=body)


class EntrySearchOptions(SearchOptions, total=False):
    """Store-specific nested filters; ``order`` is the agent's chosen traversal order."""

    order: list[str]
    since: str
    until: str
    tags: list[str]
    topic: str
    subject: str


def _apply_filter(name: str, options: EntrySearchOptions, entries: list[ParsedEntry]) -> list[ParsedEntry]:
    if name == "since" and options.get("since"):
        return [e for e in entries if e.created_at >= options["since"]]
    if name == "until" and options.get("until"):
        return [e for e in entries if e.created_at <= options["until"]]
    if name == "tags" and options.get("tags"):
        wanted = {t.lower() for t in options["tags"]}
        return [e for e in entries if wanted & {t.lower() for t in e.tags}]
    if name == "topic" and options.get("topic"):
        return [e for e in entries if e.topic.lower() == options["topic"].lower()]
    if name == "subject" and options.get("subject"):
        return [e for e in entries if options["subject"].lower() in e.subject.lower()]
    return entries


class SerializedFileMemoryStore(FileMemoryStore):
    """Serialize native add's full read/append/write across instances and loops.

    All writers of a user namespace must use this factory in ONE process. HF
    Buckets provide no compare-and-swap here; multiple workers can lose updates.
    The native implementation still owns slugging, merging and serialization for
    plain content. A journal ``<start_entry>`` becomes ONE file per entry under
    ``<topic>/<timestamp>-<subject>.md`` and is searchable by nested filters.
    """

    def __init__(self, *, lock_key: str, storage: Storage, name: str = "panel-memory") -> None:
        super().__init__(name=name, storage=storage, extraction=False)
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
            if is_entry(content):
                entry = parse_entry(content)
                await self._storage.write(entry.key, _strip_heading(content).encode("utf-8"))
                return entry.key
            return await super().add(content, metadata)
        finally:
            self._process_lock.release()

    async def search(self, query: str, options: SearchOptions | None = None) -> list[MemoryEntry]:
        """Keyword search, with agent-ordered nested filters over journal entries.

        Without filter options this is the native search. With any of
        ``since``/``until``/``tags``/``topic``/``subject`` the journal entries are
        narrowed in the ``order`` given (every named filter still applies; the order
        is the agent's chosen traversal and is echoed in ``metadata.filter_order``),
        then ranked by the query when one is given.
        """
        opts: EntrySearchOptions = dict(options or {})  # type: ignore[assignment]
        order = list(opts.get("order") or [])
        unknown = [name for name in order if name not in FILTER_NAMES]
        if unknown:
            raise ValueError(f"order must only name {FILTER_NAMES}, got {unknown}")
        active = [name for name in FILTER_NAMES if opts.get(name)]
        traversal = order + [name for name in active if name not in order]
        limit = opts.get("max_search_results") or self.max_search_results or 10
        if limit < 1:
            raise ValueError("max_search_results must be >= 1")
        entries = await self._entries()
        if not entries and not traversal:
            return await super().search(query, options)
        parsed = [entry for _, entry in entries]
        for name in traversal:
            parsed = _apply_filter(name, opts, parsed)
        keep = {id(entry) for entry in parsed}
        selected = [(key, entry) for key, entry in entries if id(entry) in keep]
        if query.strip():
            needles = {n for n in re.split(r"\W+", query.lower()) if len(n) > 1}
            scored = []
            for key, entry in selected:
                words = set(re.split(r"\W+", f"{entry.subject} {entry.body} {' '.join(entry.tags)} {entry.topic}".lower()))
                score = len(needles & words)
                if score:
                    scored.append((score, key, entry))
            selected = [(key, entry) for _, key, entry in sorted(scored, key=lambda item: (-item[0], item[2].created_at))]
        else:
            selected.sort(key=lambda item: item[1].created_at, reverse=True)
        results = [MemoryEntry(content=entry.body, metadata={
            "path": key, "topic": entry.topic, "subject": entry.subject, "created_at": entry.created_at,
            "tags": entry.tags, "filter_order": traversal}) for key, entry in selected[:limit]]
        if not traversal and query.strip() and len(results) < limit:
            # Plain query: journal entries first, then whatever the native keyword search finds
            # among non-entry files (e.g. SDK-extracted notes), without duplicating entry paths.
            seen = {r.metadata["path"] for r in results if r.metadata}
            for native in await super().search(query, {"max_search_results": limit}):
                if native.metadata and native.metadata.get("path") not in seen and not is_entry(native.content):
                    results.append(native)
        return results[:limit]

    async def _entries(self) -> list[tuple[str, ParsedEntry]]:
        found: list[tuple[str, ParsedEntry]] = []
        for key in await self._storage.list(""):
            if not key.endswith(".md"):
                continue
            raw = await self._storage.read(key)
            text = raw.decode("utf-8", errors="replace") if raw else ""
            if is_entry(text):
                try:
                    found.append((key, parse_entry(text)))
                except ValueError:
                    continue
        return found


def create_search_memories_tool(stores: builtins.list[Any]) -> Any:
    """``search_memories``: nested, agent-ordered filtering over the user's journal memories.

    Complements the native ``search_memory`` (plain keyword search). ``order`` is the
    hierarchy the agent chooses at call time, e.g. ``["since", "tags", "topic"]``; it is
    not hardwired and every listed filter still applies.
    """
    entry_stores = [store for store in stores if isinstance(store, SerializedFileMemoryStore)]

    @tool
    async def search_memories(
        query: str = "",
        order: builtins.list[str] | None = None,
        since: str | None = None,
        until: str | None = None,
        tags: builtins.list[str] | None = None,
        topic: str | None = None,
        subject: str | None = None,
        max_results: int = 10,
    ) -> builtins.list[dict[str, Any]]:
        """Search long-term memories with nested filters in the order you choose.

        Args:
            query: Keywords to rank by; empty returns newest first.
            order: Filter hierarchy to apply, any order of: since, until, tags, topic, subject.
            since: Only entries created at or after this YYYY-MM-DDTHH:MM:SS.
            until: Only entries created at or before this YYYY-MM-DDTHH:MM:SS.
            tags: Entries carrying any of these tags.
            topic: One of ToDo's, LearnedAboutUser, Feedback, UserStatement, WorthyMemory.
            subject: Substring of the two-to-eight-word subject.
            max_results: Maximum entries to return.
        """
        options: EntrySearchOptions = {"max_search_results": max_results}
        for name, value in (("order", order), ("since", since), ("until", until), ("tags", tags),
                            ("topic", topic), ("subject", subject)):
            if value:
                options[name] = value  # type: ignore[literal-required]
        results: builtins.list[dict[str, Any]] = []
        for store in entry_stores:
            for entry in await store.search(query, options):
                results.append({"content": entry.content, "store": store.name, **(entry.metadata or {})})
        return results[:max_results]

    return search_memories


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
