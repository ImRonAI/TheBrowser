"""Scheduled specialist runs: a saved specialist (``harness_agents``) runs at the cadence its owner picked.

A run IS a panel conversation with that specialist, exactly what Chat in the Context widget starts:
``PanelRuntimeManager.start`` on a new ``session_id`` with ``selection.agent = {"kind": "specialist", "id": ...}``
on the panel destination, so ``chat._create_specialist_agent`` builds the specialist (``build_specialist`` ->
``create_harness``) on the runtime's ``ThreadSessionManager`` with the runtime's ``ContextInjector``, hooks and
``ThreadProjection``. Conversation, context management, state and snapshots are therefore the SDK's, the same as
the panel agent's, and the run lists as a thread. The message that starts the run is a durable user message, so the
thread shows when and why it ran (like the Live takeover's ``[handoff]``, ``core/live_takeover.py``).

When the run ends, its ``agent_runs`` row records the outcome; the Context widget shows finished runs the user has
not opened as notifications. Review opens that ``session_id`` in the Agent Panel, which restores the pinned
``selection.agent`` from the session snapshot, so the user continues the same native session with the same
specialist.

NOT NATIVE: Strands has no scheduler. The cadence and the next due time live in Supabase ``agent_schedules``
(``supabase/migrations/024_agent_schedules.sql``, service-role key, filtered by ``owner_id`` like
``harness_agents``). One loop per API process claims due rows with a compare-and-set on ``next_run_at``, so two
processes never start the same occurrence. The runs themselves run in the process that started them (the panel
runtime's one-writer rule); a run that was active when the process stopped continues on the next access to its
session, which the loop makes at start-up for every run still marked ``running``.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import UTC, datetime, time as day_time, timedelta
from typing import Any, Final, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator

logger = logging.getLogger(__name__)

SCHEDULES: Final = "agent_schedules"
RUNS: Final = "agent_runs"
WEEKDAYS: Final = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
SUMMARY_CHARS: Final = 600
ERROR_CHARS: Final = 2000
#: Due schedules one check starts at most; the rest are due on the next check.
DUE_BATCH: Final = 20
RUN_STATUSES: Final = ("completed", "failed", "cancelled", "interrupted", "checkpointed")

RUN_PROMPT: Final = (
    "{title}\n\n"
    "{task}\n\n"
    "This run was started {why}, not by a message from the user, who is not watching it. Do the work now with "
    "your tools. End with a short report for the user: what you found or did, what is new since your last run, "
    "and anything that needs their decision. They read it later in this conversation and may reply to you here."
)


class Cadence(BaseModel):
    """When a specialist runs. ``time`` and ``weekday`` are in the user's ``timezone`` (IANA name)."""

    model_config = ConfigDict(extra="forbid")
    every: Literal["hours", "day", "weekdays", "week"]
    #: every="hours": hours between runs.
    hours: int = Field(default=24, ge=1, le=168)
    #: day / weekdays / week: local time of day, 24-hour "HH:MM".
    time: str = Field(default="08:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    #: every="week": 0 = Monday ... 6 = Sunday.
    weekday: int = Field(default=0, ge=0, le=6)
    timezone: str = Field(default="UTC", min_length=1, max_length=64)

    @field_validator("timezone")
    @classmethod
    def known_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise ValueError(f"Unknown time zone: {value}") from error
        return value


def cadence_label(cadence: Cadence) -> str:
    if cadence.every == "hours":
        return "every hour" if cadence.hours == 1 else f"every {cadence.hours} hours"
    if cadence.every == "day":
        return f"daily at {cadence.time}"
    if cadence.every == "weekdays":
        return f"weekdays at {cadence.time}"
    return f"{WEEKDAYS[cadence.weekday]}s at {cadence.time}"


def next_run(cadence: Cadence, now: datetime, previous: datetime | None = None) -> datetime:
    """The first occurrence strictly after ``now`` (UTC).

    ``hours`` counts from the previous due time when there is one, so runs do not drift by the check interval; missed
    occurrences (the API was not running) are skipped, never replayed. The others are the next matching local
    wall-clock time in the cadence's time zone, so they follow daylight saving time.
    """
    now = now.astimezone(UTC)
    if cadence.every == "hours":
        step = timedelta(hours=cadence.hours)
        if previous is None:
            return now + step
        previous = previous.astimezone(UTC)
        if previous > now:
            return previous
        return previous + step * ((now - previous) // step + 1)
    zone = ZoneInfo(cadence.timezone)
    hour, minute = (int(part) for part in cadence.time.split(":"))
    today = now.astimezone(zone).date()
    for offset in range(8):
        day = today + timedelta(days=offset)
        if cadence.every == "weekdays" and day.weekday() >= 5:
            continue
        if cadence.every == "week" and day.weekday() != cadence.weekday:
            continue
        due = datetime.combine(day, day_time(hour, minute), tzinfo=zone).astimezone(UTC)
        if due > now:
            return due
    raise AssertionError("a weekly cadence always falls within eight days")


def run_prompt(*, name: str, description: str, task: str, cadence: Cadence | None) -> str:
    """The durable user message a run starts with; its first line titles the thread."""
    if cadence is not None:
        title, why = f"{name} · scheduled run ({cadence_label(cadence)})", f"by its schedule ({cadence_label(cadence)})"
    else:
        title, why = f"{name} · run now", "from Run now in the Context widget"
    work = task.strip() or (f"Do your recurring work: {description.strip()}" if description.strip()
                            else "Do your recurring work for the user.")
    return RUN_PROMPT.format(title=title, task=work, why=why)


def run_summary(messages: list[dict[str, Any]]) -> str:
    """The last assistant text of a run (the report), trimmed for the notification."""
    for message in reversed(messages):
        if message.get("role") != "assistant":
            continue
        text = "\n".join(block["text"].strip() for block in message.get("content") or []
                         if isinstance(block, dict) and isinstance(block.get("text"), str) and block["text"].strip())
        if text:
            return text if len(text) <= SUMMARY_CHARS else text[:SUMMARY_CHARS - 1].rstrip() + "…"
    return ""


def _error_text(error: Any) -> str:
    if not error:
        return ""
    if isinstance(error, dict):
        error = error.get("message") or error.get("error") or error
    return str(error)[:ERROR_CHARS]


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat()


def _parse(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


class AgentBusy(RuntimeError):
    """The specialist already has a run in progress."""


class AgentScheduler:
    """Starts saved specialists on their schedules and records every run (see the module docstring)."""

    def __init__(self, manager: Any, *, tick: float = 30.0, enabled: bool = True) -> None:
        self._manager = manager
        self._tick = tick
        self._enabled = enabled
        self._client: Any = None
        self._client_lock = asyncio.Lock()
        self._loop: asyncio.Task[None] | None = None
        self._watchers: dict[str, asyncio.Task[None]] = {}

    # ------------------------------------------------------------------ storage

    async def client(self) -> Any:
        """One official async Supabase client (service-role key) for this process."""
        async with self._client_lock:
            if self._client is None:
                from supabase import acreate_client

                url, key = os.getenv("SUPABASE_URL", ""), os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
                if not url or not key:
                    raise RuntimeError("Scheduled agents need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the Ren API host.")
                self._client = await acreate_client(url, key)
            return self._client

    async def _agent(self, owner: str, agent_id: str) -> dict[str, Any] | None:
        rows = (await (await self.client()).table("harness_agents").select("id,name,description")
                .eq("id", agent_id).eq("owner_id", owner).limit(1).execute()).data
        return rows[0] if rows else None

    # ------------------------------------------------------------------ schedules

    async def schedules(self, owner: str) -> dict[str, dict[str, Any]]:
        rows = (await (await self.client()).table(SCHEDULES).select("agent_id,cadence,task,enabled,next_run_at")
                .eq("owner_id", owner).execute()).data
        return {row["agent_id"]: {key: row[key] for key in ("cadence", "task", "enabled", "next_run_at")} for row in rows}

    async def set_schedule(self, owner: str, agent_id: str, cadence: Cadence, *, task: str = "",
                           enabled: bool = True) -> dict[str, Any]:
        if await self._agent(owner, agent_id) is None:
            raise LookupError("That specialist agent does not exist")
        now = datetime.now(UTC)
        row = {"agent_id": agent_id, "owner_id": owner, "cadence": cadence.model_dump(), "task": task.strip(),
               "enabled": enabled, "next_run_at": _iso(next_run(cadence, now)) if enabled else None,
               "updated_at": _iso(now)}
        saved = (await (await self.client()).table(SCHEDULES).upsert(row, on_conflict="agent_id").execute()).data[0]
        logger.info("owner=<%s>, agent_id=<%s>, cadence=<%s>, next=<%s> | agent schedule saved", owner, agent_id,
                    cadence_label(cadence), saved["next_run_at"])
        return {key: saved[key] for key in ("cadence", "task", "enabled", "next_run_at")}

    async def clear_schedule(self, owner: str, agent_id: str) -> None:
        await (await self.client()).table(SCHEDULES).delete().eq("agent_id", agent_id).eq("owner_id", owner).execute()

    # ------------------------------------------------------------------ runs

    async def runs(self, owner: str, *, limit: int = 30) -> list[dict[str, Any]]:
        rows = (await (await self.client()).table(RUNS)
                .select("id,agent_id,session_id,trigger,status,summary,error,started_at,finished_at,seen_at,harness_agents(name)")
                .eq("owner_id", owner).order("started_at", desc=True).limit(limit).execute()).data
        return [{**{key: value for key, value in row.items() if key != "harness_agents"},
                 "agent_name": (row.get("harness_agents") or {}).get("name", "")} for row in rows]

    async def mark_seen(self, owner: str, run_id: str) -> bool:
        rows = (await (await self.client()).table(RUNS).update({"seen_at": _iso(datetime.now(UTC))})
                .eq("id", run_id).eq("owner_id", owner).execute()).data
        return bool(rows)

    async def _running(self, owner: str, agent_id: str) -> bool:
        rows = (await (await self.client()).table(RUNS).select("id").eq("owner_id", owner).eq("agent_id", agent_id)
                .eq("status", "running").limit(1).execute()).data
        return bool(rows)

    async def run(self, owner: str, agent_id: str, *, task: str = "", cadence: Cadence | None = None,
                  trigger: Literal["schedule", "manual"] = "manual") -> dict[str, Any]:
        """Start one run of the specialist on a new panel session; returns its ``agent_runs`` row.

        The selection is what the Agent Panel pins when Chat starts a specialist conversation: the panel destination,
        the specialist, the default chat model and browser, the default runtime options.
        """
        from agent.api.core.panel_agent import default_selection
        from agent.api.core.panel_browser import default_browser
        from agent.api.endpoints.chat import RuntimeOptions

        agent = await self._agent(owner, agent_id)
        if agent is None:
            raise LookupError("That specialist agent does not exist")
        if await self._running(owner, agent_id):
            raise AgentBusy(f"{agent['name']} is already running")
        chosen = default_selection()
        if chosen is None:
            raise RuntimeError("No chat model provider is configured on the Ren API host.")
        provider, model_id = chosen
        session_id = f"agent-{uuid.uuid4()}"
        row = (await (await self.client()).table(RUNS).insert(
            {"owner_id": owner, "agent_id": agent_id, "session_id": session_id, "trigger": trigger}).execute()).data[0]
        prompt = run_prompt(name=agent["name"], description=agent.get("description") or "", task=task, cadence=cadence)
        try:
            await self._manager.start(
                owner, session_id, prompt, action="message",
                selection={"agent": {"kind": "specialist", "id": agent_id}, "provider": provider, "model_id": model_id,
                           "reasoning_effort": None, "browser": default_browser()},
                options=RuntimeOptions().model_dump(),
            )
        except Exception as error:
            await self._finish(row["id"], "failed", error=_error_text(error))
            raise
        logger.info("owner=<%s>, agent_id=<%s>, name=<%s>, session=<%s>, trigger=<%s> | specialist run started",
                    owner, agent_id, agent["name"], session_id, trigger)
        self._watch(row["id"], owner, session_id)
        return {**row, "agent_name": agent["name"]}

    def _watch(self, run_id: str, owner: str, session_id: str) -> None:
        if run_id in self._watchers:
            return
        task = asyncio.create_task(self._follow(run_id, owner, session_id), name=f"agent-run-{run_id}")
        self._watchers[run_id] = task
        task.add_done_callback(lambda _: self._watchers.pop(run_id, None))

    async def _follow(self, run_id: str, owner: str, session_id: str) -> None:
        """Wait for the run's native invocation to end, then record its outcome for the notification."""
        try:
            # get() continues a run a previous process stopped in (SessionRun._resume_interrupted).
            session = await self._manager.get(owner, session_id)
            if session is None:
                await self._finish(run_id, "failed", error="The run's session could not be found.")
                return
            await session.wait()
            status = session.status if session.status in RUN_STATUSES else "failed"
            await self._finish(run_id, status, summary=run_summary(session.messages),
                               error=_error_text(session.error) if status == "failed" else "")
        except asyncio.CancelledError:
            raise
        except Exception as error:
            logger.exception("run=<%s>, session=<%s> | following the specialist run failed", run_id, session_id)
            await self._finish(run_id, "failed", error=_error_text(error))

    async def _finish(self, run_id: str, status: str, *, summary: str = "", error: str = "") -> None:
        try:
            await (await self.client()).table(RUNS).update(
                {"status": status, "summary": summary, "error": error, "finished_at": _iso(datetime.now(UTC))},
            ).eq("id", run_id).execute()
            logger.info("run=<%s>, status=<%s> | specialist run finished", run_id, status)
        except Exception:
            logger.exception("run=<%s> | recording the run's outcome failed", run_id)

    # ------------------------------------------------------------------ loop

    async def check(self) -> int:
        """Start every enabled schedule that is due; returns how many runs started."""
        client = await self.client()
        now = datetime.now(UTC)
        due = (await client.table(SCHEDULES).select("agent_id,owner_id,cadence,task,next_run_at")
               .eq("enabled", True).lte("next_run_at", _iso(now)).order("next_run_at").limit(DUE_BATCH).execute()).data
        started = 0
        for row in due:
            try:
                cadence = Cadence.model_validate(row["cadence"])
            except ValueError as error:
                logger.warning("agent_id=<%s>, error=<%s> | invalid schedule disabled", row["agent_id"], error)
                await client.table(SCHEDULES).update({"enabled": False}).eq("agent_id", row["agent_id"]).execute()
                continue
            following = next_run(cadence, now, _parse(row["next_run_at"]))
            # Compare-and-set: only the process that moves this exact due time forward starts the occurrence.
            claimed = (await client.table(SCHEDULES).update({"next_run_at": _iso(following)})
                       .eq("agent_id", row["agent_id"]).eq("next_run_at", row["next_run_at"]).execute()).data
            if not claimed:
                continue
            try:
                await self.run(row["owner_id"], row["agent_id"], task=row.get("task") or "", cadence=cadence,
                               trigger="schedule")
                started += 1
            except AgentBusy as busy:
                logger.info("agent_id=<%s> | %s; this occurrence is skipped", row["agent_id"], busy)
            except Exception:
                logger.exception("agent_id=<%s> | scheduled run did not start", row["agent_id"])
        return started

    async def _resume(self) -> None:
        """Follow runs a previous process left ``running`` (their sessions continue on access)."""
        rows = (await (await self.client()).table(RUNS).select("id,owner_id,session_id").eq("status", "running")
                .execute()).data
        for row in rows:
            self._watch(row["id"], row["owner_id"], row["session_id"])

    async def _forever(self) -> None:
        try:
            await self._resume()
        except Exception:
            logger.exception("resuming specialist runs failed")
        while True:
            if self._enabled:
                try:
                    await self.check()
                except Exception:
                    logger.exception("checking agent schedules failed")
            await asyncio.sleep(self._tick)

    def start(self) -> None:
        if self._loop is None or self._loop.done():
            self._loop = asyncio.create_task(self._forever(), name="agent-schedules")

    async def shutdown(self) -> None:
        tasks = [task for task in (self._loop, *self._watchers.values()) if task is not None]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self._loop = None


__all__ = ["AgentBusy", "AgentScheduler", "Cadence", "cadence_label", "next_run", "run_prompt", "run_summary"]
