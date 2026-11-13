"""Media intake: a lead model that sees gets the media natively; one that cannot gets GLM 5.3 Flash's description.

Capabilities are read from the providers' own listings (served here by ``httpx.MockTransport`` with the shapes
``GET https://api.mistral.ai/v1/models`` and ``GET https://api.x.ai/v1/language-models`` returned live on
2026-11-07). Model traffic goes through the real adapters and SDKs: ``RonMistralModel`` over the installed
``mistralai`` client parsing SSE bytes, ``RonXAIModel`` into a real ``xai_sdk`` chat, ``RonGeminiModel`` into
google-genai types. Media decoding uses the host's real ffmpeg (skipped when it is missing). Only network I/O is
replaced: catalogue/model HTTP and the attachment/URL download.
"""
from __future__ import annotations

import asyncio
import base64
import json
import shutil
import subprocess
from typing import Any

import httpx
import pytest
from strands import Agent, tool

from agent.api.core import config as app_config
from agent.api.core import media_capabilities as caps
from agent.api.core import media_understanding as media
from agent.api.core.mistral_model import RonMistralModel
from agent.tests.test_panel_tools import call_tool

needs_ffmpeg = pytest.mark.skipif(not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="ffmpeg is not installed")

ATTACHMENT = "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/shot.png"

MISTRAL_MODELS = {"object": "list", "data": [
    {"id": "zai-glm-5-3-flash", "object": "model", "aliases": [], "max_context_length": 1048576,
     "capabilities": {"completion_chat": True, "function_calling": True, "reasoning": True, "vision": True}},
    {"id": "zai-glm-5-3", "object": "model", "aliases": [], "max_context_length": 1048576,
     "capabilities": {"completion_chat": True, "function_calling": True, "reasoning": True, "vision": False}},
    {"id": "mistral-medium-2604", "object": "model", "aliases": ["mistral-medium-latest"],
     "capabilities": {"completion_chat": True, "function_calling": True, "vision": True, "audio": False}},
]}
XAI_MODELS = {"models": [
    {"id": "grok-4.7", "aliases": [], "input_modalities": ["text", "image"], "output_modalities": ["text"]},
    {"id": "grok-build-0.1", "aliases": ["grok-code-fast-1"], "input_modalities": ["text", "image"], "output_modalities": ["text"]},
    {"id": "grok-text", "aliases": [], "input_modalities": ["text"], "output_modalities": ["text"]},
]}


def _ffmpeg(*args: str) -> bytes:
    return subprocess.run(["ffmpeg", "-v", "error", *args, "pipe:1"], check=True, capture_output=True).stdout


@pytest.fixture(scope="module")
def png() -> bytes:
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg is not installed")
    return _ffmpeg("-f", "lavfi", "-i", "color=c=red:s=96x48", "-frames:v", "1", "-f", "image2pipe", "-c:v", "png")


@pytest.fixture(autouse=True)
def offline_catalogues(monkeypatch):
    """Fresh per-process caches, offline keys, and the providers' listings served from the fixtures above."""
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=MISTRAL_MODELS if request.url.host == "api.mistral.ai" else XAI_MODELS)

    monkeypatch.setattr(caps, "_catalogues", {})
    monkeypatch.setattr(caps, "_logged", set())
    monkeypatch.setattr(caps, "HTTP_TRANSPORT", httpx.MockTransport(handler))
    monkeypatch.setattr(app_config, "MISTRAL_API_KEY", "offline")
    monkeypatch.setattr(app_config, "XAI_API_KEY", "offline")
    return requests


def _serve_attachment(monkeypatch, data: bytes, media_type: str) -> list[tuple[Any, str]]:
    calls: list[tuple[Any, str]] = []

    async def download_attachment(identity: Any, path: str) -> tuple[bytes, str]:
        calls.append((identity, path))
        return data, media_type

    monkeypatch.setattr(media, "download_attachment", download_attachment)
    return calls


# --- capability from the providers' own metadata ------------------------------------------------------

def test_mistral_and_xai_capabilities_come_from_their_model_listings(offline_catalogues):
    flash = caps.media_capability("mistral", "zai-glm-5-3-flash")
    assert flash.inputs == {"image"} and flash.tool_result_images and flash.source == caps.MISTRAL_MODELS_URL
    assert caps.media_capability("mistral", "zai-glm-5-3").inputs == frozenset()
    assert caps.media_capability("mistral", "mistral-medium-latest").image  # matched through `aliases`
    unlisted = caps.media_capability("mistral", "not-a-model")
    assert not unlisted.known and not unlisted.image

    assert caps.media_capability("xai", "grok-4.7").tool_result_images
    assert caps.media_capability("xai", "grok-code-fast-1").image
    assert not caps.media_capability("xai", "grok-text").image
    # One listing per provider and process, authenticated with the provider key.
    assert [request.url.host for request in offline_catalogues] == ["api.mistral.ai", "api.x.ai"]
    assert {request.headers["authorization"] for request in offline_catalogues} == {"Bearer offline"}


def test_documented_capabilities_and_unknown_providers():
    native = caps.media_capability("gemini", "gemini-3.5-flash")
    assert native.inputs == {"image", "video", "audio", "document"} and native.tool_result_images
    assert caps.GEMINI_MODEL_DOCS in native.source
    older = caps.media_capability("gemini", "gemini-2.5-flash")
    assert older.image and not older.tool_result_images  # multimodal function responses: Gemini 3 series only
    assert not caps.media_capability("gemini", "gemini-3.8-flash-tts").image
    assert not caps.media_capability("gemini", "gemini-flash-latest").known  # an alias without a model page
    assert caps.media_capability("anthropic", "claude-sonnet-5").tool_result_images
    for provider, model_id in (("perplexity", "xai/grok-4.5"), ("openai", "gpt-5"), ("anthropic", "claude-2")):
        capability = caps.media_capability(provider, model_id)
        assert not capability.known and not capability.image and not capability.tool_result_images


def test_a_failed_listing_is_unknown_and_read_again_next_time(monkeypatch):
    statuses = [500, 200]

    def handler(request: httpx.Request) -> httpx.Response:
        status = statuses.pop(0)
        return httpx.Response(status, json=MISTRAL_MODELS if status == 200 else {"message": "down"})

    monkeypatch.setattr(caps, "HTTP_TRANSPORT", httpx.MockTransport(handler))
    assert not caps.media_capability("mistral", "zai-glm-5-3-flash").known
    assert caps.cached_tool_result_images("mistral", "zai-glm-5-3-flash") is None
    assert caps.media_capability("mistral", "zai-glm-5-3-flash").tool_result_images
    assert caps.cached_tool_result_images("mistral", "zai-glm-5-3-flash") is True


def test_media_tools_lets_a_seeing_lead_look_itself():
    def names(provider: str, model_id: str) -> list[str]:
        return [value.tool_name for value in media.media_tools(lambda: None, provider=provider, model_id=model_id)]

    assert names("mistral", "zai-glm-5-3-flash") == ["view_media"]
    assert names("xai", "grok-4.7") == ["view_media"]
    assert names("gemini", "gemini-4-hydrogen") == ["view_media"]
    assert names("gemini", "gemini-3.8-flash") == ["view_media"]
    assert names("mistral", "zai-glm-5-3") == ["understand_media"]
    assert names("gemini", "gemini-2.5-pro") == ["understand_media"]
    assert names("perplexity", "openai/gpt-6.1-sol") == ["understand_media"]
    assert "view_media" in media.CONTEXT_READING and "understand_media" in media.CONTEXT_READING
    assert media.media_model() == ("gemini", "gemini-4-hydrogen")


# --- a seeing lead gets native image blocks -------------------------------------------------------------

def _chunk(delta: dict[str, Any], finish_reason: str | None = None) -> str:
    body = {"id": "cmpl", "object": "chat.completion.chunk", "model": "m",
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}]}
    if finish_reason:
        body["usage"] = {"prompt_tokens": 9, "completion_tokens": 3, "total_tokens": 12}
    return f"data: {json.dumps(body)}\n\n"


class MistralWire:
    """The real ``mistralai`` client over scripted SSE bodies; records each request body."""

    def __init__(self, *bodies: str) -> None:
        self.bodies, self.requests = list(bodies), []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(json.loads(request.content))
        body = self.bodies.pop(0) if self.bodies else _chunk({"content": "Done."}, "stop")
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=(body + "data: [DONE]\n\n").encode())

    def model(self, model_id: str) -> RonMistralModel:
        client = httpx.AsyncClient(transport=httpx.MockTransport(self.handler))
        return RonMistralModel(model_id=model_id, client_args={"api_key": "offline", "async_client": client})


def _tool_call(name: str, arguments: dict[str, Any]) -> str:
    return (_chunk({"role": "assistant", "content": ""})
            + _chunk({"tool_calls": [{"id": "call00001", "index": 0, "function": {"name": name, "arguments": json.dumps(arguments)}}]},
                     "tool_calls"))


@needs_ffmpeg
def test_a_seeing_mistral_lead_reads_the_image_in_its_own_tool_message(monkeypatch, png):
    calls = _serve_attachment(monkeypatch, png, "image/png")
    wire = MistralWire(_tool_call("view_media", {"source": ATTACHMENT}), _chunk({"content": "A red rectangle."}, "stop"))
    identity = object()
    agent = Agent(model=wire.model("zai-glm-5-3-flash"), tools=media.media_tools(lambda: identity, provider="mistral",
                  model_id="zai-glm-5-3-flash"), callback_handler=None, load_tools_from_directory=False)

    result = asyncio.run(agent.invoke_async("What does the screenshot show?"))

    assert str(result).strip() == "A red rectangle." and calls == [(identity, ATTACHMENT)]
    stored = next(block["toolResult"] for message in agent.messages for block in message["content"] if "toolResult" in block)
    assert stored["status"] == "success" and stored["content"][1] == {"image": {"format": "png", "source": {"bytes": png}}}
    tool_message = next(message for message in wire.requests[1]["messages"] if message["role"] == "tool")
    header, image = tool_message["content"]
    assert header["type"] == "text" and json.loads(header["text"])["images"] == ["image"]
    assert image == {"type": "image_url", "image_url": "data:image/png;base64," + base64.b64encode(png).decode()}
    assert len(wire.requests) == 2  # no second model looked at it


@needs_ffmpeg
def test_a_blind_mistral_lead_never_receives_images(png):
    @tool
    def screenshot() -> dict[str, Any]:
        """A browser screenshot."""
        return {"status": "success", "content": [{"text": "page"}, {"image": {"format": "png", "source": {"bytes": png}}}]}

    wire = MistralWire(_tool_call("screenshot", {}))
    agent = Agent(model=wire.model("zai-glm-5-3"), tools=[screenshot], callback_handler=None, load_tools_from_directory=False)
    asyncio.run(agent.invoke_async("look"))

    tool_message = next(message for message in wire.requests[1]["messages"] if message["role"] == "tool")
    assert tool_message["content"] == "page"  # zai-glm-5-3 answers 400 "Image input is not enabled" to image chunks


@needs_ffmpeg
def test_an_xai_lead_gets_tool_result_images_as_the_next_user_message(png):
    from xai_sdk import Client
    from xai_sdk.proto import chat_pb2

    from agent.api.core.xai_model import RonXAIModel

    caps.media_capability("xai", "grok-4.7")  # the adapter reads the listing the panel already loaded
    model = RonXAIModel(client_args={"api_key": "offline"}, model_id="grok-4.7")
    chat = Client(api_key="offline").chat.create(model="grok-4.7")
    messages = [
        {"role": "user", "content": [{"text": "Look at it"}]},
        {"role": "assistant", "content": [{"toolUse": {"toolUseId": "call-1", "name": "view_media", "input": {"source": ATTACHMENT}}}]},
        {"role": "user", "content": [{"toolResult": {"toolUseId": "call-1", "status": "success", "content": [
            {"text": "{\"images\": [\"image\"]}"}, {"image": {"format": "png", "source": {"bytes": png}}}]}}]},
    ]
    model._append_messages_to_chat(chat, messages)

    tool_message, user_message = chat.messages[-2:]
    assert tool_message.role == chat_pb2.ROLE_TOOL and "1 image(s) from this tool result follow" in tool_message.content[0].text
    assert user_message.role == chat_pb2.ROLE_USER
    assert user_message.content[0].image_url.image_url == "data:image/png;base64," + base64.b64encode(png).decode()


@needs_ffmpeg
def test_a_gemini_3_lead_gets_function_response_parts_and_gemini_2_5_keeps_the_vended_form(png):
    from agent.api.core.gemini_model import RonGeminiModel

    messages = [
        {"role": "assistant", "content": [{"toolUse": {"toolUseId": "call-1", "name": "view_media", "input": {}}}]},
        {"role": "user", "content": [{"toolResult": {"toolUseId": "call-1", "status": "success", "content": [
            {"text": "header"}, {"image": {"format": "png", "source": {"bytes": png}}}]}}]},
    ]
    native = RonGeminiModel(client_args={"api_key": "offline"}, model_id="gemini-3.5-flash")._format_request_content(messages)
    response = native[1].parts[0].function_response
    assert response.name == "view_media" and response.response == {"output": [{"text": "header"}]}
    assert response.parts[0].inline_data.mime_type == "image/png" and response.parts[0].inline_data.data == png

    vended = RonGeminiModel(client_args={"api_key": "offline"}, model_id="gemini-2.5-flash")._format_request_content(messages)
    assert vended[1].parts[0].function_response.parts is None


# --- a blind lead gets GLM 5.3 Flash's description ----------------------------------------------------

@needs_ffmpeg
def test_understand_media_sends_the_image_to_glm_5_3_flash(monkeypatch, png):
    _serve_attachment(monkeypatch, png, "image/png")
    wire = MistralWire(_chunk({"content": "A solid red rectangle with no text."}, "stop"))
    monkeypatch.setattr(media, "MEDIA_MODEL", "mistral/zai-glm-5-3-flash")
    monkeypatch.setattr(media, "build_media_model", lambda: wire.model("zai-glm-5-3-flash"))
    [understand_media] = media.media_tools(lambda: None, provider="openai", model_id="offline")

    _, result = asyncio.run(call_tool(understand_media, {"source": ATTACHMENT, "question": "Any text?"}))

    assert result["status"] == "success", result
    payload = json.loads(result["content"][0]["text"])
    assert payload["model"] == "mistral/zai-glm-5-3-flash" and payload["description"] == "A solid red rectangle with no text."
    request = wire.requests[0]
    assert request["model"] == "zai-glm-5-3-flash"
    user = request["messages"][-1]
    assert user["role"] == "user"
    assert {"type": "image_url", "image_url": "data:image/png;base64," + base64.b64encode(png).decode()} in user["content"]
    assert user["content"][-1] == {"type": "text", "text": "Any text?"}


def test_a_media_model_without_image_input_is_refused(monkeypatch):
    monkeypatch.setattr(media, "MEDIA_MODEL", "mistral/zai-glm-5-3")
    clip = media.Media("x", "image/png", 1, [("image", b"", "png")])
    with pytest.raises(RuntimeError, match="does not accept images"):
        asyncio.run(media.describe_media(clip))


# --- what reaches a model ---------------------------------------------------------------------------

@needs_ffmpeg
def test_a_video_becomes_timestamped_frames_even_without_a_duration_header(monkeypatch):
    # Piped WebM has no duration, like a MediaRecorder screen recording; the last packet (11.9 s) bounds it.
    clip = _ffmpeg("-f", "lavfi", "-i", "testsrc=duration=12:size=320x180:rate=10", "-c:v", "libvpx", "-b:v", "100k", "-f", "webm")
    _serve_attachment(monkeypatch, clip, "video/webm")

    loaded = asyncio.run(media.load_media(ATTACHMENT, None))

    assert len(loaded.images) == app_config.RON_MEDIA_MAX_FRAMES
    assert loaded.images[0][0] == "frame at 00:00.7" and all(fmt == "jpeg" and data[:2] == b"\xff\xd8" for _, data, fmt in loaded.images)
    assert "NOT NATIVE" in loaded.notes[0] and "audio" in loaded.notes[0]


@needs_ffmpeg
def test_png_passes_through_and_other_formats_are_reencoded(png):
    data, fmt = asyncio.run(media.normalize_image(png, "image/png"))
    assert data is png and fmt == "png"
    gif = _ffmpeg("-f", "lavfi", "-i", "color=c=blue:s=40x40", "-frames:v", "1", "-f", "gif")
    data, fmt = asyncio.run(media.normalize_image(gif, "image/gif"))
    assert fmt == "png" and data.startswith(b"\x89PNG")


def test_audio_is_refused(monkeypatch):
    _serve_attachment(monkeypatch, b"ID3", "audio/mpeg")
    with pytest.raises(ValueError, match="accepts text and image input only"):
        asyncio.run(media.load_media(ATTACHMENT, None))


@needs_ffmpeg
def test_youtube_gives_oembed_metadata_and_thumbnail_not_the_video(monkeypatch, png):
    fetched: list[str] = []

    async def get_public(url: str, accept: Any) -> tuple[bytes, str]:
        fetched.append(url)
        if url.startswith(media.YOUTUBE_OEMBED):
            return json.dumps({"title": "Me at the zoo", "author_name": "jawed",
                               "thumbnail_url": "https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg"}).encode(), accept("application/json")
        return png, accept("image/png")

    monkeypatch.setattr(media, "_get_public", get_public)
    loaded = asyncio.run(media.load_media("https://www.youtube.com/watch?v=jNQXAC9IVRw", None))

    assert fetched[0].startswith("https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DjNQXAC9IVRw&format=json")
    assert fetched[1] == "https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg"
    assert loaded.media_type == "video/youtube" and loaded.images[0][0] == "YouTube thumbnail"
    assert "'Me at the zoo'" in loaded.notes[0] and "was not watched" in loaded.notes[1]
