"""Batch music generation for Ron's agents: Lyria 3.5 / Lyria 3 Clip and ElevenLabs Music.

Both produce a finished MP3 in one call (no streaming, no multi-turn editing), so each is a
single native async ``@tool`` that generates and returns the result (duration, lyrics, a signed
URL when saved). Saving reuses ``live_music.store_song`` (Supabase Storage + ``songs`` row).

* **Lyria** uses the official google-genai client, exactly as the docs show:
  ``await client.aio.interactions.create(model=..., input=<str | [text, image]>, response_format=...)``;
  the result's ``output_audio`` (``AudioContent``: ``data`` base64, ``mime_type``) is the song and
  ``output_text`` the generated lyrics/structure (``<instrumental>`` when none). Verified live
  2026-10-06: ``lyria-3-clip-preview`` → ``audio/mpeg``, ~93 s latency for a 30 s clip. The API has no
  duration or seed parameters; length is prompt-controlled on ``lyria-3.5``.
* **ElevenLabs** uses the public REST API over httpx (no SDK dependency):
  ``POST /v1/music/detailed`` (``prompt`` | ``composition_plan``, ``music_length_ms`` 3000-600000,
  ``model_id`` ``music_v1|music_v2|music_v2_5``, ``seed``, ``force_instrumental``, query
  ``output_format``) returns ``multipart/mixed`` with JSON metadata (``composition_plan``,
  ``song_metadata``) and the audio part; ``POST /v1/music/plan`` creates a composition plan for free.
"""

from __future__ import annotations

import asyncio
import base64
import json
import re
from collections.abc import Awaitable, Callable
from typing import Any, Literal

import httpx
from strands import tool

from agent.api.core import config


LYRIA_MODELS = ("lyria-3.5", "lyria-3-clip-preview")
ELEVENLABS_MODELS = ("music_v2_5", "music_v2", "music_v1")
ELEVENLABS_BASE_URL = "https://api.elevenlabs.io"
#: Lyria batch output: 44.1 kHz stereo MP3 (docs). Used for the songs row when the response omits it.
LYRIA_SAMPLE_RATE = 44100

Saver = Callable[..., Awaitable[dict[str, Any]]]


def _error(message: str) -> dict[str, Any]:
    return {"status": "error", "content": [{"text": message}]}


# ─── MP3 duration (no decoder dependency) ────────────────────────────────────

_BITRATES = {  # MPEG1 L3, MPEG2/2.5 L3 (kbps) by bitrate index
    1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}
_SAMPLE_RATES = {1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 3: [11025, 12000, 8000]}


def mp3_info(data: bytes) -> tuple[float, int, int]:
    """``(duration_seconds, sample_rate, channels)`` by walking MPEG Layer III frame headers.

    Handles an ID3v2 prefix and VBR streams (frames are summed, not extrapolated). Returns zeros
    when no sync word is found so a caller can still save the file.
    """
    pos = 0
    if data[:3] == b"ID3" and len(data) >= 10:
        size = (data[6] & 0x7F) << 21 | (data[7] & 0x7F) << 14 | (data[8] & 0x7F) << 7 | (data[9] & 0x7F)
        pos = 10 + size
    frames = 0
    seconds = 0.0
    sample_rate = 0
    channels = 0
    n = len(data)
    while pos + 4 <= n:
        b1, b2, b3, b4 = data[pos], data[pos + 1], data[pos + 2], data[pos + 3]
        if b1 != 0xFF or (b2 & 0xE0) != 0xE0:
            pos += 1
            continue
        version_bits = (b2 >> 3) & 0x03  # 00=2.5, 10=2, 11=1
        layer_bits = (b2 >> 1) & 0x03  # 01 = Layer III
        bitrate_index = b3 >> 4
        rate_index = (b3 >> 2) & 0x03
        padding = (b3 >> 1) & 0x01
        if layer_bits != 0x01 or bitrate_index in (0, 15) or rate_index == 3 or version_bits == 1:
            pos += 1
            continue
        version = 1 if version_bits == 3 else (2 if version_bits == 2 else 3)
        bitrate = _BITRATES[1 if version == 1 else 2][bitrate_index] * 1000
        rate = _SAMPLE_RATES[version][rate_index]
        samples = 1152 if version == 1 else 576
        length = (samples // 8 * bitrate) // rate + padding
        if length <= 0:
            pos += 1
            continue
        frames += 1
        seconds += samples / rate
        sample_rate = rate
        channels = 1 if ((b4 >> 6) & 0x03) == 3 else 2
        pos += length
    return (round(seconds, 3), sample_rate, channels) if frames else (0.0, 0, 0)


# ─── Lyria 3.5 / Lyria 3 Clip ────────────────────────────────────────────────

def lyria_client() -> Any:
    from google import genai

    if not config.GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not configured; Lyria needs the Gemini API key.")
    return genai.Client(api_key=config.GEMINI_API_KEY)


def lyria_input(prompt: str, image_base64: str | None, image_mime_type: str | None) -> Any:
    """``input`` for ``interactions.create``: a string, or ``[text, image]`` content for image-inspired music."""
    prompt = prompt.strip()
    if not prompt:
        raise ValueError("prompt must not be empty")
    if not image_base64:
        return prompt
    mime = image_mime_type or "image/jpeg"
    if mime not in ("image/png", "image/jpeg", "image/webp", "image/heic", "image/heif", "image/gif", "image/bmp", "image/tiff"):
        raise ValueError(f"unsupported image mime type {mime!r}")
    return [{"type": "text", "text": prompt}, {"type": "image", "mime_type": mime, "data": image_base64}]


async def lyria_generate(prompt: str, *, model: str = "lyria-3.5", audio_only: bool = False, image_base64: str | None = None,
                         image_mime_type: str | None = None, client: Any = None, timeout: float | None = None) -> dict[str, Any]:
    """One ``interactions.create`` call; returns ``{audio: bytes, mime_type, lyrics, interaction_id, status, model}``."""
    if model not in LYRIA_MODELS:
        raise ValueError(f"model must be one of {', '.join(LYRIA_MODELS)}")
    client = client if client is not None else lyria_client()
    kwargs: dict[str, Any] = {"model": model, "input": lyria_input(prompt, image_base64, image_mime_type)}
    if audio_only:
        kwargs["response_format"] = {"type": "audio"}
    interaction = await asyncio.wait_for(client.aio.interactions.create(**kwargs), timeout or config.MUSIC_GENERATION_TIMEOUT)
    status = str(getattr(interaction, "status", "") or "")
    audio = getattr(interaction, "output_audio", None)
    if status not in ("completed", "") and audio is None:
        errors = getattr(interaction, "errors", None)
        raise RuntimeError(f"Lyria interaction {status}: {errors or 'no audio was produced'}")
    data = base64.b64decode(audio.data) if audio is not None and getattr(audio, "data", None) else b""
    if not data:
        raise RuntimeError("Lyria returned no audio (the prompt may have been blocked by the safety filter).")
    return {
        "audio": data, "mime_type": getattr(audio, "mime_type", None) or "audio/mpeg",
        "lyrics": (getattr(interaction, "output_text", None) or "").strip(), "interaction_id": getattr(interaction, "id", None),
        "status": status or "completed", "model": model,
    }


# ─── ElevenLabs Music ────────────────────────────────────────────────────────

def _elevenlabs_headers() -> dict[str, str]:
    if not config.ELEVENLABS_API_KEY:
        raise RuntimeError("ELEVENLABS_API_KEY is not configured.")
    return {"xi-api-key": config.ELEVENLABS_API_KEY}


def parse_multipart_mixed(content_type: str, body: bytes) -> tuple[dict[str, Any], bytes, str]:
    """``(json_metadata, audio_bytes, audio_content_type)`` from ElevenLabs' ``multipart/mixed`` response.

    Parts are split on ``CRLF + boundary`` so exactly one delimiter CRLF is removed from each payload;
    the audio part is binary and may legitimately begin or end with 0x0D/0x0A bytes.
    """
    match = re.search(r'boundary="?([^";]+)"?', content_type)
    if not match:
        raise ValueError(f"multipart response without a boundary: {content_type!r}")
    boundary = ("--" + match.group(1)).encode()
    metadata: dict[str, Any] = {}
    audio = b""
    audio_type = ""
    # The first boundary has no preceding CRLF; normalise so every part is preceded by CRLF+boundary.
    if body.startswith(boundary):
        body = b"\r\n" + body
    for part in body.split(b"\r\n" + boundary)[1:]:
        if part.startswith(b"--"):  # closing delimiter
            break
        if part.startswith(b"\r\n"):
            part = part[2:]
        head, sep, payload = part.partition(b"\r\n\r\n")
        if not sep:
            continue
        headers = {k.strip().lower(): v.strip() for k, _, v in (line.decode(errors="replace").partition(":") for line in head.split(b"\r\n")) if k}
        ctype = headers.get("content-type", "")
        if ctype.startswith("application/json"):
            metadata = json.loads(payload.decode("utf-8", errors="replace") or "{}")
        elif ctype.startswith("audio/") or ctype.startswith("application/octet-stream"):
            audio = payload
            audio_type = ctype
    if not audio:
        raise ValueError("multipart response contained no audio part")
    return metadata, audio, audio_type


async def elevenlabs_compose(*, prompt: str | None = None, composition_plan: dict[str, Any] | None = None,
                             music_length_ms: int | None = None, model_id: str = "music_v2_5", seed: int | None = None,
                             force_instrumental: bool | None = None, output_format: str | None = None,
                             http: httpx.AsyncClient | None = None, timeout: float | None = None) -> dict[str, Any]:
    """``POST /v1/music/detailed``: returns ``{audio, mime_type, composition_plan, song_metadata, song_id, model_id}``."""
    if bool(prompt) == bool(composition_plan):
        raise ValueError("give exactly one of prompt or composition_plan")
    if model_id not in ELEVENLABS_MODELS:
        raise ValueError(f"model_id must be one of {', '.join(ELEVENLABS_MODELS)}")
    if music_length_ms is not None and not 3000 <= music_length_ms <= 600000:
        raise ValueError("music_length_ms must be between 3000 and 600000")
    if seed is not None and not 0 <= seed <= 2_147_483_647:
        raise ValueError("seed must be between 0 and 2147483647")
    body: dict[str, Any] = {"model_id": model_id}
    if prompt:
        body["prompt"] = prompt.strip()[:4100]
        if music_length_ms is not None:
            body["music_length_ms"] = music_length_ms
        if force_instrumental is not None:
            body["force_instrumental"] = force_instrumental
    else:
        body["composition_plan"] = composition_plan
    if seed is not None:
        body["seed"] = seed
    params = {"output_format": output_format} if output_format else None
    own = http is None
    http = http or httpx.AsyncClient(base_url=ELEVENLABS_BASE_URL, timeout=timeout or config.MUSIC_GENERATION_TIMEOUT)
    try:
        response = await http.post("/v1/music/detailed", json=body, params=params, headers=_elevenlabs_headers())
    finally:
        if own:
            await http.aclose()
    if response.status_code >= 400:
        raise RuntimeError(f"ElevenLabs {response.status_code}: {response.text[:600]}")
    content_type = response.headers.get("content-type", "")
    if content_type.startswith("multipart/"):
        metadata, audio, audio_type = parse_multipart_mixed(content_type, response.content)
    else:  # defensive: a plain audio body
        metadata, audio, audio_type = {}, response.content, content_type
    return {
        "audio": audio, "mime_type": audio_type or "audio/mpeg", "composition_plan": metadata.get("composition_plan") or {},
        "song_metadata": metadata.get("song_metadata") or {}, "song_id": response.headers.get("song-id"), "model_id": model_id,
    }


async def elevenlabs_plan(*, prompt: str, music_length_ms: int | None = None, model_id: str = "music_v2_5",
                          source_plan: dict[str, Any] | None = None, http: httpx.AsyncClient | None = None) -> dict[str, Any]:
    """``POST /v1/music/plan`` (free): a composition plan the user can edit before composing."""
    if model_id not in ELEVENLABS_MODELS:
        raise ValueError(f"model_id must be one of {', '.join(ELEVENLABS_MODELS)}")
    body: dict[str, Any] = {"prompt": prompt.strip()[:4100], "model_id": model_id}
    if music_length_ms is not None:
        body["music_length_ms"] = music_length_ms
    if source_plan:
        body["composition_plan"] = source_plan
    own = http is None
    http = http or httpx.AsyncClient(base_url=ELEVENLABS_BASE_URL, timeout=60)
    try:
        response = await http.post("/v1/music/plan", json=body, headers=_elevenlabs_headers())
    finally:
        if own:
            await http.aclose()
    if response.status_code >= 400:
        raise RuntimeError(f"ElevenLabs {response.status_code}: {response.text[:600]}")
    return response.json()


# ─── Tools ───────────────────────────────────────────────────────────────────

class MusicGenerationTools:
    """Class-based native async tools for batch music generation (Lyria 3.5 and ElevenLabs Music).

    ``user_id`` binds saving to the signed-in user (guests get a tool error); ``saver`` is
    ``live_music.store_song`` unless a test injects a fake.
    """

    def __init__(self, user_id: str = "default", *, saver: Saver | None = None, lyria: Callable[..., Awaitable[dict[str, Any]]] | None = None,
                 compose: Callable[..., Awaitable[dict[str, Any]]] | None = None, plan: Callable[..., Awaitable[dict[str, Any]]] | None = None) -> None:
        self.user_id = user_id
        self._saver = saver
        self._lyria = lyria or lyria_generate
        self._compose = compose or elevenlabs_compose
        self._plan = plan or elevenlabs_plan

    @property
    def tools(self) -> list[Any]:
        tools: list[Any] = []
        if config.GEMINI_API_KEY or self._lyria is not lyria_generate:
            tools.append(self.lyria_generate_song)
        if config.ELEVENLABS_API_KEY or self._compose is not elevenlabs_compose:
            tools.extend([self.elevenlabs_compose_song, self.elevenlabs_composition_plan])
        return tools

    async def _save(self, **kwargs: Any) -> dict[str, Any]:
        from agent.api.core.live_music import store_song

        saver = self._saver or store_song
        return await saver(self.user_id, **kwargs)

    @tool
    async def lyria_generate_song(
        self,
        prompt: str,
        model: Literal["lyria-3.5", "lyria-3-clip-preview"] = "lyria-3.5",
        title: str = "",
        save: bool = True,
        audio_only: bool = False,
        image_base64: str | None = None,
        image_mime_type: Literal["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp", "image/tiff", "image/heic", "image/heif"] | None = None,
    ) -> dict[str, Any]:
        """Generate a complete song (Lyria 3.5, a couple of minutes, vocals + lyrics unless the prompt says
        instrumental) or a 30-second clip (Lyria 3 Clip) from a text prompt, optionally inspired by an image.

        One shot, 44.1 kHz stereo MP3; generation is not editable afterwards (describe structure, lyrics
        with [Verse]/[Chorus] tags, timing like "[0:00 - 0:10] Intro", tempo, key and mood in the prompt).
        Takes 1-3 minutes. Saved songs appear in the user's library with a playback URL.

        Args:
            prompt: What to generate: genre, instruments, mood, structure, optional lyrics; add "instrumental only" for no vocals.
            model: lyria-3.5 for full songs, lyria-3-clip-preview for 30 s clips/loops.
            title: Library title (defaults to the first words of the prompt).
            save: Store the song in the user's library (needs a signed-in user).
            audio_only: Skip the generated lyrics/structure text.
            image_base64: Optional image (base64) to inspire the music.
            image_mime_type: MIME type of image_base64.
        """
        try:
            result = await self._lyria(prompt, model=model, audio_only=audio_only, image_base64=image_base64, image_mime_type=image_mime_type)
        except Exception as error:
            return _error(f"{type(error).__name__}: {error}")
        duration, rate, channels = mp3_info(result["audio"])
        out: dict[str, Any] = {"model": model, "duration_seconds": duration, "mime_type": result["mime_type"],
                               "lyrics": result["lyrics"], "interaction_id": result["interaction_id"], "saved": False}
        if save:
            try:
                saved = await self._save(title=title or prompt.strip()[:60], source="lyria", model=model, audio=result["audio"], fmt="mp3",
                                         duration_seconds=duration, sample_rate=rate or LYRIA_SAMPLE_RATE, channels=channels or 2,
                                         prompt=prompt, lyrics=result["lyrics"])
                out.update(saved, saved=True)
            except Exception as error:
                out["save_error"] = f"{type(error).__name__}: {error}"
        return out

    @tool
    async def elevenlabs_compose_song(
        self,
        prompt: str | None = None,
        composition_plan: dict[str, Any] | None = None,
        music_length_ms: int | None = None,
        model_id: Literal["music_v2_5", "music_v2", "music_v1"] = "music_v2_5",
        seed: int | None = None,
        force_instrumental: bool | None = None,
        title: str = "",
        save: bool = True,
    ) -> dict[str, Any]:
        """Compose a song with ElevenLabs Music (default model music_v2_5) from a prompt OR a composition plan.

        Returns the plan the model actually used (global/section styles, lyric lines, durations) and song
        metadata; the audio is an MP3 saved to the user's library when save is true. Use
        elevenlabs_composition_plan first when the user wants to approve the structure or lyrics.

        Args:
            prompt: Free-text description (<= 4100 chars). Mutually exclusive with composition_plan.
            composition_plan: A plan from elevenlabs_composition_plan (positive/negative global styles, sections with
                section_name, duration_ms, lines, local styles). Mutually exclusive with prompt.
            music_length_ms: Song length 3000-600000 ms; prompt mode only (the model chooses when omitted).
            model_id: music_v2_5 (default), music_v2 or music_v1.
            seed: 0-2147483647 for more consistent results.
            force_instrumental: Guarantee no vocals (prompt mode only).
            title: Library title (defaults to the plan's song title or the first words of the prompt).
            save: Store the song in the user's library (needs a signed-in user).
        """
        try:
            result = await self._compose(prompt=prompt, composition_plan=composition_plan, music_length_ms=music_length_ms,
                                         model_id=model_id, seed=seed, force_instrumental=force_instrumental)
        except Exception as error:
            return _error(f"{type(error).__name__}: {error}")
        duration, rate, channels = mp3_info(result["audio"])
        meta = result["song_metadata"]
        plan = result["composition_plan"]
        lyrics = "\n".join(line for section in (plan.get("sections") or []) for line in (section.get("lines") or []))
        out: dict[str, Any] = {"model_id": model_id, "duration_seconds": duration, "mime_type": result["mime_type"],
                               "composition_plan": plan, "song_metadata": meta, "elevenlabs_song_id": result["song_id"], "saved": False}
        if save:
            try:
                saved = await self._save(title=title or str(meta.get("title") or (prompt or "").strip()[:60]), source="elevenlabs",
                                         model=model_id, audio=result["audio"], fmt="mp3", duration_seconds=duration,
                                         sample_rate=rate or 48000, channels=channels or 2, prompt=prompt or "", lyrics=lyrics,
                                         composition_plan=plan)
                out.update(saved, saved=True)
            except Exception as error:
                out["save_error"] = f"{type(error).__name__}: {error}"
        return out

    @tool
    async def elevenlabs_composition_plan(
        self,
        prompt: str,
        music_length_ms: int | None = None,
        model_id: Literal["music_v2_5", "music_v2", "music_v1"] = "music_v2_5",
        source_plan: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Draft an ElevenLabs composition plan (free, no audio): global styles, sections with durations and
        lyric lines. Edit it with the user, then pass it to elevenlabs_compose_song as composition_plan.

        Args:
            prompt: What the song should be.
            music_length_ms: Target length 3000-600000 ms.
            model_id: Plan format differs per model; match the model you will compose with.
            source_plan: An existing plan to revise.
        """
        try:
            return await self._plan(prompt=prompt, music_length_ms=music_length_ms, model_id=model_id, source_plan=source_plan)
        except Exception as error:
            return _error(f"{type(error).__name__}: {error}")


def music_generation_tools(user_id: str) -> list[Any]:
    """The batch generation tools for one user's agents (empty when disabled or no provider key is set)."""
    if not config.MUSIC_GENERATION_ENABLED:
        return []
    return MusicGenerationTools(user_id).tools


__all__ = [
    "ELEVENLABS_MODELS", "LYRIA_MODELS", "MusicGenerationTools", "elevenlabs_compose", "elevenlabs_plan", "lyria_generate",
    "mp3_info", "music_generation_tools", "parse_multipart_mixed",
]
