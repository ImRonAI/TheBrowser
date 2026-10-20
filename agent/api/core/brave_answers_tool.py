"""``brave_answer``: Brave Answers (``POST /chat/completions``) as a native Strands tool.

Registered as a core tool so every Ron agent (panel text agent, Live ``BidiAgent``, recall/fixer/
teaching children, issue agents) can ask Brave for a web-grounded, cited answer. The tool is a thin
pass-through to ``BraveAnswersClient``: parameters are the documented request-body fields, the result
is the collected stream (text, parsed ``<citation>`` tags, ``<usage>`` cost metadata). Nothing is
summarized or re-ranked here; the agent decides what to do with the cited answer.
"""

from __future__ import annotations

from typing import Any, Literal

from strands import tool

from agent.api.core.brave_search import BraveAnswersClient, BraveSearchError

_CLIENT: BraveAnswersClient | None = None


def answers_client() -> BraveAnswersClient:
    """Process-wide client (one 2 req/s bucket for the whole API, matching the plan policy)."""
    global _CLIENT
    if _CLIENT is None:
        _CLIENT = BraveAnswersClient()
    return _CLIENT


def set_answers_client(client: BraveAnswersClient | None) -> None:
    """Test seam."""
    global _CLIENT
    _CLIENT = client


@tool
async def brave_answer(
    question: str,
    model: Literal["brave", "brave-pro"] | None = None,
    country: str = "us",
    language: str = "en",
    enable_citations: bool = True,
    enable_research: bool = False,
    search_context_size: Literal["low", "medium", "high"] | None = None,
    research_maximum_number_of_queries: int | None = None,
    research_maximum_number_of_seconds: int | None = None,
) -> dict[str, Any]:
    """Ask Brave Answers for an AI-generated answer grounded in a real-time web search, with
    verifiable citations. Use it for factual questions, current events, "what/who/when/how much"
    lookups, or when you need sources you can show the user. One question per call.

    Default mode is a single search (answers stream in ~4.5 s). Set enable_research=true for
    iterative multi-search research (can take minutes; citations are not available in research
    mode). The result carries the answer text (citation tags removed), the citations
    ({number, url, snippet, favicon}) and the <usage> cost metadata Brave returns.

    Args:
        question: The question to answer (the single user message).
        model: "brave" (fast, default) or "brave-pro" (the API's own default, higher quality).
        country: Target country for search results (2-letter, default "us").
        language: Response language (default "en").
        enable_citations: Include inline citations (default true; ignored in research mode).
        enable_research: Multi-search research mode for thorough answers (default false).
        search_context_size: web_search_options.search_context_size: "low" | "medium" | "high".
        research_maximum_number_of_queries: Research only; 1-50 (default 20).
        research_maximum_number_of_seconds: Research only; 1-300 (default 180).
    """
    options: dict[str, Any] = {
        "model": model, "country": country, "language": language,
        "enable_citations": enable_citations, "enable_research": enable_research,
        "search_context_size": search_context_size,
    }
    if enable_research:
        if research_maximum_number_of_queries is not None:
            options["research_maximum_number_of_queries"] = research_maximum_number_of_queries
        if research_maximum_number_of_seconds is not None:
            options["research_maximum_number_of_seconds"] = research_maximum_number_of_seconds
    try:
        answer = await answers_client().answer(question, **options)
    except BraveSearchError as error:
        return {"status": "error", "content": [{"text": f"brave_answer {error.code}: {error}"}]}
    return {
        "answer": answer.text,
        "citations": [citation.model_dump(exclude_none=True) for citation in answer.citations],
        "usage": answer.usage,
        "model": answer.model,
        "finish_reason": answer.finish_reason,
    }
