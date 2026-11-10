"""Lyria RealTime (Live Music API) for the Live agent, as native Strands custom tools.

The transport is the official google-genai client exactly as shipped (``google/genai/live_music.py``):
``client.aio.live.music.connect(model=...)`` yields an ``AsyncMusicSession`` whose methods are the
four client messages of the Live Music API reference — ``set_weighted_prompts``
(``BidiGenerateMusicClientContent``), ``set_music_generation_config``
(``BidiGenerateMusicGenerationConfig``), ``play``/``pause``/``stop``/``reset_context``
(``BidiGenerateMusicPlaybackControl``) — and ``receive()`` yields ``LiveMusicServerMessage``
(``setup_complete`` | ``server_content.audio_chunks`` | ``filtered_prompt``). ``connect`` sends the
``setup`` message itself and waits for the first server frame before yielding the session.

``LiveMusicTools`` exposes that reference to the ``BidiAgent`` as class-based async ``@tool``
methods (``DecoratedFunctionTool``, invoked concurrently by the SDK): one tool per client message
plus ``music_status`` and ``music_close``. The agent never sees audio; every server frame is
forwarded to the renderer through ``emit`` as ``music_*`` JSON frames on the same socket as the
native ``bidi_*`` events, and the renderer schedules the 48 kHz stereo PCM16 itself.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import re
import struct
import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from strands import tool
from strands.vended_plugins.skills import AgentSkills, Skill

from agent.api.core import config

logger = logging.getLogger(__name__)

Emit = Callable[[dict[str, Any]], Awaitable[None]]

#: The Agent Skill that carries the Lyria prompt guide (AgentSkills.io layout: SKILL.md + references/).
LYRIA_SKILL_DIR = Path(__file__).resolve().parents[2] / "skills" / "lyria-realtime-prompting"

SCALES = (
    "C_MAJOR_A_MINOR", "D_FLAT_MAJOR_B_FLAT_MINOR", "D_MAJOR_B_MINOR", "E_FLAT_MAJOR_C_MINOR",
    "E_MAJOR_D_FLAT_MINOR", "F_MAJOR_D_MINOR", "G_FLAT_MAJOR_E_FLAT_MINOR", "G_MAJOR_E_MINOR",
    "A_FLAT_MAJOR_F_MINOR", "A_MAJOR_G_FLAT_MINOR", "B_FLAT_MAJOR_G_MINOR", "B_MAJOR_A_FLAT_MINOR",
    "SCALE_UNSPECIFIED",
)
MODES = ("QUALITY", "DIVERSITY", "VOCALIZATION")
PLAYBACK_CONTROLS = ("play", "pause", "stop", "reset_context")

#: Ranges from the API reference (``BidiGenerateMusicGenerationConfig``).
CONFIG_RANGES: dict[str, tuple[float, float]] = {
    "temperature": (0.0, 3.0), "top_k": (1, 1000), "seed": (0, 2_147_483_647), "guidance": (0.0, 6.0),
    "bpm": (60, 200), "density": (0.0, 1.0), "brightness": (0.0, 1.0),
}
#: Changing these is a hard transition: the docs require ``reset_context`` (or stop/play) afterwards.
HARD_TRANSITION_FIELDS = ("bpm", "scale")

_MIME_RATE = re.compile(r"rate=(\d+)")
_MIME_CHANNELS = re.compile(r"channels=(\d+)")


def lyria_skill() -> Skill:
    """The Lyria prompt guide as a native Agent Skill, loaded from ``LYRIA_SKILL_DIR``."""
    return Skill.from_file(LYRIA_SKILL_DIR, strict=True)


def lyria_skills_plugin() -> AgentSkills:
    """Native ``AgentSkills`` over the Lyria skill.

    ``BidiAgent`` has no plugins, so ``create_live_agent`` registers ``plugin.tools`` (the native
    ``skills`` activation tool) directly and appends ``skills_prompt_block`` to the system prompt,
    which is what the plugin's ``BeforeInvocationEvent`` hook would do on a text ``Agent``.
    """
    return AgentSkills(skills=[lyria_skill()], strict=True)


def skills_prompt_block(plugin: AgentSkills) -> str:
    """The ``<available_skills>`` block the SDK's ``skills`` tool refers to, from the plugin's own
    formatter (the private ``_generate_skills_xml``) so a pin bump cannot desynchronise prompt and tool.
    With no agent it lists the base skills, which is exactly the Skill-instance case here."""
    return plugin._generate_skills_xml()


def parse_mime(mime: str | None) -> tuple[str, int, int]:
    """``(mime, sample_rate, channels)`` from an ``AudioChunk.mimeType`` such as ``audio/l16;rate=48000;channels=2``."""
    mime = mime or "audio/l16;rate=48000;channels=2"
    rate = _MIME_RATE.search(mime)
    channels = _MIME_CHANNELS.search(mime)
    return mime, (int(rate.group(1)) if rate else 48000), (int(channels.group(1)) if channels else 2)


def source_metadata_dict(chunk: Any) -> dict[str, Any] | None:
    """``AudioChunk.sourceMetadata`` (the prompts and config that produced this chunk) as plain JSON."""
    meta = getattr(chunk, "source_metadata", None)
    if meta is None:
        return None
    content = getattr(meta, "client_content", None)
    prompts = [
        {"text": prompt.text, "weight": prompt.weight}
        for prompt in (getattr(content, "weighted_prompts", None) or [])
    ]
    config = getattr(meta, "music_generation_config", None)
    config_dict = config.model_dump(exclude_none=True, mode="json") if config is not None else {}
    return {"prompts": prompts, "config": config_dict}


def audio_chunk_frame(chunk: Any) -> dict[str, Any] | None:
    """``music_audio_delta`` for one ``AudioChunk`` (base64 PCM16 LE; rate/channels from its MIME type;
    ``source`` = its ``sourceMetadata``)."""
    data = getattr(chunk, "data", None)
    if not data:
        return None
    mime, rate, channels = parse_mime(getattr(chunk, "mime_type", None))
    frame = {
        "type": "music_audio_delta",
        "audio": base64.b64encode(data).decode("ascii"),
        "format": "pcm",
        "sample_rate": rate,
        "channels": channels,
        "mime_type": mime,
    }
    source = source_metadata_dict(chunk)
    if source is not None:
        frame["source"] = source
    return frame


def wav_header(data_bytes: int, sample_rate: int, channels: int) -> bytes:
    """The 44-byte RIFF header for 16-bit PCM of ``data_bytes`` bytes."""
    byte_rate = sample_rate * channels * 2
    return struct.pack(
        "<4sI4s4sIHHIIHH4sI", b"RIFF", 36 + data_bytes, b"WAVE", b"fmt ", 16, 1, channels, sample_rate, byte_rate,
        channels * 2, 16, b"data", data_bytes,
    )


def wav_bytes(pcm: bytes | bytearray, sample_rate: int, channels: int) -> bytes:
    """A canonical 16-bit PCM WAV file (header + the raw chunks as received)."""
    return wav_header(len(pcm), sample_rate, channels) + pcm


class TakeRecorder:
    """Records the stream into segments: a new segment starts whenever ``sourceMetadata`` changes.

    Every chunk Lyria sends carries the prompts/config that produced it, so the song structure is
    captured exactly as it was steered, with no clock of our own. Bounded by ``max_seconds``: when
    full, the oldest audio is dropped (a rolling take) so "save that" always has the latest music.
    """

    def __init__(self, max_seconds: float) -> None:
        self.max_seconds = max_seconds
        self.segments: list[dict[str, Any]] = []
        self.sample_rate = 48000
        self.channels = 2
        self.started_at: str | None = None

    @property
    def total_bytes(self) -> int:
        return sum(len(segment["pcm"]) for segment in self.segments)

    def seconds(self, nbytes: int | None = None) -> float:
        nbytes = self.total_bytes if nbytes is None else nbytes
        return nbytes / (self.sample_rate * self.channels * 2)

    def add(self, data: bytes, mime: str | None, source: dict[str, Any] | None) -> None:
        _, self.sample_rate, self.channels = parse_mime(mime)
        if self.started_at is None:
            self.started_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        last = self.segments[-1] if self.segments else None
        if last is not None and last["source"] == source:
            last["pcm"] += data
        else:
            self.segments.append({"source": source, "pcm": bytearray(data)})
        limit = int(self.max_seconds * self.sample_rate * self.channels * 2)
        excess = self.total_bytes - limit
        while excess > 0 and self.segments:
            head = self.segments[0]
            cut = min(excess, len(head["pcm"]))
            del head["pcm"][:cut]
            excess -= cut
            if not head["pcm"]:
                self.segments.pop(0)

    def clear(self) -> None:
        self.segments.clear()
        self.started_at = None

    def timeline(self) -> list[dict[str, Any]]:
        """Segments as ``{start_s, duration_s, prompts, config}`` in order."""
        out: list[dict[str, Any]] = []
        at = 0.0
        for segment in self.segments:
            duration = self.seconds(len(segment["pcm"]))
            source = segment["source"] or {}
            out.append({"start_s": round(at, 3), "duration_s": round(duration, 3),
                        "prompts": source.get("prompts", []), "config": source.get("config", {})})
            at += duration
        return out

    def pcm(self) -> bytes:
        return b"".join(segment["pcm"] for segment in self.segments)

    def wav(self) -> bytearray:
        """The take as one WAV buffer, assembled in a single pass (no intermediate PCM copy)."""
        out = bytearray(wav_header(self.total_bytes, self.sample_rate, self.channels))
        for segment in self.segments:
            out += segment["pcm"]
        return out


def validate_prompts(prompts: Any) -> list[dict[str, Any]]:
    """``WeightedPrompt`` rules: text required, weight non-zero, not all weights zero."""
    if not isinstance(prompts, list) or not prompts:
        raise ValueError("prompts must be a non-empty list of {text, weight} objects")
    cleaned: list[dict[str, Any]] = []
    for index, item in enumerate(prompts):
        if not isinstance(item, dict):
            raise ValueError(f"prompts[{index}] must be an object with text and weight")
        text = item.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ValueError(f"prompts[{index}].text must be a non-empty string")
        weight = item.get("weight", 1.0)
        if isinstance(weight, bool) or not isinstance(weight, (int, float)):
            raise ValueError(f"prompts[{index}].weight must be a number")
        if weight == 0:
            raise ValueError(f"prompts[{index}].weight must not be 0 (lower it instead, e.g. 0.1)")
        cleaned.append({"text": text.strip(), "weight": float(weight)})
    if all(prompt["weight"] == 0 for prompt in cleaned):
        raise ValueError("weights must not all be 0")
    return cleaned


def validate_config(fields: dict[str, Any]) -> dict[str, Any]:
    """Drop ``None`` and enforce the reference ranges and enums."""
    given = {key: value for key, value in fields.items() if value is not None}
    for key, (low, high) in CONFIG_RANGES.items():
        if key in given:
            value = given[key]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high:
                raise ValueError(f"{key} must be a number in [{low}, {high}]")
            if key in ("top_k", "seed", "bpm"):
                given[key] = int(value)
    if "scale" in given and given["scale"] not in SCALES:
        raise ValueError(f"scale must be one of {', '.join(SCALES)}")
    if "music_generation_mode" in given and given["music_generation_mode"] not in MODES:
        raise ValueError(f"music_generation_mode must be one of {', '.join(MODES)}")
    for key in ("mute_bass", "mute_drums", "only_bass_and_drums"):
        if key in given and not isinstance(given[key], bool):
            raise ValueError(f"{key} must be true or false")
    return given


class LiveMusicSession:
    """One Lyria RealTime connection: the official ``AsyncMusicSession`` plus a receive task.

    ``connect`` is an async context manager, so the connection lives inside ``_run`` until
    ``close`` sets ``_closed``. ``_receive`` forwards every server message to ``emit``.
    """

    def __init__(self, emit: Emit, *, client_factory: Callable[[], Any] | None = None,
                 model: str | None = None) -> None:
        self._emit = emit
        self._client_factory = client_factory or self._default_client
        self.model = model or config.LIVE_MUSIC_MODEL
        self._session: Any = None
        self._task: asyncio.Task[None] | None = None
        self._ready: asyncio.Future[None] | None = None
        self._closed = asyncio.Event()
        self.prompts: list[dict[str, Any]] = []
        self.generation_config: dict[str, Any] = {}
        self.playback = "idle"
        self.chunks = 0
        self.filtered: list[dict[str, Any]] = []
        self.error: str | None = None
        self.recorder = TakeRecorder(config.LIVE_MUSIC_RECORD_SECONDS)

    @staticmethod
    def _default_client() -> Any:
        from google import genai

        if not config.GEMINI_API_KEY:
            raise RuntimeError("GEMINI_API_KEY is not configured; Lyria RealTime needs the Gemini API key.")
        return genai.Client(api_key=config.GEMINI_API_KEY, http_options={"api_version": config.LIVE_MUSIC_API_VERSION})

    @property
    def connected(self) -> bool:
        return self._session is not None and not self._closed.is_set()

    async def emit(self, frame: dict[str, Any]) -> None:
        """Send one ``music_*`` frame to the renderer socket."""
        await self._emit(frame)

    async def ensure_connected(self) -> None:
        if self.connected:
            return
        if self._task is not None and not self._task.done():
            assert self._ready is not None
            await self._ready
        else:
            self._closed = asyncio.Event()
            self.error = None
            loop = asyncio.get_running_loop()
            self._ready = loop.create_future()
            self._task = loop.create_task(self._run(), name="lyria-realtime")
            await self._ready
        # ``_ready`` may resolve just as ``close()`` tears the connection down.
        if self._session is None or self._closed.is_set():
            raise RuntimeError(self.error or "live music session closed")

    async def _run(self) -> None:
        assert self._ready is not None
        try:
            client = self._client_factory()
            async with client.aio.live.music.connect(model=self.model) as session:
                self._session = session
                self._ready.set_result(None)
                await self._emit({"type": "music_ready", "model": self.model})
                receiver = asyncio.create_task(self._receive(session), name="lyria-realtime-receive")
                try:
                    await self._closed.wait()
                finally:
                    receiver.cancel()
                    await asyncio.gather(receiver, return_exceptions=True)
        except Exception as error:
            self.error = f"{type(error).__name__}: {error}"
            logger.warning("model=<%s> | lyria realtime session failed: %s", self.model, self.error)
            if not self._ready.done():
                self._ready.set_exception(error)
            self._closed.set()
            await self._emit({"type": "music_error", "message": self.error})
        finally:
            # A cancel from ``close()`` is a BaseException and skips the branch above: wake any caller
            # still awaiting ``_ready`` so no tool call hangs on a connection that will never open.
            if not self._ready.done():
                self._ready.set_exception(RuntimeError(self.error or "live music session closed"))
            self._session = None
            self.playback = "idle"
            await self._emit({"type": "music_closed"})

    async def _receive(self, session: Any) -> None:
        try:
            async for message in session.receive():
                await self._handle(message)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            # The client raises APIError when the server closes the stream (ConnectionClosed).
            self.error = f"{type(error).__name__}: {error}"
            logger.warning("model=<%s> | lyria realtime receive ended: %s", self.model, self.error)
            await self._emit({"type": "music_error", "message": self.error})
            self._closed.set()

    async def _handle(self, message: Any) -> None:
        content = getattr(message, "server_content", None)
        if content is not None and getattr(content, "audio_chunks", None):
            for chunk in content.audio_chunks:
                frame = audio_chunk_frame(chunk)
                if frame is not None:
                    self.chunks += 1
                    self.recorder.add(chunk.data, getattr(chunk, "mime_type", None), frame.get("source"))
                    await self._emit(frame)
            return
        # ``BidiGenerateMusicServerMessage.warning`` exists in the API reference but not on google-genai
        # 2.24.0's ``LiveMusicServerMessage`` (unknown fields are dropped before ``receive()`` yields),
        # so there is nothing to forward for it.
        filtered = getattr(message, "filtered_prompt", None)
        if filtered is not None:
            record = {"text": getattr(filtered, "text", None), "reason": getattr(filtered, "filtered_reason", None)}
            self.filtered.append(record)
            await self._emit({"type": "music_filtered_prompt", **record})
            return
        if getattr(message, "setup_complete", None) is not None:
            await self._emit({"type": "music_setup_complete"})

    async def set_weighted_prompts(self, prompts: list[dict[str, Any]]) -> None:
        from google.genai import types

        await self.ensure_connected()
        await self._session.set_weighted_prompts(
            prompts=[types.WeightedPrompt(text=prompt["text"], weight=prompt["weight"]) for prompt in prompts],
        )
        self.prompts = prompts
        await self._emit({"type": "music_prompts", "prompts": prompts})

    async def set_music_generation_config(self, fields: dict[str, Any]) -> None:
        from google.genai import types

        await self.ensure_connected()
        await self._session.set_music_generation_config(config=types.LiveMusicGenerationConfig(**fields))
        self.generation_config = fields
        await self._emit({"type": "music_config", "config": fields})

    async def playback_control(self, action: str) -> None:
        await self.ensure_connected()
        await getattr(self._session, action)()
        self.playback = {"play": "playing", "pause": "paused", "stop": "stopped"}.get(action, self.playback)
        await self._emit({"type": "music_playback", "action": action, "state": self.playback})

    def take(self) -> dict[str, Any]:
        """What the rolling recorder holds right now."""
        recorder = self.recorder
        return {"seconds": round(recorder.seconds(), 2), "segments": recorder.timeline(), "sample_rate": recorder.sample_rate,
                "channels": recorder.channels, "started_at": recorder.started_at, "max_seconds": recorder.max_seconds}

    def status(self) -> dict[str, Any]:
        return {
            "connected": self.connected,
            "model": self.model,
            "playback": self.playback,
            "prompts": self.prompts,
            "generation_config": self.generation_config,
            "audio_chunks_received": self.chunks,
            "filtered_prompts": self.filtered[-5:],
            "recorded_seconds": round(self.recorder.seconds(), 2),
            "error": self.error,
        }

    async def close(self) -> None:
        if self._task is None:
            return
        self._closed.set()
        task, self._task = self._task, None
        try:
            await asyncio.wait_for(task, 10)
        except (asyncio.TimeoutError, TimeoutError):
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        except Exception:
            pass


def _error(message: str) -> dict[str, Any]:
    return {"status": "error", "content": [{"text": message}]}


SONGS_TABLE = "songs"


class SignInRequired(PermissionError):
    """Saved takes belong to a signed-in Supabase user."""


def owner_uuid(user_id: str) -> str:
    try:
        return str(uuid.UUID(user_id))
    except (TypeError, ValueError):
        raise SignInRequired("Sign in to Ren to save music (guest sessions cannot store takes).") from None


async def supabase_client() -> Any:
    """The official async Supabase client (service-role key), like ``harness_agents``."""
    from supabase import acreate_client

    from supabase import AsyncClientOptions

    url, key = os.getenv("SUPABASE_URL", ""), os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise RuntimeError("Saving music needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the Ren API host.")
    # The default storage timeout is 20 s; a multi-minute WAV from the VPS needs the generation budget.
    return await acreate_client(url, key, AsyncClientOptions(storage_client_timeout=int(config.MUSIC_GENERATION_TIMEOUT)))


def _is_not_found(error: Exception) -> bool:
    status = getattr(error, "status", None)
    if str(status) == "404":
        return True
    return "not found" in str(error).lower() or "does not exist" in str(error).lower()


async def ensure_bucket(storage: Any) -> None:
    """Create the private bucket only when Storage says it does not exist; any other error is re-raised
    (a transient failure must not be mistaken for a missing bucket)."""
    try:
        await storage.get_bucket(config.LIVE_MUSIC_BUCKET)
    except Exception as error:
        if not _is_not_found(error):
            raise
        await storage.create_bucket(config.LIVE_MUSIC_BUCKET, options={"public": False})


async def store_song(user_id: str, *, title: str, source: str, model: str, audio: bytes, fmt: str, duration_seconds: float,
                     sample_rate: int, channels: int, prompt: str = "", lyrics: str = "", prompts: list[dict[str, Any]] | None = None,
                     generation_config: dict[str, Any] | None = None, timeline: list[dict[str, Any]] | None = None,
                     filtered_prompts: list[dict[str, Any]] | None = None, composition_plan: dict[str, Any] | None = None,
                     client: Any = None) -> dict[str, Any]:
    """Upload one generated song to Supabase Storage and insert its ``songs`` row (``012_songs.sql``).

    Shared by the Live take recorder (``source='lyria-realtime'``, WAV) and the batch generators in
    ``music_generation.py`` (``'lyria'``/``'elevenlabs'``, MP3). The bucket is created private when missing.
    """
    owner = owner_uuid(user_id)
    if not audio:
        raise ValueError("Nothing to save: the generation produced no audio.")
    if fmt not in ("wav", "mp3"):
        raise ValueError(f"Unsupported audio format {fmt!r}")
    if len(audio) > config.LIVE_MUSIC_MAX_UPLOAD_BYTES:
        raise ValueError(
            f"This recording is {len(audio) / 1_000_000:.0f} MB; the music library accepts up to "
            f"{config.LIVE_MUSIC_MAX_UPLOAD_BYTES / 1_000_000:.0f} MB per song (RON_LIVE_MUSIC_MAX_UPLOAD_MB). "
            "Discard the take and record a shorter one.")
    title = title.strip()[:120] or f"{source} {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}"
    song_id = str(uuid.uuid4())
    path = f"{owner}/{song_id}.{fmt}"
    client = client if client is not None else await supabase_client()
    storage = client.storage
    await ensure_bucket(storage)
    await storage.from_(config.LIVE_MUSIC_BUCKET).upload(
        path, audio, file_options={"content-type": "audio/wav" if fmt == "wav" else "audio/mpeg", "upsert": "false"},
    )
    row = {
        "id": song_id, "owner_id": owner, "title": title, "source": source, "model": model,
        "duration_seconds": round(duration_seconds, 3), "sample_rate": sample_rate, "channels": channels, "format": fmt,
        "storage_path": path, "prompt": prompt[:8000], "lyrics": lyrics[:20000], "prompts": prompts or [],
        "config": generation_config or {}, "timeline": timeline or [], "filtered_prompts": filtered_prompts or [],
        "composition_plan": composition_plan or {},
    }
    await client.table(SONGS_TABLE).insert(row).execute()
    signed = await storage.from_(config.LIVE_MUSIC_BUCKET).create_signed_url(path, 3600)
    url = (signed.get("signedURL") or signed.get("signedUrl")) if isinstance(signed, dict) else None
    return {"song_id": song_id, "title": title, "source": source, "format": fmt, "duration_seconds": row["duration_seconds"],
            "storage_path": path, "signed_url": url}


async def save_take(session: LiveMusicSession, user_id: str, title: str, *, client: Any = None) -> dict[str, Any]:
    """Save the rolling Live take as a WAV song (``source='lyria-realtime'``).

    The take stays in the recorder so the user can keep steering; ``music_discard_take`` clears it.
    """
    owner_uuid(user_id)  # refuse guests before touching the recorder
    recorder = session.recorder
    if recorder.total_bytes == 0:
        raise ValueError("Nothing recorded yet: play some music first.")
    timeline = recorder.timeline()
    result = await store_song(
        user_id, title=title or f"Live take {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}", source="lyria-realtime",
        # storage3 only accepts ``bytes`` (a bytearray would be treated as a path): the WAV is assembled
        # once in ``recorder.wav()`` and converted once here, with no separate PCM join.
        model=session.model, audio=bytes(recorder.wav()), fmt="wav",
        duration_seconds=recorder.seconds(), sample_rate=recorder.sample_rate, channels=recorder.channels,
        prompts=session.prompts, generation_config=session.generation_config, timeline=timeline,
        filtered_prompts=session.filtered, client=client,
    )
    return {**result, "segments": len(timeline)}


async def list_songs(user_id: str, *, client: Any = None, limit: int = 50) -> list[dict[str, Any]]:
    owner = owner_uuid(user_id)
    client = client if client is not None else await supabase_client()
    result = await (client.table(SONGS_TABLE).select("id,title,source,model,duration_seconds,format,storage_path,prompt,lyrics,prompts,config,timeline,composition_plan,created_at")
                    .eq("owner_id", owner).order("created_at", desc=True).limit(limit).execute())
    songs = list(result.data or [])
    for song in songs:
        signed = await client.storage.from_(config.LIVE_MUSIC_BUCKET).create_signed_url(song["storage_path"], 3600)
        song["signed_url"] = (signed.get("signedURL") or signed.get("signedUrl")) if isinstance(signed, dict) else None
    return songs


async def delete_song(user_id: str, song_id: str, *, client: Any = None) -> bool:
    owner = owner_uuid(user_id)
    client = client if client is not None else await supabase_client()
    result = await client.table(SONGS_TABLE).select("storage_path").eq("owner_id", owner).eq("id", song_id).execute()
    rows = list(result.data or [])
    if not rows:
        return False
    await client.storage.from_(config.LIVE_MUSIC_BUCKET).remove([rows[0]["storage_path"]])
    await client.table(SONGS_TABLE).delete().eq("owner_id", owner).eq("id", song_id).execute()
    return True



# ─── Playlists / albums (013_playlists.sql) ──────────────────────────────────

PLAYLISTS_TABLE = "playlists"
PLAYLIST_SONGS_TABLE = "playlist_songs"
PLAYLIST_KINDS = ("playlist", "album")
SONG_COLUMNS = "id,title,source,model,duration_seconds,format,storage_path,prompt,lyrics,prompts,config,timeline,composition_plan,created_at"


async def _sign_songs(client: Any, songs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for song in songs:
        signed = await client.storage.from_(config.LIVE_MUSIC_BUCKET).create_signed_url(song["storage_path"], 3600)
        song["signed_url"] = (signed.get("signedURL") or signed.get("signedUrl")) if isinstance(signed, dict) else None
    return songs


async def _owned_playlist(client: Any, owner: str, playlist_id: str) -> dict[str, Any]:
    result = await client.table(PLAYLISTS_TABLE).select("*").eq("owner_id", owner).eq("id", playlist_id).execute()
    rows = list(result.data or [])
    if not rows:
        raise LookupError("Playlist not found")
    return rows[0]


async def _touch_playlist(client: Any, owner: str, playlist_id: str) -> None:
    """Bump ``updated_at`` (trigger) so the list orders recently edited playlists first."""
    await client.table(PLAYLISTS_TABLE).update({"updated_at": datetime.now(timezone.utc).isoformat()}).eq("owner_id", owner).eq("id", playlist_id).execute()


async def create_playlist(user_id: str, title: str, *, kind: str = "playlist", description: str = "",
                          song_ids: list[str] | None = None, client: Any = None) -> dict[str, Any]:
    """Create a playlist or album, optionally seeded with songs in the given order."""
    owner = owner_uuid(user_id)
    if kind not in PLAYLIST_KINDS:
        raise ValueError(f"kind must be one of {', '.join(PLAYLIST_KINDS)}")
    title = title.strip()[:120]
    if not title:
        raise ValueError("title must not be empty")
    client = client if client is not None else await supabase_client()
    row = {"id": str(uuid.uuid4()), "owner_id": owner, "kind": kind, "title": title, "description": description.strip()[:2000]}
    await client.table(PLAYLISTS_TABLE).insert(row).execute()
    if song_ids:
        await add_playlist_songs(user_id, row["id"], song_ids, client=client)
    return await get_playlist(user_id, row["id"], client=client)


async def list_playlists(user_id: str, *, client: Any = None) -> list[dict[str, Any]]:
    """The user's playlists/albums with their entry counts (no song details; see ``get_playlist``)."""
    owner = owner_uuid(user_id)
    client = client if client is not None else await supabase_client()
    result = await client.table(PLAYLISTS_TABLE).select("*").eq("owner_id", owner).order("updated_at", desc=True).execute()
    playlists = list(result.data or [])
    if not playlists:
        return []
    entries = await (client.table(PLAYLIST_SONGS_TABLE).select("playlist_id,song_id")
                     .in_("playlist_id", [p["id"] for p in playlists]).execute())
    counts: dict[str, int] = {}
    for entry in entries.data or []:
        counts[entry["playlist_id"]] = counts.get(entry["playlist_id"], 0) + 1
    for playlist in playlists:
        playlist["song_count"] = counts.get(playlist["id"], 0)
    return playlists


async def get_playlist(user_id: str, playlist_id: str, *, client: Any = None) -> dict[str, Any]:
    """One playlist with its songs in position order (each song carries a signed playback URL)."""
    owner = owner_uuid(user_id)
    client = client if client is not None else await supabase_client()
    playlist = await _owned_playlist(client, owner, playlist_id)
    entries = await (client.table(PLAYLIST_SONGS_TABLE).select("song_id,position,added_at")
                     .eq("playlist_id", playlist_id).order("position").execute())
    ordered = sorted(entries.data or [], key=lambda e: e["position"])
    song_ids = [entry["song_id"] for entry in ordered]
    songs: list[dict[str, Any]] = []
    if song_ids:
        result = await client.table(SONGS_TABLE).select(SONG_COLUMNS).eq("owner_id", owner).in_("id", song_ids).execute()
        by_id = {song["id"]: song for song in (result.data or [])}
        songs = await _sign_songs(client, [dict(by_id[sid], position=index) for index, sid in enumerate(song_ids) if sid in by_id])
    total = sum(float(song.get("duration_seconds") or 0) for song in songs)
    return {**playlist, "songs": songs, "song_count": len(songs), "duration_seconds": round(total, 3)}


async def add_playlist_songs(user_id: str, playlist_id: str, song_ids: list[str], *, client: Any = None) -> dict[str, Any]:
    """Append songs (the user's own, deduplicated) to the end of the playlist in the given order."""
    owner = owner_uuid(user_id)
    client = client if client is not None else await supabase_client()
    await _owned_playlist(client, owner, playlist_id)
    wanted = [sid for index, sid in enumerate(song_ids) if sid and sid not in song_ids[:index]]
    if not wanted:
        raise ValueError("song_ids must list at least one song")
    owned = await client.table(SONGS_TABLE).select("id").eq("owner_id", owner).in_("id", wanted).execute()
    owned_ids = {song["id"] for song in (owned.data or [])}
    missing = [sid for sid in wanted if sid not in owned_ids]
    if missing:
        raise LookupError(f"Unknown song id(s): {', '.join(missing)}")
    existing = await client.table(PLAYLIST_SONGS_TABLE).select("song_id,position").eq("playlist_id", playlist_id).execute()
    present = {entry["song_id"] for entry in (existing.data or [])}
    next_position = max((entry["position"] for entry in (existing.data or [])), default=-1) + 1
    rows = [{"playlist_id": playlist_id, "song_id": sid, "position": next_position + offset}
            for offset, sid in enumerate(sid for sid in wanted if sid not in present)]
    if rows:
        await client.table(PLAYLIST_SONGS_TABLE).insert(rows).execute()
        await _touch_playlist(client, owner, playlist_id)
    return await get_playlist(user_id, playlist_id, client=client)


async def remove_playlist_song(user_id: str, playlist_id: str, song_id: str, *, client: Any = None) -> dict[str, Any]:
    owner = owner_uuid(user_id)
    client = client if client is not None else await supabase_client()
    await _owned_playlist(client, owner, playlist_id)
    await client.table(PLAYLIST_SONGS_TABLE).delete().eq("playlist_id", playlist_id).eq("song_id", song_id).execute()
    playlist = await get_playlist(user_id, playlist_id, client=client)
    # close the gap so positions stay dense
    if playlist["songs"]:
        return await reorder_playlist(user_id, playlist_id, [song["id"] for song in playlist["songs"]], client=client)
    await _touch_playlist(client, owner, playlist_id)
    return playlist


async def reorder_playlist(user_id: str, playlist_id: str, song_ids: list[str], *, client: Any = None) -> dict[str, Any]:
    """Set the playlist order to ``song_ids`` (must be a permutation of its current songs)."""
    owner = owner_uuid(user_id)
    client = client if client is not None else await supabase_client()
    await _owned_playlist(client, owner, playlist_id)
    existing = await client.table(PLAYLIST_SONGS_TABLE).select("song_id").eq("playlist_id", playlist_id).execute()
    current = {entry["song_id"] for entry in (existing.data or [])}
    if set(song_ids) != current or len(song_ids) != len(current):
        raise ValueError("song_ids must contain exactly the playlist's current songs, each once")
    for index, sid in enumerate(song_ids):
        await client.table(PLAYLIST_SONGS_TABLE).update({"position": index}).eq("playlist_id", playlist_id).eq("song_id", sid).execute()
    await _touch_playlist(client, owner, playlist_id)
    return await get_playlist(user_id, playlist_id, client=client)


async def update_playlist(user_id: str, playlist_id: str, *, title: str | None = None, description: str | None = None,
                          kind: str | None = None, client: Any = None) -> dict[str, Any]:
    owner = owner_uuid(user_id)
    client = client if client is not None else await supabase_client()
    await _owned_playlist(client, owner, playlist_id)
    fields: dict[str, Any] = {}
    if title is not None:
        if not title.strip():
            raise ValueError("title must not be empty")
        fields["title"] = title.strip()[:120]
    if description is not None:
        fields["description"] = description.strip()[:2000]
    if kind is not None:
        if kind not in PLAYLIST_KINDS:
            raise ValueError(f"kind must be one of {', '.join(PLAYLIST_KINDS)}")
        fields["kind"] = kind
    if fields:
        await client.table(PLAYLISTS_TABLE).update(fields).eq("owner_id", owner).eq("id", playlist_id).execute()
    return await get_playlist(user_id, playlist_id, client=client)


async def delete_playlist(user_id: str, playlist_id: str, *, client: Any = None) -> bool:
    """Delete the playlist (its songs stay in the library)."""
    owner = owner_uuid(user_id)
    client = client if client is not None else await supabase_client()
    try:
        await _owned_playlist(client, owner, playlist_id)
    except LookupError:
        return False
    await client.table(PLAYLISTS_TABLE).delete().eq("owner_id", owner).eq("id", playlist_id).execute()
    return True


class LiveMusicTools:
    """Class-based native tools over one ``LiveMusicSession`` (one per Live socket).

    Each method is an async ``@tool``; ``tools`` is what ``BidiAgent(tools=[...])`` registers.
    """

    def __init__(self, emit: Emit, *, user_id: str = "default", session: LiveMusicSession | None = None,
                 save: Callable[..., Awaitable[dict[str, Any]]] | None = None) -> None:
        self.session = session or LiveMusicSession(emit)
        self.user_id = user_id
        self._save = save or save_take

    @property
    def tools(self) -> list[Any]:
        return [
            self.music_set_weighted_prompts, self.music_set_generation_config, self.music_playback_control,
            self.music_status, self.music_take_status, self.music_save, self.music_discard_take, self.music_close,
            self.music_library, self.music_playlist_create, self.music_playlist_add, self.music_playlist_remove,
            self.music_playlist_reorder, self.music_playlist_delete, self.music_playlists,
        ]

    @tool(inputSchema={"json": {
        "type": "object",
        "properties": {"prompts": {
            "type": "array",
            "description": "The complete set of weighted prompts now in effect (replaces the previous set).",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "A musical idea: genre, instrument, mood or texture."},
                    "weight": {"type": "number", "description": "Relative importance; any value except 0. 1.0 is a good start."},
                },
                "required": ["text", "weight"],
            },
        }},
        "required": ["prompts"],
    }})
    async def music_set_weighted_prompts(self, prompts: list[dict[str, Any]]) -> dict[str, Any]:
        """Start or steer the live music (Lyria RealTime) with weighted prompts.

        Connects the music stream on first use and starts playback right away (the reference
        sequence: set_weighted_prompts, then play). Sends BidiGenerateMusicClientContent: the full
        list of weighted prompts replaces the previous list, so repeat prompts you want to keep.
        Weights are normalized and must not all be 0. Cross-fade by sending intermediate weights over
        a few calls; a drastic change in one call is an abrupt transition. Steering is forward-only:
        new prompts change the music from now on, never audio already played.

        Args:
            prompts: Weighted prompts, each {"text": str, "weight": number != 0}.
        """
        try:
            cleaned = validate_prompts(prompts)
            await self.session.set_weighted_prompts(cleaned)
            # First prompts on an idle stream: play immediately so the user hears music without a
            # second model round-trip. Paused/stopped are the user's choice and are left alone.
            if self.session.playback == "idle":
                await self.session.playback_control("play")
        except Exception as error:
            return _error(f"{type(error).__name__}: {error}")
        return {"prompts": cleaned, "playback": self.session.playback}

    @tool
    async def music_set_generation_config(
        self,
        bpm: int | None = None,
        scale: Literal[
            "C_MAJOR_A_MINOR", "D_FLAT_MAJOR_B_FLAT_MINOR", "D_MAJOR_B_MINOR", "E_FLAT_MAJOR_C_MINOR",
            "E_MAJOR_D_FLAT_MINOR", "F_MAJOR_D_MINOR", "G_FLAT_MAJOR_E_FLAT_MINOR", "G_MAJOR_E_MINOR",
            "A_FLAT_MAJOR_F_MINOR", "A_MAJOR_G_FLAT_MINOR", "B_FLAT_MAJOR_G_MINOR", "B_MAJOR_A_FLAT_MINOR",
            "SCALE_UNSPECIFIED",
        ] | None = None,
        density: float | None = None,
        brightness: float | None = None,
        guidance: float | None = None,
        temperature: float | None = None,
        top_k: int | None = None,
        seed: int | None = None,
        mute_bass: bool | None = None,
        mute_drums: bool | None = None,
        only_bass_and_drums: bool | None = None,
        music_generation_mode: Literal["QUALITY", "DIVERSITY", "VOCALIZATION"] | None = None,
    ) -> dict[str, Any]:
        """Send the complete music generation config (BidiGenerateMusicGenerationConfig).

        The whole config is sent every time: a field you omit reverts to Lyria's default, so repeat
        every field you want to keep. Changing bpm or scale is a hard transition and only takes effect
        after music_playback_control("reset_context") (or stop then play); the result says so.

        Args:
            bpm: Beats per minute, 60-200. Omit to let the model choose from the prompts.
            scale: Key/mode enum; each value covers the relative major and minor.
            density: Density of notes/sounds, 0.0 (sparse) to 1.0 (busy).
            brightness: Tonal brightness, 0.0 to 1.0 (higher emphasizes high frequencies).
            guidance: Prompt adherence, 0.0-6.0 (default 4.0; higher = closer but more abrupt transitions).
            temperature: Variance, 0.0-3.0 (default 1.1).
            top_k: Token sampling top-k, 1-1000 (default 40).
            seed: Generation seed, 0-2147483647 (random when omitted).
            mute_bass: Remove bass from the output.
            mute_drums: Remove drums from the output.
            only_bass_and_drums: Output only bass and drums.
            music_generation_mode: QUALITY (default), DIVERSITY, or VOCALIZATION (vocalizations as an instrument).
        """
        try:
            fields = validate_config({
                "bpm": bpm, "scale": scale, "density": density, "brightness": brightness, "guidance": guidance,
                "temperature": temperature, "top_k": top_k, "seed": seed, "mute_bass": mute_bass,
                "mute_drums": mute_drums, "only_bass_and_drums": only_bass_and_drums,
                "music_generation_mode": music_generation_mode,
            })
            previous = self.session.generation_config
            await self.session.set_music_generation_config(fields)
        except Exception as error:
            return _error(f"{type(error).__name__}: {error}")
        hard = [key for key in HARD_TRANSITION_FIELDS
                if self.session.playback == "playing" and fields.get(key) != previous.get(key)]
        return {"generation_config": fields, "reset_context_required": bool(hard),
                "hint": f'{", ".join(hard)} changed: call music_playback_control("reset_context") to apply' if hard else None}

    @tool
    async def music_playback_control(self, action: Literal["play", "pause", "stop", "reset_context"]) -> dict[str, Any]:
        """Send a playback control (BidiGenerateMusicPlaybackControl) to the live music stream.

        Args:
            action: play = start/resume generation; pause = hold (play resumes); stop = stop and reset
                the context (prompts and config kept; play restarts); reset_context = hard transition
                without stopping, required after a bpm or scale change.
        """
        if action not in PLAYBACK_CONTROLS:
            return _error(f"action must be one of {', '.join(PLAYBACK_CONTROLS)}")
        try:
            await self.session.playback_control(action)
        except Exception as error:
            return _error(f"{type(error).__name__}: {error}")
        return {"action": action, "playback": self.session.playback}

    @tool
    async def music_status(self) -> dict[str, Any]:
        """Current live music state: connection, playback, prompts, config, filtered prompts, errors."""
        return self.session.status()

    @tool
    async def music_take_status(self) -> dict[str, Any]:
        """What has been recorded from the live stream so far: seconds held and the segment timeline.

        Every audio chunk Lyria sends carries the prompts and config that produced it, so the take is
        split into segments at each change you made. The recorder is rolling: it keeps the most recent
        RON_LIVE_MUSIC_RECORD_SECONDS of music.
        """
        return self.session.take()

    @tool
    async def music_save(self, title: str = "") -> dict[str, Any]:
        """Save the recorded live music as a song in the user's library (Supabase: WAV in Storage + a
        songs row with the prompt/config timeline). Requires a signed-in user. The recording keeps going;
        call music_discard_take to start a fresh take.

        Args:
            title: Song title (defaults to a timestamp).
        """
        try:
            return await self._save(self.session, self.user_id, title)
        except Exception as error:
            return _error(f"{type(error).__name__}: {error}")

    @tool
    async def music_discard_take(self) -> dict[str, Any]:
        """Forget everything recorded so far so the next music_save starts from now."""
        self.session.recorder.clear()
        await self.session.emit({"type": "music_take", **self.session.take()})
        return {"discarded": True}

    async def _library(self, action: Callable[..., Awaitable[Any]], *args: Any, **kwargs: Any) -> dict[str, Any]:
        try:
            result = await action(self.user_id, *args, **kwargs)
        except LookupError as error:
            return _error(f"Not found: {error}")
        except Exception as error:
            return _error(f"{type(error).__name__}: {error}")
        return result if isinstance(result, dict) else {"items": result}

    @tool
    async def music_library(self, limit: int = 50) -> dict[str, Any]:
        """List the user's saved songs (newest first) with id, title, source, duration and a playback URL.

        Args:
            limit: Maximum songs to return (1-200).
        """
        return await self._library(list_songs, limit=max(1, min(200, limit)))

    @tool
    async def music_playlists(self, playlist_id: str | None = None) -> dict[str, Any]:
        """List the user's playlists and albums, or fetch one with its songs in order.

        Args:
            playlist_id: When given, return that playlist with its ordered songs; otherwise list all.
        """
        if playlist_id:
            return await self._library(get_playlist, playlist_id)
        return await self._library(list_playlists)

    @tool
    async def music_playlist_create(self, title: str, kind: Literal["playlist", "album"] = "playlist", description: str = "",
                                    song_ids: list[str] | None = None) -> dict[str, Any]:
        """Create a playlist or an album from saved songs. The user plays it continuously in order or shuffled.

        Args:
            title: Name of the playlist/album.
            kind: playlist (an ordered list) or album (a curated release the user assembled).
            description: Optional notes.
            song_ids: Saved song ids (from music_library) in the order they should play.
        """
        return await self._library(create_playlist, title, kind=kind, description=description, song_ids=song_ids or [])

    @tool
    async def music_playlist_add(self, playlist_id: str, song_ids: list[str]) -> dict[str, Any]:
        """Append saved songs to the end of a playlist/album, in the given order (duplicates are skipped).

        Args:
            playlist_id: Target playlist.
            song_ids: Saved song ids from music_library.
        """
        return await self._library(add_playlist_songs, playlist_id, song_ids)

    @tool
    async def music_playlist_remove(self, playlist_id: str, song_id: str) -> dict[str, Any]:
        """Remove one song from a playlist/album (the song stays in the library).

        Args:
            playlist_id: Target playlist.
            song_id: Song to remove.
        """
        return await self._library(remove_playlist_song, playlist_id, song_id)

    @tool
    async def music_playlist_reorder(self, playlist_id: str, song_ids: list[str]) -> dict[str, Any]:
        """Set a playlist/album's track order. song_ids must contain exactly its current songs, each once.

        Args:
            playlist_id: Target playlist.
            song_ids: The complete new order.
        """
        return await self._library(reorder_playlist, playlist_id, song_ids)

    @tool
    async def music_playlist_delete(self, playlist_id: str) -> dict[str, Any]:
        """Delete a playlist/album. Its songs remain in the library.

        Args:
            playlist_id: Playlist to delete.
        """
        try:
            return {"deleted": await delete_playlist(self.user_id, playlist_id)}
        except Exception as error:
            return _error(f"{type(error).__name__}: {error}")

    @tool
    async def music_close(self) -> dict[str, Any]:
        """End the live music session and silence the stream (prompts and config are forgotten; the
        recorded take is kept until the Live call ends, so music_save still works)."""
        await self.session.close()
        return {"closed": True}
