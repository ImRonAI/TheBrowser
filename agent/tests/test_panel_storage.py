"""Native SDK integration tests; no credentials, model calls or HF network I/O."""

import asyncio
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

    def check(self, operation, token):
        self.calls.append((operation, threading.get_ident(), token))
        if operation in self.fail:
            raise self.fail[operation]

    def file(self, key):
        return BucketFile(type="file", path=key, size=len(self.data[key]), xetHash="fake")

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
    with pytest.raises(ValueError, match="HF_BUCKET_ID"):
        panel.get_panel_storage()
    monkeypatch.setenv("HF_BUCKET_ID", "test/bucket")
    monkeypatch.setenv("HF_TOKEN", "synthetic-test-token")
    client_factory = Mock(return_value=FakeHF())
    monkeypatch.setattr("huggingface_hub.HfApi", client_factory)
    assert isinstance(panel.get_panel_storage(), panel.HuggingFaceBucketStorage)
    client_factory.assert_called_once_with(token="synthetic-test-token")
    monkeypatch.setattr(panel, "_storage", None)
    monkeypatch.setenv("PANEL_STORAGE", "s3")
    with pytest.raises(ValueError, match="PANEL_STORAGE"):
        panel.get_panel_storage()


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
