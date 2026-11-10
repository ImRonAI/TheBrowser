import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


@pytest.fixture(autouse=True)
def _default_enable_perplexity_for_tests(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("RON_PERPLEXITY_AGENT_API", raising=False)
    monkeypatch.delenv("RON_PERPLEXITY_SEARCH", raising=False)


@pytest.fixture(autouse=True)
def _isolated_build_root(monkeypatch: pytest.MonkeyPatch, tmp_path_factory: pytest.TempPathFactory) -> None:
    """Build Agent workspaces (core/build_workspace.py) never land in the developer's ~/.ron/build."""
    from agent.api.core import config as app_config

    monkeypatch.setattr(app_config, "RON_BUILD_ROOT", tmp_path_factory.getbasetemp() / "ron-build")


@pytest.fixture(autouse=True)
def _offline_context_window_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    """Provider model metadata is network I/O; tests that need it install their own transport."""
    import httpx

    from agent.api.core import context_windows

    monkeypatch.setattr(context_windows, "HTTP_TRANSPORT",
                        httpx.MockTransport(lambda request: httpx.Response(503, request=request)))
    monkeypatch.setattr(context_windows, "_catalogues", {})


@pytest.fixture(autouse=True)
def _no_nim_key_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    """NIM is the first provider in ``PROVIDERS``; a developer's real key must not change test defaults."""
    from agent.api.core import config as app_config

    monkeypatch.setattr(app_config, "NVIDIA_NIM_API_KEY", None)


@pytest.fixture(autouse=True)
def _every_chat_provider_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    """A developer's RON_CHAT_PROVIDERS allowlist (loaded from .env) must not change which providers tests see."""
    monkeypatch.delenv("RON_CHAT_PROVIDERS", raising=False)
