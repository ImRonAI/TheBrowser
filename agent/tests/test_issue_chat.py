"""The issue workspace's Ron tab: ``/chat`` with ``destination="issue"`` on its own strands_harness agent.

Offline against the real installed Strands SDK, the real strands_harness ``create_harness``, the real panel runtime and
the guest SQLite workspace (``PROJECTS_GUEST_DB``); only the model is scripted and, for the signed-in 403 case, the
Supabase Auth lookup.
"""

from __future__ import annotations

import asyncio
import copy
import json
import uuid
from typing import Any

import pytest
from strands.memory import MemoryManager
from strands.models.model import Model
from strands.storage import InMemoryStorage
from strands.tools.executors import SequentialToolExecutor
from strands.vended_plugins.goal import GoalLoop

from agent.api.core import issue_agents
from agent.api.core.issue_agents import UNVERIFIED, create_issue_chat_agent, issue_chat_service
from agent.api.core.projects import ProjectIdentity

WORKSPACE = {"X-Ron-Workspace": "e" * 64}
OTHER_WORKSPACE = {"X-Ron-Workspace": "f" * 64}

#: Host shell/file/fetch/delegation tools the harness would add by default, plus the panel's host tools.
FORBIDDEN_TOOLS = {"shell", "read", "write", "edit", "web_fetch", "web_search", "programmatic_tool_caller", "subagent",
                   "editor", "environment", "mcp_client", "tool_catalog", "ask_user", "create_harness"}


class IssueModel(Model):
    """Scripted provider: every user turn reads the issue once, then answers with the title it read."""

    def __init__(self) -> None:
        self.calls: list[list[dict[str, Any]]] = []
        self.prompts: list[str] = []

    def get_config(self) -> dict[str, Any]:
        return {"model_id": "offline"}

    def update_config(self, **kwargs: Any) -> None:
        pass

    async def structured_output(self, *args: Any, **kwargs: Any):
        raise NotImplementedError
        yield

    async def stream(self, messages, tool_specs=None, system_prompt=None, **kwargs):
        self.calls.append(copy.deepcopy(messages))
        self.prompts.append(system_prompt or "")
        results = [block["toolResult"] for block in messages[-1]["content"] if "toolResult" in block]
        yield {"messageStart": {"role": "assistant"}}
        if not results:
            yield {"contentBlockStart": {"contentBlockIndex": 0, "start": {"toolUse": {
                "toolUseId": f"read-{len(self.calls)}", "name": "read_issue"}}}}
            yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"toolUse": {"input": "{}"}}}}
            yield {"contentBlockStop": {"contentBlockIndex": 0}}
            yield {"messageStop": {"stopReason": "tool_use"}}
            return
        result = results[0]
        text = result["content"][0]["text"]
        answer = f"Issue: {json.loads(text)['title']}" if result["status"] == "success" else f"Blocked: {text}"
        yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": answer}}}
        yield {"contentBlockStop": {"contentBlockIndex": 0}}
        yield {"messageStop": {"stopReason": "end_turn"}}


@pytest.fixture(autouse=True)
def isolated(monkeypatch, tmp_path):
    """Configuration/data isolation: guest workspace DB, teaching stores and session storage under tmp_path."""
    from agent.api.core import panel_storage, teaching

    monkeypatch.setenv("PROJECTS_GUEST_DB", str(tmp_path / "projects.db"))
    monkeypatch.setenv("TEACHING_STORAGE_DIR", str(tmp_path / "teaching"))
    monkeypatch.setattr(teaching, "_service", None)
    monkeypatch.setattr(panel_storage, "_storage", InMemoryStorage())


@pytest.fixture
def harness_calls(monkeypatch):
    """Records each real ``strands_harness.create_harness`` call (the real function still builds the agent)."""
    import strands_harness

    calls: list[dict[str, Any]] = []
    real = strands_harness.create_harness

    def recording(**kwargs: Any):
        # Only issue agents: the app lifespan also builds the tool fixer's A2A card agent with create_harness.
        if "Your issue ID is" in (kwargs.get("instructions") or ""):
            calls.append(kwargs)
        return real(**kwargs)

    monkeypatch.setattr(strands_harness, "create_harness", recording)
    return calls


def scripted(monkeypatch) -> IssueModel:
    from agent.api.endpoints import chat

    model = IssueModel()
    monkeypatch.setattr(chat, "build_model", lambda provider, model_id, effort=None, **kwargs: model)
    return model


def test_issue_destination_request_validation():
    """``issue`` requires a UUID ``issue_id`` (normalised); ``issue_id`` on any other destination is rejected."""
    from pydantic import ValidationError

    from agent.api.endpoints.chat import ChatRequest

    issue_id = str(uuid.uuid4())
    request = ChatRequest(session_id="s", message="hi", destination="issue", issue_id=issue_id.upper())
    assert request.issue_id == issue_id
    invalid: list[dict[str, Any]] = [{"destination": "issue"}, {"destination": "issue", "issue_id": "not-a-uuid"},
               {"destination": "panel", "issue_id": issue_id}, {"destination": "document", "issue_id": issue_id}]
    for bad in invalid:
        with pytest.raises(ValidationError):
            ChatRequest(session_id="s", message="hi", **bad)
    assert ChatRequest(session_id="s", message="hi").issue_id is None


def test_issue_chat_streams_its_own_harness_agent_with_the_callers_access(monkeypatch, harness_calls):
    """Auth (401/403/404), issue pinning (409), a create_harness agent reading the issue over SSE, no thread projection."""
    from agent.api.core import projects, threads
    from agent.tests.test_panel_api import events, offline_api

    model = scripted(monkeypatch)
    projected: list[tuple[str, str]] = []

    async def flush(self):
        projected.append((self.session_id, self.destination))

    monkeypatch.setattr(threads.ThreadProjection, "flush", flush)
    user = str(uuid.uuid4())

    async def scenario():
        async with offline_api(monkeypatch) as (client, manager, builds, agents, shell, threads_):
            project = (await client.post("/projects", json={"name": "Launch", "key": "LCH"}, headers=WORKSPACE)).json()
            issue = (await client.post("/projects/issues", json={"project_id": project["id"], "type": "task",
                                                                 "title": "Ship the beta"}, headers=WORKSPACE)).json()
            other = (await client.post("/projects/issues", json={"project_id": project["id"], "type": "task",
                                                                 "title": "Write the changelog"}, headers=WORKSPACE)).json()
            body = {"session_id": "issue-chat", "user_id": user, "provider": "openai", "model": "offline",
                    "message": "What is this issue about?", "destination": "issue", "issue_id": issue["id"]}

            # 422: contract validation and the existing panel-only rule for non-Ron agents.
            assert (await client.post("/chat", json={**body, "issue_id": None}, headers=WORKSPACE)).status_code == 422
            assert (await client.post("/chat", json={**body, "destination": "panel"}, headers=WORKSPACE)).status_code == 422
            specialist = {**body, "agent": {"kind": "specialist", "id": str(uuid.uuid4())}}
            assert (await client.post("/chat", json=specialist, headers=WORKSPACE)).status_code == 422
            # 401 without a project credential, 404 for an issue the credential cannot see.
            assert (await client.post("/chat", json=body)).status_code == 401
            unknown = {**body, "session_id": "issue-unknown", "issue_id": str(uuid.uuid4())}
            assert (await client.post("/chat", json=unknown, headers=WORKSPACE)).status_code == 404
            hidden = await client.post("/chat", json={**body, "session_id": "issue-hidden"}, headers=OTHER_WORKSPACE)
            assert hidden.status_code == 404
            # 403: a signed-in credential belonging to another user (Supabase Auth lookup replaced; no DB access follows).
            real_identity = projects.project_identity

            async def someone_else(request):
                return ProjectIdentity(str(uuid.uuid4()), "jwt", "https://offline.invalid", "anon")

            monkeypatch.setattr(projects, "project_identity", someone_else)
            denied = await client.post("/chat", json={**body, "session_id": "issue-denied"},
                                       headers={"Authorization": "Bearer jwt"})
            assert denied.status_code == 403
            monkeypatch.setattr(projects, "project_identity", real_identity)
            assert manager._sessions.get((user, "issue-unknown")) is None, "rejected turns never create a session"

            first = events(await client.post("/chat", json=body, headers=WORKSPACE))
            assert first[-1]["type"] == "run_finished" and first[-1]["status"] == "completed", first
            reads = [event for event in first if event["type"] == "tool_result" and event["name"] == "read_issue"]
            assert reads and reads[0]["status"] == "success"
            assert json.loads(reads[0]["content"][0]["text"])["id"] == issue["id"]
            assert "Issue: Ship the beta" in "".join(event["data"] for event in first if event["type"] == "text_delta")

            # Its own harness agent, not the panel composition.
            assert builds == [], "create_panel_agent is not used for the issue destination"
            assert len(harness_calls) == 1
            call = harness_calls[0]
            assert call["builtin_tools"] == [] and call["builtin_plugins"] == ["todos"]
            assert call["skills"] is False and call["session"] is False and call["mcp_servers"] is None
            assert isinstance(call["memory"], MemoryManager) and call["interventions"] is None
            assert call["background_tasks"] is False and call["checkpointing"] is False
            session = await manager.get(user, "issue-chat")
            assert session is not None and session.agent is not None
            agent = session.agent
            assert agent.agent_id == session.agent_id and call["session_manager"] is session.session_manager
            registered = set(agent.tool_registry.registry)
            assert {"read_issue", "update_issue", "edit_issue", "create_child", "read_issue_context", "link_issue",
                    "save_work_product", "add_workflow_to_description", "http_request", "understand_media",
                    "brave_answer", "brave_web_search", "render_ui", "render_workflow", "list_learned_skills",
                    "use_skill", "search_memory", "todo_write"} <= registered
            assert not registered & FORBIDDEN_TOOLS, registered & FORBIDDEN_TOOLS
            from strands_harness import HARNESS_CONTRACT

            assert model.prompts[0].startswith(HARNESS_CONTRACT)
            assert f"Your issue ID is {issue['id']}." in model.prompts[0] and "issue's Ren tab" in model.prompts[0]

            # Pinned selection, exposed by the snapshot; the verified guest identity is bound to the conversation.
            snapshot = (await client.get(f"/sessions/issue-chat?user_id={user}")).json()
            assert snapshot["selection"]["destination"] == "issue" and snapshot["selection"]["issue_id"] == issue["id"]
            assert snapshot["selection"]["project_id"] == project["id"]
            bound = issue_chat_service(user, "issue-chat").identity
            assert bound.guest and snapshot["selection"]["owner_id"] == bound.user_id

            # 409: the issue and the destination are locked for this session; another workspace's credential is 403.
            locked = await client.post("/chat", json={**body, "message": "And this one?", "issue_id": other["id"]}, headers=WORKSPACE)
            assert locked.status_code == 409 and "The issue is locked for this session" in locked.text
            panel = {key: value for key, value in body.items() if key not in ("destination", "issue_id")}
            assert (await client.post("/chat", json=panel, headers=WORKSPACE)).status_code == 409
            switched = await client.post("/chat", json={**body, "message": "Again"}, headers=OTHER_WORKSPACE)
            assert switched.status_code == 403

            # Same native session on the next turn (no agent rebuild); never projected as a thread.
            second = events(await client.post("/chat", json={**body, "message": "Any changes?"}, headers=WORKSPACE))
            assert second[-1]["status"] == "completed", second
            assert len(harness_calls) == 1, "the agent is built once per loaded session"
            assert model.calls[-1][0]["content"][0]["text"] == "What is this issue about?", "history restored"
            assert not [item for item in projected if item[0] == "issue-chat"]
    asyncio.run(scenario())


def test_options_reach_the_harness_agent(harness_calls):
    """tool_execution, checkpointing, background, goal and context are honoured on the issue agent."""
    model = IssueModel()
    agent = create_issue_chat_agent(
        user_id="options-user", session_id="options", issue_id=str(uuid.uuid4()), project_id=str(uuid.uuid4()),
        owner_id="options-user", provider="openai", model_id="offline", model=model, side_model_factory=lambda _: model,
        options={"context": "sliding", "tool_execution": "sequential", "checkpointing": True, "background": True,
                 "goal": "The issue has a written plan."},
        agent_id="options-agent", callback_handler=None,
    )
    call = harness_calls[0]
    assert isinstance(call["tool_executor"], SequentialToolExecutor) and isinstance(agent.tool_executor, SequentialToolExecutor)
    assert call["checkpointing"] is True and call["context_manager"] is False
    assert call["background_tasks"] == {"agentic": ["*"], "wait_for_completion": True, "never": ["use_skill"]}
    assert any(isinstance(plugin, GoalLoop) for plugin in call["plugins"])
    with pytest.raises(ValueError):
        create_issue_chat_agent(user_id="u", session_id="bad", issue_id=str(uuid.uuid4()), project_id=str(uuid.uuid4()),
                                owner_id="u", provider="openai", model_id="offline", model=model,
                                side_model_factory=lambda _: model, options={"context": "everything"})


def test_tools_wait_for_a_verified_credential(harness_calls):
    """Built from a credential-free GET (after a restart), the agent cancels tool calls until /chat binds an identity."""
    model = IssueModel()
    session_id = f"unverified-{uuid.uuid4().hex}"
    agent = create_issue_chat_agent(
        user_id="restart-user", session_id=session_id, issue_id=str(uuid.uuid4()), project_id=str(uuid.uuid4()),
        owner_id="restart-user", provider="openai", model_id="offline", model=model, side_model_factory=lambda _: model,
        agent_id="restart-agent", callback_handler=None,
    )
    assert issue_chat_service("restart-user", session_id).identity is UNVERIFIED
    result = asyncio.run(agent.invoke_async("Read it"))
    assert "Project access has not been verified" in str(result)
    # The /chat bind swaps the identity in place: the same agent's tools now act as the caller.
    identity = ProjectIdentity("restart-user", "jwt", "https://offline.invalid", "anon")
    issue_agents.bind_issue_chat_identity("restart-user", session_id, identity)
    assert issue_chat_service("restart-user", session_id).identity is identity
