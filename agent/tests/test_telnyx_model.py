"""Telnyx Inference provider: catalogue listing, reasoning efforts and the Responses wire, over real HTTP.

A local server answers ``GET /models`` with entries captured from ``https://api.telnyx.com/v2/ai/openai/models``
(2026-11-13, trimmed) and ``POST /responses`` with the OpenAI Responses SSE stream; the OpenAI SDK, the Strands
``Agent`` and ``RonTelnyxModel`` run unchanged against it.
"""
from __future__ import annotations

import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import pytest
from strands import Agent, tool
from strands.models.openai import OpenAIModel
from strands.models.openai_responses import OpenAIResponsesModel

from agent.api.core import config as app_config
from agent.api.core import context_windows, media_capabilities, panel_agent
from agent.api.core.nim_model import OMITTED_TOOL_IMAGE_NOTE
from agent.api.core.telnyx_model import RonTelnyxChatModel, RonTelnyxModel

TINY_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082"
)


def _card(model_id: str, **fields: Any) -> dict[str, Any]:
    return {"id": model_id, "object": "model", "created": "2026-11-13T17:11:12.341094", "owned_by": "Telnyx",
            "task": "text-generation", "context_length": 1048576, "is_vision_supported": False,
            "supported_reasoning_efforts": None, "service_tiers": ["default"], **fields}


CATALOGUE = {"object": "list", "data": [
    _card("zai-org/GLM-5.3-Flash", organization="zai-org", is_vision_supported=True,
          service_tiers=["default", "priority"]),
    _card("openai/gpt-oss-120b", organization="openai", context_length=131072,
          supported_reasoning_efforts=["low", "medium", "high"]),
    _card("deepseek-ai/DeepSeek-V4.1-Flash", organization="deepseek-ai", is_vision_supported=True),
    _card("moonshotai/Kimi-K3", organization="moonshotai", is_vision_supported=True),
    _card("moonshotai/Kimi-K3.1-Pro", organization="Telnyx", context_length=1000000, beta=True, is_vision_supported=True),
    _card("google/gemma-4-31B-it", organization="google", service_tiers=["priority"]),
    _card("nvidia/NVIDIA-NemotronLabs-VoiceChat-11B", task="speech-to-speech"),
    _card("openai/gpt-5.4-mini", owned_by="openai", task="text generation", service_tiers=None),
]}


class _TelnyxHandler(BaseHTTPRequestHandler):
    requests: list[dict[str, Any]] = []

    def do_GET(self) -> None:
        assert self.path == "/v2/ai/openai/models"
        assert self.headers["Authorization"] == "Bearer telnyx-offline-test"
        body = json.dumps(CATALOGUE).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        type(self).requests.append({"path": self.path, **request})
        if self.path == "/v2/ai/openai/chat/completions":
            called = any(msg.get("role") == "tool" for msg in request["messages"])
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            if called:
                chunks = [
                    {"id": "chatcmpl-2", "object": "chat.completion.chunk", "created": 0, "model": request["model"],
                     "choices": [{"index": 0, "delta": {"role": "assistant", "reasoning": "Reading screenshot."}, "finish_reason": None}]},
                    {"id": "chatcmpl-2", "object": "chat.completion.chunk", "created": 0, "model": request["model"],
                     "choices": [{"index": 0, "delta": {"content": "Done."}, "finish_reason": None}]},
                    {"id": "chatcmpl-2", "object": "chat.completion.chunk", "created": 0, "model": request["model"],
                     "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
                    {"id": "chatcmpl-2", "object": "chat.completion.chunk", "created": 0, "model": request["model"],
                     "choices": [], "usage": {"prompt_tokens": 20, "completion_tokens": 5, "total_tokens": 25}},
                ]
            else:
                chunks = [
                    {"id": "chatcmpl-1", "object": "chat.completion.chunk", "created": 0, "model": request["model"],
                     "choices": [{"index": 0, "delta": {"role": "assistant", "reasoning": "Calling tool."}, "finish_reason": None}]},
                    {"id": "chatcmpl-1", "object": "chat.completion.chunk", "created": 0, "model": request["model"],
                     "choices": [{"index": 0, "delta": {"tool_calls": [
                         {"index": 0, "id": "call_1", "type": "function", "function": {"name": "take_screenshot"}},
                         {"index": 0, "function": {"arguments": "{}"}},
                     ]}, "finish_reason": None}]},
                    {"id": "chatcmpl-1", "object": "chat.completion.chunk", "created": 0, "model": request["model"],
                     "choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}]},
                ]
            for chunk in chunks:
                self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
            self.wfile.write(b"data: [DONE]\n\n")
            return
        assert self.path == "/v2/ai/openai/responses"
        if request["model"] == "moonshotai/Kimi-K3.1-Pro":
            err = json.dumps({"errors": [{"code": "10027", "title": "Unprocessable Entity", "detail": "Error code: 404"}]}).encode()
            self.send_response(422)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(err)))
            self.end_headers()
            self.wfile.write(err)
            return
        response = {"id": f"resp_{len(self.requests)}", "object": "response", "created_at": 0,
                    "model": request["model"], "output": []}
        called = any(item.get("type") == "function_call_output" for item in request["input"])
        events: list[dict[str, Any]] = [{"type": "response.created", "response": {**response, "status": "in_progress"}}]
        if called:
            events += [{"type": "response.reasoning_summary_text.delta", "item_id": "rs_1", "output_index": 0,
                        "summary_index": 0, "delta": "Reading the screenshot."},
                       {"type": "response.output_text.delta", "item_id": "msg_1", "output_index": 1,
                        "content_index": 0, "delta": "Done."}]
        else:
            events += [{"type": "response.output_item.added", "output_index": 0,
                        "item": {"type": "function_call", "id": "fc_1", "call_id": "call_1",
                                 "name": "take_screenshot", "arguments": "", "status": "in_progress"}},
                       {"type": "response.function_call_arguments.done", "item_id": "fc_1", "output_index": 0,
                        "arguments": "{}"}]
        events.append({"type": "response.completed", "response": {
            **response, "status": "completed", "usage": {"input_tokens": 20, "output_tokens": 5, "total_tokens": 25}}})
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for sequence, event in enumerate(events):
            self.wfile.write(f"event: {event['type']}\ndata: {json.dumps({**event, 'sequence_number': sequence})}\n\n".encode())

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        del format, args


@pytest.fixture
def telnyx(monkeypatch: pytest.MonkeyPatch):
    server = ThreadingHTTPServer(("127.0.0.1", 0), _TelnyxHandler)
    server.daemon_threads = True
    _TelnyxHandler.requests = []
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base_url = f"http://127.0.0.1:{server.server_port}/v2/ai/openai"
    monkeypatch.setattr(app_config, "TELNYX_API_KEY", "telnyx-offline-test")
    monkeypatch.setattr(app_config, "TELNYX_INFERENCE_BASE_URL", base_url)
    monkeypatch.setattr(panel_agent, "TELNYX_INFERENCE_BASE_URL", base_url)
    monkeypatch.setitem(media_capabilities._FETCHERS, "telnyx",
                        (f"{base_url}/models", media_capabilities._FETCHERS["telnyx"][1]))
    monkeypatch.setattr(media_capabilities, "_catalogues", {})
    monkeypatch.setattr(context_windows, "HTTP_TRANSPORT", None)
    monkeypatch.setattr(context_windows, "_catalogues", {})
    try:
        yield _TelnyxHandler
    finally:
        server.shutdown()
        server.server_close()


def test_the_picker_lists_the_chat_models_telnyx_hosts_on_its_default_tier(telnyx):
    assert panel_agent.list_provider_models("telnyx") == [
        {"id": "zai-org/GLM-5.3-Flash", "owned_by": "zai-org", "provider": "telnyx"},
        {"id": "openai/gpt-oss-120b", "owned_by": "openai", "provider": "telnyx"},
        {"id": "deepseek-ai/DeepSeek-V4.1-Flash", "owned_by": "deepseek-ai", "provider": "telnyx"},
        {"id": "moonshotai/Kimi-K3", "owned_by": "moonshotai", "provider": "telnyx"},
        {"id": "moonshotai/Kimi-K3.1-Pro", "owned_by": "Telnyx", "provider": "telnyx"},
    ]


def test_reasoning_efforts_are_the_catalogues_else_the_documented_table(telnyx):
    assert panel_agent.telnyx_reasoning_efforts("openai/gpt-oss-120b") == ("low", "medium", "high")
    assert panel_agent.telnyx_reasoning_efforts("zai-org/GLM-5.3-Flash") == ("low", "high", "max")
    assert panel_agent.telnyx_reasoning_efforts("deepseek-ai/DeepSeek-V4.1-Flash") == ("none", "low", "high", "max")
    assert panel_agent.telnyx_reasoning_efforts("moonshotai/Kimi-K3") == ()
    with pytest.raises(ValueError, match="supported: low, medium, high"):
        panel_agent.build_model("telnyx", "openai/gpt-oss-120b", "max")


def test_build_model_is_the_sdk_responses_adapter_on_telnyx(telnyx):
    model = panel_agent.build_model("telnyx", "openai/gpt-oss-120b", "high")
    assert isinstance(model, RonTelnyxModel) and isinstance(model, OpenAIResponsesModel)
    assert model.client_args == {"api_key": "telnyx-offline-test", "base_url": panel_agent.TELNYX_INFERENCE_BASE_URL}
    assert model.get_config().get("stateful") is False
    assert model.get_config().get("params") == {"reasoning": {"effort": "high"}}
    assert "params" not in panel_agent.build_model("telnyx", "zai-org/GLM-5.3-Flash").get_config()


@tool
def take_screenshot() -> dict[str, Any]:
    """Return DOM JSON and a PNG screenshot like Playwright MCP browser_take_screenshot."""
    return {"status": "success", "content": [{"json": {"title": "Flights"}},
                                             {"image": {"format": "png", "source": {"bytes": TINY_PNG}}}]}


def _second_turn_output(telnyx: type[_TelnyxHandler], model_id: str) -> tuple[Agent, Any]:
    agent = Agent(model=panel_agent.build_model("telnyx", model_id), system_prompt="You are a browser assistant.",
                  tools=[take_screenshot], callback_handler=None)
    result = asyncio.run(agent.invoke_async("Check flights."))
    assert str(result).strip() == "Done."
    assert len(telnyx.requests) == 2
    request = telnyx.requests[1]
    assert request["stream"] is True and request["store"] is False
    assert request["instructions"] == "You are a browser assistant."
    assert [tool_spec["name"] for tool_spec in request["tools"]] == ["take_screenshot"]
    (output,) = [item["output"] for item in request["input"] if item.get("type") == "function_call_output"]
    return agent, output


def test_a_vision_model_reads_tool_result_images_on_the_wire(telnyx):
    agent, output = _second_turn_output(telnyx, "zai-org/GLM-5.3-Flash")
    assert [part["type"] for part in output] == ["input_text", "input_image"]
    assert output[1]["image_url"].startswith("data:image/png;base64,")
    assert any("reasoningContent" in block for block in agent.messages[-1]["content"])


def test_a_model_without_vision_gets_a_note_instead_of_the_image(telnyx):
    agent, output = _second_turn_output(telnyx, "openai/gpt-oss-120b")
    assert output == '{"title": "Flights"}\n' + OMITTED_TOOL_IMAGE_NOTE
    # The thread keeps the screenshot; only the request to this model goes without it.
    tool_result = next(block["toolResult"] for message in agent.messages for block in message["content"]
                       if "toolResult" in block)
    assert any("image" in item for item in tool_result["content"])


def test_kimi_k3_1_pro_is_the_primary_default_and_uses_chat_completions(telnyx, monkeypatch):
    monkeypatch.setattr(app_config, "GEMINI_API_KEY", "gemini-test")
    monkeypatch.setattr(app_config, "NVIDIA_NIM_API_KEY", "nim-test")
    monkeypatch.setattr(app_config, "MISTRAL_API_KEY", "mistral-test")
    assert panel_agent.PROVIDERS[0] == "telnyx"
    assert panel_agent.provider_default_model("telnyx") == "moonshotai/Kimi-K3.1-Pro"
    assert panel_agent.default_selection() == ("telnyx", "moonshotai/Kimi-K3.1-Pro")
    assert panel_agent.infer_provider("moonshotai/Kimi-K3.1-Pro") == "telnyx"

    model = panel_agent.build_model("telnyx", "moonshotai/Kimi-K3.1-Pro")
    assert isinstance(model, RonTelnyxChatModel) and isinstance(model, OpenAIModel)
    assert model.get_config().get("context_window_limit") == 1_000_000

    agent = Agent(model=model, system_prompt="You are a browser assistant.",
                  tools=[take_screenshot], callback_handler=None)
    result = asyncio.run(agent.invoke_async("Check flights."))
    assert str(result).strip() == "Done."
    assert [req["path"] for req in telnyx.requests] == [
        "/v2/ai/openai/chat/completions",
        "/v2/ai/openai/chat/completions",
    ]
    second_messages = telnyx.requests[1]["messages"]
    assert any(msg.get("role") == "tool" for msg in second_messages)
    image_msgs = [
        part for msg in second_messages if isinstance(msg.get("content"), list)
        for part in msg["content"] if isinstance(part, dict) and part.get("type") == "image_url"
    ]
    assert len(image_msgs) == 1
    assert "format" not in image_msgs[0]["image_url"]
    assert image_msgs[0]["image_url"]["url"].startswith("data:image/png;base64,")
    assert any("reasoningContent" in block for block in agent.messages[-1]["content"])
