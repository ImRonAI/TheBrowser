import asyncio
import json

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agent.api.core.articles import ArticleUnavailableError, extract_article
from agent.api.core.video_summary import extract_youtube_id, stream_video_writeup

router = APIRouter()
_slots = asyncio.Semaphore(6)
_video_slots = asyncio.Semaphore(4)


class ArticleRequest(BaseModel):
    url: str = Field(min_length=1, max_length=4096)


class VideoSummaryRequest(BaseModel):
    url: str = Field(min_length=1, max_length=4096)
    title: str = Field(default="", max_length=1000)
    channel: str = Field(default="", max_length=500)
    description: str = Field(default="", max_length=6000)
    snippets: list[str] = Field(default_factory=list, max_length=12)


@router.post("/articles/extract")
async def extract(request: ArticleRequest):
    try:
        async with asyncio.timeout(25), _slots:
            return await extract_article(request.url)
    except ArticleUnavailableError as error:
        if error.reason == "paywalled":
            raise HTTPException(422, "This publisher locks the full article behind a subscription. Use the preview or open the original.") from error
        if error.reason == "challenge":
            raise HTTPException(422, "Publisher verification blocked automated retrieval. Open the original page to read.") from error
        raise HTTPException(422, "Full text unavailable. Use the source preview or open the original.") from error
    except (ValueError, httpx.HTTPError, OSError, TimeoutError) as error:
        raise HTTPException(422, "Full text unavailable. Use the source preview or open the original.") from error


@router.post("/articles/video-summary")
async def video_summary(request: VideoSummaryRequest):
    if not extract_youtube_id(request.url):
        raise HTTPException(422, "Video writeups require a valid YouTube video URL.")

    async def event_stream():
        try:
            async with asyncio.timeout(45), _video_slots:
                async for payload in stream_video_writeup(
                    request.url,
                    title=request.title,
                    channel=request.channel,
                    description=request.description,
                    snippets=request.snippets,
                ):
                    yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
        except Exception as error:
            err_payload = {"type": "error", "message": str(error) or "Video writeup unavailable."}
            yield f"data: {json.dumps(err_payload, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
