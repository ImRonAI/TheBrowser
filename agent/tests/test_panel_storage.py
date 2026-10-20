"""Native SDK integration tests; no credentials, model calls or HF network I/O."""

import asyncio
import hashlib
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import Mock

import httpx
import pytest
from huggingface_hub import BucketFile, BucketFolder, HfApi
from huggingface_hub.errors import EntryNotFoundError, HfHubHTTPError
from strands import Agent
from strands.models import Model
from strands.session import SnapshotSessionManager
from strands.storage import InMemoryStorage, Storage
from strands.types.exceptions import StorageError
from strands.vended_memory_stores.file_memory_store import FileMemoryStore

from agent.api.core import panel_storage as panel


class FakeHF:
    """Match public HF signatures, including lazily executed pagination."""

    def __init__(self):
        self.data = {}
        self.calls = []
        self.fail = {}
        self.skip_download = False
        self.buckets = []

    def check(self, operation, token):
        self.calls.append((operation, threading.get_ident(), token))
        if operation in self.fail:
            raise self.fail[operation]

    def file(self, key):
        # Content-addressed like the real bucket: the hash changes with the bytes.
        digest = hashlib.sha256(self.data[key]).hexdigest()
        return BucketFile(type="file", path=key, size=len(self.data[key]), xetHash=digest)

    def create_bucket(self, bucket_id, *, private=None, exist_ok=False, token=None):
        self.check("create-bucket", token)
        assert private is True and exist_ok is True
        self.buckets.append(bucket_id)

    def batch_bucket_files(self, bucket_id, *, add=None, delete=None, token=None):
        self.check("write" if add else "delete", token)
        for data, key in add or []:
            self.data[key] = data
        for key in delete or []:
            self.data.pop(key, None)

    def download_bucket_files(self, bucket_id, files, *, raise_on_missing_files=False, token=None):
        self.check("read", token)
        assert raise_on_missing_files is True
        for key, path in files:
            if key not in self.data:
                raise EntryNotFoundError(key)
            if not self.skip_download:
                Path(path).write_bytes(self.data[key])

    def get_bucket_paths_info(self, bucket_id, paths, *, token=None):
        self.check("paths-call", token)

        def pages():
            self.check("paths-iterate", token)
            for key in paths:
                if key in self.data:
                    yield self.file(key)

        return pages()

    def list_bucket_tree(self, bucket_id, prefix=None, *, recursive=None, token=None):
        self.check("list-call", token)
        assert recursive is True

        def pages():
            yield BucketFolder(type="directory", path="folder")
            for key in reversed(sorted(self.data)):
                if not prefix or key.startswith(prefix):
                    yield self.file(key)
            self.check("list-iterate", token)  # Can fail after yielding results.

        return pages()


@pytest.fixture(autouse=True)
def isolated_factory(monkeypatch):
    monkeypatch.setattr(panel, "_storage", None)
    for key in ("PANEL_STORAGE", "HF_BUCKET_ID", "HF_TOKEN"):
        monkeypatch.delenv(key, raising=False)


@pytest.fixture
def hf():
    client = FakeHF()
    return panel.HuggingFaceBucketStorage("test/bucket", client=client), client


def test_installed_hf_public_api_contract():
    import inspect

    assert "raise_on_missing_files" in inspect.signature(HfApi.download_bucket_files).parameters
    assert "recursive" in inspect.signature(HfApi.list_bucket_tree).parameters
    assert "add" in inspect.signature(HfApi.batch_bucket_files).parameters
    assert "paths" in inspect.signature(HfApi.get_bucket_paths_info).parameters


@pytest.mark.parametrize("backend", ["memory", "huggingface"])
def test_storage_roundtrip_search_and_missing(backend, hf):
    storage = InMemoryStorage() if backend == "memory" else hf[0]

    async def run():
        assert isinstance(storage, Storage)
        assert await storage.read("absent") is None
        await storage.delete("absent")
        payload = bytes(range(256)) + b"\x00\xff\r\n"
        await storage.write("raw", payload)
        assert await storage.read("raw") == payload
        await storage.write("raw", b"")
        assert await storage.read("raw") == b""
        await storage.write("notes/z.md", b"tea")
        await storage.write("notes/a.md", b"tea coffee")
        await storage.write("notes/b.md", b"coffee")
        assert await storage.list("notes/") == ["notes/a.md", "notes/b.md", "notes/z.md"]
        assert [r.key for r in await storage.search("tea coffee")] == [
            "notes/a.md", "notes/b.md", "notes/z.md",
        ]
        assert (await storage.search("tea coffee"))[0].data == b"tea coffee"
        assert await storage.search("!!!") == []
        await storage.delete("raw")
        await storage.delete("raw")
        assert await storage.read("raw") is None

    main_thread = threading.get_ident()
    asyncio.run(run())
    if backend == "huggingface":
        assert all(thread != main_thread and token is False for _, thread, token in hf[1].calls)


@pytest.mark.parametrize("operation", ["write", "read", "delete", "paths-iterate", "list-iterate", "search"])
@pytest.mark.parametrize("status", [401, 403, 404, 429, 500])
def test_hf_failures_are_not_missing_or_partial_results(hf, operation, status):
    storage, client = hf
    client.data["key"] = b"coffee"
    error = HfHubHTTPError("synthetic failure", response=httpx.Response(
        status, request=httpx.Request("GET", "https://example.invalid/bucket"),
    ))
    client.fail["read" if operation == "search" else operation] = error

    async def run():
        with pytest.raises(StorageError) as caught:
            if operation == "write":
                await storage.write("key", b"next")
            elif operation in ("delete", "paths-iterate"):
                await storage.delete("key")
            elif operation == "list-iterate":
                await storage.list("")
            elif operation == "search":
                await storage.search("coffee")
            else:
                await storage.read("key")
        assert caught.value.__cause__ is error

    asyncio.run(run())


def test_hf_local_download_failure_is_not_absence(hf):
    storage, client = hf
    client.data["key"] = b"coffee"
    client.skip_download = True
    with pytest.raises(StorageError):
        asyncio.run(storage.read("key"))


@pytest.mark.parametrize("key", ["", "/", "../other", "a/../b", "a/./b", "a\\b", "a\x00b"])
def test_invalid_hf_keys(hf, key):
    with pytest.raises(StorageError):
        asyncio.run(hf[0].write(key, b"data"))
    assert hf[1].calls == []


def test_singleton_and_environment(monkeypatch):
    with ThreadPoolExecutor(max_workers=8) as pool:
        backends = list(pool.map(lambda _: panel.get_panel_storage(), range(32)))
    assert isinstance(backends[0], InMemoryStorage)
    assert all(backend is backends[0] for backend in backends)
    monkeypatch.setenv("PANEL_STORAGE", "huggingface")
    assert panel.get_panel_storage() is backends[0]
    monkeypatch.setattr(panel, "_storage", None)
    # HF is the authority: no token -> refuse (never an in-memory fallback).
    with pytest.raises(ValueError, match="HF_TOKEN"):
        panel.get_panel_storage()
    assert panel._storage is None
    monkeypatch.setenv("HF_TOKEN", "synthetic-test-token")
    with pytest.raises(ValueError, match="HF_BUCKET_ID"):
        panel.get_panel_storage()
    monkeypatch.setenv("HF_BUCKET_ID", "test/bucket")
    fake = FakeHF()
    client_factory = Mock(return_value=fake)
    monkeypatch.setattr("huggingface_hub.HfApi", client_factory)
    storage = panel.get_panel_storage()
    assert isinstance(storage, panel.HuggingFaceBucketStorage)
    client_factory.assert_called_once_with(token="synthetic-test-token")
    # create_bucket(private, exist_ok) exactly once per process, on first use.
    assert fake.buckets == ["test/bucket"]
    assert panel.get_panel_storage() is storage
    assert [c for c in fake.calls if c[0] == "create-bucket"] == [("create-bucket", threading.get_ident(), "synthetic-test-token")]
    monkeypatch.setattr(panel, "_storage", None)
    monkeypatch.setenv("PANEL_STORAGE", "s3")
    with pytest.raises(ValueError, match="PANEL_STORAGE"):
        panel.get_panel_storage()


def test_bucket_creation_failure_is_a_storage_error_not_a_fallback(monkeypatch):
    monkeypatch.setenv("PANEL_STORAGE", "huggingface")
    monkeypatch.setenv("HF_BUCKET_ID", "test/bucket")
    monkeypatch.setenv("HF_TOKEN", "synthetic-test-token")
    fake = FakeHF()
    fake.fail["create-bucket"] = HfHubHTTPError("forbidden", response=httpx.Response(
        403, request=httpx.Request("POST", "https://example.invalid/bucket")))
    monkeypatch.setattr("huggingface_hub.HfApi", Mock(return_value=fake))
    with pytest.raises(StorageError) as caught:
        panel.get_panel_storage()
    assert caught.value.__cause__ is fake.fail["create-bucket"]
    assert panel._storage is None


def test_hf_search_strategy_is_indexed_on_write_and_consulted_on_search(hf):
    """``search_strategy`` works like ``InMemoryStorage(search_strategy=)``: ``write`` indexes,
    ``search`` delegates; the default is the SDK's ``KeywordSearchStrategy``."""
    from strands.storage.search import KeywordSearchStrategy

    _, client = hf
    assert isinstance(panel.HuggingFaceBucketStorage("t/b", client=client)._search_strategy, KeywordSearchStrategy)

    class Recording:
        requires_host_fs = False

        def __init__(self):
            self.indexed, self.queries = [], []

        async def index(self, storage, key, data, **kwargs):
            self.indexed.append((key, bytes(data)))

        async def search(self, storage, query, **kwargs):
            self.queries.append(query)
            return [panel.StorageSearchResult(key="notes/a.md", score=42.0)]

    strategy = Recording()
    storage = panel.HuggingFaceBucketStorage("test/bucket", client=client, search_strategy=strategy)

    async def run():
        await storage.write("notes/a.md", b"tea")
        results = await storage.search("tea")
        assert [r.key for r in results] == ["notes/a.md"] and results[0].score == 42.0
        client.fail["write"] = OSError("transfer failed")
        with pytest.raises(StorageError):
            await storage.write("notes/b.md", b"coffee")

    asyncio.run(run())
    assert strategy.indexed == [("notes/a.md", b"tea")]  # a failed upload is never indexed
    assert strategy.queries == ["tea"]


def test_hf_xet_hash_read_cache_hits_and_invalidates(hf):
    """Reads are cached by the content hash from the latest listing; own writes/deletes and a
    changed hash (foreign writer) invalidate; a zero-byte cache never caches."""
    storage, client = hf

    def downloads():
        return sum(1 for op, _, _ in client.calls if op == "read")

    async def run():
        await storage.write("notes/a.md", b"tea")
        assert await storage.read("notes/a.md") == b"tea"
        assert downloads() == 1
        # Without a listing there is no hash to trust: still a download.
        assert await storage.read("notes/a.md") == b"tea"
        assert downloads() == 2
        await storage.list("")
        assert await storage.read("notes/a.md") == b"tea"  # downloads and caches under the listed hash
        assert downloads() == 3
        assert await storage.read("notes/a.md") == b"tea"  # served from cache
        assert await storage.read("notes/a.md") == b"tea"
        assert downloads() == 3
        # Own write invalidates immediately, before any listing.
        await storage.write("notes/a.md", b"tea coffee")
        assert await storage.read("notes/a.md") == b"tea coffee"
        assert downloads() == 4
        await storage.list("notes/")
        assert await storage.read("notes/a.md") == b"tea coffee"
        assert downloads() == 5
        assert await storage.read("notes/a.md") == b"tea coffee"
        assert downloads() == 5
        # A foreign writer changes the bytes behind our back: the next listing reports a new
        # hash, so the stale entry is dropped and re-downloaded.
        client.data["notes/a.md"] = b"chai"
        assert await storage.read("notes/a.md") == b"tea coffee"  # listing not refreshed yet
        await storage.list("")
        assert await storage.read("notes/a.md") == b"chai"
        assert downloads() == 6
        # Own delete invalidates.
        await storage.delete("notes/a.md")
        assert await storage.read("notes/a.md") is None
        # Search goes through the cache too (keyword strategy reads via storage.read).
        await storage.write("notes/b.md", b"coffee beans")
        await storage.list("")
        before = downloads()
        await storage.search("coffee")
        await storage.search("beans")
        assert downloads() == before + 1

    asyncio.run(run())

    uncached = panel.HuggingFaceBucketStorage("test/bucket", client=client, cache_bytes=0)

    async def no_cache():
        await uncached.list("")
        start = downloads()
        await uncached.read("notes/b.md")
        await uncached.read("notes/b.md")
        assert downloads() == start + 2

    asyncio.run(no_cache())
    with pytest.raises(ValueError):
        panel.HuggingFaceBucketStorage("test/bucket", client=client, cache_bytes=-1)


def test_hf_cache_is_bounded_lru(hf):
    storage, client = hf
    storage._cache_bytes = 8

    async def run():
        for key, payload in (("a", b"1234"), ("b", b"5678"), ("c", b"90ab")):
            await storage.write(key, payload)
        await storage.list("")
        await storage.read("a")
        await storage.read("b")
        assert sorted(storage._cache) == ["a", "b"]
        await storage.read("c")  # evicts the least recently used (a)
        assert sorted(storage._cache) == ["b", "c"]
        await storage.write("big", b"x" * 9)  # larger than the whole cache: never cached
        await storage.list("")
        await storage.read("big")
        assert "big" not in storage._cache

    asyncio.run(run())


def test_memory_user_isolation_and_native_append(monkeypatch):
    class ObservedStorage(InMemoryStorage):
        reads = []

        async def read(self, key):
            self.reads.append(key)
            await asyncio.sleep(0)
            return await super().read(key)

    backend = ObservedStorage()
    monkeypatch.setattr(panel, "_storage", backend)

    async def run():
        first = panel.create_memory_config("a/b")["stores"][0]
        second = panel.create_memory_config("a/b")["stores"][0]
        other = panel.create_memory_config("a_b")["stores"][0]
        assert isinstance(first, FileMemoryStore)
        await other.add("# Preferences\nOTHER coffee")
        await asyncio.gather(*(
            (first if i % 2 else second).add(f"# Preferences\nfact-{i} coffee") for i in range(40)
        ))
        backend.reads.clear()
        entries = await second.search("coffee")
        assert len(entries) == 1
        assert "OTHER" not in entries[0].content
        assert all(f"fact-{i} coffee" in entries[0].content for i in range(40))
        assert all(panel._user_scope("a/b") in key for key in backend.reads)
        assert "OTHER" in (await other.search("coffee"))[0].content
        assert await second.search("zzzz") == []
        with pytest.raises(ValueError):
            await second.search("coffee", {"max_search_results": 0})

    asyncio.run(run())


def test_memory_writes_across_threads_and_event_loops(monkeypatch):
    class YieldingStorage(InMemoryStorage):
        async def read(self, key):
            data = await super().read(key)
            await asyncio.sleep(0.003)
            return data

    monkeypatch.setattr(panel, "_storage", YieldingStorage())
    stores = [panel.create_memory_config("same-user")["stores"][0] for _ in range(12)]
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(lambda i: asyncio.run(stores[i].add(f"# Topic\nline-{i}")), range(12)))
    result = asyncio.run(stores[0].search("Topic"))[0].content
    assert all(f"line-{i}" in result for i in range(12))


def test_memory_native_hf_roundtrip_and_write_failure_unlocks(hf, monkeypatch):
    storage, client = hf
    monkeypatch.setattr(panel, "_storage", storage)

    async def run():
        store = panel.create_memory_config("user")["stores"][0]
        client.fail["write"] = OSError("transfer failed")
        with pytest.raises(StorageError):
            await store.add("# Theme\ndark mode")
        client.fail.clear()
        await asyncio.wait_for(store.add("# Theme\ndark mode"), timeout=2)
        restored = panel.create_memory_config("user")["stores"][0]
        assert "dark mode" in (await restored.search("dark"))[0].content
        # The own write below invalidates the cached object, so the next read must download.
        await restored.add("# Theme\nhigh contrast")
        client.fail["read"] = OSError("read failed")
        with pytest.raises(StorageError):
            await restored.search("dark")

    asyncio.run(run())


def test_cancelled_upload_finishes_before_next_memory_append(hf, monkeypatch):
    storage, client = hf
    monkeypatch.setattr(panel, "_storage", storage)
    entered, release = threading.Event(), threading.Event()
    original = client.batch_bucket_files

    def blocked(*args, **kwargs):
        entered.set()
        assert release.wait(3)
        return original(*args, **kwargs)

    client.batch_bucket_files = blocked

    async def run():
        first, second = [panel.create_memory_config("u")["stores"][0] for _ in range(2)]
        task = asyncio.create_task(first.add("# Topic\nfirst fact"))
        try:
            assert await asyncio.to_thread(entered.wait, 2)
            task.cancel()
            await asyncio.sleep(0)
            task.cancel()  # Repeated cancellation must not release early either.
            next_task = asyncio.create_task(second.add("# Topic\nsecond fact"))
            await asyncio.sleep(0.02)
            assert not task.done() and not next_task.done()
        finally:
            release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        await next_task
        text = (await first.search("Topic"))[0].content
        assert "first fact" in text and "second fact" in text

    asyncio.run(run())


def test_agent_memory_init_and_snapshot_session_isolation():
    def agent(user, session):
        model = Mock(spec=Model)
        model.get_config.return_value = {}
        model.stateful = False
        manager = SnapshotSessionManager(session, storage=panel.get_user_session_storage(user))
        return Agent(model=model, agent_id="panel", callback_handler=None,
                     session_manager=manager, memory_manager=panel.create_memory_config(user)), manager

    async def run():
        # Constructor runs inside an active loop: SDK bridges async memory init.
        first, manager = agent("u1", "s1")
        assert {tool.tool_name for tool in first.memory_manager.tools} >= {"search_memory", "add_memory"}
        await first.memory_manager.add("# Preference\ncoffee")
        first.messages.append({"role": "user", "content": [{"text": "private session"}]})
        await manager.save_snapshot(first, is_latest=True)
        restored, _ = agent("u1", "s1")
        other_session, _ = agent("u1", "s2")
        other_user, _ = agent("u2", "s1")
        assert restored.messages == first.messages
        assert other_session.messages == other_user.messages == []
        assert await other_session.memory_manager.search("coffee")
        assert await other_user.memory_manager.search("coffee") == []
        await manager.delete_session()
        assert await restored.memory_manager.search("coffee")
        keys = await panel.get_panel_storage().list("")
        assert any("/memory/panel-memory/" in key for key in keys)
        assert not any("/session/s1/" in key for key in keys)

    asyncio.run(run())


@pytest.mark.parametrize("user_id", ["", "   ", None])
def test_user_id_required(user_id):
    with pytest.raises(ValueError, match="user_id"):
        panel.create_memory_config(user_id)


ENTRY = """<start_entry>
<topic_name>{topic}<topic_name/>
<subject>{subject}<subject/>
<created_at>{created}<created_at/>
<tags>{tags}</tags>
{body}
<end_entry/>"""


def _entry(topic, subject, created, tags, body):
    return ENTRY.format(topic=topic, subject=subject, created=created, tags=tags, body=body)


def _journal(config):
    return next(store for store in config["stores"] if store.name == panel.JOURNAL_STORE_NAME)


def _long_term(config):
    return next(store for store in config["stores"] if store.name == panel.LONG_TERM_STORE_NAME)


def test_journal_entries_become_per_topic_files(monkeypatch):
    """Journal entries are one file each under <topic>/, named by the SERVER timestamp and subject
    (the model's created_at is a placeholder); plain content keeps the SDK's slug-and-append."""
    backend = InMemoryStorage()
    monkeypatch.setattr(panel, "_storage", backend)
    monkeypatch.setattr(panel, "_server_time", lambda: "2026-10-01T14:03:09")

    async def run():
        store = _journal(panel.create_memory_config("u"))
        key = await store.add(_entry("ToDo's", "Mom's birthday dinner plan", "1999-01-01T00:00:00",
                                     "todo, family, food, birthday, schedule, reminder, deadline, home, decision, goal",
                                     "Book Thai place for Friday; invite Aunt May."))
        assert key == "todo-s/20261001T140309-mom-s-birthday-dinner-plan.md"
        plain = await store.add("# Preferences\nlikes coffee")
        assert plain == "preferences.md"
        text = (await store._storage.read(key)).decode()
        assert text.startswith("<start_entry>") and text.rstrip().endswith("<end_entry/>")
        parsed = panel.parse_entry(text)
        assert parsed.topic == "ToDo's" and parsed.subject == "Mom's birthday dinner plan"
        assert parsed.created_at == "2026-10-01T14:03:09"  # server-stamped, not the model's value
        assert "1999" not in text
        assert parsed.tags == ["todo", "family", "food", "birthday", "schedule", "reminder", "deadline", "home", "decision", "goal"]
        # An entry without a created_at line at all is stamped too.
        bare = ENTRY.replace("<created_at>{created}<created_at/>\n", "").format(
            topic="Feedback", subject="Shorter answers please", created="", tags="", body="Be brief.")
        bare_key = await store.add(bare)
        assert panel.parse_entry((await store._storage.read(bare_key)).decode()).created_at == "2026-10-01T14:03:09"

    asyncio.run(run())


def test_long_term_entries_merge_by_subject_heading_newest_last(monkeypatch):
    """The long-term store files a ``# Topic | Subject`` entry through the native slug-merge: the
    second entry about the same subject is appended UNDER the first (recency = lowest block)."""
    monkeypatch.setattr(panel, "_storage", InMemoryStorage())

    async def run():
        store = _long_term(panel.create_memory_config("u"))
        first = "# LearnedAboutUser | Prefers Thai food\n" + _entry(
            "LearnedAboutUser", "Prefers Thai food", "2026-09-20T09:00:00", "preference, food", "Loves Thai food.")
        second = "# LearnedAboutUser | Prefers Thai food\n" + _entry(
            "LearnedAboutUser", "Prefers Thai food", "2026-10-02T09:00:00", "preference, food, correction",
            "Now prefers Vietnamese over Thai.")
        key = await store.add(first)
        assert key == "learnedaboutuser-prefers-thai-food.md"
        assert await store.add(second) == key
        text = (await store._storage.read(key)).decode()
        entries = panel.parse_entries(text)
        assert [e.created_at for e in entries] == ["2026-09-20T09:00:00", "2026-10-02T09:00:00"]
        assert text.index("Loves Thai") < text.index("Vietnamese")
        # The long-term store keeps the model's created_at (dreaming carries the journal stamp).
        hits = await store.search("", {"order": ["subject"], "subject": "thai"})
        assert [h.metadata["created_at"] for h in hits] == ["2026-10-02T09:00:00", "2026-09-20T09:00:00"]
        assert all(h.metadata["path"] == key for h in hits)
        # A bare entry (no heading) still lands in its subject file.
        assert await store.add(_entry("LearnedAboutUser", "Prefers Thai food", "2026-10-03T09:00:00",
                                      "food", "Back to Thai.")) == key
        assert len(panel.parse_entries((await store._storage.read(key)).decode())) == 3

    asyncio.run(run())


def test_entry_grammar_is_validated():
    with pytest.raises(ValueError, match="subject"):
        panel.parse_entry(_entry("ToDo's", "One", "2026-10-01T00:00:00", "a, b", "x"))
    with pytest.raises(ValueError, match="subject"):
        panel.parse_entry(_entry("ToDo's", "one two three four five six seven eight nine", "2026-10-01T00:00:00", "a, b", "x"))
    with pytest.raises(ValueError, match="topic"):
        panel.parse_entry(_entry("Random", "Two words", "2026-10-01T00:00:00", "a, b", "x"))
    with pytest.raises(ValueError, match="created_at"):
        panel.parse_entry(_entry("ToDo's", "Two words", "yesterday", "a, b", "x"))
    assert panel.parse_entry(_entry("Feedback", "Two words", "2026-10-01T00:00:00", "", "x")).tags == []


def test_nested_search_filters_in_agent_chosen_order(monkeypatch):
    """The agent nests filters (time → tags → topic → subject) in any order; results are identical,
    the traversal order is honoured and an unknown filter name is rejected."""
    backend = InMemoryStorage()
    monkeypatch.setattr(panel, "_storage", backend)

    stamps = iter(["2026-10-01T14:03:09", "2026-09-20T09:00:00", "2026-10-01T15:00:00"])
    monkeypatch.setattr(panel, "_server_time", lambda: next(stamps))

    async def run():
        store = _journal(panel.create_memory_config("u"))
        await store.add(_entry("ToDo's", "Mom's birthday dinner plan", "x",
                               "todo, family, food, birthday", "Book Thai place for Friday."))
        await store.add(_entry("LearnedAboutUser", "Prefers Thai food", "x",
                               "preference, food, family", "User's mom loves Thai food."))
        await store.add(_entry("Feedback", "Shorter answers please", "x",
                               "feedback, style", "User asked for shorter replies."))

        both = await store.search("Thai", {"order": ["tags", "topic"], "tags": ["food"]})
        assert sorted(e.metadata["topic"] for e in both) == ["LearnedAboutUser", "ToDo's"]
        assert all(e.metadata["subject"] and e.metadata["created_at"] and e.metadata["tags"] for e in both)

        recent = await store.search("", {"order": ["since", "tags"], "since": "2026-10-01T00:00:00", "tags": ["food"]})
        assert [e.metadata["topic"] for e in recent] == ["ToDo's"]
        same = await store.search("", {"order": ["tags", "since"], "since": "2026-10-01T00:00:00", "tags": ["food"]})
        assert [e.metadata["topic"] for e in same] == ["ToDo's"]
        assert recent[0].metadata["filter_order"] == ["since", "tags"] and same[0].metadata["filter_order"] == ["tags", "since"]

        by_subject = await store.search("", {"order": ["topic", "subject"], "topic": "Feedback", "subject": "shorter"})
        assert [e.metadata["subject"] for e in by_subject] == ["Shorter answers please"]
        assert await store.search("", {"order": ["until"], "until": "2026-09-01T00:00:00"}) == []
        with pytest.raises(ValueError, match="order"):
            await store.search("", {"order": ["colour"]})

    asyncio.run(run())


def test_search_memories_is_the_journal_stores_native_tool_over_both_stores(monkeypatch):
    """``search_memories`` is published through ``MemoryStore.get_tools`` (the SDK registers it on
    ``MemoryManager.tools``), exactly once per manager, and searches the journal AND the
    consolidated long-term store with the nested filters."""
    from strands.memory import MemoryManager

    backend = InMemoryStorage()
    monkeypatch.setattr(panel, "_storage", backend)
    monkeypatch.setattr(panel, "_server_time", lambda: "2026-10-01T14:03:09")

    async def run():
        config = panel.create_memory_config("u")
        journal, long_term = _journal(config), _long_term(config)
        await journal.add(_entry("ToDo's", "Mom's birthday dinner plan", "x", "todo, family, food", "Book Thai place."))
        await long_term.add("# LearnedAboutUser | Prefers Thai food\n" + _entry(
            "LearnedAboutUser", "Prefers Thai food", "2026-09-20T09:00:00", "preference, food", "Loves Thai food."))
        assert journal.get_tools()[0].tool_name == "search_memories"
        assert long_term.get_tools() == []
        manager = MemoryManager(**config)
        names = [tool.tool_name for tool in manager.tools]
        assert names.count("search_memories") == 1 and {"search_memory", "add_memory"} <= set(names)
        tool_instance = next(tool for tool in manager.tools if tool.tool_name == "search_memories")
        spec = tool_instance.tool_spec["inputSchema"]["json"]["properties"]
        assert {"query", "order", "since", "until", "tags", "topic", "subject", "max_results"} <= set(spec)
        payload = await tool_instance(query="Thai", order=["tags"], tags=["food"])
        assert [(item["store"], item["subject"]) for item in payload] == [
            ("journal", "Mom's birthday dinner plan"), ("panel-memory", "Prefers Thai food")]
        assert payload[0]["filter_order"] == ["tags"]
        only_todo = await tool_instance(query="Thai", order=["topic", "tags"], topic="ToDo's", tags=["food"])
        assert [item["topic"] for item in only_todo] == ["ToDo's"]

    asyncio.run(run())


def test_add_memory_writes_only_the_journal_store(monkeypatch):
    """The manager's ``add_memory`` targets the journal alone (``MemoryAddToolConfig(stores=["journal"])``,
    awaited); the long-term store is written by extraction only."""
    from strands.memory import MemoryManager

    monkeypatch.setattr(panel, "_storage", InMemoryStorage())
    monkeypatch.setattr(panel, "_server_time", lambda: "2026-10-01T14:03:09")

    async def run():
        config = panel.create_memory_config("u")
        manager = MemoryManager(**config)
        add_memory = next(tool for tool in manager.tools if tool.tool_name == "add_memory")
        outcome = await add_memory(entries=[_entry("Feedback", "Shorter answers please", "x", "", "Be brief.")])
        assert outcome == {"stored": 1}
        journal_keys = await _journal(config)._storage.list("")
        assert journal_keys == ["feedback/20261001T140309-shorter-answers-please.md"]
        assert await _long_term(config)._storage.list("") == []
        hits = await manager.search("brief")
        assert [hit.store_name for hit in hits] == ["journal"]

    asyncio.run(run())


def test_entry_with_native_heading_line_is_still_an_entry(monkeypatch):
    """The dream prompt asks for a ``# Topic | Subject`` heading (the native add_memory slug line);
    the store strips it and still files the entry per topic."""
    monkeypatch.setattr(panel, "_storage", InMemoryStorage())

    monkeypatch.setattr(panel, "_server_time", lambda: "2026-10-01T00:00:01")

    async def run():
        store = _journal(panel.create_memory_config("u"))
        content = "# ToDo's | Two words\n" + _entry("ToDo's", "Two words", "x", "a, b", "body")
        assert panel.is_entry(content)
        key = await store.add(content)
        assert key == "todo-s/20261001T000001-two-words.md"
        assert (await store._storage.read(key)).decode().startswith("<start_entry>")

    asyncio.run(run())



def test_memory_config_is_the_sdk_shape_extraction_and_every_turn_injection(monkeypatch):
    """Same wiring as strands_harness resolve_memory: long-term store with the dreaming
    ``ExtractionConfig`` (ModelExtractor, exclude=[] so journal add_memory calls are seen), a
    journal store that is the only add target, everyTurn injection."""
    from strands.memory import MemoryMessageFilter
    from agent.api.core.dreaming import DreamExtractor

    monkeypatch.setattr(panel, "_storage", InMemoryStorage())
    config = panel.create_memory_config("u")
    assert [store.name for store in config["stores"]] == ["panel-memory", "journal"]
    long_term, journal = config["stores"]
    assert isinstance(long_term.extraction["extractor"], DreamExtractor)
    assert long_term.extraction["filter"] == MemoryMessageFilter(exclude=[])
    assert "trigger" not in long_term.extraction  # SDK default: every 5 turns
    assert not journal.extraction and journal.entry_files and not long_term.entry_files
    assert config["injection"]["trigger"] == "everyTurn"
    assert set(config["injection"]) == {"trigger", "query", "format"}  # anchored to the current request
    assert config["add_tool_config"] == {"stores": ["journal"], "wait_for_writes": True}
    assert not panel.create_memory_config("u", extraction=False)["stores"][0].extraction


def test_native_extraction_distills_the_conversation_on_aux_model(monkeypatch):
    """MemoryManager.flush() runs the SDK extractor on agent.aux_model and the fact lands in the store."""
    from strands.memory import MemoryManager

    monkeypatch.setattr(panel, "_storage", InMemoryStorage())

    class Scripted(Model):
        def __init__(self, text):
            self.text, self.calls = text, 0

        def get_config(self):
            return {"model_id": "scripted"}

        def update_config(self, **kwargs):
            pass

        async def structured_output(self, *args, **kwargs):
            raise NotImplementedError
            yield

        async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
            self.calls += 1
            yield {"messageStart": {"role": "assistant"}}
            yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": self.text}}}
            yield {"contentBlockStop": {"contentBlockIndex": 0}}
            yield {"messageStop": {"stopReason": "end_turn"}}

    main = Scripted("Noted.")
    aux = Scripted('[{"content": "# Preferences\\nUser prefers short answers."}]')
    config = panel.create_memory_config("u")
    agent = Agent(model=main, aux_model=aux, memory_manager=MemoryManager(**config), callback_handler=None)

    async def run():
        await agent.invoke_async("I prefer short answers.")
        await agent.memory_manager.flush()
        return await _long_term(config).search("short answers"), await _journal(config)._storage.list("")

    hits, journal_keys = asyncio.run(run())
    assert aux.calls == 1 and main.calls == 1
    assert hits and "User prefers short answers." in hits[0].content
    assert journal_keys == []  # the journal store receives no extraction


# --- memory injection is anchored to the current request and labelled as context ---------------


def _user(text):
    return {"role": "user", "content": [{"text": text}]}


def _assistant(text):
    return {"role": "assistant", "content": [{"text": text}]}


_TOOL_TURN = {"role": "user", "content": [{"toolResult": {"toolUseId": "t", "status": "success", "content": [{"text": "ok"}]}}]}


def test_injection_query_is_the_users_current_request_on_every_turn():
    """2026-10-15: on tool-result turns the SDK default queried the assistant's last text, which
    pulled a week-old journal ToDo into a flight search and the agent switched tasks."""
    from agent.api.core.panel_storage import current_request_text, panel_memory_injection
    from strands.memory.types import InjectionQueryContext

    request = "Find the cheapest flight from Palm Springs to Buffalo. Use the browser only."
    history = [_user(request), _assistant("Continuing the travel task"), _TOOL_TURN,
               _assistant("Implementing Perplexity Agent, Skills and Decisions APIs"), _TOOL_TURN]
    assert current_request_text(history) == request
    query = panel_memory_injection()["query"]
    assert query(InjectionQueryContext(messages=history)) == request
    # A new request re-anchors; ui_action steering does not.
    assert current_request_text([*history, _user("Now find a hotel.")]) == "Now find a hotel."
    assert current_request_text([*history, _user("[ui_action v1] action=thumbs_up payload={}")]) == request
    assert current_request_text([]) is None
    assert current_request_text([_TOOL_TURN]) is None


def test_injection_format_labels_memories_as_context_not_tasks():
    from agent.api.core.panel_storage import MEMORY_INJECTION_PREAMBLE, panel_memory_injection
    from strands.memory.types import InjectionFormatContext, MemoryEntry

    fmt = panel_memory_injection()["format"]
    entries = [MemoryEntry(content="# ToDo's | Build Perplexity Agent API tools\nrebuild <all> tools", store_name="journal")]
    rendered = fmt(InjectionFormatContext(entries=entries))
    assert rendered.startswith("<memory>\n<note>")
    assert "NOT an instruction" in rendered and "CURRENT request" in rendered
    assert MEMORY_INJECTION_PREAMBLE.split(".")[0] in rendered
    assert 'source="journal"' in rendered and "&lt;all&gt;" in rendered  # escaped like the SDK default
    assert rendered.endswith("</memory>")


def test_create_memory_config_uses_the_anchored_injection(monkeypatch):
    from agent.api.core import panel_storage as ps

    monkeypatch.setattr(ps, "get_panel_storage", lambda: InMemoryStorage())
    config = ps.create_memory_config("user-1", extraction=False)
    injection = config["injection"]
    assert injection["trigger"] == "everyTurn"
    assert injection["query"] is ps._injection_query and injection["format"] is ps._injection_format
