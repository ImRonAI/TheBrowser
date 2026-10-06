"""Live Music (Lyria RealTime): native async tools over the official google-genai music session, offline."""

from __future__ import annotations

import asyncio
import base64
import contextlib
from types import SimpleNamespace

import pytest
from fastapi import Request
from strands.tools.decorator import DecoratedFunctionTool
from strands.tools.registry import ToolRegistry

from agent.api.core import live_music
from agent.api.core.live_music import (
    LYRIA_SKILL_DIR, LiveMusicSession, LiveMusicTools, audio_chunk_frame, lyria_skill, lyria_skills_plugin,
    skills_prompt_block, validate_config, validate_prompts,
)


class FakeMusicSession:
    """Stands in for ``google.genai.live_music.AsyncMusicSession``: records calls, yields scripted messages."""

    def __init__(self, messages):
        self.calls: list[tuple] = []
        self._messages = messages
        self.closed = False

    async def set_weighted_prompts(self, prompts):
        self.calls.append(("prompts", [(p.text, p.weight) for p in prompts]))

    async def set_music_generation_config(self, config):
        self.calls.append(("config", config.model_dump(exclude_none=True)))

    async def play(self): self.calls.append(("play",))
    async def pause(self): self.calls.append(("pause",))
    async def stop(self): self.calls.append(("stop",))
    async def reset_context(self): self.calls.append(("reset_context",))

    async def receive(self):
        for message in self._messages:
            yield message
        await asyncio.Event().wait()

    async def close(self):
        self.closed = True


class FakeClient:
    def __init__(self, session):
        self.connected_with: list[str] = []
        self.aio = SimpleNamespace(live=SimpleNamespace(music=self))
        self._session = session

    @contextlib.asynccontextmanager
    async def connect(self, *, model):
        self.connected_with.append(model)
        yield self._session


def scripted_messages():
    chunk = SimpleNamespace(data=b"\x00\x01" * 4, mime_type="audio/l16;rate=48000;channels=2", source_metadata=None)
    return [
        SimpleNamespace(setup_complete=object(), server_content=None, filtered_prompt=None),
        SimpleNamespace(setup_complete=None, server_content=SimpleNamespace(audio_chunks=[chunk]), filtered_prompt=None),
        SimpleNamespace(setup_complete=None, server_content=None,
                        filtered_prompt=SimpleNamespace(text="bad words", filtered_reason="SAFETY")),
    ]


def test_prompt_and_config_validation_follow_the_api_reference():
    assert validate_prompts([{"text": " techno ", "weight": 1}]) == [{"text": "techno", "weight": 1.0}]
    with pytest.raises(ValueError, match="must not be 0"):
        validate_prompts([{"text": "x", "weight": 0}])
    with pytest.raises(ValueError, match="non-empty"):
        validate_prompts([])
    with pytest.raises(ValueError, match="text must be"):
        validate_prompts([{"weight": 1}])
    fields = validate_config({"bpm": 120.0, "scale": "D_MAJOR_B_MINOR", "density": None, "mute_bass": True,
                              "music_generation_mode": "DIVERSITY"})
    assert fields == {"bpm": 120, "scale": "D_MAJOR_B_MINOR", "mute_bass": True, "music_generation_mode": "DIVERSITY"}
    for bad in ({"bpm": 30}, {"guidance": 7}, {"scale": "H_MAJOR"}, {"music_generation_mode": "LOUD"}, {"mute_drums": "yes"},
                {"temperature": 3.5}, {"top_k": 0}):
        with pytest.raises(ValueError):
            validate_config(bad)


def test_audio_chunk_frame_carries_rate_and_channels_from_the_mime_type():
    frame = audio_chunk_frame(SimpleNamespace(data=b"\x01\x02", mime_type="audio/l16;rate=44100;channels=1"))
    assert frame == {"type": "music_audio_delta", "audio": base64.b64encode(b"\x01\x02").decode(), "format": "pcm",
                     "sample_rate": 44100, "channels": 1, "mime_type": "audio/l16;rate=44100;channels=1"}
    assert audio_chunk_frame(SimpleNamespace(data=b"", mime_type=None)) is None
    default = audio_chunk_frame(SimpleNamespace(data=b"\x00", mime_type=None))
    assert (default["sample_rate"], default["channels"]) == (48000, 2)


def test_tools_are_native_async_class_based_tools_with_reference_schemas():
    async def emit(_frame): pass
    tools = LiveMusicTools(emit).tools
    registry = ToolRegistry()
    registry.process_tools(tools)
    names = set(registry.registry)
    assert names == {"music_set_weighted_prompts", "music_set_generation_config", "music_playback_control", "music_status",
                     "music_take_status", "music_save", "music_discard_take", "music_close", "music_library", "music_playlists",
                     "music_playlist_create", "music_playlist_add", "music_playlist_remove", "music_playlist_reorder",
                     "music_playlist_delete"}
    assert all(isinstance(t, DecoratedFunctionTool) for t in tools)
    prompts_schema = registry.registry["music_set_weighted_prompts"].tool_spec["inputSchema"]["json"]
    assert prompts_schema["properties"]["prompts"]["items"]["required"] == ["text", "weight"]
    config_schema = registry.registry["music_set_generation_config"].tool_spec["inputSchema"]["json"]
    assert "D_MAJOR_B_MINOR" in config_schema["properties"]["scale"]["enum"]
    assert config_schema["properties"]["music_generation_mode"]["enum"] == ["QUALITY", "DIVERSITY", "VOCALIZATION"]
    control_schema = registry.registry["music_playback_control"].tool_spec["inputSchema"]["json"]
    assert control_schema["properties"]["action"]["enum"] == ["play", "pause", "stop", "reset_context"]
    assert registry.registry["music_status"].tool_spec["inputSchema"]["json"].get("properties") == {}


@pytest.mark.asyncio
async def test_session_uses_the_official_client_and_forwards_server_messages_as_music_frames(monkeypatch):
    monkeypatch.setattr(live_music.config, "LIVE_MUSIC_MODEL", "models/lyria-realtime-exp", raising=False)
    fake = FakeMusicSession(scripted_messages())
    client = FakeClient(fake)
    frames: list[dict] = []

    async def emit(frame): frames.append(frame)

    session = LiveMusicSession(emit, client_factory=lambda: client, model="models/lyria-realtime-exp")
    tools = LiveMusicTools(emit, session=session)

    result = await tools.music_set_weighted_prompts(prompts=[{"text": "minimal techno", "weight": 1.0}])
    assert client.connected_with == ["models/lyria-realtime-exp"]
    assert result["prompts"] == [{"text": "minimal techno", "weight": 1.0}]
    assert "play" in result["hint"]
    first = await tools.music_set_generation_config(bpm=120, density=0.4)
    assert first["reset_context_required"] is False, "no reset needed before the stream plays"
    assert (await tools.music_playback_control(action="play")) == {"action": "play", "playback": "playing"}
    second = await tools.music_set_generation_config(bpm=90, density=0.4)
    assert second["reset_context_required"] is True and "bpm" in second["hint"]
    await tools.music_playback_control(action="reset_context")
    for _ in range(50):
        if any(f["type"] == "music_filtered_prompt" for f in frames):
            break
        await asyncio.sleep(0.01)

    assert [call[0] for call in fake.calls] == ["prompts", "config", "play", "config", "reset_context"]
    assert fake.calls[0] == ("prompts", [("minimal techno", 1.0)])
    assert fake.calls[1] == ("config", {"bpm": 120, "density": 0.4})
    types = [f["type"] for f in frames]
    assert types[0] == "music_ready"
    for expected in ("music_setup_complete", "music_prompts", "music_config", "music_playback", "music_audio_delta", "music_filtered_prompt"):
        assert expected in types, expected
    audio = next(f for f in frames if f["type"] == "music_audio_delta")
    assert (audio["sample_rate"], audio["channels"]) == (48000, 2)
    status = await tools.music_status()
    assert status["connected"] is True and status["audio_chunks_received"] == 1
    assert status["filtered_prompts"] == [{"text": "bad words", "reason": "SAFETY"}]
    assert status["generation_config"] == {"bpm": 90, "density": 0.4}

    bad = await tools.music_set_weighted_prompts(prompts=[{"text": "x", "weight": 0}])
    assert bad["status"] == "error" and "must not be 0" in bad["content"][0]["text"]

    assert (await tools.music_close()) == {"closed": True}
    assert frames[-1]["type"] == "music_closed"
    assert session.connected is False


@pytest.mark.asyncio
async def test_connection_failure_is_a_tool_error_not_an_exception():
    class BrokenClient:
        aio = SimpleNamespace(live=SimpleNamespace(music=None))

        def __init__(self):
            self.aio = SimpleNamespace(live=SimpleNamespace(music=self))

        @contextlib.asynccontextmanager
        async def connect(self, *, model):
            raise RuntimeError("no lyria for you")
            yield  # pragma: no cover

    frames: list[dict] = []

    async def emit(frame): frames.append(frame)

    session = LiveMusicSession(emit, client_factory=BrokenClient, model="models/lyria-realtime-exp")
    tools = LiveMusicTools(emit, session=session)
    result = await tools.music_playback_control(action="play")
    assert result["status"] == "error" and "no lyria for you" in result["content"][0]["text"]
    assert [f["type"] for f in frames] == ["music_error", "music_closed"]


def test_lyria_prompt_guide_is_a_native_agent_skill():
    skill = lyria_skill()
    assert skill.name == "lyria-realtime-prompting" and skill.path == LYRIA_SKILL_DIR
    assert skill.allowed_tools == ["music_set_weighted_prompts", "music_set_generation_config", "music_playback_control",
                                   "music_status", "music_take_status", "music_save", "music_discard_take", "music_close"]
    assert "weighted prompts" in skill.instructions.lower() and "reset_context" in skill.instructions
    assert (LYRIA_SKILL_DIR / "references" / "prompt-guide.md").is_file()
    plugin = lyria_skills_plugin()
    assert [tool.tool_name for tool in plugin.tools] == ["skills"]
    block = skills_prompt_block(plugin)
    assert block == plugin._generate_skills_xml(), "prompt block is the SDK's own formatter output"
    assert block.startswith("<available_skills>") and "<name>lyria-realtime-prompting</name>" in block
    assert str(LYRIA_SKILL_DIR / "SKILL.md") in block


def test_recorder_segments_on_source_metadata_and_rolls_when_full():
    from agent.api.core.live_music import TakeRecorder, wav_bytes

    recorder = TakeRecorder(max_seconds=1.0)  # 1 s of 48 kHz stereo = 192000 bytes
    frame = b"\x00\x00" * 2 * 4800  # 0.1 s
    source_a = {"prompts": [{"text": "techno", "weight": 1.0}], "config": {"bpm": 120}}
    source_b = {"prompts": [{"text": "pads", "weight": 1.0}], "config": {"bpm": 120}}
    for _ in range(4):
        recorder.add(frame, "audio/l16;rate=48000;channels=2", source_a)
    for _ in range(3):
        recorder.add(frame, "audio/l16;rate=48000;channels=2", source_b)
    timeline = recorder.timeline()
    assert [round(s["duration_s"], 1) for s in timeline] == [0.4, 0.3]
    assert timeline[1]["start_s"] == pytest.approx(0.4, abs=1e-3)
    assert timeline[0]["prompts"] == source_a["prompts"] and timeline[1]["config"] == {"bpm": 120}
    assert recorder.started_at is not None
    for _ in range(8):  # 0.8 s more -> 1.5 s total, trimmed to 1.0 s from the oldest segment
        recorder.add(frame, "audio/l16;rate=48000;channels=2", source_b)
    assert recorder.seconds() == pytest.approx(1.0, abs=1e-3)
    assert recorder.timeline()[0]["prompts"] == source_b["prompts"], "oldest audio was dropped first"
    wav = wav_bytes(recorder.pcm(), 48000, 2)
    assert wav[:4] == b"RIFF" and wav[8:12] == b"WAVE" and len(wav) == 44 + len(recorder.pcm())
    import struct
    channels, rate, byte_rate, block_align, bits = struct.unpack("<HIIHH", wav[22:36])
    assert (channels, rate, byte_rate, block_align, bits) == (2, 48000, 192000, 4, 16)
    recorder.clear()
    assert recorder.seconds() == 0 and recorder.started_at is None


class FakeTable:
    """Enough of the postgrest builder for the library helpers: insert/select/update/delete with eq/in_/order/limit."""

    def __init__(self, rows): self.rows = rows; self._filters = []; self._op = None; self._payload = None
    def insert(self, payload): self._op = "insert"; self._payload = payload; return self
    def upsert(self, payload, **_): self._op = "insert"; self._payload = payload; return self
    def update(self, payload): self._op = "update"; self._payload = payload; return self
    def select(self, *_): self._op = "select"; return self
    def delete(self): self._op = "delete"; return self
    def eq(self, key, value): self._filters.append(lambda r: r.get(key) == value); return self
    def in_(self, key, values): self._filters.append(lambda r: r.get(key) in set(values)); return self
    def order(self, *_, **__): return self
    def limit(self, *_): return self

    def _matching(self):
        return [r for r in self.rows if all(f(r) for f in self._filters)]

    async def execute(self):
        if self._op == "insert":
            new = self._payload if isinstance(self._payload, list) else [self._payload]
            self.rows.extend(dict(r) for r in new); return SimpleNamespace(data=new)
        rows = self._matching()
        if self._op == "update":
            for r in rows: r.update(self._payload)
        if self._op == "delete":
            for r in rows: self.rows.remove(r)
        return SimpleNamespace(data=[dict(r) for r in rows])


class FakeStorage:
    def __init__(self): self.buckets = set(); self.files = {}
    async def get_bucket(self, name):
        if name not in self.buckets: raise RuntimeError("Bucket not found")
    async def create_bucket(self, name, options=None): self.buckets.add(name)
    def from_(self, bucket): self._bucket = bucket; return self
    async def upload(self, path, data, file_options=None): self.files[(self._bucket, path)] = (data, file_options)
    async def create_signed_url(self, path, expires_in, options=None): return {"signedURL": f"https://x/{path}?e={expires_in}"}
    async def remove(self, paths):
        for p in paths: self.files.pop((self._bucket, p), None)


class FakeSupabase:
    def __init__(self):
        self.rows = []; self.storage = FakeStorage()
        self.tables = {"songs": self.rows, "playlists": [], "playlist_songs": []}
    def table(self, name): return FakeTable(self.tables[name])


@pytest.mark.asyncio
async def test_music_save_uploads_wav_and_inserts_a_songs_row(monkeypatch):
    from agent.api.core.live_music import delete_song, list_songs, save_take

    monkeypatch.setattr(live_music.config, "LIVE_MUSIC_BUCKET", "music", raising=False)
    frames = []

    async def emit(frame): frames.append(frame)

    session = LiveMusicSession(emit, client_factory=lambda: None, model="models/lyria-realtime-exp")
    session.prompts = [{"text": "techno", "weight": 1.0}]
    session.generation_config = {"bpm": 120}
    session.recorder.add(b"\x01\x00" * 2 * 48000, "audio/l16;rate=48000;channels=2", {"prompts": session.prompts, "config": {"bpm": 120}})
    owner = "11111111-1111-1111-1111-111111111111"
    fake = FakeSupabase()

    with pytest.raises(live_music.SignInRequired):
        await save_take(session, "guest:abc", "x", client=fake)

    result = await save_take(session, owner, "  Night drive  ", client=fake)
    assert result["title"] == "Night drive" and result["duration_seconds"] == 1.0 and result["segments"] == 1
    assert result["storage_path"] == f"{owner}/{result['song_id']}.wav" and result["signed_url"].startswith("https://x/")
    assert "music" in fake.storage.buckets
    data, options = fake.storage.files[("music", result["storage_path"])]
    assert data[:4] == b"RIFF" and options["content-type"] == "audio/wav"
    row = fake.rows[0]
    assert row["owner_id"] == owner and row["timeline"][0]["prompts"] == session.prompts and row["format"] == "wav"
    assert session.recorder.seconds() == 1.0, "saving does not clear the take"

    songs = await list_songs(owner, client=fake)
    assert [s["id"] for s in songs] == [result["song_id"]] and songs[0]["signed_url"]
    assert await list_songs("22222222-2222-2222-2222-222222222222", client=fake) == []
    assert await delete_song(owner, result["song_id"], client=fake) is True
    assert fake.rows == [] and fake.storage.files == {}
    assert await delete_song(owner, result["song_id"], client=fake) is False

    # the tool surface wraps the same function and returns tool errors, never raises
    tools = LiveMusicTools(emit, user_id="guest:abc", session=session)
    denied = await tools.music_save(title="x")
    assert denied["status"] == "error" and "Sign in" in denied["content"][0]["text"]
    empty = LiveMusicSession(emit, client_factory=lambda: None)
    nothing = await LiveMusicTools(emit, user_id=owner, session=empty, save=save_take).music_save()
    assert nothing["status"] == "error" and "Nothing recorded" in nothing["content"][0]["text"]
    status = await tools.music_take_status()
    assert status["seconds"] == 1.0 and len(status["segments"]) == 1
    assert (await tools.music_discard_take()) == {"discarded": True}
    assert frames[-1]["type"] == "music_take" and frames[-1]["seconds"] == 0


def test_music_endpoints_bind_sessions_to_the_callers_identity(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from agent.api.core import projects
    from agent.api.endpoints import music as music_endpoint
    from agent.api.core import live_tools

    calls = []
    emitted = []

    class Session:
        playback = "idle"
        recorder = SimpleNamespace(clear=lambda: calls.append("clear"))

        async def playback_control(self, action):
            calls.append(action); self.playback = "playing" if action == "play" else self.playback

        def take(self): return {"seconds": 0, "segments": []}

        async def emit(self, frame): emitted.append(frame)

    owner = "11111111-1111-1111-1111-111111111111"
    monkeypatch.setitem(live_tools.LIVE_MUSIC_SESSIONS, "agent-1", SimpleNamespace(session=Session(), user_id=owner))
    monkeypatch.setitem(live_tools.LIVE_MUSIC_SESSIONS, "agent-other", SimpleNamespace(session=Session(), user_id="someone-else"))

    async def fake_identity(request: Request):
        token = request.headers.get("authorization", "")
        if token == "Bearer owner":
            return projects.ProjectIdentity(owner, "owner", "", "")
        if request.headers.get("x-ron-workspace"):
            return projects.ProjectIdentity("guest-derived", "x" * 64, "", "", guest=True)
        from fastapi import HTTPException
        raise HTTPException(401, "Workspace credential is missing or invalid")

    app = FastAPI()
    app.include_router(music_endpoint.router)
    app.dependency_overrides[projects.project_identity] = fake_identity
    client = TestClient(app)
    auth = {"authorization": "Bearer owner"}
    guest = {"x-ron-workspace": "a" * 64}
    assert client.post("/music/control", json={"agent_id": "agent-1", "action": "play"}, headers=auth).json() == {"action": "play", "playback": "playing"}
    # another identity's session is invisible even with its agent_id; unknown ids and bad actions fail too
    assert client.post("/music/control", json={"agent_id": "agent-other", "action": "play"}, headers=auth).status_code == 404
    assert client.get("/music/take", params={"agent_id": "agent-other"}, headers=auth).status_code == 404
    assert client.post("/music/control", json={"agent_id": "nope", "action": "pause"}, headers=auth).status_code == 404
    assert client.post("/music/control", json={"agent_id": "agent-1", "action": "rewind"}, headers=auth).status_code == 422
    assert client.get("/music/take", params={"agent_id": "agent-1"}, headers=auth).json() == {"seconds": 0, "segments": []}
    assert client.post("/music/take/discard", json={"agent_id": "agent-1"}, headers=auth).json() == {"seconds": 0, "segments": []}
    assert emitted == [{"type": "music_take", "seconds": 0, "segments": []}]
    # guests: every deck route requires sign-in; the library says so instead of erroring
    assert client.post("/music/control", json={"agent_id": "agent-1", "action": "play"}, headers=guest).status_code == 401
    assert client.post("/music/save", json={"agent_id": "agent-1"}, headers=guest).status_code == 401
    assert client.get("/music/songs", headers=guest).json() == {"songs": [], "sign_in_required": True}
    assert client.post("/music/control", json={"agent_id": "agent-1", "action": "play"}).status_code == 401, "identity required"
    assert calls == ["play", "clear"]


def test_ensure_bucket_only_creates_on_not_found():
    import asyncio
    from agent.api.core.live_music import ensure_bucket

    class Storage:
        def __init__(self, error): self.error = error; self.created = []
        async def get_bucket(self, name): raise self.error
        async def create_bucket(self, name, options=None): self.created.append(name)

    missing = Storage(RuntimeError("Bucket not found"))
    asyncio.run(ensure_bucket(missing))
    assert missing.created == ["music"]
    transient = Storage(RuntimeError("Connection reset by peer"))
    with pytest.raises(RuntimeError, match="Connection reset"):
        asyncio.run(ensure_bucket(transient))
    assert transient.created == []


def test_store_song_refuses_uploads_over_the_configured_limit(monkeypatch):
    import asyncio
    from agent.api.core.live_music import store_song

    monkeypatch.setattr(live_music.config, "LIVE_MUSIC_MAX_UPLOAD_BYTES", 10, raising=False)
    with pytest.raises(ValueError, match="accepts up to"):
        asyncio.run(store_song("11111111-1111-1111-1111-111111111111", title="x", source="lyria", model="m", audio=b"\x00" * 11,
                               fmt="mp3", duration_seconds=1, sample_rate=44100, channels=2, client=FakeSupabase()))


@pytest.mark.asyncio
async def test_close_during_connect_wakes_waiting_tool_calls():
    """A cancel from close() is a BaseException: _ready must still resolve so no tool call hangs."""
    gate = asyncio.Event()

    class SlowClient:
        def __init__(self): self.aio = SimpleNamespace(live=SimpleNamespace(music=self))

        @contextlib.asynccontextmanager
        async def connect(self, *, model):
            await gate.wait()
            yield FakeMusicSession([])

    async def emit(_frame): pass

    session = LiveMusicSession(emit, client_factory=SlowClient, model="m")
    waiter = asyncio.create_task(session.ensure_connected())
    await asyncio.sleep(0.01)
    session._task.cancel()  # what close() does after its timeout
    with pytest.raises(RuntimeError, match="closed"):
        await asyncio.wait_for(waiter, 1)


def test_recorder_wav_is_assembled_in_one_pass():
    from agent.api.core.live_music import TakeRecorder, wav_bytes

    recorder = TakeRecorder(max_seconds=10)
    recorder.add(b"\x01\x02" * 2 * 480, "audio/l16;rate=48000;channels=2", {"prompts": [], "config": {}})
    recorder.add(b"\x03\x04" * 2 * 480, "audio/l16;rate=48000;channels=2", {"prompts": [{"text": "x", "weight": 1}], "config": {}})
    assert bytes(recorder.wav()) == wav_bytes(recorder.pcm(), 48000, 2)


@pytest.mark.asyncio
async def test_playlists_group_saved_songs_in_order_and_are_owner_scoped():
    from agent.api.core.live_music import (
        add_playlist_songs, create_playlist, delete_playlist, delete_song, get_playlist, list_playlists, remove_playlist_song,
        reorder_playlist, update_playlist,
    )

    owner = "11111111-1111-1111-1111-111111111111"
    other = "22222222-2222-2222-2222-222222222222"
    fake = FakeSupabase()
    songs = []
    for index, title in enumerate(["A", "B", "C"]):
        row = {"id": f"song-{index}", "owner_id": owner, "title": title, "source": "lyria", "model": "m", "duration_seconds": 10 * (index + 1),
               "format": "mp3", "storage_path": f"{owner}/song-{index}.mp3", "prompt": "", "lyrics": "", "prompts": [], "config": {}, "timeline": [],
               "composition_plan": {}, "created_at": "2026-10-06"}
        fake.rows.append(row); songs.append(row["id"])
    fake.rows.append({"id": "song-x", "owner_id": other, "title": "Not yours", "storage_path": f"{other}/x.mp3", "duration_seconds": 1})

    with pytest.raises(live_music.SignInRequired):
        await create_playlist("guest:abc", "Mix", client=fake)
    with pytest.raises(ValueError, match="kind"):
        await create_playlist(owner, "Mix", kind="mixtape", client=fake)

    album = await create_playlist(owner, "  Night Drive  ", kind="album", description="late", song_ids=["song-2", "song-0", "song-2"], client=fake)
    assert album["title"] == "Night Drive" and album["kind"] == "album" and [s["id"] for s in album["songs"]] == ["song-2", "song-0"]
    assert album["duration_seconds"] == 40 and all(s["signed_url"] for s in album["songs"])
    assert [s["position"] for s in album["songs"]] == [0, 1]

    # appending skips duplicates, keeps order, refuses foreign/unknown songs
    album = await add_playlist_songs(owner, album["id"], ["song-1", "song-0"], client=fake)
    assert [s["id"] for s in album["songs"]] == ["song-2", "song-0", "song-1"]
    with pytest.raises(LookupError, match="song-x"):
        await add_playlist_songs(owner, album["id"], ["song-x"], client=fake)
    with pytest.raises(ValueError):
        await add_playlist_songs(owner, album["id"], [], client=fake)

    album = await reorder_playlist(owner, album["id"], ["song-0", "song-1", "song-2"], client=fake)
    assert [s["id"] for s in album["songs"]] == ["song-0", "song-1", "song-2"]
    with pytest.raises(ValueError, match="exactly"):
        await reorder_playlist(owner, album["id"], ["song-0", "song-1"], client=fake)

    album = await remove_playlist_song(owner, album["id"], "song-1", client=fake)
    assert [(s["id"], s["position"]) for s in album["songs"]] == [("song-0", 0), ("song-2", 1)], "positions stay dense"

    album = await update_playlist(owner, album["id"], title="Night Drive II", kind="playlist", client=fake)
    assert album["title"] == "Night Drive II" and album["kind"] == "playlist"

    listed = await list_playlists(owner, client=fake)
    assert [(p["id"], p["song_count"]) for p in listed] == [(album["id"], 2)]
    assert await list_playlists(other, client=fake) == []
    with pytest.raises(LookupError):
        await get_playlist(other, album["id"], client=fake)

    # deleting a song drops it from the playlist (DB cascade; the fake mirrors it)
    fake.tables["playlist_songs"][:] = [e for e in fake.tables["playlist_songs"] if e["song_id"] != "song-0"]
    assert await delete_song(owner, "song-0", client=fake) is True
    assert [s["id"] for s in (await get_playlist(owner, album["id"], client=fake))["songs"]] == ["song-2"]

    assert await delete_playlist(owner, album["id"], client=fake) is True
    assert await delete_playlist(owner, album["id"], client=fake) is False
    assert fake.tables["songs"][0]["id"] == "song-1", "songs survive playlist deletion"


@pytest.mark.asyncio
async def test_playlist_tools_wrap_the_library_helpers(monkeypatch):
    owner = "11111111-1111-1111-1111-111111111111"
    fake = FakeSupabase()
    fake.rows.append({"id": "s1", "owner_id": owner, "title": "One", "source": "lyria", "model": "m", "duration_seconds": 5, "format": "mp3",
                      "storage_path": f"{owner}/s1.mp3", "prompt": "", "lyrics": "", "prompts": [], "config": {}, "timeline": [], "composition_plan": {}, "created_at": "x"})

    async def client(): return fake
    monkeypatch.setattr(live_music, "supabase_client", client)

    async def emit(_frame): pass

    tools = LiveMusicTools(emit, user_id=owner, session=LiveMusicSession(emit, client_factory=lambda: None))
    library = await tools.music_library()
    assert [s["id"] for s in library["items"]] == ["s1"]
    created = await tools.music_playlist_create(title="Mix", song_ids=["s1"])
    assert created["song_count"] == 1
    assert (await tools.music_playlists())["items"][0]["id"] == created["id"]
    assert (await tools.music_playlists(playlist_id=created["id"]))["songs"][0]["id"] == "s1"
    missing = await tools.music_playlist_add(playlist_id=created["id"], song_ids=["nope"])
    assert missing["status"] == "error" and "Not found" in missing["content"][0]["text"]
    assert (await tools.music_playlist_delete(playlist_id=created["id"])) == {"deleted": True}
    guest = LiveMusicTools(emit, user_id="guest:abc", session=LiveMusicSession(emit, client_factory=lambda: None))
    denied = await guest.music_playlist_create(title="Mix")
    assert denied["status"] == "error" and "Sign in" in denied["content"][0]["text"]
