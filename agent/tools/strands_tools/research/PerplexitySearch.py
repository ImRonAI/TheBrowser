import asyncio
import os
import re
from dataclasses import dataclass
from typing import List, Literal, Optional, Union

from .errors import NotConfiguredError

API_URL = "https://api.perplexity.ai/search"
MAX_RESULTS_LIMIT = 20
MAX_TOKENS_LIMIT = 1_000_000
MAX_QUERIES_PER_REQUEST = 5
RATE_LIMIT_PER_SECOND = 50
API_TOOL_TIMEOUT_SECONDS = int(os.getenv("API_TOOL_TIMEOUT_SECONDS", "7"))

RecencyFilter = Literal["day", "week", "month", "year"]


@dataclass
class SearchConfig:
    query: Union[str, List[str]]
    max_results: int = MAX_RESULTS_LIMIT
    max_tokens: int = MAX_TOKENS_LIMIT
    max_tokens_per_page: int = 4096
    search_domain_filter: Optional[List[str]] = None
    search_after_date: Optional[str] = None
    search_before_date: Optional[str] = None
    last_updated_after_filter: Optional[str] = None
    last_updated_before_filter: Optional[str] = None
    search_recency_filter: Optional[RecencyFilter] = None
    search_language_filter: Optional[List[str]] = None
    country: Optional[str] = None

    def validate(self) -> None:
        queries = self.query if isinstance(self.query, list) else [self.query]
        if len(queries) > MAX_QUERIES_PER_REQUEST:
            raise ValueError(f"Maximum {MAX_QUERIES_PER_REQUEST} queries allowed, got {len(queries)}")
        if len(queries) < 1:
            raise ValueError("At least 1 query required")
        if self.max_results > MAX_RESULTS_LIMIT:
            raise ValueError(f"max_results cannot exceed {MAX_RESULTS_LIMIT}")
        if self.max_tokens > MAX_TOKENS_LIMIT:
            raise ValueError(f"max_tokens cannot exceed {MAX_TOKENS_LIMIT}")

        date_pattern = r"^(0?[1-9]|1[0-2])/(0?[1-9]|[12]\d|3[01])/\d{4}$"
        for date_field in [
            self.search_after_date,
            self.search_before_date,
            self.last_updated_after_filter,
            self.last_updated_before_filter,
        ]:
            if date_field and not re.match(date_pattern, date_field):
                raise ValueError(f"Invalid date format: {date_field}. Use '%m/%d/%Y'")
        if self.search_recency_filter and any(
            [
                self.search_after_date,
                self.search_before_date,
                self.last_updated_after_filter,
                self.last_updated_before_filter,
            ]
        ):
            raise ValueError("search_recency_filter cannot combine with specific date filters")
        if self.search_domain_filter and len(self.search_domain_filter) > 20:
            raise ValueError("Maximum 20 domains in search_domain_filter")
        if self.search_language_filter and len(self.search_language_filter) > 10:
            raise ValueError("Maximum 10 languages in search_language_filter")

    def to_payload(self) -> dict:
        self.validate()
        payload = {
            "query": self.query,
            "max_results": self.max_results,
            "max_tokens": self.max_tokens,
            "max_tokens_per_page": self.max_tokens_per_page,
        }
        optional_fields = [
            "search_domain_filter",
            "search_after_date",
            "search_before_date",
            "last_updated_after_filter",
            "last_updated_before_filter",
            "search_recency_filter",
            "search_language_filter",
            "country",
        ]
        for field_name in optional_fields:
            value = getattr(self, field_name)
            if value is not None:
                payload[field_name] = value
        return payload


@dataclass
class SearchResult:
    title: str
    url: str
    snippet: str
    date: Optional[str] = None
    last_updated: Optional[str] = None


@dataclass
class SearchResponse:
    results: List[SearchResult]
    error: Optional[str] = None


class PerplexitySearchClient:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get("PERPLEXITY_API_KEY")
        if not self.api_key:
            raise ValueError("API key required. Set PERPLEXITY_API_KEY or pass api_key.")
        self.headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        self._semaphore = asyncio.Semaphore(RATE_LIMIT_PER_SECOND)

    async def search_async(self, config: SearchConfig) -> SearchResponse:
        aiohttp = _require_aiohttp()
        async with self._semaphore:
            timeout = aiohttp.ClientTimeout(total=API_TOOL_TIMEOUT_SECONDS)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                try:
                    async with session.post(API_URL, json=config.to_payload(), headers=self.headers) as resp:
                        if resp.status == 429:
                            return SearchResponse(results=[], error="Rate limited")
                        resp.raise_for_status()
                        data = await resp.json()
                        results = [
                            SearchResult(
                                title=item.get("title", ""),
                                url=item.get("url", ""),
                                snippet=item.get("snippet", ""),
                                date=item.get("date"),
                                last_updated=item.get("last_updated"),
                            )
                            for item in data.get("results", [])
                        ]
                        return SearchResponse(results=results)
                except Exception as exc:
                    return SearchResponse(results=[], error=str(exc))

    def search(self, config: SearchConfig) -> SearchResponse:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop and loop.is_running():
            new_loop = asyncio.new_event_loop()
            try:
                return new_loop.run_until_complete(self.search_async(config))
            finally:
                new_loop.close()
        return asyncio.run(self.search_async(config))

    async def search_batch_async(
        self, configs: List[SearchConfig], delay_between_batches: float = 1.0
    ) -> List[SearchResponse]:
        results: List[SearchResponse] = []
        for i in range(0, len(configs), RATE_LIMIT_PER_SECOND):
            batch = configs[i : i + RATE_LIMIT_PER_SECOND]
            tasks = [self.search_async(cfg) for cfg in batch]
            batch_results = await asyncio.gather(*tasks)
            results.extend(batch_results)
            if i + RATE_LIMIT_PER_SECOND < len(configs):
                await asyncio.sleep(delay_between_batches)
        return results


def perplexity_search(
    query: Union[str, List[str]],
    max_results: int = MAX_RESULTS_LIMIT,
    max_tokens: int = MAX_TOKENS_LIMIT,
    max_tokens_per_page: int = 4096,
    search_domain_filter: Optional[List[str]] = None,
    search_after_date: Optional[str] = None,
    search_before_date: Optional[str] = None,
    last_updated_after_filter: Optional[str] = None,
    last_updated_before_filter: Optional[str] = None,
    search_recency_filter: Optional[RecencyFilter] = None,
    search_language_filter: Optional[List[str]] = None,
    country: Optional[str] = None,
) -> dict:
    client = PerplexitySearchClient()
    config = SearchConfig(
        query=query,
        max_results=max_results,
        max_tokens=max_tokens,
        max_tokens_per_page=max_tokens_per_page,
        search_domain_filter=search_domain_filter,
        search_after_date=search_after_date,
        search_before_date=search_before_date,
        last_updated_after_filter=last_updated_after_filter,
        last_updated_before_filter=last_updated_before_filter,
        search_recency_filter=search_recency_filter,
        search_language_filter=search_language_filter,
        country=country,
    )
    response = client.search(config)
    return {
        "results": [
            {
                "title": item.title,
                "url": item.url,
                "snippet": item.snippet,
                "date": item.date,
                "last_updated": item.last_updated,
            }
            for item in response.results
        ],
        "error": response.error,
    }


def _require_aiohttp():
    try:
        import aiohttp  # type: ignore
    except Exception as exc:
        raise NotConfiguredError("aiohttp is required for perplexity_search") from exc
    return aiohttp
