"""End-to-end verification of native async agent/tool execution, subagent supervision, and runtime tool hot-reload.

Exercises the real ``create_panel_agent``, ``PanelRuntimeManager``, ``strands_harness.create_harness``,
``_BackgroundTasks(always=["*"])``, ``_SubagentTool(background=True)``, ``ToolWatcher`` (``load_tools_from_directory``),
``strands_tools.load_tool``, and ``make_programmatic_tool_caller(hot_reload=True)`` completely offline.
"""

from __future__ import annotations

import asyncio
import copy
import json
import re
from pathlib import Path
from typing import Any

import pytest
from strands import tool
from strands.models.model import Model
from strands.storage import InMemoryStorage
from strands.types.tools import ToolContext
from strands_harness import create_harness

from agent.api.core import config as app_config
from agent.api.core import panel_agent, panel_storage, teaching
from agent.api.core.panel_runtime import PanelRuntimeManager


def _emit_tool_uses(calls: list[tuple[str, str, dict[str, Any]]]):
    yield {"messageStart": {"role": "assistant"}}
    for idx, (tool_use_id, name, payload) in enumerate(calls):
        yield {
            "contentBlockStart": {
                "contentBlockIndex": idx,
                "start": {"toolUse": {"toolUseId": tool_use_id, "name": name}},
            }
        }
        yield {
            "contentBlockDelta": {
                "contentBlockIndex": idx,
                "delta": {"toolUse": {"input": json.dumps(payload)}},
            }
        }
        yield {"contentBlockStop": {"contentBlockIndex": idx}}
    yield {"messageStop": {"stopReason": "tool_use"}}


def _emit_text(text: str):
    yield {"messageStart": {"role": "assistant"}}
    yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": text}}}
    yield {"contentBlockStop": {"contentBlockIndex": 0}}
    yield {"messageStop": {"stopReason": "end_turn"}}


class _QuietMemoryModel(Model):
    def get_config(self) -> dict[str, Any]:
        return {"model_id": "offline-memory", "stateful": False}

    def update_config(self, **kwargs: Any) -> None:
        del kwargs

    async def structured_output(self, *args: Any, **kwargs: Any):
        raise NotImplementedError
        yield

    async def stream(self, messages: Any, tool_specs: Any = None, system_prompt: Any = None, **kwargs: Any):
        del messages, tool_specs, system_prompt, kwargs
        for ev in _emit_text("[]"):
            yield ev


@pytest.fixture
def isolated_panel_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> InMemoryStorage:
    for key in (
        "PANEL_SKILLS_DIR",
        "PANEL_SKILLS_DIRS",
        "PANEL_SKILL_TOOLS",
        "PANEL_FORMATIONS_FILE",
        "PANEL_RETRY_MAX_ATTEMPTS",
        "PANEL_RETRY_INITIAL_DELAY",
        "PANEL_RETRY_MAX_DELAY",
        "RON_MEMORY_MODEL",
    ):
        monkeypatch.delenv(key, raising=False)
    storage = InMemoryStorage()
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(panel_agent, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(panel_agent, "get_user_session_storage", lambda user: storage)
    monkeypatch.setattr(panel_storage, "get_panel_storage", lambda: storage)
    monkeypatch.setenv("TEACHING_STORAGE_DIR", str(tmp_path / "teaching"))
    monkeypatch.setattr(teaching, "_service", None)
    monkeypatch.setenv("RON_MEMORY_MODEL", "offline/memory")
    monkeypatch.setattr(app_config, "OPENAI_API_KEY", "offline-openai-key")
    monkeypatch.setattr(app_config, "PERPLEXITY_API_KEY", "offline-perplexity-key")
    return storage


def test_panel_runtime_async_subagent_concurrency_steering_hangup_and_recover(
    isolated_panel_env: InMemoryStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Parent spawns subagent(background=True), executes async parent tools concurrently, checks status + steers,
    wakes on [subagent-hangup] when child scraper stalls, and recovers via _fork_messages without redoing work."""
    seed_calls: list[str] = []
    steered_notes: list[str] = []
    child_hung_started = asyncio.Event()
    child_hung_cancelled = asyncio.Event()

    @tool
    def collect_seed_urls() -> str:
        """Collect target pricing URLs (step 1)."""
        seed_calls.append("collected")
        return "https://pricing.example/catalog"

    @tool(context=True)
    async def olostep_scrape_website(url: str, tool_context: ToolContext) -> str:
        """Simulate a scraper that hangs indefinitely until cancelled."""
        del url
        child_hung_started.set()
        try:
            while not tool_context.cancel_signal.is_set():
                await asyncio.sleep(0.01)
        finally:
            child_hung_cancelled.set()
        return "never"

    @tool
    def fast_http_extract(url: str) -> str:
        """Fast fallback extractor."""
        return f"Extracted pricing from {url}: $49/mo"

    @tool
    async def parent_fetch(topic: str) -> str:
        """Async parent tool running concurrently via _BackgroundTasks(always=['*'])."""
        await asyncio.sleep(0.02)
        return f"Baseline for {topic}: $59/mo"

    class OrchestratedModel(Model):
        def get_config(self) -> dict[str, Any]:
            return {"model_id": "offline-resilience", "stateful": False}

        def update_config(self, **kwargs: Any) -> None:
            del kwargs

        async def structured_output(self, *args: Any, **kwargs: Any):
            raise NotImplementedError
            yield

        async def stream(self, messages: Any, tool_specs: Any = None, system_prompt: Any = None, **kwargs: Any):
            del tool_specs, system_prompt, kwargs
            msg_list = list(messages)
            first_text = "".join(
                block.get("text", "") for block in (msg_list[0].get("content") or ()) if isinstance(block, dict)
            )
            is_parent = "Compare competitor pricing" in first_text
            uses = [
                block["toolUse"]
                for m in msg_list
                if m.get("role") == "assistant"
                for block in m.get("content") or ()
                if "toolUse" in block
            ]
            all_text = "\n".join(
                block["text"]
                for m in msg_list
                for block in m.get("content") or ()
                if isinstance(block.get("text"), str)
            )

            if not is_parent:
                # Child subagent model!
                if "<parent-steering>" in all_text:
                    steered_notes.append(all_text)
                called_child = [u["name"] for u in uses]
                if "collect_seed_urls" not in called_child:
                    for ev in _emit_tool_uses([("child-seed", "collect_seed_urls", {})]):
                        yield ev
                    return
                # Wait for collect_seed_urls background task settlement before step 2.
                seed_settled = any("https://pricing.example/catalog" in json.dumps(m) for m in msg_list)
                if not seed_settled:
                    for ev in _emit_text("Waiting for seed URLs..."):
                        yield ev
                    return
                if "Use fast_http_extract" in all_text:
                    if "fast_http_extract" not in called_child:
                        for ev in _emit_tool_uses(
                            [("child-fast", "fast_http_extract", {"url": "https://pricing.example/catalog"})]
                        ):
                            yield ev
                        return
                    fast_settled = any("Extracted pricing from" in json.dumps(m) for m in msg_list)
                    if not fast_settled:
                        for ev in _emit_text("Waiting for fast_http_extract..."):
                            yield ev
                        return
                    for ev in _emit_text("Child recovered result: $49/mo"):
                        yield ev
                    return
                if "olostep_scrape_website" not in called_child:
                    for ev in _emit_tool_uses(
                        [("child-hung", "olostep_scrape_website", {"url": "https://pricing.example/catalog"})]
                    ):
                        yield ev
                    return
                for ev in _emit_text("Waiting on scraper..."):
                    yield ev
                return

            # Parent model!
            sub_actions = [u["input"].get("action", "spawn") for u in uses if u["name"] == "subagent"]
            if not sub_actions:
                for ev in _emit_tool_uses(
                    [
                        ("p-spawn", "subagent", {"task": "Collect seed URLs and scrape pricing"}),
                        ("p-fetch", "parent_fetch", {"topic": "competitors"}),
                    ]
                ):
                    yield ev
                return

            subagent_id = ""
            for m in msg_list:
                for block in m.get("content") or ():
                    tr = block.get("toolResult") or {}
                    if tr.get("toolUseId") == "p-spawn":
                        for item in tr.get("content") or ():
                            if isinstance(item.get("json"), dict) and "subagent_id" in item["json"]:
                                subagent_id = str(item["json"]["subagent_id"])
            assert subagent_id, "Expected immediate non-blocking subagent_id from spawn"

            if "status" not in sub_actions:
                await asyncio.wait_for(child_hung_started.wait(), timeout=3.0)
                for ev in _emit_tool_uses(
                    [
                        ("p-status", "subagent", {"action": "status", "subagent_id": subagent_id}),
                        (
                            "p-steer",
                            "subagent",
                            {"action": "steer", "subagent_id": subagent_id, "task": "Avoid slow scrapers"},
                        ),
                    ]
                ):
                    yield ev
                return

            if "[subagent-completed]" in all_text:
                for ev in _emit_text("Final comparison: $49/mo vs $59/mo"):
                    yield ev
                return

            if "[subagent-hangup]" in all_text and "recover" not in sub_actions:
                for ev in _emit_tool_uses(
                    [
                        (
                            "p-recover",
                            "subagent",
                            {
                                "action": "recover",
                                "subagent_id": subagent_id,
                                "task": "Use fast_http_extract on the already-collected URL",
                            },
                        )
                    ]
                ):
                    yield ev
                return

            for ev in _emit_text("Supervising background subagent and parent_fetch..."):
                yield ev

    import sys
    from strands.vended_tools.subagent import make_subagent as real_make_subagent

    vended_subagent_pkg = sys.modules["strands.vended_tools.subagent"]
    vended_subagent_mod = sys.modules["strands.vended_tools.subagent.subagent"]

    def fast_stall_make_subagent(*args: Any, **kwargs: Any):
        kwargs["stall_timeout"] = 0.15
        kwargs["max_consecutive_errors"] = 2
        return real_make_subagent(*args, **kwargs)

    monkeypatch.setattr(vended_subagent_pkg, "make_subagent", fast_stall_make_subagent)
    monkeypatch.setattr(vended_subagent_mod, "make_subagent", fast_stall_make_subagent)

    def fake_build_model(*args: Any, hosted_tools: bool = True, **kwargs: Any):
        del kwargs
        if not hosted_tools and args[:2] == ("perplexity", "offline/memory"):
            return _QuietMemoryModel()
        return OrchestratedModel()

    monkeypatch.setattr(panel_agent, "build_model", fake_build_model)

    async def scenario() -> None:
        async def factory(*, user_id: str, session_id: str, selection: Any, options: Any, runtime_options: Any):
            return await asyncio.to_thread(
                panel_agent.create_panel_agent,
                provider="openai",
                model_id="offline-resilience",
                session_id=session_id,
                user_id=user_id,
                system_prompt="Be concise.",
                extra_tools=[collect_seed_urls, olostep_scrape_website, fast_http_extract, parent_fetch],
                options=options,
                runtime_options=runtime_options,
            )

        manager = PanelRuntimeManager(factory=factory, storage_factory=lambda _: isolated_panel_env)
        try:
            session = await manager.start("u1", "s-resilience", "Compare competitor pricing")
            await asyncio.wait_for(session.wait(), timeout=10.0)
            events = [ev async for ev in session.events(0, run_id=session.run_id)]
            assert session.status == "completed", session.error
            # Step 1 (collect_seed_urls) ran ONCE and was salvaged by _fork_messages on recover!
            assert seed_calls == ["collected"]
            assert child_hung_cancelled.is_set()
            bg_events = [ev["event"] for ev in events if ev.get("type") == "background_event"]
            # Parent async tool completed over background_event
            assert any(
                ev.get("tool_use", {}).get("name") == "parent_fetch"
                and ev.get("tool_result", {}).get("status") == "success"
                for ev in bg_events
            )
            # Subagent streamed live child tool events AND emitted hangup + completed resume notifications
            assert any(
                isinstance(ev.get("tool_stream_event", {}).get("tool_use", {}).get("input", {}).get("subagent_id"), str)
                for ev in bg_events
            )
            resumes = [ev["subagent_resume"] for ev in bg_events if "subagent_resume" in ev]
            assert any(r.startswith("[subagent-hangup]") for r in resumes)
            assert any(r.startswith("[subagent-completed]") and "$49/mo" in r for r in resumes)
            final_text = "".join(ev["data"] for ev in events if ev.get("type") == "text_delta" and not ev["node_path"])
            assert "Final comparison: $49/mo vs $59/mo" in final_text
        finally:
            await manager.shutdown()

    asyncio.run(scenario())


def test_panel_agent_cancels_hung_tool_and_hot_reloads_authored_tools_into_programmatic_caller(
    isolated_panel_env: InMemoryStorage,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """When a background tool hangs, the agent polls + cancels it, authors new @tool Python files (hot-reloaded via
    ToolWatcher on ./tools/*.py and via explicit load_tool), and invokes them inside programmatic_tool_caller(hot_reload=True)
    under always=['*'] without deadlocking."""
    del isolated_panel_env
    hung_started = asyncio.Event()
    hung_cancelled = asyncio.Event()
    polled_modes: list[str] = []

    @tool(context=True)
    async def olostep_scrape_website(url: str, tool_context: ToolContext) -> str:
        """Simulate a hung scraper."""
        del url
        hung_started.set()
        try:
            while not tool_context.cancel_signal.is_set():
                await asyncio.sleep(0.01)
        finally:
            hung_cancelled.set()
        return "unreachable"

    watched_tool_code = (
        "from strands import tool\n\n"
        "@tool\n"
        "def watched_rescuer(target: str) -> str:\n"
        '    """Hot-reloaded tool discovered automatically by ToolWatcher."""\n'
        '    return f"watched:{target}"\n'
    )
    explicit_tool_code = (
        "from strands import tool\n\n"
        "@tool\n"
        "def loaded_rescuer(target: str) -> str:\n"
        '    """Runtime tool loaded explicitly via load_tool."""\n'
        '    return f"loaded:{target}"\n'
    )

    class HotReloadResilienceModel(Model):
        def get_config(self) -> dict[str, Any]:
            return {"model_id": "offline-hot-reload", "stateful": False}

        def update_config(self, **kwargs: Any) -> None:
            del kwargs

        async def structured_output(self, *args: Any, **kwargs: Any):
            raise NotImplementedError
            yield

        async def stream(self, messages: Any, tool_specs: Any = None, system_prompt: Any = None, **kwargs: Any):
            del system_prompt, kwargs
            msg_list = list(messages)
            spec_names = {spec["name"] for spec in (tool_specs or ())}
            assert {"load_tool", "programmatic_tool_caller", "strands_manage_background_task"} <= spec_names
            uses = [
                block["toolUse"]
                for m in msg_list
                if m.get("role") == "assistant"
                for block in m.get("content") or ()
                if "toolUse" in block
            ]
            called_names = [u["name"] for u in uses]

            if "olostep_scrape_website" not in called_names:
                for ev in _emit_tool_uses([("t-scrape", "olostep_scrape_website", {"url": "https://hung.example"})]):
                    yield ev
                return

            task_id = ""
            for m in msg_list:
                for block in m.get("content") or ():
                    tr = block.get("toolResult") or {}
                    if tr.get("toolUseId") == "t-scrape":
                        for item in tr.get("content") or ():
                            match = re.search(r"Task ID:\s*([0-9a-fA-F-]+)", item.get("text", ""))
                            if match:
                                task_id = match.group(1)
            assert task_id

            explicit_modes = [
                u["input"].get("mode")
                for u in uses
                if u["name"] == "strands_manage_background_task" and u["toolUseId"].startswith("t-")
            ]
            if "list" not in explicit_modes:
                await asyncio.wait_for(hung_started.wait(), timeout=3.0)
                polled_modes.append("list")
                for ev in _emit_tool_uses([("t-list", "strands_manage_background_task", {"mode": "list"})]):
                    yield ev
                return
            if "get" not in explicit_modes:
                polled_modes.append("get")
                for ev in _emit_tool_uses(
                    [("t-get", "strands_manage_background_task", {"mode": "get", "task_id": task_id})]
                ):
                    yield ev
                return
            if "cancel" not in explicit_modes:
                polled_modes.append("cancel")
                for ev in _emit_tool_uses(
                    [("t-cancel", "strands_manage_background_task", {"mode": "cancel", "task_id": task_id})]
                ):
                    yield ev
                return

            # Wait for cancelled task settlement before authoring replacement tools.
            cancel_settled = any(
                u["name"] == "strands_manage_background_task" and u["toolUseId"] == task_id for u in uses
            )
            if not cancel_settled:
                for ev in _emit_text("Waiting for cancelled task settlement..."):
                    yield ev
                return

            if "load_tool" not in called_names:
                # Author both ./tools/watched_rescuer.py (picked up by native ToolWatcher) and ./loaded_rescuer.py!
                tools_dir = tmp_path / "tools"
                tools_dir.mkdir(exist_ok=True)
                (tools_dir / "watched_rescuer.py").write_text(watched_tool_code, encoding="utf-8")
                explicit_path = tmp_path / "loaded_rescuer.py"
                explicit_path.write_text(explicit_tool_code, encoding="utf-8")
                # Give watchdog observer a moment to process FSEvents/kqueue on ./tools/watched_rescuer.py
                for _ in range(40):
                    await asyncio.sleep(0.05)
                for ev in _emit_tool_uses(
                    [("t-load", "load_tool", {"path": str(explicit_path), "name": "loaded_rescuer"})]
                ):
                    yield ev
                return

            if "programmatic_tool_caller" not in called_names:
                assert "watched_rescuer" in spec_names, f"ToolWatcher did not hot-load watched_rescuer: {spec_names}"
                assert "loaded_rescuer" in spec_names, f"load_tool did not register loaded_rescuer: {spec_names}"
                code = (
                    "a = await watched_rescuer(target='alpha')\n"
                    "b = await loaded_rescuer(target='beta')\n"
                    "print(f'{a} | {b}')\n"
                )
                for ev in _emit_tool_uses([("t-ptc", "programmatic_tool_caller", {"code": code})]):
                    yield ev
                return

            ptc_settled = any("watched:alpha | loaded:beta" in json.dumps(m) for m in msg_list)
            if not ptc_settled:
                for ev in _emit_text("Waiting for programmatic_tool_caller background settlement..."):
                    yield ev
                return

            for ev in _emit_text("Rescued via hot-reloaded tools: watched:alpha | loaded:beta"):
                yield ev

    def fake_build_model(*args: Any, hosted_tools: bool = True, **kwargs: Any):
        del kwargs
        if not hosted_tools and args[:2] == ("perplexity", "offline/memory"):
            return _QuietMemoryModel()
        return HotReloadResilienceModel()

    monkeypatch.setattr(panel_agent, "build_model", fake_build_model)
    (tmp_path / "tools").mkdir(exist_ok=True)

    agent = panel_agent.create_panel_agent(
        provider="openai",
        model_id="offline-hot-reload",
        session_id="hot-reload-session",
        user_id="u1",
        system_prompt="Be concise.",
        extra_tools=[olostep_scrape_website],
    )
    try:
        result = asyncio.run(agent.invoke_async("Scrape hung.example or build a fallback tool"))
        assert result.stop_reason == "end_turn"
        assert polled_modes == ["list", "get", "cancel"]
        assert hung_cancelled.is_set()
        assert "watched_rescuer" in agent.tool_registry.registry
        assert "loaded_rescuer" in agent.tool_registry.registry
        assert "Rescued via hot-reloaded tools: watched:alpha | loaded:beta" in str(result)
    finally:
        agent.cleanup()


def test_harness_agent_consecutive_tool_errors_trigger_hangup_and_recover(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """create_harness with subagent(background=True, max_consecutive_errors=2) wakes parent on consecutive child
    tool failures and recovers cleanly."""
    monkeypatch.chdir(tmp_path)
    broken_attempts = 0

    @tool
    def broken_api(endpoint: str) -> str:
        """Always fails."""
        nonlocal broken_attempts
        broken_attempts += 1
        raise RuntimeError(f"503 Service Unavailable on {endpoint}")

    @tool
    def healthy_api(endpoint: str) -> str:
        """Succeeds cleanly."""
        return f"OK:{endpoint}"

    class HarnessResilienceModel(Model):
        def get_config(self) -> dict[str, Any]:
            return {"model_id": "offline-harness", "stateful": False}

        def update_config(self, **kwargs: Any) -> None:
            del kwargs

        async def structured_output(self, *args: Any, **kwargs: Any):
            raise NotImplementedError
            yield

        async def stream(self, messages: Any, tool_specs: Any = None, system_prompt: Any = None, **kwargs: Any):
            del tool_specs, system_prompt, kwargs
            msg_list = copy.deepcopy(list(messages))
            first_text = "".join(
                block.get("text", "") for block in (msg_list[0].get("content") or ()) if isinstance(block, dict)
            )
            is_parent = "Fetch items resiliently" in first_text
            uses = [
                block["toolUse"]
                for m in msg_list
                if m.get("role") == "assistant"
                for block in m.get("content") or ()
                if "toolUse" in block
            ]
            all_text = "\n".join(
                block["text"]
                for m in msg_list
                for block in m.get("content") or ()
                if isinstance(block.get("text"), str)
            )

            if not is_parent:
                called_child = [u["name"] for u in uses]
                if "Switch to healthy_api" in all_text:
                    if "healthy_api" not in called_child:
                        for ev in _emit_tool_uses([("c-healthy", "healthy_api", {"endpoint": "/v2/items"})]):
                            yield ev
                        return
                    if not any("OK:/v2/items" in json.dumps(m) for m in msg_list):
                        for ev in _emit_text("Waiting on healthy_api..."):
                            yield ev
                        return
                    for ev in _emit_text("Recovered via healthy_api: OK:/v2/items"):
                        yield ev
                    return
                # Fail twice in a row to trigger max_consecutive_errors=2 hangup!
                fail_calls = sum(1 for n in called_child if n == "broken_api")
                settled_fails = sum(1 for m in msg_list if "503 Service Unavailable" in json.dumps(m))
                if fail_calls > settled_fails:
                    for ev in _emit_text("Waiting for broken_api failure settlement..."):
                        yield ev
                    return
                if fail_calls < 3:
                    for ev in _emit_tool_uses(
                        [(f"c-broken-{fail_calls}", "broken_api", {"endpoint": "/v1/items"})]
                    ):
                        yield ev
                    return
                for ev in _emit_text("Child stuck."):
                    yield ev
                return

            sub_actions = [u["input"].get("action", "spawn") for u in uses if u["name"] == "subagent"]
            if not sub_actions:
                for ev in _emit_tool_uses([("h-spawn", "subagent", {"task": "Fetch items"})]):
                    yield ev
                return
            subagent_id = ""
            for m in msg_list:
                for block in m.get("content") or ():
                    tr = block.get("toolResult") or {}
                    if tr.get("toolUseId") == "h-spawn":
                        for item in tr.get("content") or ():
                            if isinstance(item.get("json"), dict) and "subagent_id" in item["json"]:
                                subagent_id = str(item["json"]["subagent_id"])
            if "[subagent-completed]" in all_text:
                for ev in _emit_text("Parent completed after recovery: OK:/v2/items"):
                    yield ev
                return
            if "[subagent-hangup]" in all_text and "recover" not in sub_actions:
                for ev in _emit_tool_uses(
                    [
                        (
                            "h-recover",
                            "subagent",
                            {"action": "recover", "subagent_id": subagent_id, "task": "Switch to healthy_api"},
                        )
                    ]
                ):
                    yield ev
                return
            for ev in _emit_text("Monitoring subagent..."):
                yield ev

    agent = create_harness(
        model=HarnessResilienceModel(),
        caching=False,
        session=False,
        skills=False,
        memory=False,
        tools=[broken_api, healthy_api],
        builtin_tools={
            "*": False,
            "programmatic_tool_caller": {"hot_reload": True},
            "subagent": {"background": True, "stall_timeout": 10.0, "max_consecutive_errors": 2},
        },
        builtin_plugins=["todos"],
        background_tasks={"always": ["*"], "never": ["subagent", "todo_write"], "wait_for_completion": True},
        load_tools_from_directory=False,
    )
    try:
        result = asyncio.run(agent.invoke_async("Fetch items resiliently"))
        assert broken_attempts >= 2
        assert "Parent completed after recovery: OK:/v2/items" in str(result)
    finally:
        agent.cleanup()
