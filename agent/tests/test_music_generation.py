"""Batch music generation tools (Lyria 3.5 via Interactions API, ElevenLabs Music), offline."""

from __future__ import annotations

import base64
import json
from types import SimpleNamespace

import httpx
import pytest
from strands.tools.decorator import DecoratedFunctionTool
from strands.tools.registry import ToolRegistry

from agent.api.core import config, music_generation as mg


def mp3_frames(count: int, *, version1: bool = True, stereo: bool = True) -> bytes:
    """Synthetic MPEG Layer III frames: 128 kbps, 44.1 kHz (v1) or 64 kbps, 22.05 kHz (v2), no padding."""
    if version1:
        header = bytes([0xFF, 0xFB, 0x90 | 0x00, 0x00 if stereo else 0xC0])  # v1 L3, bitrate idx 9 = 128k, 44100
        length = (1152 // 8 * 128000) // 44100  # 417
    else:
        header = bytes([0xFF, 0xF3, 0x80, 0x00 if stereo else 0xC0])  # v2 L3, bitrate idx 8 = 64k, 22050
        length = (576 // 8 * 64000) // 22050  # 209
    frame = header + b"\x00" * (length - 4)
    return frame * count


def test_mp3_info_reads_duration_rate_and_channels_from_frame_headers():
    data = b"ID3" + bytes([4, 0, 0, 0, 0, 0, 10]) + b"\x00" * 10 + mp3_frames(100)  # ID3v2 header (size 10) then 100 frames
    duration, rate, channels = mg.mp3_info(data)
    assert rate == 44100 and channels == 2
    assert duration == pytest.approx(100 * 1152 / 44100, abs=0.01)
    duration2, rate2, channels2 = mg.mp3_info(mp3_frames(10, version1=False, stereo=False))
    assert (rate2, channels2) == (22050, 1) and duration2 == pytest.approx(10 * 576 / 22050, abs=0.01)
    assert mg.mp3_info(b"not an mp3 at all") == (0.0, 0, 0)


def test_lyria_input_is_a_string_or_text_plus_image_content():
    assert mg.lyria_input("  piano  ", None, None) == "piano"
    assert mg.lyria_input("piano", "QUJD", "image/png") == [{"type": "text", "text": "piano"}, {"type": "image", "mime_type": "image/png", "data": "QUJD"}]
    with pytest.raises(ValueError):
        mg.lyria_input("", None, None)
    with pytest.raises(ValueError):
        mg.lyria_input("x", "QUJD", "image/svg+xml")


@pytest.mark.asyncio
async def test_lyria_generate_calls_interactions_create_like_the_docs():
    calls = []

    class Interactions:
        async def create(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(status="completed", id="v1_abc", output_text="<instrumental>",
                                   output_audio=SimpleNamespace(data=base64.b64encode(mp3_frames(5)).decode(), mime_type="audio/mpeg"))

    client = SimpleNamespace(aio=SimpleNamespace(interactions=Interactions()))
    result = await mg.lyria_generate("acoustic guitar", model="lyria-3-clip-preview", client=client, timeout=5)
    assert calls == [{"model": "lyria-3-clip-preview", "input": "acoustic guitar"}]
    assert result["mime_type"] == "audio/mpeg" and result["lyrics"] == "<instrumental>" and result["interaction_id"] == "v1_abc"
    assert result["audio"] == mp3_frames(5)
    await mg.lyria_generate("piano", audio_only=True, client=client, timeout=5)
    assert calls[-1] == {"model": "lyria-3.5", "input": "piano", "response_format": {"type": "audio"}}
    with pytest.raises(ValueError, match="model must be one of"):
        await mg.lyria_generate("x", model="lyria-9", client=client)

    class Blocked:
        async def create(self, **kwargs):
            return SimpleNamespace(status="failed", id="v1_x", output_text=None, output_audio=None, errors=[{"message": "safety"}])

    with pytest.raises(RuntimeError, match="failed"):
        await mg.lyria_generate("x", client=SimpleNamespace(aio=SimpleNamespace(interactions=Blocked())), timeout=5)


def test_parse_multipart_mixed_splits_metadata_and_audio():
    boundary = "ronboundary"
    meta = {"composition_plan": {"sections": [{"section_name": "Verse 1", "lines": ["la la"], "duration_ms": 10000}]}, "song_metadata": {"title": "My Song"}}
    body = (f"--{boundary}\r\nContent-Type: application/json\r\n\r\n{json.dumps(meta)}\r\n"
            f"--{boundary}\r\nContent-Type: audio/mpeg\r\n\r\n").encode() + mp3_frames(3) + f"\r\n--{boundary}--\r\n".encode()
    parsed, audio, ctype = mg.parse_multipart_mixed(f'multipart/mixed; boundary="{boundary}"', body)
    assert parsed == meta and audio == mp3_frames(3) and ctype == "audio/mpeg"
    # binary payload edges that look like CR/LF survive: only the single delimiter CRLF is removed
    edgy = b"\r\n\n" + mp3_frames(2) + b"\n\r\n\r"
    body2 = (f"--{boundary}\r\nContent-Type: application/json\r\n\r\n{{}}\r\n--{boundary}\r\nContent-Type: audio/mpeg\r\n\r\n").encode() + edgy + f"\r\n--{boundary}--\r\n".encode()
    _, audio2, _ = mg.parse_multipart_mixed(f"multipart/mixed; boundary={boundary}", body2)
    assert audio2 == edgy
    with pytest.raises(ValueError, match="boundary"):
        mg.parse_multipart_mixed("multipart/mixed", body)


@pytest.mark.asyncio
async def test_elevenlabs_compose_posts_v1_music_detailed_and_parses_the_response(monkeypatch):
    monkeypatch.setattr(config, "ELEVENLABS_API_KEY", "xi-test", raising=False)
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url); seen["headers"] = dict(request.headers); seen["body"] = json.loads(request.content)
        if request.url.path == "/v1/music/plan":
            return httpx.Response(200, json={"positive_global_styles": ["pop"], "sections": [{"section_name": "Verse 1", "duration_ms": 10000, "lines": ["hello"]}]})
        boundary = "b1"
        meta = {"composition_plan": {"positive_global_styles": ["pop"], "sections": [{"section_name": "Verse 1", "duration_ms": 10000, "lines": ["hello", "world"]}]},
                "song_metadata": {"title": "Hello World", "genres": ["pop"]}}
        body = (f"--{boundary}\r\nContent-Type: application/json\r\n\r\n{json.dumps(meta)}\r\n--{boundary}\r\nContent-Type: audio/mpeg\r\n\r\n").encode() \
            + mp3_frames(4) + f"\r\n--{boundary}--".encode()
        return httpx.Response(200, content=body, headers={"content-type": f'multipart/mixed; boundary="{boundary}"', "song-id": "song-42"})

    http = httpx.AsyncClient(base_url=mg.ELEVENLABS_BASE_URL, transport=httpx.MockTransport(handler))
    result = await mg.elevenlabs_compose(prompt="an upbeat pop song", music_length_ms=10000, force_instrumental=False, seed=7, http=http)
    assert seen["url"] == "https://api.elevenlabs.io/v1/music/detailed"
    assert seen["headers"]["xi-api-key"] == "xi-test"
    assert seen["body"] == {"model_id": "music_v2_5", "prompt": "an upbeat pop song", "music_length_ms": 10000, "force_instrumental": False, "seed": 7}
    assert result["audio"] == mp3_frames(4) and result["song_id"] == "song-42" and result["song_metadata"]["title"] == "Hello World"
    assert result["composition_plan"]["sections"][0]["lines"] == ["hello", "world"]

    plan = await mg.elevenlabs_plan(prompt="a lullaby", music_length_ms=30000, http=http)
    assert seen["url"].endswith("/v1/music/plan") and seen["body"] == {"prompt": "a lullaby", "model_id": "music_v2_5", "music_length_ms": 30000}
    assert plan["positive_global_styles"] == ["pop"]

    composed = await mg.elevenlabs_compose(composition_plan=plan, http=http)
    assert seen["body"] == {"model_id": "music_v2_5", "composition_plan": plan}
    assert composed["audio"]
    with pytest.raises(ValueError, match="exactly one"):
        await mg.elevenlabs_compose(prompt="x", composition_plan=plan, http=http)
    with pytest.raises(ValueError, match="music_length_ms"):
        await mg.elevenlabs_compose(prompt="x", music_length_ms=1000, http=http)
    await http.aclose()


@pytest.mark.asyncio
async def test_generation_tools_are_native_async_tools_that_save_through_store_song(monkeypatch):
    saved = []

    async def saver(user_id, **kwargs):
        saved.append((user_id, kwargs))
        return {"song_id": "s1", "title": kwargs["title"], "source": kwargs["source"], "format": kwargs["fmt"],
                "duration_seconds": kwargs["duration_seconds"], "storage_path": f"{user_id}/s1.mp3", "signed_url": "https://x/s1"}

    async def lyria(prompt, **kwargs):
        return {"audio": mp3_frames(20), "mime_type": "audio/mpeg", "lyrics": "[Verse]\nhi", "interaction_id": "v1", "status": "completed", "model": kwargs["model"]}

    async def compose(**kwargs):
        return {"audio": mp3_frames(10), "mime_type": "audio/mpeg", "composition_plan": {"sections": [{"lines": ["a", "b"]}]},
                "song_metadata": {"title": "Planned"}, "song_id": "e1", "model_id": kwargs["model_id"]}

    async def plan(**kwargs):
        return {"sections": []}

    tools = mg.MusicGenerationTools("owner-1", saver=saver, lyria=lyria, compose=compose, plan=plan)
    registry = ToolRegistry()
    registry.process_tools(tools.tools)
    assert set(registry.registry) == {"lyria_generate_song", "elevenlabs_compose_song", "elevenlabs_composition_plan"}
    assert all(isinstance(t, DecoratedFunctionTool) for t in tools.tools)
    schema = registry.registry["lyria_generate_song"].tool_spec["inputSchema"]["json"]
    assert schema["properties"]["model"]["enum"] == ["lyria-3.5", "lyria-3-clip-preview"] and schema["required"] == ["prompt"]
    el_schema = registry.registry["elevenlabs_compose_song"].tool_spec["inputSchema"]["json"]
    assert el_schema["properties"]["model_id"]["enum"] == ["music_v2_5", "music_v2", "music_v1"]

    result = await tools.lyria_generate_song(prompt="a sunny indie song", title="Sunny")
    assert result["saved"] is True and result["song_id"] == "s1" and result["lyrics"] == "[Verse]\nhi"
    assert result["duration_seconds"] == pytest.approx(20 * 1152 / 44100, abs=0.01)
    assert saved[-1][0] == "owner-1" and saved[-1][1]["source"] == "lyria" and saved[-1][1]["fmt"] == "mp3" and saved[-1][1]["sample_rate"] == 44100

    unsaved = await tools.lyria_generate_song(prompt="x", save=False)
    assert unsaved["saved"] is False and "song_id" not in unsaved and len(saved) == 1

    composed = await tools.elevenlabs_compose_song(prompt="pop", music_length_ms=10000)
    assert composed["saved"] is True and composed["elevenlabs_song_id"] == "e1"
    assert saved[-1][1]["title"] == "Planned" and saved[-1][1]["lyrics"] == "a\nb" and saved[-1][1]["source"] == "elevenlabs"
    assert (await tools.elevenlabs_composition_plan(prompt="x")) == {"sections": []}

    async def failing(prompt, **kwargs):
        raise RuntimeError("blocked by safety filter")

    broken = mg.MusicGenerationTools("owner-1", saver=saver, lyria=failing, compose=compose, plan=plan)
    out = await broken.lyria_generate_song(prompt="x")
    assert out["status"] == "error" and "blocked" in out["content"][0]["text"]

    async def guest_saver(user_id, **kwargs):
        raise PermissionError("Sign in to Ron to save music")

    guest = mg.MusicGenerationTools("guest:abc", saver=guest_saver, lyria=lyria, compose=compose, plan=plan)
    out = await guest.lyria_generate_song(prompt="x")
    assert out["saved"] is False and "Sign in" in out["save_error"], "generation succeeds; only the save is refused"


def test_generation_tools_follow_provider_keys_and_the_kill_switch(monkeypatch):
    monkeypatch.setattr(config, "GEMINI_API_KEY", "g", raising=False)
    monkeypatch.setattr(config, "ELEVENLABS_API_KEY", None, raising=False)
    assert [t.tool_name for t in mg.music_generation_tools("u")] == ["lyria_generate_song"]
    monkeypatch.setattr(config, "ELEVENLABS_API_KEY", "xi", raising=False)
    assert [t.tool_name for t in mg.music_generation_tools("u")] == ["lyria_generate_song", "elevenlabs_compose_song", "elevenlabs_composition_plan"]
    monkeypatch.setattr(config, "MUSIC_GENERATION_ENABLED", False, raising=False)
    assert mg.music_generation_tools("u") == []
