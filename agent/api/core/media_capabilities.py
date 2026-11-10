"""Which inputs a lead model accepts, from each provider's own metadata, and whether it sees tool-result images.

``media_capability(provider, model_id)`` answers two questions for ``media_understanding.media_tools``:

1. ``inputs``: the media the model accepts (``image`` / ``video`` / ``audio`` / ``document``; text is implied).
2. ``tool_result_images``: whether an image returned in a tool result reaches this model natively, i.e. the
   model accepts images AND Ron's adapter for the provider carries tool-result images on the wire.

Sources, per provider (never guessed; anything not covered is "unknown" = text-only, and logged):

- **mistral**: ``GET https://api.mistral.ai/v1/models`` ``capabilities.vision`` / ``capabilities.audio``
  (installed ``mistralai/client/models/modelcapabilities.py:47,55``), matched on ``id`` and ``aliases``.
  Tool-result images: the chat-completions ``ToolMessage.content`` is ``str | List[ContentChunk]``
  (``mistralai/client/models/toolmessage.py:21-26``); a vision model reads an ``image_url`` chunk in a ``tool``
  message (live 2026-11-07: ``zai-glm-5-3-flash`` and ``mistral-medium-latest`` both read it; ``zai-glm-5-3``
  answers ``400 Image input is not enabled for this model``). The vended formatter drops tool-result images
  (``strands/models/mistral.py:218-222``), so ``RonMistralModel`` adds them for vision models.
- **xai**: ``GET https://api.x.ai/v1/language-models`` ``input_modalities`` (the gRPC ``LanguageModel.input_modalities``
  in the installed ``xai_sdk/proto/v5/models_pb2.pyi:46``), matched on ``id`` and ``aliases``. Tool-result images:
  ``strands_xai`` keeps only text/json of a tool result (``strands_xai/xai.py:661-670``) and ``xai_sdk.chat.tool_result``
  takes a string (``xai_sdk/chat.py:682``); ``RonXAIModel`` sends the images as the next user message, the
  SDK's own pattern for OpenAI chat (``strands/models/openai.py:280-330``), live-verified on ``grok-4.7``.
- **gemini**: the models list has no modality field (``supportedGenerationMethods`` etc. only; google-genai
  ``types.Model``), so the per-model "Supported data types → Inputs" of the official model pages
  (``https://aistudio.google.com/docs/models/<id>``, read 2026-11-07) are tabled below by exact id. Aliases
  (``gemini-flash-latest`` …) have no page and stay unknown. Tool-result images: "For Gemini 3 series models,
  you can include multimodal content in the function response parts"
  (https://aistudio.google.com/docs/function-calling?generate-content=true#multimodal); the vended formatter
  serializes images into the JSON ``response`` instead (``strands/models/gemini.py:189-206``), so
  ``RonGeminiModel`` puts them in ``FunctionResponse.parts`` for ``gemini-3*`` models only.
- **anthropic**: the installed SDK's ``ModelInfo`` has no capability field (``id, created_at, display_name, type``),
  so the ``supportedModels`` list of https://platform.claude.com/docs/en/build-with-claude/vision is used by exact
  id. Tool-result images are native (``strands/models/anthropic.py:253-266``; the doc counts "images nested inside
  ``tool_result`` content").
- **openai**: ``Model`` has only ``id, created, object, owned_by`` and no documented per-id table is wired here:
  unknown. (When known, tool-result images are native: ``function_call_output`` arrays,
  ``strands/models/openai_responses.py:805-817``.)
- **perplexity**: ``GET /v1/models`` returns ids only and the model docs (https://docs.perplexity.ai/docs/agent-api/models)
  state no per-model input modalities ("Check model documentation for specific capabilities"); images in
  ``function_call_output`` are undocumented: unknown.

Catalogues are fetched once per process and provider (a failed fetch is logged and retried on the next call).
"""
from __future__ import annotations

import asyncio
import logging
import threading
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger(__name__)

MISTRAL_MODELS_URL = "https://api.mistral.ai/v1/models"
XAI_LANGUAGE_MODELS_URL = "https://api.x.ai/v1/language-models"
GEMINI_MODEL_DOCS = "https://aistudio.google.com/docs/models/"
GEMINI_MULTIMODAL_FUNCTION_RESPONSES = "https://aistudio.google.com/docs/function-calling?generate-content=true#multimodal"
ANTHROPIC_VISION_DOCS = "https://platform.claude.com/docs/en/build-with-claude/vision"
PERPLEXITY_MODEL_DOCS = "https://docs.perplexity.ai/docs/agent-api/models"

#: Transport for catalogue requests; ``None`` is the network. Tests set an ``httpx.MockTransport``.
HTTP_TRANSPORT: httpx.BaseTransport | None = None
CATALOGUE_TIMEOUT = 15.0

_ALL = frozenset({"image", "video", "audio", "document"})
_IMAGE_VIDEO_AUDIO = frozenset({"image", "video", "audio"})

#: "Supported data types → Inputs" of each official Gemini model page (GEMINI_MODEL_DOCS + id), exact ids.
GEMINI_INPUTS: dict[str, frozenset[str]] = {
    # "Text, Image, Video, Audio, and PDF"
    **{model: _ALL for model in (
        "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite",
        "gemini-3.1-pro-preview", "gemini-3.1-flash-lite", "gemini-3.1-flash-lite-preview", "gemini-3-flash-preview",
        "gemini-4-argon",
    )},
    # Documented as a separate endpoint of Gemini 3.1 Pro Preview (gemini-3.1-pro-preview#gemini-31-pro-preview-customtools).
    "gemini-3.1-pro-preview-customtools": _ALL,
    "gemini-2.5-pro": _ALL,                                   # "Audio, images, video, text, and PDF"
    "gemini-2.5-flash": _IMAGE_VIDEO_AUDIO,                   # "Text, images, video, audio"
    "gemini-2.5-flash-lite": _ALL,                            # "Text, image, video, audio, PDF"
    "gemini-robotics-er-2-preview": _IMAGE_VIDEO_AUDIO,       # "Text, images, video, audio"
    **{model: frozenset({"image", "video", "document"}) for model in (  # "Text, Image, Video, and PDF"
        "gemini-nano-banana-2.1", "gemini-3.1-flash-image", "gemini-3.1-flash-lite-image")},
    "gemini-3-pro-image": frozenset({"image"}),              # "Image and Text"
    "gemini-2.5-flash-image": frozenset({"image"}),          # "Image and Text"
    **{model: frozenset() for model in (                      # "Text"
        "gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts", "gemini-3.1-flash-tts-preview",
        "gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts")},
    "gemini-omni-1.2-flash": frozenset({"image", "video"}),  # "Text, Image, Video (...)"
    "gemini-omni-1.1-flash": frozenset({"image", "video"}),
    "gemini-3.5-transcribe": frozenset({"audio"}),           # "Audio (up to 1 hour)"
    "gemini-2.5-computer-use-preview-10-2025": frozenset({"image"}),  # "Image, text"
    "antigravity-preview-05-2026": frozenset({"image"}),     # "Text, Image"
    "antigravity-preview-09-2026": frozenset({"image"}),
    **{model: _ALL for model in (                             # "Text, Image, PDF, Audio, Video"
        "deep-research-pro-preview-12-2025", "deep-research-preview-04-2026", "deep-research-max-preview-04-2026")},
}

#: ``supportedModels`` of ANTHROPIC_VISION_DOCS (image input; tool_result images are documented there too).
ANTHROPIC_VISION_MODELS = frozenset({
    "claude-fable-5-1", "claude-mythos-5-1", "claude-fable-5", "claude-mythos-5", "claude-mythos-preview",
    "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-sonnet-5", "claude-haiku-5-5",
    "claude-haiku-4-5-20251001", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6",
    "claude-opus-4-5-20251101", "claude-sonnet-4-5-20250929",
})


@dataclass(frozen=True)
class MediaCapability:
    """What one lead model can take in. ``known=False`` means the provider exposes nothing for it."""

    provider: str
    model_id: str
    inputs: frozenset[str] = field(default_factory=frozenset)
    tool_result_images: bool = False
    source: str = ""
    known: bool = True

    @property
    def image(self) -> bool:
        return "image" in self.inputs


_catalogues: dict[str, dict[str, frozenset[str]]] = {}
_lock = threading.Lock()
_logged: set[tuple[str, str]] = set()


def _client() -> httpx.Client:
    return httpx.Client(timeout=CATALOGUE_TIMEOUT, transport=HTTP_TRANSPORT)


def _api_key(provider: str) -> str | None:
    from agent.api.core.panel_agent import provider_api_key

    return provider_api_key(provider)  # type: ignore[arg-type]


def _mistral_catalogue(payload: Any) -> dict[str, frozenset[str]]:
    catalogue: dict[str, frozenset[str]] = {}
    for item in payload.get("data") or []:
        capabilities = item.get("capabilities") or {}
        inputs = frozenset(name for name, flag in (("image", capabilities.get("vision")), ("audio", capabilities.get("audio"))) if flag)
        for name in (item.get("id"), *(item.get("aliases") or [])):
            if name:
                catalogue[str(name)] = inputs
    return catalogue


def _xai_catalogue(payload: Any) -> dict[str, frozenset[str]]:
    catalogue: dict[str, frozenset[str]] = {}
    for item in payload.get("models") or []:
        inputs = frozenset(str(value).lower() for value in item.get("input_modalities") or []) & _ALL
        for name in (item.get("id"), *(item.get("aliases") or [])):
            if name:
                catalogue[str(name)] = inputs
    return catalogue


_FETCHERS = {
    "mistral": (MISTRAL_MODELS_URL, _mistral_catalogue),
    "xai": (XAI_LANGUAGE_MODELS_URL, _xai_catalogue),
}


def _catalogue(provider: str) -> dict[str, frozenset[str]] | None:
    """The provider's model -> inputs map from its own listing; ``None`` when it cannot be read now."""
    with _lock:
        cached = _catalogues.get(provider)
    if cached is not None:
        return cached
    key = _api_key(provider)
    if not key:
        logger.warning("provider=<%s> | no API key: model input modalities cannot be read", provider)
        return None
    url, parse = _FETCHERS[provider]
    try:
        with _client() as client:
            response = client.get(url, headers={"Authorization": f"Bearer {key}"})
            response.raise_for_status()
            catalogue = parse(response.json())
    except Exception as error:  # a listing failure must never fail agent construction
        logger.warning("provider=<%s>, error=<%s> | model listing failed: input modalities unknown", provider, error)
        return None
    with _lock:
        _catalogues[provider] = catalogue
    return catalogue


def _unknown(provider: str, model_id: str, reason: str) -> MediaCapability:
    if (provider, model_id) not in _logged:
        _logged.add((provider, model_id))
        logger.warning("provider=<%s>, model=<%s> | media capability unknown (%s): treated as text-only",
                       provider, model_id, reason)
    return MediaCapability(provider, model_id, source=reason, known=False)


def media_capability(provider: str, model_id: str) -> MediaCapability:
    """The lead model's media inputs and whether tool-result images reach it (see the module docstring)."""
    if provider in _FETCHERS:
        url = _FETCHERS[provider][0]
        catalogue = _catalogue(provider)
        if catalogue is None:
            return _unknown(provider, model_id, f"{url} unavailable")
        if model_id not in catalogue:
            return _unknown(provider, model_id, f"not listed by {url}")
        inputs = catalogue[model_id]
        return MediaCapability(provider, model_id, inputs, tool_result_images="image" in inputs, source=url)
    if provider == "gemini":
        if model_id not in GEMINI_INPUTS:
            return _unknown(provider, model_id, f"no model page under {GEMINI_MODEL_DOCS}")
        inputs = GEMINI_INPUTS[model_id]
        native = "image" in inputs and model_id.startswith("gemini-3")
        return MediaCapability(provider, model_id, inputs, tool_result_images=native,
                               source=f"{GEMINI_MODEL_DOCS}{model_id}; {GEMINI_MULTIMODAL_FUNCTION_RESPONSES}")
    if provider == "anthropic":
        if model_id not in ANTHROPIC_VISION_MODELS:
            return _unknown(provider, model_id, f"not in supportedModels of {ANTHROPIC_VISION_DOCS}")
        return MediaCapability(provider, model_id, frozenset({"image"}), tool_result_images=True, source=ANTHROPIC_VISION_DOCS)
    if provider == "perplexity":
        return _unknown(provider, model_id, f"Perplexity documents no per-model input modalities ({PERPLEXITY_MODEL_DOCS})")
    if provider == "openai":
        return _unknown(provider, model_id, "the OpenAI models endpoint exposes no input modalities")
    if provider == "nim":
        return _unknown(provider, model_id, "the NIM models endpoint exposes no input modalities")
    return _unknown(provider, model_id, "unknown provider")


def cached_tool_result_images(provider: str, model_id: str) -> bool | None:
    """Non-blocking read for model adapters: ``None`` until the provider's listing has been fetched."""
    if provider in _FETCHERS:
        with _lock:
            catalogue = _catalogues.get(provider)
        if catalogue is None:
            return None
        return "image" in catalogue.get(model_id, frozenset())
    return media_capability(provider, model_id).tool_result_images


async def load_capability(provider: str, model_id: str) -> MediaCapability:
    """``media_capability`` off the event loop (the first call per provider may do one HTTP GET)."""
    return await asyncio.to_thread(media_capability, provider, model_id)


def has_tool_result_images(messages: Any) -> bool:
    return any("image" in item for message in messages for block in message.get("content", [])
               if "toolResult" in block for item in block["toolResult"].get("content", []))


__all__ = ["ANTHROPIC_VISION_MODELS", "GEMINI_INPUTS", "MediaCapability", "cached_tool_result_images",
           "has_tool_result_images", "load_capability", "media_capability"]
