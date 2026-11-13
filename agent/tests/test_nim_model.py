"""Tests for RonNIMModel (agent/api/core/nim_model.py) against NVIDIA NIM wire invariants."""

from __future__ import annotations

import asyncio
import copy
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import httpx
import pytest
from strands import Agent, tool
from strands.models.openai import OpenAIModel
from strands.vended_plugins.context_injector import ContextInjector, InjectionContext
from strands_harness.plugins import Todos

from agent.api.core import config as app_config
from agent.api.core import media_capabilities, panel_agent
from agent.api.core.nim_model import OMITTED_TOOL_IMAGE_NOTE, RonNIMModel

TINY_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0"
    b"\x00\x00\x03\x01\x01\x00\xc9\xfe\x92\xef\x00\x00\x00\x00IEND\xaeB`\x82"
)


def test_nim_model_subclasses_sdk_openai_model_and_bounds_reads(monkeypatch):
    monkeypatch.setattr(app_config, "NVIDIA_NIM_API_KEY", "nvapi-offline-test")
    monkeypatch.delenv("NIM_READ_TIMEOUT", raising=False)

    model = panel_agent.build_model("nim", "minimaxai/minimax-m3.1-flash")
    assert type(model) is RonNIMModel
    assert isinstance(model, OpenAIModel)
    assert model.client_args == {
        "api_key": "nvapi-offline-test",
        "base_url": app_config.NVIDIA_NIM_BASE_URL,
        "max_retries": 0,
        "timeout": httpx.Timeout(app_config.NIM_READ_TIMEOUT, connect=10.0),
    }

    monkeypatch.setenv("NIM_READ_TIMEOUT", "15")
    short = panel_agent.build_model("nim", "minimaxai/minimax-m3.1-flash")
    assert short.client_args["timeout"] == httpx.Timeout(15.0, connect=10.0)
    assert short.client_args["max_retries"] == 0

    # Explicit read_timeout (e.g. Build Agent's RON_BUILD_NIM_READ_TIMEOUT) takes precedence.
    explicit = panel_agent.build_model("nim", "z-ai/glm-5.3-flash", "max", read_timeout=20.0)
    assert explicit.client_args["timeout"] == httpx.Timeout(20.0, connect=10.0)
    assert explicit.client_args["max_retries"] == 0

    # 0 disables the read timeout while keeping HTTP client retries off.
    monkeypatch.setenv("NIM_READ_TIMEOUT", "0")
    unbounded = panel_agent.build_model("nim", "minimaxai/minimax-m3.1-flash")
    assert "timeout" not in unbounded.client_args
    assert unbounded.client_args["max_retries"] == 0


def test_tool_result_images_are_dropped_for_nim_and_heal_saved_screenshot_threads(monkeypatch):
    monkeypatch.setattr(app_config, "NVIDIA_NIM_API_KEY", "nvapi-offline-test")
    model = panel_agent.build_model("nim", "minimaxai/minimax-m3.1-flash")

    messages: list[dict[str, Any]] = [
        {"role": "user", "content": [{"text": "Take a screenshot of Google Flights"}]},
        {
            "role": "assistant",
            "content": [
                {"reasoningContent": {"reasoningText": {"text": "Capturing page"}}},
                {
                    "toolUse": {
                        "toolUseId": "call_shot_1",
                        "name": "user_browser_playwright_browser_take_screenshot",
                        "input": {},
                    }
                },
            ],
        },
        {
            "role": "user",
            "content": [
                {
                    "toolResult": {
                        "toolUseId": "call_shot_1",
                        "status": "success",
                        "content": [
                            {"json": {"url": "https://www.google.com/travel/flights", "title": "Flights"}},
                            {"image": {"format": "png", "source": {"bytes": TINY_PNG}}},
                        ],
                    }
                }
            ],
        },
    ]
    original = copy.deepcopy(messages)
    request = model.format_request(messages, system_prompt="Be concise")
    formatted = request["messages"]

    assert [m["role"] for m in formatted] == ["system", "user", "assistant", "tool"]
    assert formatted[3] == {
        "role": "tool",
        "tool_call_id": "call_shot_1",
        "content": '{"url": "https://www.google.com/travel/flights", "title": "Flights"}',
    }
    assert "image_url" not in json.dumps(formatted)
    assert messages == original

    # Image-only toolResult keeps a non-empty note so strict schemas never see content="".
    image_only = [
        {"role": "user", "content": [{"text": "Show image"}]},
        {"role": "assistant", "content": [{"toolUse": {"toolUseId": "call_img", "name": "shot", "input": {}}}]},
        {
            "role": "user",
            "content": [
                {
                    "toolResult": {
                        "toolUseId": "call_img",
                        "status": "success",
                        "content": [{"image": {"format": "png", "source": {"bytes": TINY_PNG}}}],
                    }
                }
            ],
        },
    ]
    only_formatted = model.format_request(image_only)["messages"]
    assert only_formatted[-1] == {
        "role": "tool",
        "tool_call_id": "call_img",
        "content": OMITTED_TOOL_IMAGE_NOTE,
    }


def test_vision_capable_nim_model_splits_standard_image_url_without_nonstandard_format_key(monkeypatch):
    monkeypatch.setattr(app_config, "NVIDIA_NIM_API_KEY", "nvapi-offline-test")
    monkeypatch.setattr(media_capabilities, "cached_tool_result_images", lambda provider, model_id: True)
    from agent.api.core import nim_model

    monkeypatch.setattr(nim_model, "cached_tool_result_images", lambda provider, model_id: True)
    model = panel_agent.build_model("nim", "future-vision-model")
    messages: list[dict[str, Any]] = [
        {"role": "user", "content": [{"text": "Inspect"}]},
        {"role": "assistant", "content": [{"toolUse": {"toolUseId": "c1", "name": "shot", "input": {}}}]},
        {
            "role": "user",
            "content": [
                {
                    "toolResult": {
                        "toolUseId": "c1",
                        "status": "success",
                        "content": [
                            {"text": "captured"},
                            {"image": {"format": "png", "source": {"bytes": TINY_PNG}}},
                        ],
                    }
                },
                {"text": "<system-reminder>Context</system-reminder>"},
            ],
        },
    ]
    formatted = model.format_request(messages)["messages"]
    assert [m["role"] for m in formatted] == ["user", "assistant", "tool", "user"]
    image_part = formatted[3]["content"][0]
    assert image_part["type"] == "image_url"
    assert set(image_part["image_url"].keys()) == {"detail", "url"}
    assert formatted[3]["content"][1] == {"type": "text", "text": "<system-reminder>Context</system-reminder>"}


@pytest.mark.parametrize("tool_count", [1, 2])
@pytest.mark.parametrize("inline_context", [False, True])
@pytest.mark.parametrize("context", [None, "<system-reminder>Your current todo list: []</system-reminder>", "Steering"])
def test_tool_results_precede_injected_user_text(monkeypatch, tool_count, inline_context, context):
    monkeypatch.setattr(app_config, "NVIDIA_NIM_API_KEY", "nvapi-offline-test")
    model = panel_agent.build_model("nim", "z-ai/glm-5.3-flash", "high")
    ids = [f"call0000{i}" for i in range(tool_count)]
    tool_result_blocks = [
        {"toolResult": {"toolUseId": call_id, "status": "success", "content": [{"text": "done"}]}}
        for call_id in ids
    ]
    if context and inline_context:
        trailing = [{"role": "user", "content": [*tool_result_blocks, {"text": context}]}]
    else:
        trailing = [
            {"role": "user", "content": tool_result_blocks},
            *([{"role": "user", "content": [{"text": context}]}] if context else []),
        ]
    messages = [
        {"role": "user", "content": [{"text": "Check the browser"}]},
        {
            "role": "assistant",
            "content": [
                {"reasoningContent": {"reasoningText": {"text": "Inspecting first"}}},
                *[{"toolUse": {"toolUseId": call_id, "name": "inspect", "input": {}}} for call_id in ids],
            ],
        },
        *trailing,
    ]
    original = copy.deepcopy(messages)
    request = model.format_request(messages, system_prompt="Be helpful")
    formatted = request["messages"]
    assert [m["role"] for m in formatted] == [
        "system",
        "user",
        "assistant",
        *(["tool"] * tool_count),
        *(["user"] if context else []),
    ]
    assert [m["tool_call_id"] for m in formatted if m["role"] == "tool"] == ids
    if context:
        assert formatted[-1]["content"] == [{"type": "text", "text": context}]
    assert messages == original


def test_empty_or_none_tool_specs_omit_tools_and_tool_choice(monkeypatch):
    monkeypatch.setattr(app_config, "NVIDIA_NIM_API_KEY", "nvapi-offline-test")
    model = panel_agent.build_model("nim", "minimaxai/minimax-m3.1-flash")
    messages = [{"role": "user", "content": [{"text": "Summarize this conversation."}]}]

    req_none = model.format_request(messages, tool_specs=None)
    assert "tools" not in req_none
    assert "tool_choice" not in req_none

    req_empty = model.format_request(messages, tool_specs=[], tool_choice={"auto": {}})
    assert "tools" not in req_empty
    assert "tool_choice" not in req_empty

    spec = {
        "name": "ping",
        "description": "Ping",
        "inputSchema": {"json": {"type": "object", "properties": {}}},
    }
    req_with_tool = model.format_request(messages, tool_specs=[spec], tool_choice={"auto": {}})
    assert len(req_with_tool["tools"]) == 1
    assert req_with_tool["tool_choice"] == "auto"


def test_reasoning_only_assistant_turn_preserves_role_alternation(monkeypatch):
    monkeypatch.setattr(app_config, "NVIDIA_NIM_API_KEY", "nvapi-offline-test")
    model = panel_agent.build_model("nim", "z-ai/glm-5.3-flash", "max")
    messages = [
        {"role": "user", "content": [{"text": "First prompt"}]},
        {"role": "assistant", "content": [{"reasoningContent": {"reasoningText": {"text": "Thinking interrupted..."}}}]},
        {"role": "user", "content": [{"text": "[recovery] Continue."}]},
    ]
    formatted = model.format_request(messages, system_prompt="System")["messages"]
    assert [m["role"] for m in formatted] == ["system", "user", "assistant", "user"]
    assert formatted[2] == {"role": "assistant", "content": ""}


class _StrictNIMHandler(BaseHTTPRequestHandler):
    """Strict OpenAI Chat Completions / NVIDIA NIM validator for end-to-end Strands Agent loop tests."""

    requests: list[dict[str, Any]] = []

    def _reject(self, status: int, payload: dict[str, Any]) -> None:
        raw = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self) -> None:  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        type(self).requests.append(body)

        # Invariant 1: NIM rejects `"tools": []` with HTTP 400.
        if "tools" in body and body["tools"] == []:
            self._reject(
                400,
                {
                    "message": "Validation: tools array cannot be empty; omit the field entirely to disable tool use",
                    "type": "Bad Request",
                    "code": 400,
                },
            )
            return

        # Invariant 2: Non-vision NIM endpoints reject screenshot image_url payloads (422 safety screening).
        messages = body.get("messages") or []
        if "image_url" in json.dumps(messages):
            self._reject(422, {"error": {"message": "input rejected by content safety screening"}})
            return

        # Invariant 3: Every assistant message with tool_calls must be immediately followed by its tool results,
        # never interrupted by a role="user" message, and no two user messages may appear consecutively.
        expected_tool_ids: list[str] = []
        prev_role: str | None = None
        for msg in messages:
            role = msg["role"]
            if expected_tool_ids:
                if role != "tool" or msg.get("tool_call_id") not in expected_tool_ids:
                    self._reject(
                        400,
                        {"error": {"message": f"Expected tool result for {expected_tool_ids}, got role={role!r}"}},
                    )
                    return
                expected_tool_ids.remove(msg["tool_call_id"])
            elif role == "user" and prev_role == "user":
                self._reject(400, {"error": {"message": "Consecutive user messages are not allowed"}})
                return

            if role == "assistant" and msg.get("tool_calls"):
                expected_tool_ids = [tc["id"] for tc in msg["tool_calls"]]
            prev_role = role

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        chunk = {"id": "nim-1", "object": "chat.completion.chunk", "created": 0, "model": body["model"]}

        has_tool_result = any(m["role"] == "tool" for m in messages)
        if body.get("tools") and not has_tool_result:
            events = [
                {
                    **chunk,
                    "choices": [
                        {
                            "index": 0,
                            "delta": {"role": "assistant", "reasoning_content": "Let me take a screenshot first."},
                            "finish_reason": None,
                        }
                    ],
                },
                {
                    **chunk,
                    "choices": [
                        {
                            "index": 0,
                            "delta": {
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "id": "call_nim_1",
                                        "type": "function",
                                        "function": {"name": "take_screenshot", "arguments": "{}"},
                                    }
                                ]
                            },
                            "finish_reason": None,
                        }
                    ],
                },
                {**chunk, "choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}]},
            ]
        else:
            events = [
                {
                    **chunk,
                    "choices": [
                        {
                            "index": 0,
                            "delta": {"role": "assistant", "reasoning_content": "Read DOM snapshot.", "content": "Done."},
                            "finish_reason": None,
                        }
                    ],
                },
                {**chunk, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
                {**chunk, "choices": [], "usage": {"prompt_tokens": 20, "completion_tokens": 5, "total_tokens": 25}},
            ]
        for event in events:
            self.wfile.write(f"data: {json.dumps(event)}\n\n".encode())
        self.wfile.write(b"data: [DONE]\n\n")

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        del format, args


def test_end_to_end_strands_agent_loop_against_strict_nim_server(monkeypatch):
    server = ThreadingHTTPServer(("127.0.0.1", 0), _StrictNIMHandler)
    server.daemon_threads = True
    _StrictNIMHandler.requests = []
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setattr(app_config, "NVIDIA_NIM_API_KEY", "nvapi-offline-test")
    monkeypatch.setattr(panel_agent, "NVIDIA_NIM_BASE_URL", f"http://127.0.0.1:{server.server_port}/v1")

    @tool
    def take_screenshot() -> dict[str, Any]:
        """Return both DOM JSON and a PNG screenshot like Playwright MCP browser_take_screenshot."""
        return {
            "status": "success",
            "content": [
                {"json": {"title": "Flights", "price": "$199"}},
                {"image": {"format": "png", "source": {"bytes": TINY_PNG}}},
            ],
        }

    async def render_browser_context(_ctx: InjectionContext) -> str:
        return "Active tab: https://www.google.com/travel/flights"

    injector = ContextInjector(render_browser_context, trigger="everyTurn", name="ron:request-context")

    try:
        lead = Agent(
            model=panel_agent.build_model("nim", "minimaxai/minimax-m3.1-flash"),
            system_prompt="You are a browser assistant.",
            tools=[take_screenshot],
            plugins=[Todos(), injector],
            callback_handler=None,
        )
        result = asyncio.run(lead.invoke_async("Check flights."))
        assert str(result).strip() == "Done."
        assert len(_StrictNIMHandler.requests) == 2
        second_roles = [m["role"] for m in _StrictNIMHandler.requests[1]["messages"]]
        assert second_roles == ["system", "user", "assistant", "tool", "user"]

        # Tool-less side call (e.g. SummarizingConversationManager / MemoryExtractor / GoalLoop judge).
        side = Agent(
            model=panel_agent.build_model("nim", "minimaxai/minimax-m3.1-flash"),
            system_prompt="Summarize.",
            callback_handler=None,
        )
        side_result = asyncio.run(side.invoke_async("Summarize this turn."))
        assert str(side_result).strip() == "Done."
        assert "tools" not in _StrictNIMHandler.requests[2]
    finally:
        server.shutdown()
        server.server_close()
