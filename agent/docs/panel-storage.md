# Panel native storage and memory

## Dependencies

The application requirements and project venv pin:

```text
strands-agents==1.56.0
huggingface_hub==1.20.1
```

The project venv initially contained `strands-agents==1.51.0`. That
version has `Storage.write/read/delete/list` and `SnapshotSessionManager`, but
**has neither `Storage.search` nor `FileMemoryStore`**. Its `TestMemoryStore`
does not accept a storage backend. The implementation intentionally requires
1.56.0 rather than replacing native memory or patching installed SDK source.

`huggingface_hub==1.20.1` is already installed and was verified against its
public `HfApi` signatures and implementation. Buckets require `hf-xet`, pulled
in by the Hub package; the installed version inspected here is 1.5.1.

Run the focused tests against the installed, unmodified SDK:

```bash
./venv/bin/python -m pytest agent/tests/test_panel_storage.py -q
```

## Parent-facing APIs

```python
from strands import Agent
from strands.session import SnapshotSessionManager
from agent.api.core.panel_storage import (
    create_memory_config,
    get_panel_storage,
    get_user_session_storage,
)

storage = get_panel_storage()  # Process singleton, native Storage protocol.
session_manager = SnapshotSessionManager(
    session_id,
    storage=get_user_session_storage(user_id),
)
agent = Agent(
    model=model,  # An explicit configured provider instance.
    agent_id="panel",
    session_manager=session_manager,
    memory_manager=create_memory_config(user_id),
    callback_handler=None,
)
async for event in agent.stream_async(message):
    ...
```

`session_manager` and `memory_manager` can also be passed as constructor
overrides to `config_to_agent`; they are not agent-config JSON fields.

`create_memory_config(user_id)` is synchronous, returns native
`MemoryManagerConfig`, and constructs **two** fresh `SerializedFileMemoryStore`s
(a small subclass of native `FileMemoryStore`) with explicit `storage=`:

* `panel-memory` — long-term memory. Its `extraction` is the dreaming pass
  (`agent/api/core/dreaming.py`): a native `ExtractionConfig` whose
  `DreamExtractor` renders journal `add_memory` calls into the transcript
  (`MemoryMessageFilter(exclude=[])`), lists the existing `# Topic | Subject`
  headings and delegates to the SDK `ModelExtractor` on `agent.aux_model`
  (default trigger every 5 turns; `memory_manager.flush()` at close/shutdown).
  Entries headed `# Topic | Subject` go through native `add`, which slug-merges
  them into one subject file with the newest block last.
* `journal` (`entry_files=True`) — the only `add_memory` target
  (`MemoryAddToolConfig(stores=["journal"], wait_for_writes=True)`). A
  `<start_entry>` is server-stamped (UTC `<created_at>`, replacing the model's
  value) and written as its own object `<topic>/<stamp>-<subject>.md`. The
  store implements `MemoryStore.get_tools()` and publishes `search_memories`
  (nested filters `order/since/until/tags/topic/subject` over journal and
  long-term memory), which the `MemoryManager` registers beside `search_memory`.

`MemoryInjectionConfig(trigger="everyTurn")` injects from both stores before every
model call. `extraction=False` builds the same stores for a consumer without a
flush owner (Live, `recall`). SDK code retains ownership of markdown topic slugs,
append formatting, extraction scheduling, retrieval, tools, injection, and
session snapshots.

User identities are exact UTF-8 strings hashed with SHA-256 for path safety.
They must be nonblank. A trusted parent must supply the authenticated user's ID.
Different slash-containing or Unicode IDs are not merged by slug sanitization.

Storage layout:

```text
panel/users/<sha256(user_id)>/memory/panel-memory/<topic>-<subject>.md      (dreamed, merged)
panel/users/<sha256(user_id)>/memory/journal/<topic>/<stamp>-<subject>.md   (one per add_memory entry)
panel/users/<sha256(user_id)>/session/<session_id>/scopes/agent/<agent_id>/snapshots/...
```

Memory survives new agent and session instances for the same user. Sessions are
scoped separately by user, session ID and agent ID. Deleting a native session
does not delete memory. Use `get_user_session_storage(user_id)` rather than raw
`get_panel_storage()` when constructing a session manager. Scoped memory search
lists and reads only its namespace; it does not scan other users and then filter.

## Configuration and lifecycle

* `PANEL_STORAGE=memory` (default): native `InMemoryStorage`, shared by the whole
  process, ephemeral across process restarts.
* `PANEL_STORAGE=huggingface` (production authority): `HF_BUCKET_ID=namespace/bucket-name`
  and `HF_TOKEN` are **required** (`ValueError` otherwise; never a memory fallback).
  The factory calls `ensure_bucket()` — `HfApi.create_bucket(private=True, exist_ok=True)`
  — once per process; a creation/auth failure is a `StorageError` and the singleton
  stays unset. `main.py` warms the factory in the lifespan so a bad configuration
  fails at boot.
* Invalid mode or bucket ID fails explicitly. No fallback to memory on a remote
  error.
* Environment configuration is consumed lazily on the first successful factory
  call. Restart the process to change configuration. Importing this module does
  not construct a client, load `.env`, or read credential files.

Native `MemoryManager.init_agent` is async, but `Agent(...)` initializes it
synchronously through the SDK's thread/event-loop bridge. No caller-side
`await initialize()` is needed; construction works inside a running loop. Agent
construction can block while plugins or session restore perform I/O, so an async
endpoint may offload its existing construction function with `asyncio.to_thread`.
Continue consuming native `stream_async` on the endpoint loop.

This store needs no separate async initialization. Extraction is enabled, so the
SDK lifecycle applies: `PanelRuntimeManager` awaits `agent.memory_manager.flush()`
at the async shutdown boundary to persist pending extraction. Awaited add-tool writes already finish before
returning; `flush()` does not drain fire-and-forget add-tool writes.

## HF contract and error behavior

`HuggingFaceBucketStorage` implements async `write/read/delete/list/search`:

* `batch_bucket_files(add=[(bytes, key)])` preserves binary data exactly.
* `download_bucket_files(..., raise_on_missing_files=True)` downloads to a fresh
  temporary path, which is read as bytes and removed in the same worker.
* `get_bucket_paths_info` checks deletion existence; missing files are omitted.
  Deletion uses `batch_bucket_files(delete=[key])`.
* `list_bucket_tree(..., recursive=True)` returns files only, sorted by full key.
  Iterator creation **and exhaustion** happen in the worker, including pagination.
* Search delegates to the configured `search_strategy` (the SDK `SearchStrategy`
  Protocol, like `InMemoryStorage(search_strategy=)`); `write` calls
  `strategy.index` after a successful upload. The default `KeywordSearchStrategy`
  returns native `StorageSearchResult` values ranked by token overlap. Equal scores
  retain lexicographic key order from `list`. It is keyword search, with a full
  scan of the scoped namespace, not vector search.
* Reads are cached (bounded LRU, `cache_bytes`, default 64 MiB) by the bucket's
  content hash: `list` records each `BucketFile.xet_hash`; a later `read` of a key
  whose listed hash matches the cached entry is served from memory. Own `write`
  and `delete` invalidate immediately; a foreign writer is detected on the next
  listing because its hash changes. `cache_bytes=0` disables the cache.

Only `EntryNotFoundError` maps to `None` on read or a no-op on delete. Empty
bytes remain `b""`. Generic HTTP 404 (including missing bucket), authentication,
rate-limit, transfer, pagination and local filesystem failures become
`StorageError` with their cause preserved. Storage and FileMemoryStore search
propagate failures. Native **MemoryManager.search** has a separate fail-open
policy: it logs per-store failures and returns successful results; callers who
need strict diagnostics should use the store or storage directly.

All synchronous HF calls and temporary-file I/O run via `asyncio.to_thread`.
Cancellation cannot stop those workers: the wrapper waits for the worker before
propagating cancellation, preventing a cancelled memory upload from continuing
after another append acquires its lock. Network timeouts remain the Hub client's
responsibility.

## Concurrency boundary

Native `FileMemoryStore.add` is a read/append/write operation. Its instance-local
async lock does not protect separate agents writing the same user's topic.
`SerializedFileMemoryStore.add` wraps the entire native operation in a shared,
per-user threading lock, acquired nonblockingly with async waits. This works
across store instances, threads and event loops without blocking the event loop
or occupying the worker pool with lock waiters. Lock references are weakly held
by the registry, so unused user locks can be collected.

**Run a single backend writer process.** Every writer of a memory namespace must
use this factory. These locks do not coordinate multiple server workers, machines,
or external Bucket writers. HF batch operations provide no compare-and-swap here;
concurrent processes can lose an append. The same-session snapshot overwrite
policy remains native; the parent must serialize simultaneous turns for the same
user/session if it requires ordered conversation updates.

## Verification coverage

`agent/tests/test_panel_storage.py` exercises real native in-memory storage,
FileMemoryStore, MemoryManager and snapshot save/restore, plus a
signature-compatible fake HF client. Coverage includes exact binary/empty bytes,
overwrite and missing keys, sorted listings and keyword scores, search-strategy
indexing/delegation, xet-hash cache hits/invalidation/LRU bounds, token and bucket
creation requirements, lazy iteration in worker threads, HTTP and local download
failures, user isolation (including read scope), cross-session recall, concurrent
append from multiple loops, write failure recovery, repeated cancellation during a
blocked upload, server-stamped journal files, long-term subject merging (newest
last), `search_memories` via `get_tools`, and journal-only `add_memory`.
`agent/tests/test_dreaming.py` runs the dreaming extraction on a scripted
`aux_model`; `agent/tests/test_memory_agent.py` covers the `recall` subagent. No
live HF/model requests or credentials are used.
