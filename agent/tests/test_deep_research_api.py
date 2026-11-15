"""Tests for Deep Research HTTP/SSE endpoints, async Strands tools, and 8-root agent integration.

Covers:
1. Loopback-only enforcement on every ``/deep-research/*`` route (403 on non-loopback IP) and
   guarantee that ``/deep-research`` is never on ``public_tunnel``'s ngrok allowlist.
2. Full REST + SSE surface: ``GET /status``, ``POST /runs``, ``GET /runs``, ``GET /runs/{id}``,
   ``GET /runs/{id}/events`` (SSE frames, ``after`` replay cursor, ``Last-Event-ID``, 410 on
   ``ReplayOverflow``, 422 on ``after < 0``, 404 on unknown), ``POST /runs/{id}/cancel``,
   ``DELETE /runs/{id}``, and kill-switch ``RON_DEEP_RESEARCH_ENABLED=0``.
3. Native async ``@tool``s (``deep_research_start``, ``deep_research_status``,
   ``deep_research_cancel``): immediate non-blocking return while a formation is executing in the
   background, plain-JSON ``ToolResult`` wrapping (zero image blocks, zero interrupts, compatible
   with ``BidiAgent`` and ``UnattendedRunGuard``), listing vs per-run status -> completed
   ``report_markdown``, cancellation, and ``is_parent_only_tool`` / ``ThinkToolsGuard`` exclusion.
4. Registration of ``DEEP_RESEARCH_TOOL_NAMES`` across ALL 8 Ren agent composition roots:
   - Agent Panel (``create_panel_agent``: ``panel``, ``document``, ``context``, ``search``)
   - Gemini Live ``BidiAgent`` (``live_tools.build_live_tools``: ``panel`` and ``issue:<uuid>``)
   - Specialist / Harness Agents (``harness_agents.build_specialist``) & Context Agent prompt
   - Project Agent (``chat._create_runtime_agent`` w/ ``kind="project"`` + ``project_agent_prompt``)
   - Issue Chat Agent (``issue_agents.create_issue_chat_agent``)
   - Autonomous Issue Agent (``issue_agents.IssueAgentRuntime``)
   - Build Agent (``build_agent.create_build_agent``)
   - Browser Search Agent (``search_agent.create_search_agent``)
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import tempfile
import time
import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, cast

import httpx
import pytest
from fastapi import FastAPI
from strands import Agent
from strands.models.model import Model
from strands.storage import InMemoryStorage

from agent.api.core import config as app_config
from agent.api.core import panel_storage, public_tunnel
from agent.api.core.deep_research_tools import (
    DEEP_RESEARCH_DIRECTIVE,
    DEEP_RESEARCH_TOOL_NAMES,
    deep_research_tools,
    is_deep_research_tool,
)
from agent.api.core.panel_tools import ThinkToolsGuard, is_parent_only_tool
from agent.api.endpoints import deep_research as deep_research_ep


class StubTextModel(Model):
    """Offline Strands ``Model`` double for fast agent composition & tool-call tests."""

    def __init__(self, reply: str = "ok") -> None:
        self.reply = reply
        self.calls: list[dict[str, Any]] = []

    def get_config(self) -> dict[str, Any]:
        return {
            "model_id": "stub-offline-model",
            "stateful": False,
            "context_window_limit": 200_000,
        }

    def update_config(self, **kwargs: Any) -> None:
        return None

    async def structured_output(self, *args: Any, **kwargs: Any):
        raise NotImplementedError
        yield

    async def stream(
        self, messages: Any, tool_specs: Any = None, system_prompt: Any = None, **kwargs: Any
    ) -> AsyncIterator[Any]:
        self.calls.append(
            {
                "messages": messages,
                "tools": list(tool_specs or []),
                "system_prompt": system_prompt or "",
            }
        )
        yield {"messageStart": {"role": "assistant"}}
        yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": self.reply}}}
        yield {"contentBlockStop": {"contentBlockIndex": 0}}
        yield {"messageStop": {"stopReason": "end_turn"}}


class GatedResearchRuntime:
    """Deterministic in-memory ``DeepResearchRuntime`` test double with controllable stage gates
    and ``ReplayOverflow`` injection for verifying immediate non-blocking returns and HTTP/SSE edges.
    """

    def __init__(self, *, overflow_before: int = 0, artifacts_dir: Path | None = None) -> None:
        self._runs: dict[tuple[str, str], dict[str, Any]] = {}
        self._owners_by_session: dict[str, str] = {}
        self._events: dict[tuple[str, str], list[dict[str, Any]]] = {}
        self._tasks: dict[tuple[str, str], asyncio.Task[None]] = {}
        self._gates: dict[str, asyncio.Event] = {}
        self._ready: dict[str, asyncio.Event] = {}
        self._tmp_dir = tempfile.TemporaryDirectory() if artifacts_dir is None else None
        self.artifacts_dir: Path = artifacts_dir or Path(self._tmp_dir.name)  # type: ignore[union-attr]
        self.overflow_before = overflow_before
        self.closed = False

    def hold_session(self, session_id: str) -> asyncio.Event:
        gate = asyncio.Event()
        self._gates[session_id] = gate
        self._ready[session_id] = asyncio.Event()
        return gate

    async def wait_executing(self, session_id: str) -> None:
        ev = self._ready.get(session_id)
        if ev is not None:
            await asyncio.wait_for(ev.wait(), timeout=2.0)

    def _emit(self, key: tuple[str, str], event_type: str, **fields: Any) -> dict[str, Any]:
        snap = self._runs[key]
        seq = int(snap["sequence"]) + 1
        now = datetime.now(timezone.utc).isoformat()
        snap["sequence"] = seq
        snap["updated_at"] = now
        event = {
            "version": 1,
            "sequence": seq,
            "session_id": snap["session_id"],
            "type": event_type,
            "node_path": fields.pop("node_path", list(snap["active_node_path"])),
            "timestamp": now,
            **fields,
        }
        self._events[key].append(event)
        return event

    async def start_run(
        self,
        *,
        user_id: str,
        query: str,
        session_id: str | None = None,
        context: str | None = None,
        depth: str = "deep",
        provider: str | None = None,
        model_id: str | None = None,
        reasoning_effort: str | None = None,
    ) -> dict[str, Any]:
        sid = session_id or f"dr-{uuid.uuid4().hex[:10]}"
        now = datetime.now(timezone.utc).isoformat()
        key = (user_id, sid)
        snap: dict[str, Any] = {
            "version": 1,
            "session_id": sid,
            "user_id": user_id,
            "query": query,
            "context": context,
            "title": query[:64],
            "depth": depth,
            "status": "executing",
            "active": True,
            "created_at": now,
            "updated_at": now,
            "completed_at": None,
            "selection": {
                "provider": provider or "gemini",
                "model_id": model_id or "gemini-3.5-pro",
                "reasoning_effort": reasoning_effort,
            },
            "sequence": 0,
            "replay_after": 0,
            "active_node_path": ["planning_formation", "problem_framing"],
            "completed_nodes": [],
            "failed_nodes": [],
            "execution_order": ["planning_formation/problem_framing"],
            "nodes": {
                "planning_formation/problem_framing": {
                    "node_id": "problem_framing",
                    "node_path": ["planning_formation", "problem_framing"],
                    "node_type": "agent",
                    "status": "executing",
                    "started_at": now,
                    "completed_at": None,
                    "execution_time_ms": 0,
                    "execution_count": 1,
                    "skills_used": ["domain-landscape-scan"],
                    "output_preview": "",
                }
            },
            "handoffs": [],
            "citations": [],
            "usage": {"inputTokens": 0, "outputTokens": 0, "totalTokens": 0},
            "execution_time_ms": 0,
            "report_markdown": None,
            "slidev_markdown": None,
            "artifacts": {},
            "summary": None,
            "error": None,
        }
        self._runs[key] = snap
        self._owners_by_session[sid] = user_id
        self._events[key] = []
        self._emit(key, "run_started", query=query, depth=depth, node_path=[])
        self._emit(
            key,
            "node_start",
            node_id="problem_framing",
            node_type="agent",
            node_path=["planning_formation", "problem_framing"],
        )

        async def _worker() -> None:
            ready = self._ready.get(sid)
            if ready is not None:
                ready.set()
            gate = self._gates.get(sid)
            if gate is not None:
                await gate.wait()
            else:
                await asyncio.sleep(0.01)
            if snap["status"] == "cancelled":
                return
            done_at = datetime.now(timezone.utc).isoformat()
            snap["active_node_path"] = []
            snap["completed_nodes"] = [
                "planning_formation",
                "investigation_formation",
                "verification_swarm",
                "synthesis_formation",
            ]
            snap["citations"] = [
                {
                    "url": "https://example.org/primary-study",
                    "title": "Primary Study on Solid-State Electrolytes",
                    "snippet": "Verified energy density benchmark.",
                    "source": "example.org",
                }
            ]
            snap["usage"] = {"inputTokens": 420, "outputTokens": 310, "totalTokens": 730}
            snap["execution_time_ms"] = 145
            snap["summary"] = f"Executive synthesis for: {query}"
            snap["report_markdown"] = (
                f"# Executive Report: {query}\n\n"
                "Verified synthesis citing [Primary Study](https://example.org/primary-study)."
            )
            snap["slidev_markdown"] = (
                "---\ntheme: default\nrouterMode: hash\n---\n\n"
                f"# {query[:48]}\n\nExecutive Research Deck\n\n---\n\n"
                "## Key Findings\n\n- Solid-state electrolyte stability verified\n"
            )
            run_art_dir = self.artifacts_dir / sid
            (run_art_dir / "slides" / "assets").mkdir(parents=True, exist_ok=True)
            (run_art_dir / "report.pdf").write_bytes(b"%PDF-1.4\n%Test Scholarly Report PDF\n%%EOF\n")
            (run_art_dir / "report.md").write_text(snap["report_markdown"], encoding="utf-8")
            (run_art_dir / "slides.md").write_text(snap["slidev_markdown"], encoding="utf-8")
            (run_art_dir / "slides.pdf").write_bytes(b"%PDF-1.4\n%Test Slidev Deck PDF\n%%EOF\n")
            (run_art_dir / "slides" / "index.html").write_text(
                '<!doctype html><html><head><link rel="stylesheet" href="./assets/style.css"></head>'
                '<body><div id="app">Slide 1</div><script type="module" src="./assets/app.js"></script></body></html>',
                encoding="utf-8",
            )
            (run_art_dir / "slides" / "assets" / "app.js").write_text(
                "console.log('slidev hash router active');\n",
                encoding="utf-8",
            )
            (run_art_dir / "slides" / "assets" / "style.css").write_text(
                "body { margin: 0; font-family: sans-serif; }\n",
                encoding="utf-8",
            )
            base_url = f"/deep-research/runs/{sid}/artifacts"
            snap["artifacts"] = {
                "report_pdf_url": f"{base_url}/report.pdf",
                "report_markdown_url": f"{base_url}/report.md",
                "slidev_preview_url": f"{base_url}/slides/index.html",
                "slidev_pdf_url": f"{base_url}/slides.pdf",
                "slidev_markdown_url": f"{base_url}/slides.md",
            }
            snap["status"] = "completed"
            snap["active"] = False
            snap["completed_at"] = done_at
            self._emit(
                key,
                "citation",
                url="https://example.org/primary-study",
                title="Primary Study on Solid-State Electrolytes",
                snippet="Verified energy density benchmark.",
                source="example.org",
                node_path=["investigation_formation", "web_intelligence"],
            )
            self._emit(
                key,
                "text_delta",
                text=snap["report_markdown"],
                node_path=["synthesis_formation", "executive_editor"],
            )
            self._emit(
                key,
                "artifact_ready",
                kind="report_pdf",
                artifacts=dict(snap["artifacts"]),
                node_path=["synthesis_formation", "pdf_publisher"],
            )
            self._emit(
                key,
                "artifact_ready",
                kind="slidev_deck",
                artifacts=dict(snap["artifacts"]),
                node_path=["synthesis_formation", "slidev_producer"],
            )
            self._emit(
                key,
                "run_finished",
                status="completed",
                summary=snap["summary"],
                report_markdown=snap["report_markdown"],
                slidev_markdown=snap["slidev_markdown"],
                artifacts=dict(snap["artifacts"]),
                node_path=[],
            )

        self._tasks[key] = asyncio.create_task(_worker())
        return dict(snap)

    async def get_run(
        self,
        *,
        user_id: str,
        session_id: str,
        include_report: bool = True,
    ) -> dict[str, Any] | None:
        snap = self._runs.get((user_id, session_id))
        if snap is None:
            return None
        copy_snap = dict(snap)
        if not include_report:
            copy_snap["report_markdown"] = None
            copy_snap["slidev_markdown"] = None
        return copy_snap

    def resolve_artifact_path(
        self,
        *,
        session_id: str,
        relative_path: str,
        user_id: str | None = None,
    ) -> Path | None:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", session_id or ""):
            return None
        if (
            not relative_path
            or "\x00" in relative_path
            or "\\" in relative_path
            or relative_path.startswith("/")
            or ".." in PurePosixPath(relative_path).parts
        ):
            return None
        owner = self._owners_by_session.get(session_id)
        if user_id and user_id != "default" and owner is not None and owner != user_id:
            return None
        session_root = os.path.realpath(self.artifacts_dir / session_id)
        candidate = os.path.realpath(os.path.join(session_root, relative_path))
        try:
            if os.path.commonpath([session_root, candidate]) != session_root:
                return None
        except ValueError:
            return None
        target = Path(candidate)
        return target if target.is_file() else None

    async def list_runs(self, *, user_id: str, limit: int = 50) -> list[dict[str, Any]]:
        matching = [dict(v) for (uid, _), v in self._runs.items() if uid == user_id]
        matching.sort(key=lambda item: str(item["created_at"]), reverse=True)
        return matching[:limit]

    async def cancel_run(self, *, user_id: str, session_id: str) -> dict[str, Any] | None:
        key = (user_id, session_id)
        snap = self._runs.get(key)
        if snap is None:
            return None
        snap["status"] = "cancelled"
        snap["active"] = False
        snap["active_node_path"] = []
        snap["completed_at"] = datetime.now(timezone.utc).isoformat()
        self._emit(key, "run_finished", status="cancelled", node_path=[])
        gate = self._gates.get(session_id)
        if gate is not None:
            gate.set()
        task = self._tasks.get(key)
        if task is not None and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        return dict(snap)

    async def delete_run(self, *, user_id: str, session_id: str) -> bool:
        key = (user_id, session_id)
        if key not in self._runs:
            return False
        await self.cancel_run(user_id=user_id, session_id=session_id)
        self._runs.pop(key, None)
        self._events.pop(key, None)
        self._tasks.pop(key, None)
        return True

    async def events(
        self,
        *,
        user_id: str,
        session_id: str,
        after: int = 0,
    ) -> AsyncIterator[dict[str, Any]]:
        from agent.api.core.deep_research import ReplayOverflow

        key = (user_id, session_id)
        if key not in self._runs:
            raise KeyError(session_id)
        if self.overflow_before and after < self.overflow_before:
            latest = int(self._runs[key]["sequence"])
            raise ReplayOverflow(after, self.overflow_before, latest)
        idx = 0
        while True:
            buf = self._events.get(key, [])
            while idx < len(buf):
                ev = buf[idx]
                idx += 1
                if int(ev["sequence"]) > after:
                    yield ev
            if not self._runs[key]["active"] and idx >= len(self._events.get(key, [])):
                break
            await asyncio.sleep(0.01)

    async def sse(
        self,
        *,
        user_id: str,
        session_id: str,
        after: int = 0,
    ) -> AsyncIterator[str]:
        async for ev in self.events(user_id=user_id, session_id=session_id, after=after):
            yield f"id: {ev['sequence']}\ndata: {json.dumps(ev, ensure_ascii=False)}\n\n"

    async def wait_run(
        self,
        *,
        user_id: str,
        session_id: str,
        timeout: float | None = None,
    ) -> dict[str, Any] | None:
        task = self._tasks.get((user_id, session_id))
        if task is not None:
            await asyncio.wait_for(asyncio.shield(task), timeout=timeout)
        return await self.get_run(user_id=user_id, session_id=session_id)

    async def aclose(self) -> None:
        self.closed = True
        for gate in self._gates.values():
            gate.set()
        for task in list(self._tasks.values()):
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks.values(), return_exceptions=True)
        if self._tmp_dir is not None:
            self._tmp_dir.cleanup()


def _parse_sse_frames(raw_text: str) -> list[tuple[int | None, str | None, dict[str, Any]]]:
    frames: list[tuple[int | None, str | None, dict[str, Any]]] = []
    for block in raw_text.split("\n\n"):
        lines = [ln for ln in block.splitlines() if ln.strip()]
        if not lines:
            continue
        seq_id: int | None = None
        ev_name: str | None = None
        data_raw: str | None = None
        for ln in lines:
            if ln.startswith("id:"):
                seq_id = int(ln.removeprefix("id:").strip())
            elif ln.startswith("event:"):
                ev_name = ln.removeprefix("event:").strip()
            elif ln.startswith("data:"):
                data_raw = ln.removeprefix("data:").strip()
        if data_raw is not None:
            frames.append((seq_id, ev_name, json.loads(data_raw)))
    return frames


@pytest.fixture
def isolated_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    from agent.api.core import teaching

    monkeypatch.setenv("PROJECTS_GUEST_DB", str(tmp_path / "projects.db"))
    monkeypatch.setenv("TEACHING_STORAGE_DIR", str(tmp_path / "teaching"))
    monkeypatch.setattr(teaching, "_service", None)
    monkeypatch.setattr(panel_storage, "_storage", InMemoryStorage())
    monkeypatch.setattr(app_config, "RON_DEEP_RESEARCH_ENABLED", True)
    monkeypatch.setenv("RON_DEEP_RESEARCH_ENABLED", "1")


# ---------------------------------------------------------------------------
# 1. Loopback & Public Tunnel Security Boundaries
# ---------------------------------------------------------------------------


def test_deep_research_never_on_ngrok_allowlist(monkeypatch: pytest.MonkeyPatch):
    assert all(not p.startswith("/deep-research") for p in public_tunnel.DEFAULT_ALLOW_PATHS)
    monkeypatch.delenv("RON_NGROK_ALLOW_PATHS", raising=False)
    allowed = public_tunnel.allowed_paths()
    assert all(not p.startswith("/deep-research") for p in allowed)
    assert "/deep-research" not in public_tunnel.traffic_policy(allowed)


def test_deep_research_routes_enforce_loopback_403(isolated_env):
    from agent.api.core.deep_research import set_deep_research_runtime

    rt = GatedResearchRuntime()
    set_deep_research_runtime(cast(Any, rt))
    app = FastAPI()
    app.state.deep_research = rt
    app.include_router(deep_research_ep.router)

    async def scenario() -> None:
        try:
            transport = httpx.ASGITransport(app=app, client=("203.0.113.42", 52100))
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as remote:
                assert (await remote.get("/deep-research/status")).status_code == 403
                assert (await remote.post("/deep-research/runs", json={"query": "battery tech"})).status_code == 403
                assert (await remote.get("/deep-research/runs")).status_code == 403
                assert (await remote.get("/deep-research/runs/s1")).status_code == 403
                assert (await remote.get("/deep-research/runs/s1/artifacts/report.pdf")).status_code == 403
                assert (await remote.get("/deep-research/runs/s1/events")).status_code == 403
                assert (await remote.post("/deep-research/runs/s1/cancel")).status_code == 403
                assert (await remote.delete("/deep-research/runs/s1")).status_code == 403
        finally:
            await rt.aclose()
            set_deep_research_runtime(None)

    asyncio.run(scenario())


# ---------------------------------------------------------------------------
# 2. HTTP + SSE Endpoint Lifecycle, Validation, Replay Cursor & Kill-Switch
# ---------------------------------------------------------------------------


def test_deep_research_endpoints_lifecycle_sse_replay_and_kill_switch(
    isolated_env, monkeypatch: pytest.MonkeyPatch
):
    from agent.api.core.deep_research import set_deep_research_runtime

    rt = GatedResearchRuntime()
    set_deep_research_runtime(cast(Any, rt))
    app = FastAPI()
    app.state.deep_research = rt
    app.include_router(deep_research_ep.router)

    async def scenario() -> None:
        try:
            transport = httpx.ASGITransport(app=app, client=("127.0.0.1", 52101))
            async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as client:
                # GET /status
                status_res = await client.get("/deep-research/status")
                assert status_res.status_code == 200
                status_body = status_res.json()
                assert status_body["available"] is True
                assert status_body["depths"] == ["standard", "deep", "exhaustive"]
                assert status_body["topology"]["id"] == "deep_research_graph"
                assert len(status_body["topology"]["nodes"]) == 4

                # Validation: blank query -> 422, invalid depth -> 422, negative after -> 422
                assert (await client.post("/deep-research/runs", json={"query": "   "})).status_code == 422
                assert (
                    await client.post(
                        "/deep-research/runs",
                        json={"query": "solid state", "depth": "ludicrous"},
                    )
                ).status_code == 422

                # Launch a gated run for alice
                gate = rt.hold_session("run-alice-1")
                create_res = await client.post(
                    "/deep-research/runs",
                    json={
                        "query": "Solid-state lithium-metal electrolyte interfaces",
                        "user_id": "alice",
                        "session_id": "run-alice-1",
                        "context": "Focus on 2025-2026 peer-reviewed benchmarks",
                        "depth": "exhaustive",
                    },
                )
                assert create_res.status_code == 200
                created = create_res.json()
                assert created["session_id"] == "run-alice-1"
                assert created["user_id"] == "alice"
                assert created["depth"] == "exhaustive"
                assert created["active"] is True

                # User isolation on GET /runs and GET /runs/{id}
                alice_list = (await client.get("/deep-research/runs", params={"user_id": "alice"})).json()
                bob_list = (await client.get("/deep-research/runs", params={"user_id": "bob"})).json()
                assert [r["session_id"] for r in alice_list["runs"]] == ["run-alice-1"]
                assert bob_list["runs"] == []
                assert (
                    await client.get("/deep-research/runs/run-alice-1", params={"user_id": "bob"})
                ).status_code == 404

                # Negative cursor -> 422; unknown session -> 404
                assert (
                    await client.get(
                        "/deep-research/runs/run-alice-1/events",
                        params={"user_id": "alice", "after": -1},
                    )
                ).status_code == 422
                assert (
                    await client.get(
                        "/deep-research/runs/missing/events",
                        params={"user_id": "alice"},
                    )
                ).status_code == 404

                # Release the gate so the run finishes and emits all SSE events
                gate.set()
                await rt.wait_run(user_id="alice", session_id="run-alice-1", timeout=3.0)

                # Full SSE stream from after=0
                sse_res = await client.get(
                    "/deep-research/runs/run-alice-1/events",
                    params={"user_id": "alice", "after": 0},
                )
                assert sse_res.status_code == 200
                assert sse_res.headers["content-type"].startswith("text/event-stream")
                assert sse_res.headers["cache-control"] == "no-cache"
                assert sse_res.headers["x-accel-buffering"] == "no"
                frames = _parse_sse_frames(sse_res.text)
                seqs = [seq for seq, _, _ in frames]
                types = [payload["type"] for _, _, payload in frames]
                assert seqs == list(range(1, len(frames) + 1))
                assert types[0] == "run_started"
                assert "citation" in types
                assert types[-1] == "run_finished"

                # Replay cursor: after=2 returns only events strictly after sequence 2
                replay_res = await client.get(
                    "/deep-research/runs/run-alice-1/events",
                    params={"user_id": "alice", "after": 2},
                )
                assert replay_res.status_code == 200
                replay_frames = _parse_sse_frames(replay_res.text)
                assert [seq for seq, _, _ in replay_frames] == [s for s in seqs if s is not None and s > 2]

                # Last-Event-ID header fallback works identically
                header_res = await client.get(
                    "/deep-research/runs/run-alice-1/events",
                    params={"user_id": "alice"},
                    headers={"Last-Event-ID": "3"},
                )
                assert header_res.status_code == 200
                header_frames = _parse_sse_frames(header_res.text)
                assert [seq for seq, _, _ in header_frames] == [s for s in seqs if s is not None and s > 3]

                # ReplayOverflow -> HTTP 410 Gone
                rt.overflow_before = 3
                overflow_res = await client.get(
                    "/deep-research/runs/run-alice-1/events",
                    params={"user_id": "alice", "after": 1},
                )
                assert overflow_res.status_code == 410
                assert overflow_res.json()["detail"]["code"] == "replay_overflow"
                rt.overflow_before = 0

                # Cancel active run (both query param and JSON body supported)
                rt.hold_session("run-cancel-me")
                await client.post(
                    "/deep-research/runs",
                    json={"query": "Cancelable topic", "user_id": "alice", "session_id": "run-cancel-me"},
                )
                await rt.wait_executing("run-cancel-me")
                cancel_res = await client.post(
                    "/deep-research/runs/run-cancel-me/cancel",
                    params={"user_id": "alice"},
                )
                assert cancel_res.status_code == 200
                assert cancel_res.json()["status"] == "cancelled"
                assert cancel_res.json()["active"] is False
                assert (
                    await client.post("/deep-research/runs/unknown-id/cancel", json={"user_id": "alice"})
                ).status_code == 404

                # Delete run -> 200 then 404
                del_res = await client.delete(
                    "/deep-research/runs/run-alice-1",
                    params={"user_id": "alice"},
                )
                assert del_res.status_code == 200
                assert del_res.json() == {"deleted": True, "session_id": "run-alice-1"}
                assert (
                    await client.delete("/deep-research/runs/run-alice-1", params={"user_id": "alice"})
                ).status_code == 404

                # Kill-switch RON_DEEP_RESEARCH_ENABLED=0
                monkeypatch.setenv("RON_DEEP_RESEARCH_ENABLED", "0")
                disabled_status = (await client.get("/deep-research/status")).json()
                assert disabled_status["available"] is False
                disabled_post = await client.post("/deep-research/runs", json={"query": "blocked"})
                assert disabled_post.status_code == 503
                assert deep_research_tools(user_id="alice") == []
        finally:
            await rt.aclose()
            set_deep_research_runtime(None)

    asyncio.run(scenario())


# ---------------------------------------------------------------------------
# 2b. Artifact Serving (PDF Inline & Download, Slidev Sub-Assets, Traversal)
# ---------------------------------------------------------------------------


def test_deep_research_artifact_serving_inline_download_subassets_and_traversal(
    isolated_env, tmp_path: Path
):
    from agent.api.core.deep_research import set_deep_research_runtime

    secret_file = tmp_path / "outside-secret.txt"
    secret_file.write_text("TOP_SECRET", encoding="utf-8")
    rt = GatedResearchRuntime(artifacts_dir=tmp_path / "artifacts")
    set_deep_research_runtime(cast(Any, rt))
    app = FastAPI()
    app.state.deep_research = rt
    app.include_router(deep_research_ep.router)

    async def scenario() -> None:
        try:
            transport = httpx.ASGITransport(app=app, client=("127.0.0.1", 52102))
            async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as client:
                await client.post(
                    "/deep-research/runs",
                    json={
                        "query": "Next-gen HBM4 packaging architectures",
                        "user_id": "alice",
                        "session_id": "art-session-1",
                    },
                )
                await rt.wait_run(user_id="alice", session_id="art-session-1", timeout=3.0)

                # Symlink inside session dir pointing outside -> must be rejected by realpath/commonpath!
                symlink_escape = rt.artifacts_dir / "art-session-1" / "escape.txt"
                symlink_escape.symlink_to(secret_file)

                # 1. Inline PDF (`download` omitted/false -> no attachment Content-Disposition, iframe-embeddable)
                pdf_inline = await client.get(
                    "/deep-research/runs/art-session-1/artifacts/report.pdf",
                    params={"user_id": "alice"},
                )
                assert pdf_inline.status_code == 200
                assert pdf_inline.headers["content-type"] == "application/pdf"
                assert "attachment" not in pdf_inline.headers.get("content-disposition", "")
                assert pdf_inline.content.startswith(b"%PDF-1.4")

                # 2. Download PDF (`?download=true` -> Content-Disposition: attachment; filename="report.pdf")
                pdf_dl = await client.get(
                    "/deep-research/runs/art-session-1/artifacts/report.pdf",
                    params={"user_id": "alice", "download": "true"},
                )
                assert pdf_dl.status_code == 200
                assert pdf_dl.headers["content-type"] == "application/pdf"
                assert 'attachment; filename="report.pdf"' in pdf_dl.headers.get("content-disposition", "")

                # 3. Slidev static SPA `slides/index.html` + relative sub-assets WITHOUT `user_id` query param!
                deck_html = await client.get("/deep-research/runs/art-session-1/artifacts/slides/index.html")
                assert deck_html.status_code == 200
                assert deck_html.headers["content-type"].startswith("text/html")
                assert "./assets/app.js" in deck_html.text

                deck_js = await client.get("/deep-research/runs/art-session-1/artifacts/slides/assets/app.js")
                assert deck_js.status_code == 200
                assert deck_js.headers["content-type"].startswith("text/javascript")
                assert "slidev hash router active" in deck_js.text

                deck_css = await client.get("/deep-research/runs/art-session-1/artifacts/slides/assets/style.css")
                assert deck_css.status_code == 200
                assert deck_css.headers["content-type"].startswith("text/css")

                deck_md = await client.get(
                    "/deep-research/runs/art-session-1/artifacts/slides.md",
                    params={"download": "true"},
                )
                assert deck_md.status_code == 200
                assert deck_md.headers["content-type"].startswith("text/markdown")
                assert 'attachment; filename="slides.md"' in deck_md.headers.get("content-disposition", "")

                # 4. Ownership check when explicit non-default `user_id` is passed
                wrong_user = await client.get(
                    "/deep-research/runs/art-session-1/artifacts/report.pdf",
                    params={"user_id": "bob"},
                )
                assert wrong_user.status_code == 404

                # 5. Path traversal & symlink escape defenses
                for bad_path in (
                    "%2e%2e/outside-secret.txt",
                    "slides/%2e%2e/%2e%2e/outside-secret.txt",
                    "..%5coutside-secret.txt",
                    "escape.txt",
                    "nonexistent.pdf",
                ):
                    bad_res = await client.get(f"/deep-research/runs/art-session-1/artifacts/{bad_path}")
                    assert bad_res.status_code == 404, f"Expected 404 for {bad_path}, got {bad_res.status_code}"
                    assert b"TOP_SECRET" not in bad_res.content
        finally:
            await rt.aclose()
            set_deep_research_runtime(None)

    asyncio.run(scenario())


# ---------------------------------------------------------------------------
# 3. Native Async Agent Tools (Immediate Non-Blocking Return, Plain JSON, Guards)
# ---------------------------------------------------------------------------


def test_async_deep_research_tools_non_blocking_progress_cancel_and_plain_json_result(isolated_env):
    from agent.api.core.deep_research import set_deep_research_runtime

    rt = GatedResearchRuntime()
    set_deep_research_runtime(cast(Any, rt))

    async def scenario() -> None:
        try:
            tools_by_name = {t.tool_name: t for t in deep_research_tools(user_id="researcher-1")}
            assert set(tools_by_name) == set(DEEP_RESEARCH_TOOL_NAMES)

            start_fn: Any = tools_by_name["deep_research_start"]
            status_fn: Any = tools_by_name["deep_research_status"]
            cancel_fn: Any = tools_by_name["deep_research_cancel"]

            # Hold the formation so it CANNOT finish during deep_research_start!
            # Monkeypatch start_run session_id or pre-hold via wrapper:
            orig_start = rt.start_run
            gate = asyncio.Event()

            async def _held_start(**kwargs: Any) -> dict[str, Any]:
                sid = kwargs.get("session_id") or "held-session-1"
                rt._gates[sid] = gate
                rt._ready[sid] = asyncio.Event()
                kwargs["session_id"] = sid
                return await orig_start(**kwargs)

            rt.start_run = _held_start  # type: ignore[method-assign]

            t0 = time.monotonic()
            started = await start_fn(
                query="Photonic interconnects for rack-scale AI clusters",
                context="Compare co-packaged optics vs pluggable transceivers",
                depth="deep",
            )
            elapsed = time.monotonic() - t0
            assert elapsed < 0.25, f"deep_research_start blocked for {elapsed:.3f}s"
            assert started["session_id"] == "held-session-1"
            assert started["status"] == "executing"
            assert started["depth"] == "deep"
            assert started["url"] == "ron://research/held-session-1"
            assert started["active_node_path"] == ["planning_formation", "problem_framing"]
            assert "ron://research/held-session-1" in started["message"]
            # Crucial BidiAgent / Strands invariant: NO "content" key in raw dict!
            assert "content" not in started

            # Listing mode (session_id="") while run is still executing
            listed = await status_fn()
            assert "runs" in listed and len(listed["runs"]) == 1
            assert listed["runs"][0]["session_id"] == "held-session-1"
            assert listed["runs"][0]["active"] is True

            # Live progress check while still executing
            in_flight = await status_fn(session_id="held-session-1")
            assert in_flight["status"] == "executing"
            assert in_flight["active"] is True
            assert in_flight["active_node_path"] == ["planning_formation", "problem_framing"]
            assert "report_markdown" not in in_flight

            # Release the formation gate and verify completed status + report_markdown
            gate.set()
            await rt.wait_run(user_id="researcher-1", session_id="held-session-1", timeout=3.0)

            completed = await status_fn(session_id="held-session-1", include_report=True)
            assert completed["status"] == "completed"
            assert completed["active"] is False
            assert len(completed["citations"]) == 1
            assert completed["usage"]["totalTokens"] == 730
            assert completed["report_markdown"].startswith("# Executive Report:")
            assert completed["artifacts"]["report_pdf_url"] == "/deep-research/runs/held-session-1/artifacts/report.pdf"
            assert completed["artifacts"]["slidev_preview_url"] == "/deep-research/runs/held-session-1/artifacts/slides/index.html"
            assert completed["artifacts"]["slidev_pdf_url"] == "/deep-research/runs/held-session-1/artifacts/slides.pdf"
            assert completed["has_slidev_markdown"] is True
            assert completed["slidev_summary"]["present"] is True
            assert completed["slidev_summary"]["slide_count"] == 2
            assert "routerMode: hash" in completed["slidev_markdown"]

            no_report = await status_fn(session_id="held-session-1", include_report=False)
            assert "report_markdown" not in no_report
            assert "slidev_markdown" not in no_report
            assert no_report["artifacts"]["report_pdf_url"] == "/deep-research/runs/held-session-1/artifacts/report.pdf"
            assert no_report["has_slidev_markdown"] is True

            # Unknown session_id
            missing = await status_fn(session_id="does-not-exist")
            assert missing == {"status": "not_found", "session_id": "does-not-exist"}

            # Verify Strands DecoratedFunctionTool streams a plain text JSON ToolResult
            # (zero image blocks, zero interrupts) when invoked through the SDK tool protocol.
            stream_events = [
                ev
                async for ev in status_fn.stream(
                    {
                        "toolUseId": "tu-1",
                        "name": "deep_research_status",
                        "input": {"session_id": "held-session-1", "include_report": True},
                    },
                    {},
                )
            ]
            wrapped = stream_events[-1].tool_result
            assert wrapped["status"] == "success"
            assert len(wrapped["content"]) == 1
            assert set(wrapped["content"][0].keys()) == {"text"}
            assert json.loads(wrapped["content"][0]["text"])["session_id"] == "held-session-1"

            # Launch a second run and cancel it via deep_research_cancel
            gate2 = asyncio.Event()

            async def _held_start_2(**kwargs: Any) -> dict[str, Any]:
                sid = "held-session-2"
                rt._gates[sid] = gate2
                rt._ready[sid] = asyncio.Event()
                kwargs["session_id"] = sid
                return await orig_start(**kwargs)

            rt.start_run = _held_start_2  # type: ignore[method-assign]
            await start_fn(query="Cryogenic CMOS control electronics", depth="standard")
            await rt.wait_executing("held-session-2")
            cancelled = await cancel_fn(session_id="held-session-2")
            assert cancelled == {
                "session_id": "held-session-2",
                "status": "cancelled",
                "active": False,
                "cancelled": True,
            }
            assert (await cancel_fn(session_id="unknown-run"))["cancelled"] is False
        finally:
            await rt.aclose()
            set_deep_research_runtime(None)

    asyncio.run(scenario())


def test_deep_research_tools_are_parent_only_and_compatible_with_unattended_takeover(isolated_env):
    from strands.hooks import BeforeToolCallEvent

    from agent.api.core.live_takeover import UnattendedRunGuard

    for name in DEEP_RESEARCH_TOOL_NAMES:
        assert is_deep_research_tool(name) is True
        assert is_parent_only_tool(name) is True
    assert is_deep_research_tool("brave_web_search") is False

    # ThinkToolsGuard strips parent-only Deep Research tools when the `think` child tool is called
    from agent.api.core.brave_tools import brave_web_search

    guard = ThinkToolsGuard()
    dummy_agent = Agent(
        model=StubTextModel(),
        tools=[brave_web_search, *deep_research_tools(user_id="guard-user")],
        callback_handler=None,
        load_tools_from_directory=False,
    )
    think_ev = BeforeToolCallEvent(
        agent=dummy_agent,
        selected_tool=None,
        tool_use={
            "toolUseId": "t1",
            "name": "think",
            "input": {"thought": "plan", "tools": ["brave_web_search", *DEEP_RESEARCH_TOOL_NAMES]},
        },
        invocation_state={},
    )
    guard.before_tool_call(think_ev)
    assert think_ev.tool_use["input"]["tools"] == ["brave_web_search"]

    # UnattendedRunGuard (cloud live takeover) MUST allow all 3 Deep Research tools (never cancels them!)
    unattended = UnattendedRunGuard()
    for name in DEEP_RESEARCH_TOOL_NAMES:
        ev = BeforeToolCallEvent(
            agent=dummy_agent,
            selected_tool=None,
            tool_use={"toolUseId": "t2", "name": name, "input": {}},
            invocation_state={},
        )
        unattended.before_tool_call(ev)
        assert not ev.cancel_tool, f"UnattendedRunGuard unexpectedly blocked {name}"


# ---------------------------------------------------------------------------
# 4. All 8 Ren Agent Composition Roots Register DEEP_RESEARCH_TOOL_NAMES
# ---------------------------------------------------------------------------


def test_all_eight_agent_composition_roots_register_deep_research_tools(
    isolated_env, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    from agent.api.core import (
        build_agent,
        context_agent,
        harness_agents,
        issue_agents,
        live_tools,
        panel_agent,
        project_agent,
        search_agent,
    )
    from agent.api.endpoints import chat

    monkeypatch.setattr(panel_agent, "configured_providers", lambda: ["gemini", "nim", "mistral"])
    monkeypatch.setattr(panel_agent, "build_model", lambda *_a, **_kw: StubTextModel())
    monkeypatch.setattr(panel_agent, "get_user_session_storage", lambda _u: InMemoryStorage())
    monkeypatch.setattr(chat, "build_model", lambda *_a, **_kw: StubTextModel())
    monkeypatch.setattr(app_config, "GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.setattr(search_agent, "build_model", lambda *_a, **_kw: StubTextModel())

    # --- Root 1: Agent Panel (`create_panel_agent`, including panel/document/context scopes) ---
    for scope in ("panel", "document", "context"):
        p_agent = panel_agent.create_panel_agent(
            provider="gemini",
            model_id="gemini-3.5-pro",
            session_id=f"dr-root-{scope}",
            user_id="user-root-1",
            system_prompt=f"Scope {scope}",
            extra_tools=[],
            agent_scope=scope,
        )
        try:
            reg = set(p_agent.tool_registry.registry.keys())
            assert DEEP_RESEARCH_TOOL_NAMES <= reg, f"Missing Deep Research tools in panel scope={scope}"
        finally:
            p_agent.cleanup()
    assert "deep_research_start" in chat.AGENT_SYSTEM_PROMPT_BASE
    assert DEEP_RESEARCH_DIRECTIVE in panel_agent.SKILLS_AND_SPECIALISTS_DIRECTIVE

    # --- Root 2: Gemini Live `BidiAgent` (`live_tools.build_live_tools` in panel & issue scopes) ---
    for live_scope in ("panel", f"issue:{uuid.uuid4()}"):
        l_names = {t.tool_name for t in live_tools.build_live_tools("user-root-2", live_scope)}
        assert DEEP_RESEARCH_TOOL_NAMES <= l_names, f"Missing Deep Research tools in Live scope={live_scope}"
    assert "deep_research_start" in live_tools.live_system_prompt("user")

    # --- Root 3: Specialist / Harness Agents (`harness_agents.build_specialist`) + Context Agent ---
    spec_agent = harness_agents.build_specialist(
        owner_id="user-root-3",
        config={
            "name": "Semiconductor Scout",
            "description": "Tracks fab capex.",
            "instructions": "Research fab equipment.",
            "model": "gemini/gemini-3.5-pro",
            "tools": [],
        },
        model=StubTextModel(),
        connect_mcp=False,
    )
    try:
        assert DEEP_RESEARCH_TOOL_NAMES <= set(spec_agent.tool_registry.registry.keys())
    finally:
        spec_agent.cleanup()
    for tool_name in DEEP_RESEARCH_TOOL_NAMES:
        assert tool_name in context_agent.CONTEXT_AGENT_PROMPT

    # --- Root 4: Project Agent (`chat._create_runtime_agent` w/ `kind="project"` + prompt) ---
    proj_id = str(uuid.uuid4())
    proj_prompt = project_agent.project_agent_prompt(proj_id)
    assert "deep_research_start" in proj_prompt
    assert "deep_research_status" in proj_prompt
    assert "add_issue_context" in proj_prompt
    proj_agent = asyncio.run(
        chat._create_runtime_agent(
            user_id="user-root-4",
            session_id="dr-proj-session",
            options={},
            runtime_options={},
            selection={
                "provider": "gemini",
                "model_id": "gemini-3.5-pro",
                "destination": "panel",
                "agent": {"kind": "project", "id": proj_id},
            },
        )
    )
    try:
        assert DEEP_RESEARCH_TOOL_NAMES <= set(proj_agent.tool_registry.registry.keys())
    finally:
        proj_agent.cleanup()

    # --- Root 5: Issue Chat Agent (`issue_agents.create_issue_chat_agent`) ---
    ic_agent = issue_agents.create_issue_chat_agent(
        user_id="user-root-5",
        session_id="dr-issue-chat",
        issue_id=str(uuid.uuid4()),
        project_id=str(uuid.uuid4()),
        owner_id="user-root-5",
        provider="gemini",
        model_id="gemini-3.5-pro",
        model=StubTextModel(),
        side_model_factory=lambda _: StubTextModel(),
        callback_handler=None,
    )
    try:
        assert DEEP_RESEARCH_TOOL_NAMES <= set(ic_agent.tool_registry.registry.keys())
    finally:
        ic_agent.cleanup()

    # --- Root 6: Autonomous Issue Agent (`issue_agents.IssueAgentRuntime`) ---
    from agent.tests.test_issue_agents import Database, configured
    from agent.tests.test_panel_tools import OfflineModel

    configured(monkeypatch)

    async def _verify_autonomous_issue_agent() -> None:
        db = Database()
        owner_svc, iss_id = db.service()
        captured_models: list[OfflineModel] = []

        def _mf(_prov: str, _mid: str, **_kw: Any) -> OfflineModel:
            m = OfflineModel("done")
            captured_models.append(m)
            return m

        rt_issue = issue_agents.IssueAgentRuntime(_mf)
        await rt_issue.start(cast(Any, owner_svc), iss_id, "Run quick check")
        await asyncio.gather(*(r.task for r in rt_issue.active.values() if r.task is not None))
        await rt_issue.shutdown()
        assert captured_models and captured_models[0].calls
        sent_tool_names = {t["name"] for t in captured_models[0].calls[0]["tools"]}
        assert DEEP_RESEARCH_TOOL_NAMES <= sent_tool_names

    asyncio.run(_verify_autonomous_issue_agent())

    # --- Root 7: Build Agent (`build_agent.create_build_agent`) ---
    b_agent = build_agent.create_build_agent(
        user_id="user-root-7",
        session_id="dr-build-session",
        model=StubTextModel(),
        side_model_factory=lambda _: StubTextModel(),
        browser="user",
        options={"background": True},
        callback_handler=None,
    )
    try:
        assert DEEP_RESEARCH_TOOL_NAMES <= set(b_agent.tool_registry.registry.keys())
    finally:
        b_agent.cleanup()
    bg_cfg = build_agent._background({"background": True})
    assert DEEP_RESEARCH_TOOL_NAMES <= set(bg_cfg["never"])

    # --- Root 8: Browser Search Agent (`search_agent.create_search_agent`) ---
    s_agent = search_agent.create_search_agent(
        "medium",
        user_id="user-root-8",
        session_id="dr-search-session",
        session_dir=tmp_path,
    )
    try:
        assert DEEP_RESEARCH_TOOL_NAMES <= set(s_agent.tool_names)
        assert "deep_research_start" in (s_agent.system_prompt or "")
    finally:
        s_agent.cleanup()


# ---------------------------------------------------------------------------
# 5. Real DeepResearchRuntime + FastAPI Lifespan Smoke Check
# ---------------------------------------------------------------------------


def test_real_deep_research_runtime_status_and_router_wiring(isolated_env, tmp_path: Path):
    from agent.api.core.deep_research import (
        VALID_DEPTHS,
        DeepResearchRuntime,
        get_deep_research_runtime,
        get_formation_topology,
        set_deep_research_runtime,
    )

    assert tuple(VALID_DEPTHS) == ("standard", "deep", "exhaustive")
    topo = get_formation_topology()
    assert topo["id"] == "deep_research_graph"

    artifacts_root = tmp_path / "real-artifacts"
    real_rt = DeepResearchRuntime(artifacts_dir=artifacts_root)
    set_deep_research_runtime(real_rt)
    app = FastAPI()
    app.state.deep_research = real_rt
    app.include_router(deep_research_ep.router)

    # Seed a real session artifact directory using the runtime's own ownership structure.
    session_dir = artifacts_root / "dr-real-art-1"
    slides_assets = session_dir / "slides" / "assets"
    slides_assets.mkdir(parents=True, exist_ok=True)
    (session_dir / ".owner.json").write_text(
        json.dumps({"user_id": "alice", "session_id": "dr-real-art-1"}),
        encoding="utf-8",
    )
    (session_dir / "report.pdf").write_bytes(b"%PDF-1.4\n%real-runtime-pdf\n%%EOF\n")
    (session_dir / "slides" / "index.html").write_text(
        '<!doctype html><script type="module" src="./assets/deck.js"></script>',
        encoding="utf-8",
    )
    (slides_assets / "deck.js").write_text("console.log('real-slidev');\n", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("do-not-read", encoding="utf-8")

    async def scenario() -> None:
        try:
            assert get_deep_research_runtime() is real_rt
            transport = httpx.ASGITransport(app=app, client=("127.0.0.1", 52105))
            async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as client:
                res = await client.get("/deep-research/status")
                assert res.status_code == 200
                body = res.json()
                assert body["available"] is True
                assert body["depths"] == ["standard", "deep", "exhaustive"]
                assert body["topology"]["id"] == "deep_research_graph"

                runs_res = await client.get("/deep-research/runs", params={"user_id": "fresh-user"})
                assert runs_res.status_code == 200
                assert runs_res.json() == {"runs": []}

                # Real `DeepResearchRuntime.resolve_artifact_path` integration:
                pdf_inline = await client.get(
                    "/deep-research/runs/dr-real-art-1/artifacts/report.pdf",
                    params={"user_id": "alice"},
                )
                assert pdf_inline.status_code == 200
                assert pdf_inline.headers["content-type"].startswith("application/pdf")
                assert "attachment" not in pdf_inline.headers.get("content-disposition", "")

                pdf_dl = await client.get(
                    "/deep-research/runs/dr-real-art-1/artifacts/report.pdf",
                    params={"user_id": "alice", "download": "true"},
                )
                assert pdf_dl.status_code == 200
                assert 'attachment; filename="report.pdf"' in pdf_dl.headers.get("content-disposition", "")

                # Relative Slidev sub-asset fetched by iframe without `user_id` query param:
                asset_js = await client.get(
                    "/deep-research/runs/dr-real-art-1/artifacts/slides/assets/deck.js"
                )
                assert asset_js.status_code == 200
                assert "javascript" in asset_js.headers["content-type"]

                # Wrong user, hidden `.owner.json` dotfile, and `..` traversal all return 404:
                wrong_user = await client.get(
                    "/deep-research/runs/dr-real-art-1/artifacts/report.pdf",
                    params={"user_id": "bob"},
                )
                assert wrong_user.status_code == 404

                dotfile_res = await client.get(
                    "/deep-research/runs/dr-real-art-1/artifacts/.owner.json",
                    params={"user_id": "alice"},
                )
                assert dotfile_res.status_code == 404

                trav_res = await client.get(
                    "/deep-research/runs/dr-real-art-1/artifacts/%2e%2e/%2e%2e/secret.txt"
                )
                assert trav_res.status_code == 404
        finally:
            await real_rt.aclose()
            set_deep_research_runtime(None)

    asyncio.run(scenario())
