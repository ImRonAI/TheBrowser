"""``POST /attachments/title``: a short summary name for a pasted prompt's attachment card.

The panel names the card from the paste's opening words at once and swaps this title in when it
arrives; any failure here leaves that name in place. Ported from the v0-clone-blurple orchestrator's
``POST /attachments/title`` (``server.py`` ``attachment_title``).
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from agent.api.core.prompt_attachments import ATTACHMENT_TEXT_MAX, paste_title

router = APIRouter()


class PasteTitleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=ATTACHMENT_TEXT_MAX)


@router.post("/attachments/title")
async def attachment_title(body: PasteTitleRequest) -> dict[str, str]:
    try:
        return {"title": await paste_title(body.text)}
    except (TimeoutError, ValueError) as error:
        raise HTTPException(504, f"No title: {error}") from error
    except Exception as error:
        raise HTTPException(502, f"Title model failed: {type(error).__name__}: {error}") from error
