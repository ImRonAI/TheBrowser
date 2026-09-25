import asyncio
import json
import sys
import types

import pytest

from agent.api.core import public_tunnel
from agent.api.core.config import API_PORT


class FakeListener:
    def url(self):
        return "https://example.ngrok-free.dev"


def fake_ngrok(calls):
    async def forward(addr, **options):
        calls.append(("forward", addr, options))
        return FakeListener()

    async def disconnect(url=None):
        calls.append(("disconnect", url))

    return types.SimpleNamespace(forward=forward, disconnect=disconnect)


@pytest.fixture
def ngrok_calls(monkeypatch):
    calls = []
    monkeypatch.setitem(sys.modules, "ngrok", fake_ngrok(calls))
    monkeypatch.setattr(public_tunnel, "_open", False)
    for name in ("RON_NGROK", "NGROK_URL", "RON_NGROK_ALLOW_PATHS"):
        monkeypatch.delenv(name, raising=False)
    return calls


def test_off_by_default(ngrok_calls):
    assert asyncio.run(public_tunnel.start()) is None
    assert ngrok_calls == []


def test_forwards_api_port_with_path_allowlist(ngrok_calls, monkeypatch):
    monkeypatch.setenv("RON_NGROK", "1")
    monkeypatch.setenv("NGROK_URL", "https://name.ngrok-free.dev/")
    assert asyncio.run(public_tunnel.start()) == "https://example.ngrok-free.dev"
    (kind, addr, options), = ngrok_calls
    assert (kind, addr) == ("forward", f"localhost:{API_PORT}")
    assert options["authtoken_from_env"] is True
    assert options["domain"] == "name.ngrok-free.dev"
    policy = json.loads(options["traffic_policy"])
    assert policy == {"on_http_request": [{
        "expressions": ["!(req.url.path == '/telnyx/webhook')"],
        "actions": [{"type": "deny", "config": {"status_code": 404}}],
    }]}


def test_no_domain_uses_account_dev_domain(ngrok_calls, monkeypatch):
    monkeypatch.setenv("RON_NGROK", "true")
    asyncio.run(public_tunnel.start())
    assert "domain" not in ngrok_calls[0][2]


def test_empty_allowlist_denies_everything():
    policy = json.loads(public_tunnel.traffic_policy([]))
    assert policy == {"on_http_request": [{"actions": [{"type": "deny", "config": {"status_code": 404}}]}]}


def test_multiple_paths_and_validation(monkeypatch):
    monkeypatch.setenv("RON_NGROK_ALLOW_PATHS", "/a, /b")
    assert public_tunnel.allowed_paths() == ["/a", "/b"]
    rule = json.loads(public_tunnel.traffic_policy(["/a", "/b"]))["on_http_request"][0]
    assert rule["expressions"] == ["!(req.url.path == '/a' || req.url.path == '/b')"]
    monkeypatch.setenv("RON_NGROK_ALLOW_PATHS", "a' || true || '")
    with pytest.raises(ValueError):
        public_tunnel.allowed_paths()


def test_forward_failure_does_not_block_startup(monkeypatch, ngrok_calls):
    async def boom(addr, **options):
        raise ValueError("failed to connect session")
    monkeypatch.setattr(sys.modules["ngrok"], "forward", boom)
    monkeypatch.setenv("RON_NGROK", "1")
    assert asyncio.run(public_tunnel.start()) is None


def test_stop_only_disconnects_an_opened_tunnel(ngrok_calls, monkeypatch):
    asyncio.run(public_tunnel.stop())
    assert ngrok_calls == []
    monkeypatch.setenv("RON_NGROK", "1")
    asyncio.run(public_tunnel.start())
    asyncio.run(public_tunnel.stop())
    assert ngrok_calls[-1] == ("disconnect", None)
    asyncio.run(public_tunnel.stop())
    assert ngrok_calls.count(("disconnect", None)) == 1
