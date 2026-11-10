"""Server-owned panel sessions on Strands 1.56.0 (one process / event loop).

Integration contract
--------------------
``await manager.start(user_id, session_id, message=None, action="message",
interrupt_responses=None, *, factory=None, selection=None, options=None)`` returns
the long-lived ``SessionRun``. ``action`` is ``message``, ``resume`` (checkpoint),
or ``interrupt``. ``get(..., factory=...)`` restores without invoking the model.
``steer(..., message, steering_id=None)``, ``cancel(...)``, ``snapshot(...)`` and
``shutdown()`` are async. Unknown GETs return None; other unknown operations raise
KeyError. Busy/configuration conflicts raise RuntimeConflict (HTTP 409).

The async factory is called with keyword arguments ``user_id``, ``session_id``,
``selection``, ``options``, ``runtime_options`` and returns an Agent. Pass all
runtime_options to Agent; merge their hooks/plugins with application hooks/plugins.
They include agent_id, SnapshotSessionManager, callback_handler, hooks and plugins.
The factory must offload synchronous Agent construction (e.g. asyncio.to_thread).
Selection/options must be JSON configuration, not credentials or live SDK objects.
They are immutable for a session; omitted values reuse stored configuration.

SessionRun.events(after=sequence, run_id=...) yields JSON event envelopes;
SessionRun.sse(...) yields SSE strings with session-wide numeric ids. Disconnecting
either iterator NEVER cancels execution. Capture run_id immediately after start.
SessionRun.wait() shields the server task. History is bounded; ReplayOverflow must
be mapped to a resync/error response, never silently ignored. Snapshot messages
are stable PRE-RUN messages while active; replay from snapshot['replay_after'].
If the pre-run cursor expired, snapshot returns canonical completed SDK messages,
history_incomplete=True, replay_status="gap", and replay_after=latest. In-flight
text is explicitly unavailable; attach at that cursor and refresh on completion.
The normal snapshot also carries the pending run input. On completion fetch a fresh
snapshot for canonical SDK history (including GoalLoop/structured output).

Durability uses immutable *native* snapshots plus an application journal pointing
to the committed snapshot. Live deltas/replay are MEMORY ONLY between lifecycle,
steering, pause and final journal commits. Tokens never wait for storage I/O.
The session manager saves the native snapshot_latest after every message
(save_latest_on="message"), so a run a restart interrupted continues, in the same run, on a fresh
agent that restores it; no tool is replayed (an unanswered toolUse gets the SDK's
"Tool was interrupted." result). No failure leaves a session unusable.
InMemoryStorage is process-local; choose durable panel_storage for restart support.
No cross-process writer locking is provided; run one manager-owning API worker.

Keep native background_tasks.wait_for_completion=True. GoalLoop with
preserve_context=False and checkpoint/interrupt workflows is unsupported; its
history rollback happens before pause hooks. Runtime hooks use priority 200:
application resume/retry/result-transform hooks must use a lower priority.
Idle steering reserves a native follow-up invocation; paused steering stays queued.
A stalled attempt (the manager's watchdog: stall_seconds/tool_stall_seconds; 0 disables), a model
timeout the native retry strategy gave up on, or a context-window overflow the conversation
manager could not reduce is recovered inside the same run, max_recoveries times: the old
instance is saved as the session's latest snapshot, the factory builds a fresh agent on the same
ThreadSessionManager (which restores it), and the run continues with no error event. The
ContextInjector adds a recovery note to the model input; after an overflow the request context
is shortened to RECOVERY_CONTEXT_SHARE of the model's window. The budget counts consecutive
recoveries: a completed tool call resets it. A run that spends it fails with its error; the
session stays open and the next message continues on a fresh agent from the saved conversation.
Finishing-phase arrivals are admitted after the native stream exits. Root model
deltas/retries carry cycle (native cycle ID) and model_attempt (1-based per cycle).
Retry identifies the discarded attempt; attempt is the next attempt number.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import logging
import threading
import time
import uuid
from collections import deque
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from contextlib import aclosing, suppress
from typing import Any, Protocol

import grpc
import grpc.aio
import httpx
from strands import Agent
from strands.agent.agent_result import AgentResult
from strands.hooks.events import (
    AfterInvocationEvent, AfterModelCallEvent, AfterToolCallEvent, BeforeModelCallEvent,
)
from strands.hooks.registry import HookRegistry
from strands.multiagent.base import MultiAgentResult, NodeResult
from strands.storage import Storage
from strands.types.exceptions import ContextWindowOverflowException
from strands.vended_plugins.context_injector import ContextInjector, InjectionContext

from .panel_storage import ThreadSessionManager, get_user_session_storage, thread_agent_id
from .panel_tools import serializable_event

STEERING_STATE_KEY = "panel.runtime.steering"
_HOOK_ORDER = 200
_BACKGROUND_TOOL = "strands_manage_background_task"
_BACKGROUND_STATE = "strands.background_tasks"
_ACTIVE = {"starting", "running", "finishing"}
_DURABLE_EVENTS = {"run_started", "steering_accepted", "steering_applied", "checkpoint", "interrupt", "run_finished", "error",
                   "tool_repair_proposed", "tool_repair_investigating", "tool_repair_approval", "tool_repair_ready"}
_LOGGER = logging.getLogger(__name__)

#: Ephemeral note the ContextInjector adds to every model call after an in-run respawn. It is
#: never stored, so the thread shows nothing.
RECOVERY_NOTE = (
    "[recovery] {what} A fresh agent instance took over this same conversation (recovery {attempt} "
    "of {limit}); your messages, agent state and todo list were restored. Continue the user's request "
    "from where it stopped without redoing completed work.{tools}"
)
#: Added only when a tool call was cut off by the respawn.
RECOVERY_TOOL_NOTE = (
    " The tool call whose result reads \"Tool was interrupted.\" never returned: do not repeat it if it "
    "may already have had side effects until you have checked whether it did."
)
RECOVERY_REASONS = {
    "stall": "{detail}; the previous attempt was stopped.",
    "timeout": "The previous model call timed out ({detail}).",
    "restart": "{detail}",
    "overflow": "The previous model call exceeded the model's context window; the reference context "
                "attached to this request was shortened to fit.",
}
#: Share of the model's context window the per-request reference context may use after an overflow.
RECOVERY_CONTEXT_SHARE = 0.25
_DISPOSE_SECONDS = 30.0


def is_model_timeout(error: BaseException | None) -> bool:
    """True when a provider call failed on a timeout: TimeoutError, an httpx timeout, or gRPC
    DEADLINE_EXCEEDED (xai_sdk), anywhere on the exception's cause/context chain."""
    seen: set[int] = set()
    while error is not None and id(error) not in seen:
        seen.add(id(error))
        if isinstance(error, (TimeoutError, httpx.TimeoutException)) or (
                isinstance(error, (grpc.Call, grpc.aio.AioRpcError))
                and error.code() == grpc.StatusCode.DEADLINE_EXCEEDED):
            return True
        error = error.__cause__ or error.__context__
    return False


class RuntimeConflict(RuntimeError):
    """An invocation is reserved, or configuration/action conflicts with state."""


class ReplayOverflow(RuntimeError):
    """The requested cursor was evicted; callers must explicitly resynchronize."""

    def __init__(self, after: int, earliest: int, latest: int) -> None:
        self.after, self.earliest, self.latest = after, earliest, latest
        super().__init__(f"Replay cursor {after} expired; retained sequences {earliest}..{latest}")


class AgentFactory(Protocol):
    def __call__(
        self, *, user_id: str, session_id: str, selection: dict[str, Any],
        options: dict[str, Any], runtime_options: dict[str, Any],
    ) -> Awaitable[Agent]: ...


def _config(value: Mapping[str, Any] | None) -> dict[str, Any]:
    # Deliberately reject non-JSON construction objects instead of persisting opaque tags.
    return json.loads(json.dumps(dict(value or {}), allow_nan=False))


def _wire(value: Any) -> Any:
    """Explicitly retain AgentResult extras missing from SDK to_dict()."""
    if isinstance(value, AgentResult):
        return {
            **serializable_event(value),
            "metrics": serializable_event(value.metrics.get_summary()),
            "interrupts": serializable_event(value.interrupts or []),
            "structured_output": serializable_event(value.structured_output),
        }
    if isinstance(value, NodeResult):
        return {**serializable_event(value), "result": _wire(value.result)}
    if isinstance(value, MultiAgentResult):
        return {**serializable_event(value), "results": _wire(value.results)}
    if isinstance(value, Mapping):
        return {str(key): _wire(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_wire(item) for item in value]
    return serializable_event(value)


class SessionRun:
    """One user/session's agent, latest run, replay journal and lifecycle owner.

    Construct through PanelRuntimeManager. Public readable fields: session_id,
    user_id, run_id, status, sequence, agent, selection, options, task.
    """

    def __init__(
        self, user_id: str, session_id: str, storage: Storage, *, history_limit: int,
        history_bytes: int, factory: AgentFactory | None, max_recoveries: int = 2,
    ) -> None:
        self.user_id, self.session_id = user_id, session_id
        self.storage = storage
        self.session_manager = ThreadSessionManager(session_id, storage=storage, save_latest_on="message")
        self.agent_id = thread_agent_id(user_id)
        self.key = f"panel-runtime/{hashlib.sha256(session_id.encode()).hexdigest()}.json"
        self.factory = factory
        self.selection: dict[str, Any] = {}
        self.options: dict[str, Any] = {}
        self.agent: Agent | None = None
        self.task: asyncio.Task[None] | None = None
        self.run_id: str | None = None
        self.status = "idle"
        self.sequence = 0
        self.replay_after = 0
        self.messages: list[dict[str, Any]] = []
        self.input: Any = None
        # Per-run reference data (e.g. browser context). Injected ephemerally into
        # the model input by the native ContextInjector; NEVER journaled, persisted, or
        # written to agent.messages/state, so it never surfaces in the UI.
        self.request_context: str | None = None
        self.checkpoint: Any = None
        self.interrupts: list[Any] = []
        self.result: Any = None
        self.error: Any = None
        self.snapshot_id: str | None = None
        self.steering: list[dict[str, Any]] = []
        self.recovery_required = False
        self._history: deque[dict[str, Any]] = deque()
        self._event_sizes: deque[int] = deque()
        self._retained_bytes = 0
        self._history_limit, self._history_bytes = history_limit, history_bytes
        self._lock = asyncio.Lock()
        self._changed = asyncio.Event()
        self._loop = asyncio.get_running_loop()
        self._thread = threading.get_ident()
        self._cancel = threading.Event()
        self._closed = False
        self._callback_closed = False
        self._callback_lock = threading.Lock()
        self._callback_tasks: set[asyncio.Task[None]] = set()
        self._injected: set[str] = set()
        self._results: dict[tuple[tuple[str, ...], str], Any] = {}
        self._inputs: dict[tuple[tuple[str, ...], str], Any] = {}
        self._background_results: dict[str, Any] = {}
        self._attempt = 0
        self._cycle: str | None = None
        self._model_attempt = 0
        self._retried: tuple[str, None] | tuple[str | None, int] | None = None
        # Stall-watchdog state: every emitted event refreshes _last_event_at; tool ids enter
        # _tools_in_flight at their (deduplicated) input event and leave at AfterToolCallEvent,
        # so a legitimately long silent tool gets the longer tool window.
        self._last_event_at = time.monotonic()
        self._tools_in_flight: set[str] = set()
        self._stall_reason: str | None = None
        # In-run recovery: the current stream attempt (the watchdog cancels only this), the
        # per-run respawn count and the note the ContextInjector adds after a respawn.
        self._attempt_task: asyncio.Task[AgentResult | None] | None = None
        self._max_recoveries = max_recoveries
        self.recoveries = 0
        self._recovery_note: str | None = None
        # What continues the run: its input, or [] once that input is in the saved conversation.
        self._run_input: Any = None
        # A previous process stopped during this session's run; the next access continues it.
        self._interrupted = False

    @property
    def active(self) -> bool:
        return self.task is not None and not self.task.done()

    def register_hooks(self, registry: HookRegistry, **_: Any) -> None:
        registry.add_callback(AfterToolCallEvent, self._after_tool, order=_HOOK_ORDER)
        registry.add_callback(BeforeModelCallEvent, self._before_model, order=_HOOK_ORDER)
        registry.add_callback(AfterModelCallEvent, self._after_model, order=_HOOK_ORDER)
        registry.add_callback(AfterInvocationEvent, self._after_invocation, order=_HOOK_ORDER)

    def _runtime_options(self) -> dict[str, Any]:
        return {
            "agent_id": self.agent_id,
            "session_manager": self.session_manager,
            # Native ephemeral per-call context (browser context + queued steering), on every
            # model call of the tool loop, like strands_harness's Todos injector.
            "plugins": [ContextInjector(self._render_context, trigger="everyTurn", name="ron:request-context")],
            "hooks": [self],
            "callback_handler": self._callback,
        }

    def _metadata(self) -> dict[str, Any]:
        return {name: copy.deepcopy(getattr(self, name)) for name in (
            "selection", "options", "run_id", "status", "sequence", "replay_after",
            "messages", "input", "checkpoint", "interrupts", "result", "snapshot_id",
            "steering", "recovery_required", "error", "recoveries",
        )} | {"version": 1, "events": list(self._history)}

    async def _persist(self) -> None:
        """Called under _lock; writes serialize on the owning loop."""
        await self.storage.write(self.key, json.dumps(self._metadata(), ensure_ascii=False).encode())

    async def _load(self) -> bool:
        data = await self.storage.read(self.key)
        if data is None:
            return False
        metadata = json.loads(data)
        if metadata.get("version") != 1:
            raise ValueError("Unsupported panel runtime journal version")
        for name in self._metadata().keys() - {"version", "events"}:
            if name in metadata:
                setattr(self, name, metadata[name])
        self._history = deque(metadata["events"])
        self._event_sizes = deque(len(json.dumps(event).encode()) for event in self._history)
        self._retained_bytes = sum(self._event_sizes)
        if self.status in _ACTIVE or self.recovery_required:
            # The native snapshot_latest (saved after every message) is ahead of the journal's
            # immutable snapshot: the next agent restores it on construction.
            self._interrupted = self.status in _ACTIVE
            self.recovery_required = False
            self.snapshot_id = None
        return True

    async def _resume_interrupted(self) -> None:
        """Continue, in the same run, the invocation a previous process stopped in."""
        self._interrupted = False
        if self.recoveries >= self._max_recoveries:
            self.status = "failed"
            await self._emit("error", error="The server restarted repeatedly during this run. The conversation is "
                                            "saved up to its last completed step; send a message to continue.")
            await self._emit("run_finished", stop_reason="error", status=self.status)
            return
        self.recoveries += 1
        self._reserve(self.input, restart=True)

    async def _ensure_agent(self, *, restore_checkpoint: bool = True) -> None:
        if self.agent is not None:
            return
        if self.factory is None:
            raise RuntimeConflict("Restoring this session requires an async agent factory")
        startup = asyncio.create_task(self.factory(
            user_id=self.user_id, session_id=self.session_id,
            selection=copy.deepcopy(self.selection), options=copy.deepcopy(self.options),
            runtime_options=self._runtime_options(),
        ))
        try:
            agent = await asyncio.shield(startup)
        except asyncio.CancelledError:
            # Do not orphan a constructor offloaded to a thread.
            agent = await startup
            try:
                if agent.memory_manager is not None:
                    await agent.memory_manager.flush()
            finally:
                await asyncio.to_thread(agent.cleanup)
            raise
        if not isinstance(agent, Agent):
            raise TypeError("Panel factory must return a native strands.Agent")
        self.agent = agent
        if agent.agent_id != self.agent_id:
            raise ValueError("Factory must pass runtime_options['agent_id'] to Agent")
        if restore_checkpoint and self.snapshot_id is not None:
            if not await self.session_manager.restore_snapshot(agent, snapshot_id=self.snapshot_id):
                raise RuntimeError("Committed native snapshot is missing")
        # The journal also persists steering accepted since the last native snapshot.
        agent.state.set(STEERING_STATE_KEY, self.steering)
        self.messages = _wire(agent.messages)

    async def _respawn(self, kind: str, error: Any) -> None:
        """Continue this run on a fresh agent from the same factory and the same session.

        The old instance is saved as ``snapshot_latest``; the new one restores it on
        construction (same ``agent_id`` and ``ThreadSessionManager``), so it carries the same
        conversation manager, offloader and ContextInjector. After a restart there is no old
        instance and the new one restores the ``snapshot_latest`` the session manager saved after
        the last message. ``_run_input`` becomes ``[]`` once the run's input is in the restored
        conversation (the SDK then closes a toolUse that was never answered with "Tool was
        interrupted."). The pre-run immutable snapshot and the pre-run ``messages`` stay put.
        """
        if kind != "restart":
            self.recoveries += 1
        _LOGGER.warning("session_id=<%s>, kind=<%s>, recovery=<%d/%d>, error=<%s> | respawning the agent on "
                        "the same session", self.session_id, kind, self.recoveries, self._max_recoveries, error)
        # Silent: the renderer drops the failed attempt's partial text without showing a retry.
        await self._model_retry(kind, silent=True)
        tools_cut = RECOVERY_TOOL_NOTE if self._tools_in_flight else ""
        for tool_id in sorted(self._tools_in_flight):
            await self._tool_result({"toolUseId": tool_id, "status": "error",
                                     "content": [{"text": "Tool was interrupted."}]}, ())
        self._tools_in_flight.clear()
        old, self.agent, pre_run = self.agent, None, self.messages
        if old is not None:
            try:
                old.state.set(STEERING_STATE_KEY, self.steering)
                await asyncio.wait_for(self.session_manager.save_snapshot(old, is_latest=True), _DISPOSE_SECONDS)
            except Exception:
                _LOGGER.exception("session_id=<%s> | saving the old instance failed; continuing from the last "
                                  "saved message", self.session_id)
            await self._dispose(old)
        await self._ensure_agent(restore_checkpoint=False)
        assert self.agent is not None
        if self.messages != pre_run:
            self._run_input = []
        self.messages = pre_run
        last = self.agent.messages[-1]["content"] if self.agent.messages else []
        if any("toolUse" in block for block in last):
            tools_cut = RECOVERY_TOOL_NOTE
        if kind == "overflow" and self.request_context:
            self.request_context = await self._fit_request_context(self.agent.model, self.request_context)
        self._recovery_note = RECOVERY_NOTE.format(
            what=RECOVERY_REASONS[kind].format(detail=error), attempt=self.recoveries, limit=self._max_recoveries,
            tools=tools_cut)
        self._last_event_at = time.monotonic()

    @staticmethod
    async def _dispose(agent: Agent) -> None:
        """Bounded memory flush and cleanup of an instance this session no longer uses."""
        if agent.memory_manager is not None:
            with suppress(Exception):
                await asyncio.wait_for(agent.memory_manager.flush(), _DISPOSE_SECONDS)
        with suppress(Exception):
            await asyncio.wait_for(asyncio.to_thread(agent.cleanup), _DISPOSE_SECONDS)

    @staticmethod
    async def _fit_request_context(model: Any, text: str) -> str:
        """Shorten the per-request context to RECOVERY_CONTEXT_SHARE of the model's real window."""
        used = model.estimate_utilization(await model.count_tokens([{"role": "user", "content": [{"text": text}]}]))
        if used <= RECOVERY_CONTEXT_SHARE:
            return text
        return text[:int(len(text) * RECOVERY_CONTEXT_SHARE / used)] + "\n[reference context shortened to fit]"

    async def _emit(self, event_type: str, *, node_path: tuple[str, ...] = (), **payload: Any) -> dict[str, Any]:
        async with self._lock:
            return await self._emit_locked(event_type, node_path=node_path, **payload)

    async def _emit_locked(self, event_type: str, *, node_path: tuple[str, ...] = (), **payload: Any) -> dict[str, Any]:
        if event_type == "error" and not node_path:
            self.error = _wire(payload.get("error"))
        self._last_event_at = time.monotonic()
        self.sequence += 1
        event = {"version": 1, "sequence": self.sequence, "session_id": self.session_id,
                 "run_id": self.run_id, "type": event_type, "node_path": list(node_path), **_wire(payload)}
        self._history.append(event)
        size = len(json.dumps(event).encode())
        self._event_sizes.append(size)
        self._retained_bytes += size
        # Even a single oversized event can be evicted. Consumers get overflow,
        # rather than a truncated result that looks like a successful replay.
        while self._history and (len(self._history) > self._history_limit or self._retained_bytes > self._history_bytes):
            self._history.popleft()
            self._retained_bytes -= self._event_sizes.popleft()
        if event_type in _DURABLE_EVENTS:
            await self._persist()
        self._changed.set()
        return copy.deepcopy(event)

    def _check_cursor(self, after: int) -> None:
        earliest = self._history[0]["sequence"] if self._history else self.sequence + 1
        if after < earliest - 1:
            raise ReplayOverflow(after, earliest, self.sequence)
        if after > self.sequence or after < 0:
            raise ValueError("Replay cursor must be between zero and the latest session sequence")

    async def events(self, after: int = 0, *, run_id: str | None = None) -> AsyncIterator[dict[str, Any]]:
        """Replay then follow; optionally stop at the selected run's terminal event."""
        while True:
            async with self._lock:
                self._check_cursor(after)
                batch = [copy.deepcopy(event) for event in self._history if event["sequence"] > after]
                ended = not self.active
                self._changed.clear()
            for event in batch:
                after = event["sequence"]
                yield event
                if event["type"] == "run_finished" and (run_id is None or event["run_id"] == run_id):
                    return
            if ended:
                return
            await self._changed.wait()

    async def sse(self, after: int = 0, *, run_id: str | None = None) -> AsyncIterator[str]:
        async for event in self.events(after, run_id=run_id):
            yield f"id: {event['sequence']}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"

    async def wait(self) -> None:
        # Follow separately admitted idle-steering work, never drive SDK cycles.
        while self.task is not None:
            task = self.task
            await asyncio.shield(task)
            if self.task is task:
                return

    async def snapshot(self) -> dict[str, Any]:
        async with self._lock:
            replaying = self.active and self.status in _ACTIVE
            cursor = self.replay_after if replaying else self.sequence
            incomplete = False
            messages = self.messages
            try:
                self._check_cursor(cursor)
            except ReplayOverflow:
                incomplete = True
                cursor = self.sequence
                # No await between reading native messages and pairing the cursor.
                # These are completed messages, NOT a projection of in-flight text.
                messages = _wire(self.agent.messages) if self.agent is not None else self.messages
            return {"version": 1, "session_id": self.session_id, "run_id": self.run_id,
                    "status": self.status, "active": self.active, "sequence": self.sequence,
                    "replay_after": cursor, "messages": copy.deepcopy(messages),
                    "history_incomplete": incomplete, "replay_status": "gap" if incomplete else "complete",
                    "input": copy.deepcopy(self.input) if replaying and not incomplete else None,
                    "checkpoint": copy.deepcopy(self.checkpoint), "interrupts": copy.deepcopy(self.interrupts),
                    "steering": copy.deepcopy(self.steering), "selection": copy.deepcopy(self.selection),
                    "options": copy.deepcopy(self.options), "result": copy.deepcopy(self.result),
                    "recovery_required": self.recovery_required, "error": copy.deepcopy(self.error)}

    async def _render_context(self, context: InjectionContext) -> str | None:
        """``ContextInjector`` render: browser context plus queued steering for this model call.

        Runs after BeforeModel hooks/interrupt gates and the complete tool batch; the SDK folds
        the text into this call's input only (never agent.messages, the session or the journal).
        """
        if self._cancel.is_set():
            return None
        async with self._lock:
            pending = [record for record in self.steering if record["status"] == "queued"]
            self._injected = {record["id"] for record in pending}
            parts = [record["message"] for record in pending]
            if self.request_context:
                parts.insert(0, self.request_context)
            if self._recovery_note:
                parts.append(self._recovery_note)
            return "\n\n".join(parts) or None

    def _before_model(self, event: BeforeModelCallEvent) -> None:
        cycle = str(event.invocation_state["event_loop_cycle_id"])
        self._model_attempt = self._model_attempt + 1 if cycle == self._cycle else 1
        self._cycle = cycle
        self._injected.clear()

    def _model_scope(self) -> dict[str, Any]:
        return {"cycle": self._cycle, "model_attempt": self._model_attempt}

    async def _model_retry(self, reason: Any, **extra: Any) -> None:
        scope = (self._cycle, self._model_attempt)
        if self._retried == scope:
            return
        self._retried = scope
        await self._emit("retry", attempt=self._model_attempt + 1, reason=reason, **self._model_scope(), **extra)

    async def _after_model(self, event: AfterModelCallEvent) -> None:
        if event.retry:
            self._injected.clear()
            # A hook that recovered an overflow (XAIStatePruner) is invisible like a respawn.
            await self._model_retry(_wire(event.exception) or "model hook retry",
                                    silent=isinstance(event.exception, ContextWindowOverflowException))
            return
        if event.stop_response is None or self._cancel.is_set():
            self._injected.clear()
            return
        async with self._lock:
            for record in self.steering:
                if record["id"] in self._injected and record["status"] == "queued":
                    record["status"] = "applied"
                    record["applied_run_id"] = self.run_id
                    event.agent.state.set(STEERING_STATE_KEY, self.steering)
                    await self._emit_locked("steering_applied", id=record["id"], message=record["message"])
            self._injected.clear()

    async def _after_invocation(self, event: AfterInvocationEvent) -> None:
        result = event.result
        async with self._lock:
            if result is None or result.stop_reason not in ("end_turn", "stop_sequence") or self._cancel.is_set():
                # GoalLoop can set resume even for a pause. Do not consume queued
                # steering or allow its resume text to bypass a checkpoint/interrupt.
                event.resume = None
                return
            if any(record["status"] == "queued" for record in self.steering):
                # Preserve GoalLoop's entire public AgentInput, including content
                # blocks/messages. Steering merges ephemerally at InvokeModel.
                if event.resume is None:
                    event.resume = []

    async def _drain_callbacks(self) -> None:
        await asyncio.sleep(0)
        while self._callback_tasks:
            await asyncio.gather(*tuple(self._callback_tasks))

    async def _after_tool(self, event: AfterToolCallEvent) -> None:
        self._tools_in_flight.discard(str(event.tool_use.get("toolUseId", "")))
        self.recoveries = 0
        payload = {"tool_result": _wire(event.result), "tool_use": _wire(event.tool_use), "retry": event.retry}
        background = self._background_id(event.tool_use["toolUseId"])
        if threading.get_ident() != self._thread:
            future = asyncio.run_coroutine_threadsafe(self._tool_completion(payload, background=background), self._loop)
            await asyncio.wrap_future(future)
        else:
            await self._tool_completion(payload, background=background)

    def _background_id(self, tool_use_id: str | None) -> str | None:
        if self.agent is not None and tool_use_id:
            for task in self.agent.state.get(_BACKGROUND_STATE) or []:
                if task["tool_use_id"] == tool_use_id:
                    return task["task_id"]
        return None

    async def _tool_completion(self, payload: dict[str, Any], *, background: str | None = None) -> None:
        if payload["retry"]:
            self._attempt += 1
            await self._emit("retry", attempt=self._attempt, reason="tool hook retry", id=payload["tool_use"]["toolUseId"])
        elif background:
            if self._background_results.get(background) == payload:
                return
            self._background_results[background] = payload
            await self._emit("background_event", task_id=background, event=payload)
        else:
            await self._tool_result(payload["tool_result"], (), name=payload["tool_use"]["name"])

    def _callback(self, **event: Any) -> None:
        # Both foreground tool tasks and background tasks can run on this loop.
        # Only the native persisted task registry establishes background ownership.
        stream = event.get("tool_stream_event")
        if not isinstance(stream, Mapping):
            return
        background_id = self._background_id(stream.get("tool_use", {}).get("toolUseId"))
        if background_id is None:
            return
        # Whitelist the stream envelope: invocation_state also contains host
        # messages, system_prompt, request_state, model and other private data.
        payload = {"task_id": background_id, "tool_stream_event": _wire(stream)}
        with self._callback_lock:
            if not self._callback_closed:
                self._loop.call_soon_threadsafe(self._enqueue_callback, payload)

    def _enqueue_callback(self, event: dict[str, Any]) -> None:
        task = self._loop.create_task(self._emit("background_event", event=event))
        self._callback_tasks.add(task)
        task.add_done_callback(self._callback_tasks.discard)
        task.add_done_callback(lambda done: None if done.cancelled() else done.exception())

    async def _announce_repair_proposal(self) -> None:
        """Investigations start from the native tool hook (``ToolRepairTrigger`` -> ``RepairService``);
        there is no proposal to announce and nothing to approve before investigating."""
        return

    def _repair_fields(self, result: Mapping[str, Any]) -> dict[str, Any]:
        return {"tool": result.get("tool_name"), "rev": result.get("revision"), "repair_kind": result.get("repair_kind"),
                "status": result.get("status"), "summary": result.get("summary", ""), "diff": result.get("diff", ""),
                "demonstrations": result.get("demonstrations", []), "sandbox": result.get("sandbox"),
                "route": result.get("route"), "approval_token": result.get("approval_token"),
                "applied": result.get("applied"), "declined": result.get("declined")}

    async def repair_event(self, payload: Mapping[str, Any]) -> None:
        """Repair-service callback for the originating session.

        ``investigating`` -> ``tool_repair_investigating``; the fixer's A2A task events (``a2a``) render as the
        ChainOfThought "Repair" under the synthetic tool-use id ``repair:<revision>``; ``approval``
        -> ``tool_repair_approval`` (the verified artifact, the parked interrupt, the approval
        token); ``ready`` -> ``tool_repair_ready`` (terminal: applied / declined / failed / blocked
        / cancelled / needs_maintainer / not_reproducible).
        """
        revision = str(payload.get("revision", ""))
        tool_use = {"toolUseId": f"repair:{revision}", "name": "repair", "input": {"tool": payload.get("tool_name")}}
        if "investigating" in payload:
            info = dict(payload["investigating"])
            await self._tool_input(tool_use, ())
            await self._emit("tool_repair_investigating", tool=payload.get("tool_name"), rev=revision,
                             kind=info.get("kind"), count=info.get("count"), exception_class=info.get("exception_class"),
                             context_id=info.get("context_id"))
            return
        if "approval" in payload:
            result = dict(payload["approval"])
            await self._emit("tool_repair_approval", **self._repair_fields(result))
            return
        if "ready" in payload:
            result = dict(payload["ready"])
            ok = result.get("status") in ("verified", "active") or result.get("applied")
            await self._tool_result({"toolUseId": tool_use["toolUseId"], "status": "success" if ok else "error",
                                     "content": [{"json": _wire(result)}]}, (), name="repair")
            await self._emit("tool_repair_ready", **self._repair_fields(result))
            return
        if "a2a" in payload:
            # The fixer's A2A task progress (status/artifact text) renders in the Repair chain.
            await self._tool_input(tool_use, ())
            await self._emit("tool_progress", id=tool_use["toolUseId"], name="repair", data=payload["a2a"])
            return
        if "event" in payload:
            await self._tool_input(tool_use, ())
            await self._translate({"tool_stream_event": {"tool_use": tool_use, "data": payload["event"]}})

    async def _tool_result(self, result: dict[str, Any], path: tuple[str, ...], *, name: str | None = None) -> None:
        tool_id = result.get("toolUseId", "")
        key = (path, tool_id)
        payload = _wire(result)
        if self._results.get(key) == payload:
            return
        self._results[key] = payload
        await self._emit("tool_result", node_path=path, id=tool_id, name=name,
                         status=result.get("status", "success"), content=result.get("content", []))

    async def _tool_input(self, use: dict[str, Any], path: tuple[str, ...]) -> None:
        key = (path, use.get("toolUseId", ""))
        payload = _wire(use)
        if self._inputs.get(key) == payload:
            return
        self._inputs[key] = payload
        self._tools_in_flight.add(str(use.get("toolUseId", "")))
        await self._emit("tool_input", node_path=path, id=key[1], name=use.get("name", ""), input=use.get("input", {}))

    async def _translate(self, event: Mapping[str, Any], path: tuple[str, ...] = ()) -> None:
        kind = event.get("type", "")
        if kind == "multiagent_node_stream":
            await self._translate(event["event"], (*path, str(event["node_id"])))
            return
        if "tool_stream_event" in event:
            stream = event["tool_stream_event"]
            use, data = stream["tool_use"], stream.get("data")
            if not path and self._background_id(use["toolUseId"]):
                # Callback is the authoritative channel for native background
                # progress; never mirror it into the foreground tool stream.
                return
            child_path = (*path, str(use["toolUseId"]))
            if isinstance(data, Mapping) and (any(key in data for key in (
                "event", "tool_stream_event", "current_tool_use", "message", "result", "delta",
                "tool_result", "tool_interrupt_event",
            )) or str(data.get("type", "")).startswith("multiagent_")):
                # panel_tools wraps formation/skill streams in {formation/skill, event}; native
                # ToolStreamEvents (e.g. a harness subagent) carry the child's SDK event
                # directly. Child events are re-emitted under node_path=[<tool use id>[, <formation name>]].
                if ("formation" in data or "skill" in data) and isinstance(data.get("event"), Mapping):
                    await self._translate(data["event"], (*child_path, str(data.get("formation", data.get("skill")))))
                else:
                    await self._translate(data, child_path)
            else:
                await self._emit("tool_progress", node_path=path, id=use["toolUseId"], name=use["name"], data=data)
            return
        if str(kind).startswith("multiagent_"):
            await self._emit("node_event", node_path=path, event=event)
            return
        if "tool_interrupt_event" in event:
            interrupt = event["tool_interrupt_event"]
            # The root AgentResult supplies the canonical complete interrupt set.
            # Nested interrupts still need a node-scoped envelope of their own.
            if path:
                await self._emit("interrupt", node_path=path, interrupts=interrupt["interrupts"],
                                 id=interrupt["tool_use"]["toolUseId"])
        # Native provider server-side tool events (PerplexityResponsesModel yields
        # {"perplexity": payload} and RonXAIModel yields {"xai": payload} chunks; Strands wraps
        # every raw chunk as {"event": chunk}). Forwarded verbatim for the panel's tool
        # cards; never part of the durable message history.
        raw = event.get("event")
        if isinstance(raw, Mapping) and isinstance(native := (raw.get("perplexity") or raw.get("xai")), Mapping):
            item = native.get("item") if isinstance(native.get("item"), Mapping) else None
            await self._emit("native_tool", node_path=path, event=str(native.get("type", "")),
                             item_type=item.get("type") if item else None, payload=native)
        # Raw provider chunks under 'event' duplicate SDK data/reasoningText.
        if "data" in event:
            await self._emit("text_delta", node_path=path, data=event["data"], **(self._model_scope() if not path else {}))
        if event.get("reasoningText") is not None:
            await self._emit("reasoning_delta", node_path=path, data=event["reasoningText"], **(self._model_scope() if not path else {}))
        if "current_tool_use" in event:
            await self._tool_input(event["current_tool_use"], path)
        if "tool_result" in event:
            await self._tool_result(event["tool_result"], path)
        for block in event.get("message", {}).get("content", []):
            if "toolResult" in block:
                await self._tool_result(block["toolResult"], path)
            if "toolUse" in block:
                await self._tool_input(block["toolUse"], path)
        if "event_loop_throttled_delay" in event:
            if not path:
                # SDK emits this AFTER AfterModelCallEvent for the same attempt.
                await self._model_retry("throttled", delay=event["event_loop_throttled_delay"])
            else:
                await self._emit("retry", node_path=path, reason="throttled", delay=event["event_loop_throttled_delay"])
        if path and "result" in event:
            await self._emit("node_event", node_path=path, event={"result": _wire(event["result"])})

    async def _stream(self, prompt: Any) -> AgentResult | None:
        assert self.agent is not None
        final = None
        async with aclosing(self.agent.stream_async(prompt, cancel_signal=self._cancel)) as stream:
            async for event in stream:
                if isinstance(event.get("result"), AgentResult):
                    final = event["result"]
                await self._translate(event)
        return final

    def _can_recover(self) -> bool:
        return self.recoveries < self._max_recoveries and not self._cancel.is_set() and self.factory is not None

    def _answered(self) -> bool:
        """The restored conversation already ends with the assistant's answer to this run."""
        assert self.agent is not None
        last = self.agent.messages[-1] if self.agent.messages else None
        return (self._run_input == [] and last is not None and last["role"] == "assistant"
                and not any("toolUse" in block for block in last["content"]))

    async def _run_attempt(self, recovery: tuple[str, Any] | None) -> AgentResult | None:
        """One cancellable attempt: the respawn a recovery asks for, then the native stream."""
        if recovery is not None:
            await self._respawn(*recovery)
            if self._answered():
                return None
        return await self._stream(self._run_input)

    async def _execute(self, restart: bool = False) -> None:
        try:
            async with self._lock:
                await self._persist()
            recovery: tuple[str, Any] | None = None
            if restart:
                recovery = ("restart", "The server restarted while the previous attempt was running.")
                async with self._lock:
                    self.status = "running"
            else:
                await self._ensure_agent()
                assert self.agent is not None
                if self.snapshot_id is None:
                    self.snapshot_id = await self.session_manager.save_snapshot(self.agent, is_latest=False)
                    await self.session_manager.save_snapshot(self.agent, is_latest=True)
                async with self._lock:
                    self.messages = _wire(self.agent.messages)
                    self.status = "running"
                    await self._emit_locked("run_started", model_id=self.selection.get("model_id"), provider=self.selection.get("provider"))
            final = None
            while not self._cancel.is_set():
                # The watchdog cancels only this task; a respawn that hangs is recovered like a stream.
                self._stall_reason = None
                self._last_event_at = time.monotonic()
                self._attempt_task = asyncio.create_task(self._run_attempt(recovery))
                try:
                    final = await self._attempt_task
                    break
                except asyncio.CancelledError:
                    # Only the watchdog cancels the attempt alone; cancelling the run is not a stall.
                    current = asyncio.current_task()
                    if self._stall_reason is None or (current and current.cancelling()) or not self._can_recover():
                        raise
                    recovery = ("stall", self._stall_reason)
                except ContextWindowOverflowException as overflow:
                    # The SDK already ran the conversation manager's reduce_context and retried.
                    if not self._can_recover():
                        raise
                    recovery = ("overflow", overflow)
                except Exception as failure:
                    # Timeouts reach here after the native retry strategy's attempts.
                    if not is_model_timeout(failure) or not self._can_recover():
                        raise
                    recovery = ("timeout", failure)
            async with self._lock:
                self.status = "finishing"
            await self._announce_repair_proposal()
            assert self.agent is not None
            answered = final is None and not self._cancel.is_set() and self._answered()
            if final is None and not self._cancel.is_set() and not answered:
                raise RuntimeError("Native stream ended without an AgentResult")
            stop = final.stop_reason if final else "end_turn" if answered else "cancelled"
            if self._closed and stop == "cancelled":
                # Shutdown: the journal keeps the run active, so the next process continues it.
                return
            status = {"checkpoint": "checkpointed", "interrupt": "interrupted", "cancelled": "cancelled"}.get(stop, "completed")
            if stop not in ("checkpoint", "interrupt", "cancelled", "end_turn", "stop_sequence"):
                status = "failed"
            await self._drain_callbacks()
            # Snapshot first, then one journal commit pairs it with pause metadata.
            async with self._lock:
                self.agent.state.set(STEERING_STATE_KEY, self.steering)
                snapshot_id = await self.session_manager.save_snapshot(self.agent, is_latest=False)
                await self.session_manager.save_snapshot(self.agent, is_latest=True)
                self.snapshot_id = snapshot_id
                self.messages = _wire(self.agent.messages)
                self.checkpoint = _wire(final.checkpoint) if final else None
                self.interrupts = _wire(final.interrupts or []) if final else []
                self.result = _wire(final)
                self.status = status
                if self.checkpoint is not None:
                    await self._emit_locked("checkpoint", checkpoint=self.checkpoint)
                if self.interrupts:
                    await self._emit_locked("interrupt", interrupts=self.interrupts)
                await self._emit_locked("run_finished", stop_reason=stop, status=status, result=self.result)
        except asyncio.CancelledError:
            if not self._closed:
                await self._fail(self._stall_reason or "The run was stopped before it finished.", cancelled=True)
        except Exception as error:
            await self._fail(error)
        finally:
            # This is admission of accepted user input after stream_async has
            # exited, not a replacement execution/retry loop. During native
            # execution AfterInvocationEvent.resume handles all continuations.
            async with self._lock:
                # Request context is scoped to the run that carried it; a steering
                # follow-up run must not inherit stale browser state.
                self.request_context = None
                self._wake_steering(finishing=True)
            self._changed.set()

    def _reserve(self, prompt: Any, *, request_context: str | None = None, restart: bool = False) -> None:
        """Atomic loop-local admission shared by start, idle steering and a restart's continuation
        (which keeps the interrupted run's id, input, replay cursor and recovery count)."""
        if not restart:
            self.run_id = uuid.uuid4().hex
            self.input = _wire(prompt)
            self.replay_after = self.sequence
            self.recoveries = 0
        self.status = "starting"
        self.error = None
        self.request_context = request_context or None
        self._run_input = prompt
        self._last_event_at = time.monotonic()
        self._cancel = threading.Event()
        self._results.clear()
        self._inputs.clear()
        self._background_results.clear()
        self._attempt = 0
        self._cycle = None
        self._model_attempt = 0
        self._retried = None
        self._tools_in_flight.clear()
        self._stall_reason = None
        self._attempt_task = None
        self._recovery_note = None
        self.task = asyncio.create_task(self._execute(restart), name=f"panel-{self.session_id}-{self.run_id}")
        self.task.add_done_callback(lambda done: None if done.cancelled() else done.exception())

    def _wake_steering(self, *, finishing: bool = False) -> None:
        if (not self._closed and not self.recovery_required and (not finishing or not self._cancel.is_set())
                and self.status in ("idle", "completed", "cancelled") and (finishing or not self.active)
                and any(record["status"] == "queued" for record in self.steering)):
            self._reserve([])

    async def _fail(self, error: Any, *, cancelled: bool = False) -> None:
        async with self._lock:
            self.status = "cancelled" if cancelled else "failed"
            # Preserve the history (including completed tools) so a new message or reload cannot
            # roll back and repeat side effects. The session always stays open: the next message
            # continues from this snapshot, or from the snapshot_latest the session manager saved
            # after the last message when this save fails.
            agent, drop = self.agent, cancelled
            if agent is not None:
                self.messages = _wire(agent.messages)
                agent.state.set(STEERING_STATE_KEY, self.steering)
                try:
                    snapshot_id = await asyncio.wait_for(self.session_manager.save_snapshot(agent, is_latest=False),
                                                         _DISPOSE_SECONDS)
                    await asyncio.wait_for(self.session_manager.save_snapshot(agent, is_latest=True), _DISPOSE_SECONDS)
                    self.snapshot_id = snapshot_id
                except Exception:
                    _LOGGER.exception("session_id=<%s> | saving the failed run's history failed", self.session_id)
                    self.snapshot_id, drop = None, True
            if drop and agent is not None:
                # A stopped instance may be wedged mid-call: the next message builds a fresh one.
                self.agent = None
                await self._dispose(agent)
            await self._emit_locked("error", error=_wire(error), recovery_required=False)
            await self._emit_locked("run_finished", stop_reason="cancelled" if cancelled else "error", status=self.status)

    async def _cancel_background(self) -> None:
        if self.agent is None:
            return
        tasks = self.agent.state.get(_BACKGROUND_STATE) or []
        tool = self.agent.tool_registry.registry.get(_BACKGROUND_TOOL)
        if tasks and tool is None:
            raise RuntimeError("Native background tasks exist without their SDK management tool")
        for task in tasks:
            if task["status"] in ("completed", "failed", "cancelled"):
                continue
            # Use the registered native AgentTool.stream public interface, which
            # also works while the host is interrupted (Agent.tool refuses that).
            use = {"toolUseId": uuid.uuid4().hex, "name": _BACKGROUND_TOOL,
                   "input": {"mode": "cancel", "task_id": task["task_id"]}}
            async for _ in tool.stream(use, invocation_state={"agent": self.agent}):
                pass

    async def close(self, timeout: float) -> None:
        if self._closed:
            return
        self._closed = True
        self._cancel.set()
        errors: list[Exception] = []
        try:
            if self.agent is not None:
                self.agent.cancel()
                try:
                    await self._cancel_background()
                except Exception as error:
                    errors.append(error)
            if self.task is not None and not self.task.done():
                try:
                    await asyncio.wait_for(asyncio.shield(self.task), timeout)
                except TimeoutError:
                    self.task.cancel()
                    await asyncio.gather(self.task, return_exceptions=True)
            if self.agent is not None:
                try:
                    await self._cancel_background()
                except Exception as error:
                    errors.append(error)
                if self.agent.memory_manager is not None:
                    await self.agent.memory_manager.flush()
        finally:
            try:
                if self.agent is not None:
                    await asyncio.to_thread(self.agent.cleanup)
            finally:
                with self._callback_lock:
                    self._callback_closed = True
                await self._drain_callbacks()
        if errors:
            raise ExceptionGroup("Native background cancellation failed", errors)


class PanelRuntimeManager:
    """Loop-local runtime registry; all entrypoints are asynchronous.

    storage_factory takes a user_id and returns user-scoped native Storage.
    factory may be specified here or per start/get (GET uses persisted config).
    """

    def __init__(
        self, *, factory: AgentFactory | None = None,
        storage_factory: Callable[[str], Storage] = get_user_session_storage,
        history_limit: int = 2048, history_bytes: int = 8 * 1024 * 1024,
        shutdown_timeout: float = 10.0,
        stall_seconds: float = 120.0, tool_stall_seconds: float = 480.0, max_recoveries: int = 2,
    ) -> None:
        if history_limit < 1 or history_bytes < 1 or shutdown_timeout <= 0:
            raise ValueError("History limits and shutdown timeout must be positive")
        if stall_seconds < 0 or tool_stall_seconds < 0 or max_recoveries < 0:
            raise ValueError("Stall windows and recovery budget must be nonnegative")
        self.factory, self.storage_factory = factory, storage_factory
        self.history_limit, self.history_bytes = history_limit, history_bytes
        self.shutdown_timeout = shutdown_timeout
        self.stall_seconds, self.tool_stall_seconds = stall_seconds, tool_stall_seconds
        self.max_recoveries = max_recoveries
        self._sessions: dict[tuple[str, str], SessionRun] = {}
        self._locks: dict[tuple[str, str], asyncio.Lock] = {}
        self._closed = False
        self._watchdog_task: asyncio.Task[None] | None = None

    def _key(self, user_id: str, session_id: str) -> tuple[str, str]:
        if not isinstance(user_id, str) or not user_id.strip():
            raise ValueError("user_id must be nonempty")
        if not isinstance(session_id, str) or not session_id.strip():
            raise ValueError("session_id must be nonempty")
        return user_id, session_id

    async def _get_locked(self, key: tuple[str, str], factory: AgentFactory | None, *, create: bool) -> SessionRun | None:
        if self._closed:
            raise RuntimeConflict("Runtime manager is shut down")
        session = self._sessions.get(key)
        if session is None:
            session = SessionRun(*key, self.storage_factory(key[0]), history_limit=self.history_limit,
                                 history_bytes=self.history_bytes, factory=factory or self.factory,
                                 max_recoveries=self.max_recoveries)
            exists = await session._load()
            if not exists and not create:
                return None
            self._sessions[key] = session
            if session._interrupted and session.factory is not None:
                self._ensure_watchdog()
                await session._resume_interrupted()
        elif factory is not None and session.factory is None:
            session.factory = factory
        return session

    async def get(self, user_id: str, session_id: str, *, factory: AgentFactory | None = None) -> SessionRun | None:
        key = self._key(user_id, session_id)
        async with self._locks.setdefault(key, asyncio.Lock()):
            session = await self._get_locked(key, factory, create=False)
            if session is not None and not session.active:
                await session._ensure_agent()
            return session

    async def start(
        self, user_id: str, session_id: str, message: Any = None, action: str = "message",
        interrupt_responses: list[dict[str, Any]] | None = None, *, factory: AgentFactory | None = None,
        selection: Mapping[str, Any] | None = None, options: Mapping[str, Any] | None = None,
        request_context: str | None = None,
    ) -> SessionRun:
        key = self._key(user_id, session_id)
        if action not in ("message", "resume", "interrupt"):
            raise ValueError("action must be message, resume, or interrupt")
        self._ensure_watchdog()
        async with self._locks.setdefault(key, asyncio.Lock()):
            session = await self._get_locked(key, factory, create=True)
            assert session is not None
            if session.active:
                raise RuntimeConflict("Session already has a reserved invocation")
            if session.recovery_required:
                raise RuntimeConflict("Session requires recovery; inspect snapshot and start a new session")
            for name, value in (("selection", selection), ("options", options)):
                if value is not None:
                    config = _config(value)
                    if session.run_id is not None and config != getattr(session, name):
                        raise RuntimeConflict(f"Session {name} cannot change; use a new session")
                    setattr(session, name, config)
            if session.factory is None:
                raise ValueError("An async agent factory is required")
            if action == "resume":
                if session.status != "checkpointed" or session.checkpoint is None:
                    raise RuntimeConflict("Session is not checkpointed")
                if message is not None or interrupt_responses:
                    raise ValueError("Queue steering separately; checkpoint resume takes no new input")
                prompt = {"checkpointResume": {"checkpoint": copy.deepcopy(session.checkpoint)}}
            elif action == "interrupt":
                if session.status != "interrupted":
                    raise RuntimeConflict("Session is not interrupted")
                if message is not None or not interrupt_responses:
                    raise ValueError("Interrupt resume requires native interruptResponse content blocks")
                expected = {item["id"] for item in session.interrupts}
                ids = [item.get("interruptResponse", {}).get("interruptId") for item in interrupt_responses]
                if len(set(ids)) != len(ids) or set(ids) != expected:
                    raise ValueError("Supply exactly one response for each pending interrupt")
                prompt = copy.deepcopy(interrupt_responses)
            else:
                if session.status in ("checkpointed", "interrupted"):
                    raise RuntimeConflict("Resume the paused session before sending a new message")
                if message is None or interrupt_responses:
                    raise ValueError("message action requires a message and no interrupt responses")
                prompt = copy.deepcopy(message)
            # Reservation is made BEFORE agent startup and persists independently
            # of the requesting HTTP task. Even cancellation of start's caller
            # cannot cancel the owned task or admit a second invocation.
            session._reserve(prompt, request_context=request_context)
            return session

    async def steer(
        self, user_id: str, session_id: str, message: str, *, steering_id: str | None = None,
    ) -> dict[str, Any]:
        if not isinstance(message, str) or not message.strip():
            raise ValueError("Steering message must be nonempty")
        session = await self.get(user_id, session_id)
        if session is None:
            raise KeyError("Unknown session")
        async with session._lock:
            if session._closed or session.recovery_required:
                raise RuntimeConflict("Session is closed or requires recovery")
            record_id = steering_id or uuid.uuid4().hex
            for record in session.steering:
                if record["id"] == record_id:
                    if record["message"] != message:
                        raise RuntimeConflict("Steering id already has different content")
                    return copy.deepcopy(record)
            record = {"id": record_id, "message": message, "status": "queued", "run_id": session.run_id}
            session.steering.append(record)
            if session.agent is not None:
                session.agent.state.set(STEERING_STATE_KEY, session.steering)
            await session._emit_locked("steering_accepted", id=record_id, message=message)
            session._wake_steering()
            return copy.deepcopy(record)

    async def cancel(self, user_id: str, session_id: str) -> dict[str, Any]:
        session = await self.get(user_id, session_id)
        if session is None:
            raise KeyError("Unknown session")
        session._cancel.set()
        if session.agent is not None:
            session.agent.cancel()
            await session._cancel_background()
        return {"session_id": session_id, "run_id": session.run_id, "cancel_requested": True}

    def _ensure_watchdog(self) -> None:
        """One loop-local stall watchdog; ``stall_seconds=0`` disables it entirely."""
        if self.stall_seconds <= 0 or self._closed:
            return
        if self._watchdog_task is None or self._watchdog_task.done():
            tick = max(1.0, min(15.0, self.stall_seconds / 4))
            self._watchdog_task = asyncio.create_task(self._watchdog(tick), name="panel-runtime-watchdog")

    def _stalled_for(self, session: SessionRun) -> float | None:
        """Seconds the run has been silent past its window, or None when it is healthy.

        A tool call in flight is legitimate silence (tools emit no events while executing),
        so it gets the longer tool window; everything else must produce events inside the
        plain stall window.
        """
        if session.status not in ("starting", "running") or session._closed:
            return None
        idle = time.monotonic() - session._last_event_at
        limit = self.tool_stall_seconds if session._tools_in_flight else self.stall_seconds
        return idle if idle > limit else None

    async def _watchdog(self, tick: float) -> None:
        while not self._closed:
            await asyncio.sleep(tick)
            for key, session in list(self._sessions.items()):
                try:
                    await self._recover_if_stalled(key, session)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    _LOGGER.exception("Stall recovery failed for session %s", session.session_id)

    async def _recover_if_stalled(self, key: tuple[str, str], session: SessionRun) -> None:
        """Stop a silent attempt so its run respawns the agent; hard-cancel a run that stays wedged.

        The first window cancels only the stream attempt (a wedged agent does not heed the
        cooperative cancel event); ``SessionRun._execute`` then continues the same run on a fresh
        agent. A window that passes outside an attempt (the run's startup I/O) cancels the run:
        it fails with the stall as its error and the session stays open for the next message.
        """
        async with self._locks.setdefault(key, asyncio.Lock()):
            idle = self._stalled_for(session)
            if idle is None or not session.active or session.task is None:
                return
            attempt = session._attempt_task
            if session._stall_reason is None and attempt is not None and not attempt.done():
                session._stall_reason = f"Run stalled (no activity for {idle:.0f}s)"
                session._last_event_at = time.monotonic()
                attempt.cancel()
                return
            session._stall_reason = f"Run stalled (no activity for {idle:.0f}s)"
            task = session.task
            task.cancel()
            done, _ = await asyncio.wait({task}, timeout=_DISPOSE_SECONDS)
            if not done:
                # A run that ignores asyncio cancellation cannot be recovered from the loop;
                # leave it to the existing shutdown/409 semantics instead of double-booking.
                _LOGGER.error("run_id=<%s> | stalled run ignored cancellation", session.run_id)

    async def snapshot(self, user_id: str, session_id: str, *, factory: AgentFactory | None = None) -> dict[str, Any]:
        session = await self.get(user_id, session_id, factory=factory)
        if session is None:
            raise KeyError("Unknown session")
        return await session.snapshot()

    async def shutdown(self) -> None:
        self._closed = True
        if self._watchdog_task is not None:
            self._watchdog_task.cancel()
            await asyncio.gather(self._watchdog_task, return_exceptions=True)
        # Join GET construction and registry loads admitted before the close fence.
        # New callers cannot pass _get_locked once the fence is set.
        for lock in list(self._locks.values()):
            async with lock:
                pass
        results = await asyncio.gather(*(session.close(self.shutdown_timeout) for session in self._sessions.values()),
                                       return_exceptions=True)
        errors = [result for result in results if isinstance(result, Exception)]
        if errors:
            raise ExceptionGroup("Panel runtime shutdown failed", errors)
