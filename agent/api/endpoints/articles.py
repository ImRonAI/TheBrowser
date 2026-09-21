import asyncio

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from agent.api.core.articles import extract_article

router = APIRouter()
_slots = asyncio.Semaphore(4)


class ArticleRequest(BaseModel):
    url: str = Field(min_length=1, max_length=4096)


@router.post("/articles/extract")
async def extract(request: ArticleRequest):
    try:
        async with asyncio.timeout(20), _slots:
            return await extract_article(request.url)
    except (ValueError, httpx.HTTPError, OSError, TimeoutError) as error:
        raise HTTPException(422, "Full text unavailable. Use the source preview or open the original.") from error