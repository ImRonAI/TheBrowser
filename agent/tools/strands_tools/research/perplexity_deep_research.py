from __future__ import annotations

"""
Perplexity Deep Research Tool
Non-blocking async integration using the Sonar Deep Research model.

This module creates an async job via Perplexity's /async/chat/completions endpoint
and manages polling with exponential backoff without blocking the caller.

## Async Workflow for Agent Orchestration

The intended workflow allows agents to:
1. **Start research early**: Call with action="start" to initiate deep research
2. **Continue other work**: Agent proceeds with other tool calls while research runs
3. **Fetch results before final output**: Call with action="fetch" to retrieve results

### Example Agent Flow:
```
Agent: perplexity_deep_research(topic="...", action="start")
       → Returns request_id immediately

Agent: [performs other tool calls, reasoning, etc.]

Agent: perplexity_deep_research(action="fetch", request_id="...")
       → Returns completed report for use in final response
```

### Status Values:
- CREATED: Job submitted, awaiting processing
- POLLING: Background poller active
- PROCESSING: Perplexity is running deep research
- COMPLETED: Research finished, results available
- FAILED: Research failed
- TIMED_OUT: Max polling attempts exceeded
- CANCELLED: Job cancelled by caller

Note: Async requests have a TTL of 7 days on Perplexity's servers.
"""

import asyncio
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import aiohttp
import json
from strands import tool
from dotenv import load_dotenv

logger = logging.getLogger(__name__)
API_TOOL_TIMEOUT_SECONDS = int(os.getenv("API_TOOL_TIMEOUT_SECONDS", "7"))

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

# -----------------------------------------------------------------------------
# Job state tracking
# -----------------------------------------------------------------------------


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _safe_float(value: Optional[float | str], default: float) -> float:
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _safe_int(value: Optional[int | str], default: int) -> int:
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


class ResearchJobState:
    """Holds state for a Perplexity deep research job."""

    request_id: str
    topic: str
    depth: str
    reasoning_effort: str
    status: str
    created_at: datetime
    updated_at: datetime
    report: Optional[str]
    citations: Optional[List[Any]]
    raw_response: Optional[Dict[str, Any]]
    error: Optional[str]
    attempts: int
    next_poll_in: Optional[float]
    last_error: Optional[str]
    polling_started_at: Optional[datetime]
    initial_delay_seconds: float
    base_backoff_seconds: float
    max_backoff_seconds: float
    max_attempts: int
    completion_event: asyncio.Event

    def __init__(
        self,
        *,
        request_id: str,
        topic: str,
        depth: str,
        reasoning_effort: str = "medium",
        status: str = "CREATED",
        created_at: Optional[datetime] = None,
        updated_at: Optional[datetime] = None,
        report: Optional[str] = None,
        citations: Optional[List[Any]] = None,
        raw_response: Optional[Dict[str, Any]] = None,
        error: Optional[str] = None,
        attempts: int = 0,
        next_poll_in: Optional[float] = None,
        last_error: Optional[str] = None,
        polling_started_at: Optional[datetime] = None,
        initial_delay_seconds: float = 180.0,
        base_backoff_seconds: float = 60.0,
        max_backoff_seconds: float = 300.0,
        max_attempts: int = 20,
        completion_event: Optional[asyncio.Event] = None,
    ) -> None:
        self.request_id = request_id
        self.topic = topic
        self.depth = depth
        self.reasoning_effort = reasoning_effort
        self.status = status
        self.created_at = created_at or _utcnow()
        self.updated_at = updated_at or _utcnow()
        self.report = report
        self.citations = citations
        self.raw_response = raw_response
        self.error = error
        self.attempts = attempts
        self.next_poll_in = next_poll_in
        self.last_error = last_error
        self.polling_started_at = polling_started_at
        self.initial_delay_seconds = initial_delay_seconds
        self.base_backoff_seconds = base_backoff_seconds
        self.max_backoff_seconds = max_backoff_seconds
        self.max_attempts = max_attempts
        self.completion_event = completion_event or asyncio.Event()

    def to_dict(self, include_report: bool = False) -> Dict[str, Any]:
        """Serialize job state for tool responses."""
        data: Dict[str, Any] = {
            "success": self.status == "COMPLETED",
            "status": self.status,
            "topic": self.topic,
            "depth": self.depth,
            "reasoning_effort": self.reasoning_effort,
            "request_id": self.request_id,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "attempts": self.attempts,
            "next_poll_in_seconds": self.next_poll_in,
            "last_error": self.last_error,
            "polling_started_at": self.polling_started_at.isoformat()
            if self.polling_started_at
            else None,
            "polling_strategy": {
                "initial_delay_seconds": self.initial_delay_seconds,
                "base_backoff_seconds": self.base_backoff_seconds,
                "max_backoff_seconds": self.max_backoff_seconds,
                "max_attempts": self.max_attempts,
            },
        }

        if include_report and self.report is not None:
            data["report"] = self.report

        if self.citations is not None:
            data["citations"] = self.citations
            data["sources_analyzed"] = len(self.citations)

        if self.error:
            data["error"] = self.error

        if include_report and self.raw_response is not None:
            try:
                data["response_payload"] = json.dumps(self.raw_response)
            except (TypeError, ValueError):
                data["response_payload"] = str(self.raw_response)

        return data


RESEARCH_JOBS: Dict[str, ResearchJobState] = {}
RESEARCH_POLLERS: Dict[str, asyncio.Task] = {}


def get_pending_research_jobs() -> List[Dict[str, Any]]:
    """
    Get a list of all pending/in-progress research jobs.
    
    Useful for agents to check if there are outstanding research jobs
    that should be fetched before generating final output.
    
    Returns:
        List of job metadata dicts with request_id, topic, status, etc.
    """
    pending_jobs = []
    for request_id, job in RESEARCH_JOBS.items():
        if job.status not in {"COMPLETED", "FAILED", "TIMED_OUT", "CANCELLED"}:
            pending_jobs.append({
                "request_id": request_id,
                "topic": job.topic,
                "status": job.status,
                "created_at": job.created_at.isoformat(),
                "attempts": job.attempts,
                "next_poll_in_seconds": job.next_poll_in,
            })
    return pending_jobs


async def await_pending_research(
    timeout_seconds: float = API_TOOL_TIMEOUT_SECONDS,
    request_ids: Optional[List[str]] = None,
) -> Dict[str, Dict[str, Any]]:
    """
    Wait for pending research jobs to complete, with optional timeout.
    
    This is useful for agents that want to ensure all deep research
    is complete before generating their final response.
    
    Args:
        timeout_seconds: Maximum time to wait for all jobs (default 5 min)
        request_ids: Optional list of specific job IDs to wait for.
                    If None, waits for all pending jobs.
    
    Returns:
        Dict mapping request_id to job results (or status if still pending)
    """
    jobs_to_await = []
    
    if request_ids:
        jobs_to_await = [
            RESEARCH_JOBS[rid] for rid in request_ids
            if rid in RESEARCH_JOBS
        ]
    else:
        jobs_to_await = [
            job for job in RESEARCH_JOBS.values()
            if job.status not in {"COMPLETED", "FAILED", "TIMED_OUT", "CANCELLED"}
        ]
    
    if not jobs_to_await:
        return {}
    
    results: Dict[str, Dict[str, Any]] = {}
    
    try:
        timeout_seconds = min(timeout_seconds, API_TOOL_TIMEOUT_SECONDS)
        # Wait for all completion events with timeout
        events = [job.completion_event.wait() for job in jobs_to_await]
        await asyncio.wait_for(
            asyncio.gather(*events, return_exceptions=True),
            timeout=timeout_seconds,
        )
    except asyncio.TimeoutError:
        logger.warning(
            "await_pending_research timed out after %s seconds",
            timeout_seconds,
        )
    
    # Collect results regardless of timeout
    for job in jobs_to_await:
        include_report = job.status == "COMPLETED"
        results[job.request_id] = job.to_dict(include_report=include_report)
    
    return results


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------


def _compute_delays(
    initial_delay_seconds: Optional[float],
    base_backoff_seconds: Optional[float],
    max_backoff_seconds: Optional[float],
    max_attempts: Optional[int],
) -> Tuple[float, float, float, int]:
    """Resolve polling configuration from parameters/env/defaults."""

    resolved_initial = _safe_float(
        initial_delay_seconds
        if initial_delay_seconds is not None
        else os.getenv("PPLX_DEEP_RESEARCH_INITIAL_DELAY_SECONDS"),
        180.0,
    )

    resolved_base = _safe_float(
        base_backoff_seconds
        if base_backoff_seconds is not None
        else os.getenv("PPLX_DEEP_RESEARCH_BASE_BACKOFF_SECONDS"),
        60.0,
    )

    resolved_max = _safe_float(
        max_backoff_seconds
        if max_backoff_seconds is not None
        else os.getenv("PPLX_DEEP_RESEARCH_MAX_BACKOFF_SECONDS"),
        600.0,
    )

    resolved_attempts = _safe_int(
        max_attempts
        if max_attempts is not None
        else os.getenv("PPLX_DEEP_RESEARCH_MAX_ATTEMPTS"),
        30,
    )

    if resolved_initial < 0:
        resolved_initial = 0.0
    if resolved_base <= 0:
        resolved_base = 30.0
    if resolved_max < resolved_base:
        resolved_max = resolved_base
    if resolved_attempts < 1:
        resolved_attempts = 1

    return resolved_initial, resolved_base, resolved_max, resolved_attempts


def _extract_completed_payload(
    payload: Dict[str, Any]
) -> Tuple[Optional[str], Optional[List[Any]], Dict[str, Any]]:
    """
    Extract summary text and citations from the completed payload.

    The async polling endpoint nests the final chat completion response in a
    `response` object, but Perplexity's examples occasionally return the full
    completion payload at the top level. Handle both cases gracefully.
    """
    response_payload = payload.get("response") or payload

    # Attempt to read assistant message content from choices
    summary_text: Optional[str] = None
    choices = response_payload.get("choices")
    if isinstance(choices, list) and choices:
        message = choices[0].get("message", {})
        summary_text = message.get("content")

    # Fallback to a plain "response" field if present
    if not summary_text:
        summary_text = response_payload.get("response")

    citations = (
        response_payload.get("citations")
        or response_payload.get("search_results")
        or payload.get("citations")
        or payload.get("search_results")
    )

    if citations is not None and not isinstance(citations, list):
        citations = [citations]

    return summary_text, citations, response_payload


async def _poll_research_job(
    job: ResearchJobState,
    headers: Dict[str, str],
) -> None:
    """Background task that polls the async endpoint using exponential backoff."""
    request_id = job.request_id
    attempt = 0
    delay = job.base_backoff_seconds
    job.status = "POLLING"
    job.polling_started_at = _utcnow()
    job.next_poll_in = job.initial_delay_seconds
    job.updated_at = job.polling_started_at

    try:
        # Initial sleep requested by product: wait before first poll.
        await asyncio.sleep(job.initial_delay_seconds)

        timeout = aiohttp.ClientTimeout(total=API_TOOL_TIMEOUT_SECONDS)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            while attempt < job.max_attempts:
                attempt += 1
                job.attempts = attempt
                job.updated_at = _utcnow()
                try:
                    async with session.get(
                        f"https://api.perplexity.ai/async/chat/completions/{request_id}",
                        headers=headers,
                        timeout=timeout,
                    ) as poll_response:
                        if poll_response.status != 200:
                            text = await poll_response.text()
                            job.last_error = (
                                f"HTTP {poll_response.status} during poll: {text}"
                            )
                            logger.warning(
                                "Perplexity deep research poll failed (%s): %s",
                                poll_response.status,
                                text,
                            )
                        else:
                            status_payload = await poll_response.json()
                            status = status_payload.get("status")

                            if status == "COMPLETED":
                                report, citations, response_payload = _extract_completed_payload(
                                    status_payload
                                )
                                job.report = report
                                job.citations = citations
                                job.raw_response = response_payload
                                job.status = "COMPLETED"
                                job.error = None
                                job.next_poll_in = None
                                job.updated_at = _utcnow()
                                logger.info(
                                    "Perplexity deep research %s completed after %s attempts",
                                    request_id,
                                    attempt,
                                )
                                return

                            if status == "FAILED":
                                job.status = "FAILED"
                                job.error = status_payload.get(
                                    "error_message", "Perplexity reported failure"
                                )
                                job.raw_response = status_payload
                                job.next_poll_in = None
                                job.updated_at = _utcnow()
                                logger.error(
                                    "Perplexity deep research %s failed: %s",
                                    request_id,
                                    job.error,
                                )
                                return

                            # For CREATED/STARTED/PROCESSING etc., continue polling.
                            job.status = status or "POLLING"
                            job.last_error = None
                            logger.debug(
                                "Perplexity deep research %s status: %s (attempt %s)",
                                request_id,
                                job.status,
                                attempt,
                            )

                except asyncio.CancelledError:
                    job.status = "CANCELLED"
                    job.error = "Polling cancelled"
                    logger.info("Perplexity deep research %s polling cancelled", request_id)
                    raise
                except Exception as exc:
                    job.last_error = str(exc)
                    logger.exception(
                        "Perplexity deep research poll error for %s: %s", request_id, exc
                    )

                # Prepare next attempt
                attempt_delay = min(delay, job.max_backoff_seconds)
                job.next_poll_in = attempt_delay
                await asyncio.sleep(attempt_delay)
                delay = min(delay * 2, job.max_backoff_seconds)

            # Exceeded attempts without success/failure
            job.status = "TIMED_OUT"
            job.error = (
                f"Polling exceeded {job.max_attempts} attempts without completion"
            )
            job.next_poll_in = None
            logger.error(
                "Perplexity deep research %s timed out after %s attempts",
                request_id,
                attempt,
            )
    finally:
        job.updated_at = _utcnow()
        job.completion_event.set()
        RESEARCH_POLLERS.pop(request_id, None)


def _register_job(job: ResearchJobState, task: asyncio.Task) -> None:
    """Track active polling tasks and log background errors."""

    RESEARCH_JOBS[job.request_id] = job
    RESEARCH_POLLERS[job.request_id] = task

    def _log_task_result(fut: asyncio.Future) -> None:
        try:
            fut.result()
        except asyncio.CancelledError:
            logger.debug(
                "Polling task for Perplexity request %s cancelled", job.request_id
            )
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.exception(
                "Unhandled exception in Perplexity polling task %s: %s",
                job.request_id,
                exc,
            )

    task.add_done_callback(_log_task_result)


async def _cancel_job(request_id: str) -> Optional[ResearchJobState]:
    """Cancel a running polling task if present."""
    job = RESEARCH_JOBS.get(request_id)
    task = RESEARCH_POLLERS.get(request_id)
    if task and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    if job:
        job.status = "CANCELLED"
        job.error = job.error or "Cancelled by caller"
        job.next_poll_in = None
        job.updated_at = _utcnow()
        job.completion_event.set()
    RESEARCH_POLLERS.pop(request_id, None)
    return job


# -----------------------------------------------------------------------------
# Public tool entry point
# -----------------------------------------------------------------------------


@tool
async def perplexity_deep_research(
    topic: str,
    depth: str = "comprehensive",
    focus_areas: list[str] | None = None,
    include_trials: bool = True,
    include_guidelines: bool = True,
    search_domains: list[str] | None = None,
    time_range: str | None = None,
    max_sources: int = 100,
    reasoning_effort: str = "medium",
    *,
    action: str = "start",
    request_id: str | None = None,
    wait_for_completion: bool = False,
    initial_delay_seconds: float | None = None,
    base_backoff_seconds: float | None = None,
    max_backoff_seconds: float | None = None,
    max_attempts: int | None = None,
) -> dict[str, Any]:
    """Conduct deep research using Perplexity's Sonar Deep Research model.

    ## Async Workflow (Recommended)

    This tool supports a non-blocking async pattern ideal for agent orchestration:

    1. **Start research early in your workflow**:
       ```python
       result = perplexity_deep_research(topic="...", action="start")
       request_id = result["request_id"]  # Save this!
       ```

    2. **Continue with other tool calls while research runs in background**

    3. **Fetch results before generating final output**:
       ```python
       result = perplexity_deep_research(action="fetch", request_id=request_id, topic="")
       report = result["report"]  # Use in your final response
       ```

    ## Parameters

    Research Configuration:
        topic: The research topic or complex question to investigate
        depth: Research depth - 'quick' (3 queries), 'standard' (6), 
               'comprehensive' (10), 'exhaustive' (unlimited)
        focus_areas: Specific areas to focus on (e.g., ['diagnosis', 'treatment'])
        reasoning_effort: Perplexity reasoning depth - 'low' (faster, cheaper),
                         'medium' (balanced), 'high' (thorough, more expensive)
        include_trials: Include clinical trial data
        include_guidelines: Include clinical practice guidelines
        search_domains: Domains to include/exclude (e.g., ['pubmed.gov', '-reddit.com'])
        time_range: Time filter - 'day', 'week', 'month', 'year', '5years'
        max_sources: Maximum sources to analyze (up to 100+)

    Lifecycle Control:
        action: 'start' (default) - Create new job
                'status'/'fetch' - Check progress/get results
                'cancel' - Stop polling
        request_id: Required for status/fetch/cancel actions
        wait_for_completion: If True, block until complete (not recommended for agents)

    Polling Configuration (optional overrides):
        initial_delay_seconds: Delay before first poll (default: 180s / 3 min)
        base_backoff_seconds: Base backoff interval (default: 60s)
        max_backoff_seconds: Maximum backoff (default: 600s)
        max_attempts: Max poll attempts before timeout (default: 30)

    Environment Variables:
        PPLX_DEEP_RESEARCH_INITIAL_DELAY_SECONDS
        PPLX_DEEP_RESEARCH_BASE_BACKOFF_SECONDS
        PPLX_DEEP_RESEARCH_MAX_BACKOFF_SECONDS
        PPLX_DEEP_RESEARCH_MAX_ATTEMPTS

    Returns:
        On start: {request_id, status, message, ...} - Save request_id!
        On fetch (completed): {success: True, report, citations, ...}
        On fetch (pending): {success: False, status: "POLLING", ...}
    """
    api_key = os.getenv("PERPLEXITY_API_KEY") or _read_env_value("PERPLEXITY_API_KEY")
    if not api_key:
        return {
            "success": False,
            "error": "PERPLEXITY_API_KEY not configured",
            "topic": topic,
        }

    normalized_action = (action or "start").strip().lower()

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    # ------------------------------------------------------------------ #
    # Handle list_pending action - show all in-progress jobs
    # ------------------------------------------------------------------ #
    if normalized_action == "list_pending":
        pending = get_pending_research_jobs()
        return {
            "success": True,
            "pending_jobs": pending,
            "count": len(pending),
            "message": (
                f"Found {len(pending)} pending research job(s). "
                "Use action='fetch' with a request_id to retrieve results."
                if pending
                else "No pending research jobs. Use action='start' to begin new research."
            ),
        }

    # ------------------------------------------------------------------ #
    # Handle status / fetch requests
    # ------------------------------------------------------------------ #
    if normalized_action in {"status", "fetch"}:
        if not request_id:
            # Check if there are any pending jobs to suggest
            pending = get_pending_research_jobs()
            if pending:
                return {
                    "success": False,
                    "error": "request_id is required when checking job status",
                    "topic": topic,
                    "hint": f"Found {len(pending)} pending job(s). Here are their IDs:",
                    "pending_jobs": pending,
                }
            return {
                "success": False,
                "error": "request_id is required when checking job status",
                "topic": topic,
            }

        job = RESEARCH_JOBS.get(request_id)
        if job:
            include_report = job.status in {"COMPLETED", "FAILED", "TIMED_OUT"}
            result = job.to_dict(include_report=include_report)
            
            # Add helpful message based on status
            if job.status == "COMPLETED":
                result["message"] = (
                    "✅ Research complete! Use the 'report' field in your response."
                )
            elif job.status in {"FAILED", "TIMED_OUT"}:
                result["message"] = (
                    f"❌ Research {job.status.lower()}. Check 'error' field for details."
                )
            else:
                # Still in progress
                elapsed = (_utcnow() - job.created_at).total_seconds()
                result["message"] = (
                    f"⏳ Research still in progress (status={job.status}, "
                    f"elapsed={elapsed:.0f}s, attempts={job.attempts}). "
                    f"Try fetching again in ~{job.next_poll_in or 60:.0f}s, "
                    f"or continue with other work and fetch before final output."
                )
                result["retry_in_seconds"] = job.next_poll_in or 60
            
            return result

        # If job is unknown locally, attempt a direct poll once.
        try:
            timeout = aiohttp.ClientTimeout(total=API_TOOL_TIMEOUT_SECONDS)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(
                    f"https://api.perplexity.ai/async/chat/completions/{request_id}",
                    headers=headers,
                    timeout=timeout,
                ) as response:
                    if response.status != 200:
                        text = await response.text()
                        return {
                            "success": False,
                            "error": f"Failed to retrieve status: {response.status} - {text}",
                            "request_id": request_id,
                        }
                    payload = await response.json()
        except Exception as exc:  # pragma: no cover - defensive path
            logger.exception(
                "Failed to fetch Perplexity deep research status for %s: %s",
                request_id,
                exc,
            )
            return {
                "success": False,
                "error": f"Unable to fetch status: {exc}",
                "request_id": request_id,
            }

        status = payload.get("status")
        if status == "COMPLETED":
            report, citations, response_payload = _extract_completed_payload(payload)
            return {
                "success": True,
                "status": status,
                "report": report,
                "citations": citations,
                "response_payload": json.dumps(response_payload) if response_payload else None,
                "request_id": request_id,
            }

        return {
            "success": status == "COMPLETED",
            "status": status or "UNKNOWN",
            "request_id": request_id,
            "payload": payload,
        }

    # ------------------------------------------------------------------ #
    # Handle cancellation
    # ------------------------------------------------------------------ #
    if normalized_action == "cancel":
        if not request_id:
            return {
                "success": False,
                "error": "request_id is required to cancel a job",
                "topic": topic,
            }

        job = await _cancel_job(request_id)
        if not job:
            return {
                "success": False,
                "error": f"No active job found with id {request_id}",
                "request_id": request_id,
            }
        return job.to_dict(include_report=False)

    # ------------------------------------------------------------------ #
    # Start (default flow)
    # ------------------------------------------------------------------ #
    initial_delay, base_delay, max_delay, attempts = _compute_delays(
        initial_delay_seconds,
        base_backoff_seconds,
        max_backoff_seconds,
        max_attempts,
    )

    prompt_parts = [f"Conduct comprehensive research on: {topic}"]

    if focus_areas:
        prompt_parts.append(f"Focus on: {', '.join(focus_areas)}")
    if include_trials:
        prompt_parts.append("Include clinical trial data")
    if include_guidelines:
        prompt_parts.append("Include clinical practice guidelines")
    if time_range:
        prompt_parts.append(f"Focus on sources from the last {time_range}")

    prompt_parts.append(f"Research depth: {depth}")
    prompt_parts.append(f"Analyze up to {max_sources} sources")

    research_prompt = ". ".join(prompt_parts)

    # Validate reasoning_effort
    valid_efforts = {"low", "medium", "high"}
    normalized_effort = (reasoning_effort or "medium").strip().lower()
    if normalized_effort not in valid_efforts:
        logger.warning(
            "Invalid reasoning_effort '%s', defaulting to 'medium'",
            reasoning_effort,
        )
        normalized_effort = "medium"

    payload: Dict[str, Any] = {
        "request": {
            "model": "sonar-deep-research",
            "messages": [{"role": "user", "content": research_prompt}],
            "reasoning_effort": normalized_effort,
        }
    }

    if search_domains:
        payload["request"]["search_domain_filter"] = search_domains

    try:
        timeout = aiohttp.ClientTimeout(total=API_TOOL_TIMEOUT_SECONDS)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(
                "https://api.perplexity.ai/async/chat/completions",
                headers=headers,
                json=payload,
                timeout=timeout,
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    return {
                        "success": False,
                        "error": f"Failed to create job: {response.status} - {error_text}",
                        "topic": topic,
                    }

                job_data = await response.json()
    except Exception as exc:
        logger.exception("Failed to create Perplexity deep research job: %s", exc)
        return {
            "success": False,
            "error": f"Failed to create research job: {exc}",
            "topic": topic,
        }

    request_id = job_data.get("id") or job_data.get("request_id")
    status = job_data.get("status", "CREATED")

    if not request_id:
        return {
            "success": False,
            "error": "No request_id returned from async API",
            "topic": topic,
        }

    job_state = ResearchJobState(
        request_id=request_id,
        topic=topic,
        depth=depth,
        reasoning_effort=normalized_effort,
        status=status or "CREATED",
        initial_delay_seconds=initial_delay,
        base_backoff_seconds=base_delay,
        max_backoff_seconds=max_delay,
        max_attempts=attempts,
    )

    poll_task = asyncio.create_task(_poll_research_job(job_state, headers))
    _register_job(job_state, poll_task)

    if wait_for_completion:
        try:
            await asyncio.wait_for(
                job_state.completion_event.wait(),
                timeout=API_TOOL_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            response_payload = job_state.to_dict(include_report=False)
            response_payload.update(
                {
                    "success": False,
                    "status": job_state.status,
                    "error": (
                        f"Timed out waiting for completion after "
                        f"{API_TOOL_TIMEOUT_SECONDS}s"
                    ),
                }
            )
            return response_payload
        include_report = job_state.status == "COMPLETED"
        return job_state.to_dict(include_report=include_report)

    # Non-blocking response with request metadata and async workflow guidance
    response_payload = job_state.to_dict(include_report=False)
    response_payload["message"] = (
        f"🔬 Deep research job started for: '{topic}' (reasoning_effort={normalized_effort}). "
        f"Polling has begun in the background. "
        f"IMPORTANT: Save request_id='{request_id}' and call again with "
        f"action='fetch' before your final response to retrieve results."
    )
    response_payload["async_workflow_hint"] = {
        "next_action": "Continue with other tool calls, then fetch results before final output",
        "fetch_command": f"perplexity_deep_research(action='fetch', request_id='{request_id}', topic='')",
        "estimated_time_seconds": initial_delay + base_delay * 2,
        "note": "Results typically ready in 2-5 minutes for comprehensive research",
    }
    return response_payload


# Fix Pydantic "class-not-fully-defined" error by rebuilding the tool's model
try:
    perplexity_deep_research._tool_metadata.input_model.model_rebuild()
except Exception:
    pass  # Silently fail if already rebuilt or if structure changed
