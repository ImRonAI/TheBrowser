"""
Perplexity Search API integration for agent tooling.

Provides rich, async search results with optional media enrichment and
structured chain-of-thought metadata suitable for UI rendering.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union
from urllib.parse import urlparse
from pathlib import Path

import aiohttp
from bs4 import BeautifulSoup  # type: ignore
from dotenv import load_dotenv
from strands import tool

try:
    from perplexity import AsyncPerplexity, APIError, RateLimitError  # type: ignore
except ImportError:  # pragma: no cover - handled gracefully at runtime
    AsyncPerplexity = None  # type: ignore
    APIError = Exception  # type: ignore
    RateLimitError = Exception  # type: ignore

logger = logging.getLogger(__name__)

ENV_PATH = Path(__file__).resolve().parents[3] / ".env"
load_dotenv(ENV_PATH)


def _read_env_value(key: str) -> Optional[str]:
    for path in (ENV_PATH, Path.cwd() / ".env"):
        if not path.exists():
            continue
        try:
            for line in path.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                name, value = line.split("=", 1)
                if name.strip() == key:
                    return value.strip().strip('"').strip("'")
        except Exception:
            continue
    return None

USER_AGENT = (
    "RonAI/PerplexitySearchIntegration (+https://ron-ai-web.local) "
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)

MAX_MEDIA_PER_RESULT = 3
HTML_CHAR_LIMIT = 120_000
API_TOOL_TIMEOUT_SECONDS = int(os.getenv("API_TOOL_TIMEOUT_SECONDS", "7"))
MEDIA_FETCH_TIMEOUT = aiohttp.ClientTimeout(total=API_TOOL_TIMEOUT_SECONDS)
CONCURRENT_MEDIA_FETCHES = 5


def _build_filters_summary(filters: Dict[str, Any]) -> str:
    """Return human friendly summary for chain-of-thought."""
    if not filters:
        return "No additional filters applied."

    readable_parts: List[str] = []
    if filters.get("search_domain_filter"):
        readable_parts.append(
            f"domains={len(filters['search_domain_filter'])} "
            f"({', '.join(filters['search_domain_filter'][:3])}"
            f"{'…' if len(filters['search_domain_filter']) > 3 else ''})"
        )
    if filters.get("search_recency_filter"):
        readable_parts.append(f"recency={filters['search_recency_filter']}")
    if filters.get("search_after_date_filter") or filters.get("search_before_date_filter"):
        start = filters.get("search_after_date_filter", "any")
        end = filters.get("search_before_date_filter", "present")
        readable_parts.append(f"date_range={start} → {end}")
    if filters.get("search_context_size"):
        readable_parts.append(f"context={filters['search_context_size']}")
    if filters.get("country"):
        readable_parts.append(f"country={filters['country']}")
    if filters.get("user_location"):
        readable_parts.append("user_location=custom")

    remaining = [
        key for key in filters.keys()
        if key not in {
            "search_domain_filter",
            "search_recency_filter",
            "search_after_date_filter",
            "search_before_date_filter",
            "search_context_size",
            "country",
            "user_location",
        }
    ]
    for key in remaining:
        readable_parts.append(f"{key}={filters[key]}")

    return "; ".join(readable_parts)


def _extract_domain(url: str) -> str:
    try:
        parsed = urlparse(url)
        return parsed.netloc or url
    except Exception:
        return url


def _serialize_result(result: Any) -> Dict[str, Any]:
    """Normalize SDK model/dict into plain dict."""
    if isinstance(result, dict):
        return {
            "title": result.get("title", ""),
            "url": result.get("url", ""),
            "snippet": result.get("snippet", ""),
            "date": result.get("date"),
            "last_updated": result.get("last_updated"),
        }

    # SDK result objects expose attributes
    return {
        "title": getattr(result, "title", "") or "",
        "url": getattr(result, "url", "") or "",
        "snippet": getattr(result, "snippet", "") or "",
        "date": getattr(result, "date", None),
        "last_updated": getattr(result, "last_updated", None),
    }


async def _fetch_media_from_url(
    session: aiohttp.ClientSession,
    url: str,
    want_images: bool,
    want_videos: bool,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Fetch OpenGraph/Twitter metadata to extract images or videos.
    Returns (images, videos).
    """
    if not want_images and not want_videos:
        return [], []

    try:
        async with session.get(url, timeout=MEDIA_FETCH_TIMEOUT) as response:
            if response.status >= 400:
                logger.debug("Media fetch skipped for %s (status %s)", url, response.status)
                return [], []

            text = await response.text(errors="ignore")
            if len(text) > HTML_CHAR_LIMIT:
                text = text[:HTML_CHAR_LIMIT]
            soup = BeautifulSoup(text, "html.parser")

            images: List[Dict[str, Any]] = []
            videos: List[Dict[str, Any]] = []

            if want_images:
                og_images = {
                    meta.get("content")
                    for meta in soup.find_all("meta", property=lambda val: val and "image" in val.lower())
                    if meta.get("content")
                }
                twitter_images = {
                    meta.get("content")
                    for meta in soup.find_all("meta", attrs={"name": "twitter:image"})
                    if meta.get("content")
                }
                image_candidates = list(og_images.union(twitter_images))
                for src in image_candidates[:MAX_MEDIA_PER_RESULT]:
                    images.append(
                        {
                            "url": src,
                            "source_url": url,
                        }
                    )

            if want_videos:
                og_videos = {
                    meta.get("content")
                    for meta in soup.find_all("meta", property=lambda val: val and "video" in val.lower())
                    if meta.get("content")
                }
                video_tags = {
                    video.get("src")
                    for video in soup.find_all("video")
                    if video.get("src")
                }
                video_candidates = [src for src in list(og_videos.union(video_tags)) if src]
                for src in video_candidates[:MAX_MEDIA_PER_RESULT]:
                    videos.append(
                        {
                            "url": src,
                            "source_url": url,
                        }
                    )

            return images, videos
    except asyncio.TimeoutError:
        logger.debug("Media fetch timed out for %s", url)
        return [], []
    except Exception as exc:
        logger.debug("Media fetch failed for %s: %s", url, exc)
        return [], []


async def _enrich_results_with_media(
    results: List[Dict[str, Any]],
    want_images: bool,
    want_videos: bool,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Fetch media metadata for each result concurrently."""
    if not results or (not want_images and not want_videos):
        return [], []

    semaphore = asyncio.Semaphore(CONCURRENT_MEDIA_FETCHES)

    async with aiohttp.ClientSession(
        headers={"User-Agent": USER_AGENT},
        timeout=MEDIA_FETCH_TIMEOUT,
    ) as session:

        async def fetch_for_result(result: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
            async with semaphore:
                return await _fetch_media_from_url(
                    session=session,
                    url=result.get("url", ""),
                    want_images=want_images,
                    want_videos=want_videos,
                )

        tasks = [fetch_for_result(result) for result in results if result.get("url")]
        media_pairs = await asyncio.gather(*tasks, return_exceptions=True)

    images: List[Dict[str, Any]] = []
    videos: List[Dict[str, Any]] = []

    for idx, media in enumerate(media_pairs):
        if isinstance(media, Exception):
            logger.debug("Media enrichment error for result %s: %s", idx, media)
            continue
        result_images, result_videos = media
        if result_images:
            images.extend(result_images)
            results[idx]["images"] = result_images  # type: ignore[index]
        if result_videos:
            videos.extend(result_videos)
            results[idx]["videos"] = result_videos  # type: ignore[index]

    return images[:MAX_MEDIA_PER_RESULT * len(results)], videos[:MAX_MEDIA_PER_RESULT * len(results)]


@tool
async def perplexity_search_api(
    query: Optional[str] = None,
    queries: Optional[Sequence[str]] = None,
    max_results: Optional[int] = None,
    max_tokens: Optional[int] = None,
    max_tokens_per_page: Optional[int] = None,
    search_domain_filter: Optional[Sequence[str]] = None,
    search_recency_filter: Optional[str] = None,
    search_after_date_filter: Optional[str] = None,
    search_before_date_filter: Optional[str] = None,
    search_context_size: Optional[str] = None,
    country: Optional[str] = None,
    user_location: Optional[Dict[str, Any]] = None,
    return_images: bool = False,
    return_videos: bool = False,
    include_raw_results: bool = False,
) -> Dict[str, Any]:
    """Search the live web with the Perplexity Search API and return ranked results.

    Use this for current information, recent news, source-grounded research, or
    anything beyond training data. Provide one `query` or several `queries`.

    Args:
        query: A single natural-language search query.
        queries: Several queries to run together (up to 5); use instead of `query`.
        max_results: Maximum number of results to return (1-20, default 10).
        max_tokens: Total token budget across all result snippets.
        max_tokens_per_page: Token budget per result page.
        search_domain_filter: Restrict to these domains, e.g. ["arxiv.org"]; prefix with "-" to exclude.
        search_recency_filter: Only recent content: one of "hour", "day", "week", "month", "year".
        search_after_date_filter: Only content published after this date (M/D/YYYY).
        search_before_date_filter: Only content published before this date (M/D/YYYY).
        search_context_size: Snippet depth: "low", "medium" or "high".
        country: Two-letter ISO country code to localize results, e.g. "US".
        user_location: Optional location object with city/region/country/latitude/longitude.
        return_images: Also fetch representative images for each result.
        return_videos: Also fetch representative videos for each result.
        include_raw_results: Include the raw provider response alongside the normalized results.
    """
    if AsyncPerplexity is None:
        return {
            "success": False,
            "error": "perplexityai package not installed on backend",
        }

    api_key = os.getenv("PERPLEXITY_API_KEY") or _read_env_value("PERPLEXITY_API_KEY")
    if not api_key:
        return {
            "success": False,
            "error": "PERPLEXITY_API_KEY not configured",
        }

    if not query and not queries:
        return {
            "success": False,
            "error": "Either 'query' or 'queries' must be provided",
        }

    search_filters: Dict[str, Any] = {}
    # NOTE: `search_mode` exists in the perplexityai SDK signature but the Search
    # API rejects it ("search_mode is not supported", 400), so it is not exposed.
    if search_domain_filter:
        search_filters["search_domain_filter"] = list(search_domain_filter)
    if search_recency_filter:
        search_filters["search_recency_filter"] = search_recency_filter
    if search_after_date_filter:
        search_filters["search_after_date_filter"] = search_after_date_filter
    if search_before_date_filter:
        search_filters["search_before_date_filter"] = search_before_date_filter
    if search_context_size:
        search_filters["search_context_size"] = search_context_size
    if country:
        search_filters["country"] = country
    if user_location:
        search_filters["user_location"] = user_location
    if max_tokens:
        search_filters["max_tokens"] = max_tokens

    active_query: Union[str, Sequence[str]]
    if queries and len(queries) == 1 and not query:
        active_query = queries[0]
    elif queries and len(queries) > 1:
        active_query = list(queries)
    else:
        active_query = query or (queries[0] if queries else "")

    search_kwargs: Dict[str, Any] = {
        "query": active_query,
    }
    if max_results:
        search_kwargs["max_results"] = max_results
    if max_tokens_per_page:
        search_kwargs["max_tokens_per_page"] = max_tokens_per_page

    extra_body: Dict[str, Any] = {k: v for k, v in search_filters.items() if k not in search_kwargs}
    if extra_body:
        search_kwargs["extra_body"] = extra_body

    try:
        # The Search API lives at the SDK default host. The process may set
        # PERPLEXITY_BASE_URL to the Agent API router for chat; that router does
        # not serve /search (404), so pin the documented Search API base here.
        async with AsyncPerplexity(api_key=api_key, base_url="https://api.perplexity.ai") as client:  # type: ignore[call-arg]
            response = await client.search.create(**search_kwargs)  # type: ignore[arg-type]
    except RateLimitError as exc:  # pragma: no cover - dependent on external service
        return {
            "success": False,
            "error": f"Perplexity rate limit exceeded: {exc}",
        }
    except APIError as exc:  # pragma: no cover - dependent on external service
        return {
            "success": False,
            "error": f"Perplexity API error: {exc}",
        }
    except Exception as exc:
        logger.exception("Unexpected Perplexity search error: %s", exc)
        return {
            "success": False,
            "error": str(exc),
        }

    raw_results: Any = getattr(response, "results", [])
    per_query_results: List[Dict[str, Any]] = []

    def normalize_results(results_block: Any) -> List[Dict[str, Any]]:
        normalized: List[Dict[str, Any]] = []
        for item in results_block or []:
            data = _serialize_result(item)
            data["domain"] = _extract_domain(data.get("url", ""))
            normalized.append(data)
        return normalized

    if raw_results and isinstance(raw_results[0], (list, tuple)):
        for idx, group in enumerate(raw_results):
            normalized_group = normalize_results(group)
            per_query_results.append(
                {
                    "query": (queries[idx] if queries and idx < len(queries) else f"Query {idx + 1}"),
                    "results": normalized_group,
                }
            )
    else:
        per_query_results.append(
            {
                "query": active_query if isinstance(active_query, str) else (queries[0] if queries else ""),
                "results": normalize_results(raw_results),
            }
        )

    flat_results: List[Dict[str, Any]] = [
        item for group in per_query_results for item in group["results"]
    ]

    images: List[Dict[str, Any]] = []
    videos: List[Dict[str, Any]] = []

    if return_images or return_videos:
        images, videos = await _enrich_results_with_media(
            results=flat_results,
            want_images=return_images,
            want_videos=return_videos,
        )

    source_domains = sorted({item.get("domain", "") for item in flat_results if item.get("domain")})

    chain_of_thought: List[Dict[str, Any]] = [
        {
            "label": "Analyze user request",
            "description": f"Processed query input ({'multi-query' if isinstance(active_query, (list, tuple)) else 'single query'}).",
            "status": "complete",
        },
        {
            "label": "Apply filters",
            "description": _build_filters_summary(search_filters),
            "status": "complete",
        },
        {
            "label": "Retrieve ranked sources",
            "description": f"Received {len(flat_results)} results spanning {len(source_domains)} domains.",
            "status": "complete",
            "sources": source_domains[:6],
        },
    ]

    if return_images or return_videos:
        media_summary_parts: List[str] = []
        if return_images:
            media_summary_parts.append(f"{len(images)} images")
        if return_videos:
            media_summary_parts.append(f"{len(videos)} videos")
        chain_of_thought.append(
            {
                "label": "Enrich with media metadata",
                "description": f"Discovered {' and '.join(media_summary_parts) if media_summary_parts else 'no media assets'}.",
                "status": "complete" if images or videos else "pending",
            }
        )

    result_payload: Dict[str, Any] = {
        "success": True,
        "query": active_query,
        "multi_query": isinstance(active_query, (list, tuple)) or len(per_query_results) > 1,
        "filters_applied": search_filters,
        "results": per_query_results,
        "flat_results": flat_results if include_raw_results else None,
        "images": images,
        "videos": videos,
        "chain_of_thought": chain_of_thought,
        "response_id": getattr(response, "id", None),
        "server_time": getattr(response, "server_time", None),
        "source_domains": source_domains,
    }

    if not include_raw_results:
        result_payload.pop("flat_results", None)

    if result_payload.get("success"):
        summary_lines: List[str] = []
        for group in per_query_results:
            query_label = group.get("query", "Query")
            for item in group.get("results", [])[:3]:
                title = item.get("title") or item.get("url") or "Untitled result"
                url = item.get("url", "")
                summary_lines.append(f"- {query_label}: {title} ({url})")

        if summary_lines:
            result_payload["result"] = "\n".join(summary_lines)
        else:
            result_payload["result"] = f"Search completed with {len(flat_results)} source(s)."

    # Build normalized search results for __ui_data__
    ui_results = []
    for i, r in enumerate(flat_results):
        ui_results.append({
            "id": f"perplexity-{i}-{hash(r.get('url', '')) % 100000}",
            "title": r.get("title", ""),
            "url": r.get("url", ""),
            "snippet": r.get("snippet", ""),
            "date": r.get("date") or r.get("last_updated"),
            "source": r.get("domain", "perplexity"),
        })

    query_str = active_query if isinstance(active_query, str) else (
        ", ".join(active_query) if isinstance(active_query, (list, tuple)) else str(active_query)
    )
    result_payload["__ui_data__"] = {
        "type": "sources",
        "data": {
            "provider": "perplexity",
            "query": query_str,
            "results": ui_results,
        },
    }

    return result_payload
