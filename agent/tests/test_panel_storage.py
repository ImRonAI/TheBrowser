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
from strands.storage import InMemoryStorage, Storage
from strands.types.exceptions import StorageError

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
