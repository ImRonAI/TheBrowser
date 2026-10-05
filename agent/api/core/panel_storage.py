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
from collections import OrderedDict
from collections.abc import Callable, Sequence
from pathlib import Path
from tempfile import TemporaryDirectory
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, TypeVar
from weakref import WeakValueDictionary

from strands import tool
from strands.memory import MemoryAddToolConfig, MemoryInjectionConfig, MemoryManagerConfig
from strands.memory.types import MemoryEntry, Metadata, SearchOptions
from strands.storage import InMemoryStorage, Storage
from strands.storage.search import KeywordSearchStrategy, SearchStrategy
from strands.storage.storage import StorageSearchResult
from strands.types.exceptions import StorageError
from strands.types.tools import AgentTool
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
        self._forget(key)
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
        self._forget(key)

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
    """Return the process singleton; environment changes require a restart.

    ``PANEL_STORAGE=huggingface`` is the production authority: it requires ``HF_TOKEN``
    and ``HF_BUCKET_ID`` and ensures the bucket exists (blocking HF call on first use;
    ``main.py`` warms it in the lifespan so misconfiguration fails at boot). It never
    falls back to in-memory storage.

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
            elif mode == "huggingface":
                token = os.environ.get("HF_TOKEN", "").strip()
                if not token:
                    raise ValueError("PANEL_STORAGE=huggingface requires HF_TOKEN")
                hf_storage = HuggingFaceBucketStorage(os.environ.get("HF_BUCKET_ID", ""), token=token)
                hf_storage.ensure_bucket()
                _storage = hf_storage
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
#: Topics the panel/live agents journal under; the dreaming extractor keeps them verbatim.
ENTRY_TOPICS = ("ToDo's", "LearnedAboutUser", "Feedback", "UserStatement", "WorthyMemory")
#: Nested-filter names the agent may order freely in ``search_memories``.
FILTER_NAMES = ("since", "until", "tags", "topic", "subject")
#: Store names: the per-user journal (``add_memory`` target, one file per entry) and the
#: long-term memory the dreaming extractor consolidates into (name preserved: existing VPS data).
JOURNAL_STORE_NAME = "journal"
LONG_TERM_STORE_NAME = "panel-memory"
_TAG = re.compile(r"<(topic_name|subject|created_at)>(.*?)<\1/>", re.S)
_TAGS = re.compile(r"<tags>(.*?)</tags>", re.S)
_ENTRY_BLOCK = re.compile(r"<start_entry>.*?<end_entry/>", re.S)
_CREATED_AT = re.compile(r"<created_at>.*?<created_at/>\n?", re.S)
_CREATED_AT_FORMAT = "%Y-%m-%dT%H:%M:%S"


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

    @property
    def heading(self) -> str:
        """The native ``add`` slug line the long-term store merges on."""
        return f"# {self.topic} | {self.subject}"


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


def _server_time() -> str:
    return datetime.now(timezone.utc).strftime(_CREATED_AT_FORMAT)


def stamp_entry(content: str, created_at: str | None = None) -> str:
    """Return the entry with its ``<created_at>`` replaced by (or set to) the server's UTC time.

    The model's own timestamp is never trusted on a journal write: clocks drift and models
    guess. The stamp goes right after ``<subject>`` (or after ``<start_entry>`` when the
    subject is missing, so the grammar error still surfaces in :func:`parse_entry`).
    """
    stamp = created_at or _server_time()
    text = _strip_heading(content)
    text = _CREATED_AT.sub("", text)
    line = f"<created_at>{stamp}<created_at/>"
    marker = re.search(r"<subject>.*?<subject/>\n?", text, re.S)
    if marker is not None:
        return text[:marker.end()].rstrip("\n") + "\n" + line + "\n" + text[marker.end():]
    return text.replace("<start_entry>", f"<start_entry>\n{line}", 1)


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
        datetime.strptime(created, _CREATED_AT_FORMAT)
    except ValueError:
        raise ValueError("created_at must be YYYY-MM-DDTHH:MM:SS") from None
    raw_tags = _TAGS.search(text)
    tags = [t.strip() for t in raw_tags.group(1).replace("\n", " ").split(",") if t.strip()] if raw_tags else []
    body = _TAGS.sub("", _TAG.sub("", text[len("<start_entry>"):-len("<end_entry/>")])).strip()
    return ParsedEntry(topic=topic, subject=subject, created_at=created, tags=tags, body=body)


def parse_entries(content: str) -> builtins.list[ParsedEntry]:
    """Every valid entry block in ``content`` (a journal file holds one; a long-term subject file
    headed ``# Topic | Subject`` may hold several, oldest first after native slug-merging)."""
    found: builtins.list[ParsedEntry] = []
    for block in _ENTRY_BLOCK.findall(content):
        try:
            found.append(parse_entry(block))
        except ValueError:
            continue
    return found


class EntrySearchOptions(SearchOptions, total=False):
    """Store-specific nested filters; ``order`` is the agent's chosen traversal order."""

    order: builtins.list[str]
    since: str
    until: str
    tags: builtins.list[str]
    topic: str
    subject: str


def _apply_filter(name: str, options: EntrySearchOptions, entries: builtins.list[ParsedEntry]) -> builtins.list[ParsedEntry]:
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
    The native implementation still owns slugging, merging and serialization.

    Two shapes, one class:

    * ``entry_files=True`` (the **journal**): a ``<start_entry>`` is server-stamped
      (UTC ``<created_at>``) and becomes ONE file under ``<topic>/<stamp>-<subject>.md``.
    * ``entry_files=False`` (**long-term memory**, learned skills): content goes to the
      native ``add`` unchanged, so an entry headed ``# Topic | Subject`` slug-merges into
      that subject's file, newest block last (corrections resolve by recency).

    Both shapes search journal entries with the nested ``EntrySearchOptions`` filters and
    publish that search as the store-native ``search_memories`` tool via :meth:`get_tools`
    (the ``MemoryManager`` registers it alongside ``search_memory``/``add_memory``).
    """

    def __init__(self, *, lock_key: str, storage: Storage, name: str = LONG_TERM_STORE_NAME,
                 extraction: Any = False, entry_files: bool = False, description: str | None = None,
                 writable: bool = True, search_tool: bool = False) -> None:
        kwargs: dict[str, Any] = {"name": name, "storage": storage, "extraction": extraction, "writable": writable}
        if description is not None:
            kwargs["description"] = description
        super().__init__(**kwargs)
        self.entry_files = entry_files
        #: Publish ``search_memories`` from this store (exactly one store per manager: the SDK
        #: registers every store's tools by name). ``search_peers`` are the sibling stores that
        #: tool searches as well, set by :func:`create_memory_config`.
        self.search_tool = search_tool
        self.search_peers: builtins.list[SerializedFileMemoryStore] = []
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
                if self.entry_files:
                    stamped = stamp_entry(content)
                    entry = parse_entry(stamped)
                    await self._storage.write(entry.key, stamped.encode("utf-8"))
                    return entry.key
                if not content.lstrip().startswith("#"):
                    # Long-term: the native add slug-merges on the first line, so a bare entry
                    # gets its ``# Topic | Subject`` heading and lands in that subject's file.
                    content = f"{parse_entry(content).heading}\n{content.strip()}"
            return await super().add(content, metadata)
        finally:
            self._process_lock.release()

    async def search(self, query: str, options: SearchOptions | None = None) -> builtins.list[MemoryEntry]:
        """Keyword search, with agent-ordered nested filters over journal entries.

        Without filter options this is the native search. With any of
        ``since``/``until``/``tags``/``topic``/``subject`` the journal entries are
        narrowed in the ``order`` given (every named filter still applies; the order
        is the agent's chosen traversal and is echoed in ``metadata.filter_order``),
        then ranked by the query when one is given.
        """
        opts: EntrySearchOptions = dict(options or {})  # type: ignore[assignment]
        order = builtins.list(opts.get("order") or [])
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

    async def _entries(self) -> builtins.list[tuple[str, ParsedEntry]]:
        """Every parsed entry with the key of the file it lives in (several per merged file)."""
        found: builtins.list[tuple[str, ParsedEntry]] = []
        for key in await self._storage.list(""):
            if not key.endswith(".md"):
                continue
            raw = await self._storage.read(key)
            text = raw.decode("utf-8", errors="replace") if raw else ""
            if is_entry(text):
                found.extend((key, entry) for entry in parse_entries(text))
        return found

    def get_tools(self) -> builtins.list[AgentTool]:
        """The store-native ``search_memories`` tool (``MemoryStore.get_tools`` extension point),
        from the one store configured with ``search_tool=True``; it covers ``search_peers`` too."""
        if not self.search_tool:
            return []
        return [create_search_memories_tool([self, *self.search_peers])]


def create_search_memories_tool(stores: Sequence[SerializedFileMemoryStore]) -> AgentTool:
    """``search_memories`` over the given stores: nested, agent-ordered filtering over journal and
    consolidated memories.

    Complements the native ``search_memory`` (plain keyword search). ``order`` is the
    hierarchy the agent chooses at call time, e.g. ``["since", "tags", "topic"]``; it is
    not hardwired and every listed filter still applies. Published by the store's
    :meth:`SerializedFileMemoryStore.get_tools`, never hand-wired into a catalog.
    """
    targets = builtins.list(stores)

    @tool(name="search_memories")
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
        for store in targets:
            results.extend({"content": entry.content, "store": store.name, **(entry.metadata or {})}
                           for entry in await store.search(query, options))
        results.sort(key=lambda item: str(item.get("created_at", "")), reverse=True)
        return results[:max_results]

    return search_memories


def create_memory_config(user_id: str, *, extraction: bool = True) -> MemoryManagerConfig:
    """Fresh native manager configuration sharing memory across a user's sessions.

    The SDK's own memory wiring (strands_harness ``resolve_memory``) over two stores:

    * ``panel-memory`` (long-term): ``extraction`` = the dreaming pass, a native
      ``ExtractionConfig(ModelExtractor(DREAM_PROMPT), filter=exclude [])`` on
      ``agent.aux_model`` with the SDK's default trigger (every 5 turns), consolidating
      journal entries into ``# Topic | Subject`` subject files (newest last).
    * ``journal``: the only ``add_memory`` target (``wait_for_writes=True``); each
      entry is server-stamped and filed as its own file.

    ``MemoryInjectionConfig(trigger="everyTurn")`` injects relevant memories from both
    before every model call of the tool loop; ``search_memory`` and the stores'
    ``search_memories`` are registered. ``extraction=False`` builds read-only-consumer
    stores (e.g. Live) that never spawn extraction without a flush owner.
    """
    from agent.api.core.dreaming import dream_extraction

    scope = _user_scope(user_id)
    storage = _ScopedStorage(get_panel_storage(), scope)
    long_term = SerializedFileMemoryStore(
        lock_key=f"{scope}:{LONG_TERM_STORE_NAME}", storage=storage, name=LONG_TERM_STORE_NAME,
        description="Consolidated long-term memory: one file per topic/subject, newest facts last.",
    )
    if extraction:
        # The dreaming extractor lists this store's own subject files as the existing topics.
        long_term.extraction = dream_extraction(long_term._storage)
    journal = SerializedFileMemoryStore(
        lock_key=f"{scope}:{JOURNAL_STORE_NAME}", storage=storage, name=JOURNAL_STORE_NAME,
        entry_files=True, search_tool=True,
        description="The user's journal: every add_memory entry, server-stamped, one file per entry.",
    )
    journal.search_peers = [long_term]
    return MemoryManagerConfig(
        stores=[long_term, journal],
        search_tool_config=True,
        add_tool_config=MemoryAddToolConfig(stores=[JOURNAL_STORE_NAME], wait_for_writes=True),
        injection=MemoryInjectionConfig(trigger="everyTurn"),
    )
