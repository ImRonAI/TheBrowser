import asyncio
import json

from fastapi.testclient import TestClient

from agent.api.core import video_summary
from agent.api.main import app


def test_extract_youtube_id_variants():
    assert video_summary.extract_youtube_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert video_summary.extract_youtube_id("https://youtu.be/dQw4w9WgXcQ?t=42") == "dQw4w9WgXcQ"
    assert video_summary.extract_youtube_id("https://www.youtube.com/shorts/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert video_summary.extract_youtube_id("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert video_summary.extract_youtube_id("https://vimeo.com/123456789") is None
    assert video_summary.extract_youtube_id("https://www.youtube.com/channel/UC12345") is None
    assert video_summary.extract_youtube_id("javascript:alert(1)") is None


def test_parse_timedtext_xml_and_json3_and_chapters():
    xml_caption = b"""<?xml version="1.0" encoding="utf-8" ?>
    <transcript>
      <text start="0.5" dur="4.2">Welcome to our deep dive &amp; architectural overview.</text>
      <text start="35.0" dur="5.0">Next we examine the memory controller latency numbers.</text>
      <text start="40.0" dur="5.0">Finally we compare bandwidth saturation curves.</text>
    </transcript>"""
    parsed_xml = video_summary._parse_timedtext(xml_caption)
    assert "[00:00] Welcome to our deep dive & architectural overview." in parsed_xml
    assert "[00:40] Finally we compare bandwidth saturation curves." in parsed_xml

    json3_caption = json.dumps({
        "events": [
            {"tStartMs": 1000, "segs": [{"utf8": "First segment "}, {"utf8": "in JSON3."}]},
            {"tStartMs": 42000, "segs": [{"utf8": "Second segment after thirty seconds."}]},
            {"tStartMs": 50000, "segs": [{"utf8": "Third segment in next bucket."}]},
        ]
    }).encode("utf-8")
    parsed_json3 = video_summary._parse_timedtext(json3_caption)
    assert "[00:01] First segment in JSON3." in parsed_json3
    assert "[00:50] Third segment in next bucket." in parsed_json3

    chapters = video_summary._parse_chapters("Intro paragraph\n0:00 Opening thesis\n04:15 - Benchmark walkthrough\n1:02:10 Final verdict")
    assert chapters == ["[0:00] Opening thesis", "[04:15] Benchmark walkthrough", "[1:02:10] Final verdict"]


def test_video_summary_endpoint_streams_mistral_glm_and_caches(monkeypatch):
    video_summary.clear_video_summary_cache()
    fetch_calls = []
    model_calls = []

    async def fake_fetch_context(video_id, **kwargs):
        fetch_calls.append((video_id, kwargs))
        return video_summary.VideoContext(
            video_id=video_id,
            url=f"https://www.youtube.com/watch?v={video_id}",
            title=kwargs.get("fallback_title") or "Systems Architecture Breakdown",
            channel="Systems Lab",
            duration_seconds=754,
            published="2026-11-12",
            description="0:00 Overview\n05:10 Benchmarks",
            chapters=["[0:00] Overview", "[05:10] Benchmarks"],
            transcript="[0:00] Today we benchmark the new interconnect.",
            snippets=kwargs.get("fallback_snippets") or [],
        )

    async def fake_stream_deltas(prompt):
        model_calls.append(prompt)
        yield "## Overview\n\nSystems Lab benchmarks the new interconnect.\n\n"
        yield "## What It Covers\n\n- `[00:00]` Architecture and latency.\n\n## Key Takeaways\n\n- Lower tail latency."

    monkeypatch.setattr(video_summary, "fetch_youtube_context", fake_fetch_context)
    monkeypatch.setattr(video_summary, "_stream_mistral_glm_deltas", fake_stream_deltas)

    client = TestClient(app)
    resp = client.post(
        "/articles/video-summary",
        json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "title": "Systems Architecture Breakdown"},
    )
    assert resp.status_code == 200
    events = [
        json.loads(line.removeprefix("data: "))
        for line in resp.text.splitlines()
        if line.startswith("data: ")
    ]
    assert events[0]["type"] == "meta"
    assert events[0]["model"] == "mistral/zai-glm-5-3-flash"
    assert events[0]["meta"]["duration"] == "12:34"
    assert events[-1]["type"] == "done"
    assert "## What It Covers" in events[-1]["text"]
    assert len(fetch_calls) == 1 and len(model_calls) == 1
    assert "Timestamped Transcript:" in model_calls[0]

    # Second call serves from cache without hitting YouTube or Mistral again
    resp_cached = client.post(
        "/articles/video-summary",
        json={"url": "https://youtu.be/dQw4w9WgXcQ"},
    )
    cached_events = [
        json.loads(line.removeprefix("data: "))
        for line in resp_cached.text.splitlines()
        if line.startswith("data: ")
    ]
    assert cached_events[0]["cached"] is True
    assert cached_events[-1]["text"] == events[-1]["text"]
    assert len(fetch_calls) == 1 and len(model_calls) == 1

    # Non-YouTube URLs rejected with 422
    bad = client.post("/articles/video-summary", json={"url": "https://example.com/video.mp4"})
    assert bad.status_code == 422
    video_summary.clear_video_summary_cache()
