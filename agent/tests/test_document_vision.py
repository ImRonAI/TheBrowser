import asyncio
import base64
import shutil
import subprocess

import pytest
from pydantic import ValidationError

from agent.api.core import document_vision
from agent.api.core import media_capabilities as caps
from agent.api.endpoints.chat import ChatRequest


def _sample_png_data_url() -> str:
    if shutil.which("ffmpeg"):
        png_bytes = subprocess.run(
            ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=white:s=64x48", "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "pipe:1"],
            check=True,
            capture_output=True,
        ).stdout
    else:
        # Valid 1x1 white PNG
        png_bytes = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC"
        )
    return "data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii")


def test_nim_minimax_m3_1_flash_is_registered_as_vision_capable():
    cap = caps.media_capability("nim", "minimaxai/minimax-m3.1-flash")
    assert cap.known is True
    assert cap.image is True
    assert cap.tool_result_images is False

    other_nim = caps.media_capability("nim", "z-ai/glm5.3")
    assert other_nim.known is False
    assert other_nim.image is False


def test_vision_lead_model_receives_screen_frame_image_block_directly():
    data_url = _sample_png_data_url()
    image_blocks, note = asyncio.run(
        document_vision.prepare_document_screen_input(
            screen_frame=data_url,
            provider="gemini",
            model_id="gemini-3.5-flash",
            user_goal="Add a section summarizing the new grid battery benchmarks.",
            context_summary="- Tab: Grid Battery Installations Surge",
        )
    )
    assert len(image_blocks) == 1
    assert image_blocks[0]["image"]["format"] in ("png", "jpeg")
    assert isinstance(image_blocks[0]["image"]["source"]["bytes"], bytes)
    assert note and "attached as an image block" in note


def test_text_only_lead_model_relays_goal_to_minimax_m3_1_flash_eyes(monkeypatch):
    data_url = _sample_png_data_url()
    captured = {}

    class FakeMiniMaxModel:
        def update_config(self, **kwargs):
            captured["config"] = kwargs

        async def stream(self, messages, tool_specs=None, system_prompt=None):
            captured["messages"] = messages
            captured["system_prompt"] = system_prompt
            yield {"contentBlockDelta": {"delta": {"text": "Title: Q4 Architecture Notes. Sections: Overview, Risks. Append battery benchmarks after Overview."}}}

    def fake_build_model(provider, model_id, effort=None, *, hosted_tools=True, read_timeout=None):
        captured["provider"] = provider
        captured["model_id"] = model_id
        captured["effort"] = effort
        captured["read_timeout"] = read_timeout
        return FakeMiniMaxModel()

    monkeypatch.setattr("agent.api.core.panel_agent.provider_api_key", lambda p: "test-key" if p == "nim" else "")
    monkeypatch.setattr("agent.api.core.panel_agent.build_model", fake_build_model)

    image_blocks, note = asyncio.run(
        document_vision.prepare_document_screen_input(
            screen_frame=data_url,
            provider="nim",
            model_id="z-ai/glm5.3",  # non-vision lead model
            user_goal="Document the key latency takeaways under a new 'Interconnect Benchmarks' heading.",
            context_summary="- Tab: Systems Architecture Breakdown",
        )
    )
    assert image_blocks == []
    assert captured["provider"] == "nim"
    assert captured["model_id"] == "minimaxai/minimax-m3.1-flash"
    sent_blocks = captured["messages"][0]["content"]
    assert "image" in sent_blocks[0]
    assert "Interconnect Benchmarks" in sent_blocks[1]["text"]
    assert "Systems Architecture Breakdown" in sent_blocks[1]["text"]
    assert note and "MiniMax M3.1 Flash acting as your eyes" in note
    assert "Title: Q4 Architecture Notes" in note


def test_chat_request_validates_screen_frame_on_message_only():
    data_url = _sample_png_data_url()
    ok = ChatRequest(session_id="doc-session-1", message="Update the intro", destination="document", screen_frame=data_url)
    assert ok.screen_frame == data_url

    with pytest.raises(ValidationError):
        ChatRequest(session_id="doc-session-1", action="checkpoint_resume", screen_frame=data_url)

    with pytest.raises(ValueError):
        asyncio.run(document_vision.decode_screen_frame("javascript:alert(1)"))


def test_force_eyes_uses_minimax_relay_even_when_nominal_selection_has_vision(monkeypatch):
    data_url = _sample_png_data_url()
    monkeypatch.setattr(shutil, "which", lambda _cmd: None)
    monkeypatch.setattr(
        document_vision,
        "load_capability",
        lambda _p, _m: asyncio.sleep(0, result=MediaCapability(frozenset({"image"}), True)),
    )

    class FakeMiniMaxModel:
        def update_config(self, **_kwargs):
            return None

        async def stream(self, *_args, **_kwargs):
            yield {"contentBlockDelta": {"delta": {"text": "Title: Existing Spec\nVisible section: ## Overview"}}}

    monkeypatch.setattr("agent.api.core.panel_agent.provider_api_key", lambda p: "test-key" if p == "nim" else "")
    monkeypatch.setattr("agent.api.core.panel_agent.build_model", lambda *_a, **_kw: FakeMiniMaxModel())

    image_blocks, note = asyncio.run(
        document_vision.prepare_document_screen_input(
            screen_frame=data_url,
            provider="nim",
            model_id="minimaxai/minimax-m3.1-flash",
            user_goal="Append a rollout section.",
            force_eyes=True,
        )
    )
    assert image_blocks == []
    assert note and "Existing Spec" in note


def test_document_agent_scope_excludes_host_shell_editor_and_repo_environment(monkeypatch, tmp_path):
    from strands.models.model import Model
    from strands.storage import InMemoryStorage
    from agent.api.core import panel_agent as composition

    class StubModel(Model):
        def get_config(self):
            return {"model_id": "zai-glm-5-3-flash", "stateful": False, "context_window_limit": 1_048_576}

        def update_config(self, **_kwargs):
            return None

        async def structured_output(self, *_args, **_kwargs):
            raise NotImplementedError
            yield

        async def stream(self, *_args, **_kwargs):
            yield {"messageStart": {"role": "assistant"}}
            yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "# Draft"}}}
            yield {"contentBlockStop": {"contentBlockIndex": 0}}
            yield {"messageStop": {"stopReason": "end_turn"}}

    built_candidates: list[tuple[str, str, str | None]] = []

    def fake_build_model(provider, model_id, effort=None, **_kwargs):
        built_candidates.append((provider, model_id, effort))
        return StubModel()

    monkeypatch.setattr(composition, "configured_providers", lambda: ["nim", "mistral"])
    monkeypatch.setattr(composition, "build_model", fake_build_model)
    monkeypatch.setattr(composition, "get_user_session_storage", lambda _u: InMemoryStorage())
    monkeypatch.setattr("agent.api.core.config.PERPLEXITY_API_KEY", "")

    agent = composition.create_panel_agent(
        provider="nim",
        model_id="minimaxai/minimax-m3.1-flash",
        session_id="doc-scope-check",
        user_id="user-1",
        system_prompt="You are Document Agent.",
        extra_tools=[],
        agent_scope="document",
    )
    try:
        registered = set(agent.tool_registry.registry.keys())
        assert "shell" not in registered
        assert "editor" not in registered
        assert "mcp_client" not in registered
        assert "tool_catalog" not in registered
        assert "render_ui" not in registered
        assert {"http_request", "brave_web_search", "brave_image_search", "brave_video_search", "render_workflow"} <= registered
        assert built_candidates == [
            ("mistral", "zai-glm-5-3-flash", "low"),
            ("nim", "z-ai/glm-5.3-flash", "low"),
            ("mistral", "zai-glm-5-3", "low"),
        ]
    finally:
        agent.cleanup()
