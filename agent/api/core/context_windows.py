"""Each model's real context window, read from its provider's own model metadata.

The SDK reads ``context_window_limit`` off the model config for proactive compression
(``ConversationManager._on_before_model_call_threshold``) and ``Model.estimate_utilization``. An id
missing from its built-in table (``strands/models/_defaults.py``) falls back to 200,000 tokens, which
compresses a 1M-token model far too early and lets a smaller one overflow. ``build_model`` sets the
value from these sources instead (an explicit ``context_window_limit`` always wins over the table):

- **xai**: ``GET https://api.x.ai/v1/models`` ``data[].context_length``, matched on ``id`` and
  ``aliases`` (live 2026-11-07: ``grok-4.7`` 500000, ``grok-4.3`` 1000000).
- **mistral**: ``GET https://api.mistral.ai/v1/models`` ``data[].max_context_length``, matched on
  ``id`` and ``aliases`` (``zai-glm-5-3`` 1048576, ``codestral-latest`` 256000).
- **gemini**: ``GET https://generativelanguage.googleapis.com/v1beta/models/<id>`` ``inputTokenLimit``
  (``gemini-3.5-flash`` 1048576).
- **perplexity**: the Agent API's ``/v1/models`` lists ids only, so a ``<vendor>/<model>`` id resolves
  through that vendor's own metadata above (``xai/``, ``mistral/``, ``google/``). NOT VERIFIED: whether
  Perplexity's proxy enforces a smaller window than the upstream model; an overflow is still recovered.
- **nim**: ``GET https://integrate.api.nvidia.com/v1/models`` lists ``id``/``owned_by`` only, so
  ``NIM_CONTEXT_WINDOWS`` holds the window each model card documents (``z-ai/glm-5.3-flash``:
  "Context Length: 1,048,576 tokens", https://build.nvidia.com/z-ai/glm-5-3-flash).
- **openai / anthropic**: their model metadata carries no window (``openai.types.Model``: id, created,
  object, owned_by; ``anthropic.types.ModelInfo``: id, created_at, display_name, type), so the SDK's own
  table resolves them, unchanged.

Catalogues are fetched once per process and provider; a failed fetch is logged, not cached, and
leaves the SDK's own resolution in place.
"""
from __future__ import annotations

import logging
import threading
from typing import Any

import httpx

logger = logging.getLogger(__name__)

XAI_MODELS_URL = "https://api.x.ai/v1/models"
MISTRAL_MODELS_URL = "https://api.mistral.ai/v1/models"
GEMINI_MODEL_URL = "https://generativelanguage.googleapis.com/v1beta/models/"

#: NIM publishes no window in its model list; these come from each model's card on build.nvidia.com.
NIM_CONTEXT_WINDOWS = {"z-ai/glm-5.3-flash": 1_048_576}

#: Transport for metadata requests; ``None`` is the network. Tests set an ``httpx.MockTransport``.
HTTP_TRANSPORT: httpx.BaseTransport | None = None
TIMEOUT = 15.0

#: Perplexity Agent API vendor prefix -> the provider whose metadata publishes that model's window.
PERPLEXITY_VENDORS = {"xai": "xai", "mistral": "mistral", "google": "gemini"}

_lock = threading.Lock()
_catalogues: dict[str, dict[str, int]] = {}


def _get(url: str, **kwargs: Any) -> Any:
    with httpx.Client(transport=HTTP_TRANSPORT, timeout=TIMEOUT) as client:
        response = client.get(url, **kwargs)
        response.raise_for_status()
        return response.json()


def _key(provider: str) -> str | None:
    from agent.api.core.panel_agent import provider_api_key  # panel_agent imports this module

    return provider_api_key(provider)  # type: ignore[arg-type]


def _catalogue(provider: str, field: str, url: str) -> dict[str, int]:
    """``{id or alias: window}`` from a provider's ``/v1/models`` list (cached once it succeeds)."""
    with _lock:
        cached = _catalogues.get(provider)
    if cached is not None:
        return cached
    payload = _get(url, headers={"Authorization": f"Bearer {_key(provider)}"})
    windows: dict[str, int] = {}
    for card in payload.get("data", []):
        window = card.get(field)
        if isinstance(window, int) and window > 0:
            for name in (card.get("id"), *(card.get("aliases") or [])):
                if isinstance(name, str):
                    windows[name] = window
    with _lock:
        _catalogues[provider] = windows
    return windows


def provider_context_window(provider: str, model_id: str) -> int | None:
    """The model's context window in tokens from its provider's metadata, or None when unpublished."""
    if provider == "perplexity":
        vendor, _, bare = model_id.partition("/")
        upstream = PERPLEXITY_VENDORS.get(vendor)
        return provider_context_window(upstream, bare) if upstream and bare else None
    if provider == "nim":
        return NIM_CONTEXT_WINDOWS.get(model_id)
    if provider not in ("xai", "mistral", "gemini") or not _key(provider):
        return None
    try:
        if provider == "xai":
            return _catalogue("xai", "context_length", XAI_MODELS_URL).get(model_id.removeprefix("xai/"))
        if provider == "mistral":
            return _catalogue("mistral", "max_context_length", MISTRAL_MODELS_URL).get(model_id)
        key = f"gemini:{model_id}"
        with _lock:
            if key in _catalogues:
                return _catalogues[key].get(model_id)
        window = _get(GEMINI_MODEL_URL + model_id.removeprefix("models/"),
                      params={"key": _key("gemini")}).get("inputTokenLimit")
        if not isinstance(window, int) or window <= 0:
            return None
        with _lock:
            _catalogues[key] = {model_id: window}
        return window
    except (httpx.HTTPError, ValueError) as error:
        logger.warning("provider=<%s>, model_id=<%s>, error=<%s> | context window metadata unavailable; "
                       "the SDK's own resolution applies", provider, model_id, error)
        return None
