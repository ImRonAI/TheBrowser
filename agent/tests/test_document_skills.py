"""Agent Skills authored as project pages: real guest SQLite workspace, real TeachingService storage, the
real native skill/SOP loaders and the real HTTP routes. No network, no Supabase."""
import json
import re
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from strands.models import Model
from strands.vended_plugins.skills import Skill

from agent.api.core import document_skills, teaching
from agent.api.core.document_skills import page_markdown, parse_skill_page, reference_markdown
from agent.api.core.media_understanding import html_to_markdown
from agent.api.core.teaching import TeachingService, _group_steps, _scope
from agent.api.endpoints.projects import router as projects_router
from agent.api.endpoints.teaching import router as teaching_router

WORKSPACE = {"X-Ron-Workspace": "e" * 64}
GUEST = {"user_id": "default", "agent_id": "panel"}


def chip(kind: str, ref_id: str, label: str) -> str:
    """The editor's ReferenceMention chip, as Tiptap renders it to HTML."""
    return (f'<span data-type="reference" data-kind="{kind}" data-id="{ref_id}" data-label="{label}" '
            f'class="reference-chip">@{label}</span>')


def skill_page(*, tool: str = "http_request", extra: str = "") -> str:
    """The Agent Skill template, filled in (italic paragraphs are the template's author notes)."""
    return (
        "<h1>Description</h1><p><em>What the skill does and when to use it.</em></p>"
        "<p>Write a weekly brief about a topic from current sources.</p>"
        "<h2>When to use</h2><p>When the user asks for a weekly brief.</p>"
        "<h2>Inputs</h2><ul><li><p>topic: what the brief covers</p></li></ul>"
        "<h2>Steps</h2>"
        f"<h3>Gather sources</h3><p>Fetch the sources with {chip('tool', tool, tool)} and check the time with "
        f"{chip('tool', 'current_time', 'current_time')}.</p><p>Done when: at least three sources are read.</p>"
        f"<h3>Draft</h3><p>Write it in the voice of {chip('document', '{doc}', 'Voice guide')} and let "
        f"{chip('agent', 'ron', 'Ron')} review it.</p>"
        "<h3></h3><p></p><p>Done when: </p>"
        "<h2>Completion criteria</h2><ul data-type=\"taskList\"><li data-type=\"taskItem\" data-checked=\"false\">"
        "<label><input type=\"checkbox\"><span></span></label><div><p>Every claim cites a source</p></div></li>"
        "<li data-type=\"taskItem\" data-checked=\"false\"><label><input type=\"checkbox\"><span></span></label><div><p></p></div></li></ul>"
        "<h2>Notes</h2><ul><li><p></p></li></ul>"
        f"{extra}"
    )


@pytest.fixture
def app(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> FastAPI:
    monkeypatch.setenv("PROJECTS_GUEST_DB", str(tmp_path / "projects.db"))
    monkeypatch.setenv("PANEL_A2A_ENABLED", "1")
    monkeypatch.setattr(teaching, "_service", TeachingService(tmp_path / "teaching"))
    application = FastAPI()
    application.include_router(projects_router)
    application.include_router(teaching_router)
    return application


def client(app: FastAPI, headers: dict[str, str] | None = WORKSPACE) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=headers or {}, timeout=120)


async def _workspace(http: httpx.AsyncClient) -> tuple[dict[str, Any], dict[str, Any]]:
    project = (await http.post("/projects", json={"name": "Writing", "key": "WR"})).json()
    voice = (await http.post("/projects/documents", json={"project_id": project["id"], "title": "Voice guide",
                                                          "content": "<p>Short sentences. <strong>No jargon.</strong></p>"})).json()
    return project, voice


def test_page_markdown_writes_references_and_task_items() -> None:
    html = ('<p>Ask ' + chip("agent", "ron", "Ron [beta]") + ' first.</p><ul data-type="taskList"><li data-type="taskItem" '
            'data-checked="true"><label><input type="checkbox" checked><span></span></label><div><p>Done</p></div></li></ul>')
    assert reference_markdown("agent", "ron", "Ron [beta]") == r"@[Ron \[beta\]](ron://agent/ron)"
    markdown = page_markdown(html)
    assert r"Ask @[Ron \[beta\]](ron://agent/ron) first." in markdown and "- [x] Done" in markdown
    # Issue and project agents read pages through the same converter.
    assert html_to_markdown(html) == markdown


def test_parse_reads_sections_drops_notes_and_unfilled_slots() -> None:
    page = parse_skill_page("Weekly brief", skill_page().replace("{doc}", "00000000-0000-4000-8000-000000000001"))
    assert page.description == "Write a weekly brief about a topic from current sources."
    assert page.use_when == "When the user asks for a weekly brief." and page.inputs == ["topic: what the brief covers"]
    assert [step.title for step in page.steps] == ["Gather sources", "Draft"]
    assert page.steps[0].outcome == "at least three sources are read."
    assert [(ref.kind, ref.id) for ref in page.steps[1].references] == [
        ("document", "00000000-0000-4000-8000-000000000001"), ("agent", "ron")]
    assert page.criteria == ["[ ] Every claim cites a source"] and page.references == []
    assert "What the skill does" not in page.markdown and "###" not in page.markdown.replace("### Gather", "").replace("### Draft", "")
    # Unfilled to-dos and bullets are not published, nor the lists they leave empty.
    assert "- [ ]\n" not in page.markdown + "\n" and "- [ ] Every claim cites a source" in page.markdown
    assert not re.search(r"^\s*[-*]\s*$", page.markdown, flags=re.MULTILINE)
    # A numbered list works as Steps too.
    numbered = parse_skill_page("x", "<h2>Description</h2><p>Does x.</p><h2>Steps</h2><ol><li><p>Open it. Then read.</p></li><li><p>Save.</p></li></ol>")
    assert [step.title for step in numbered.steps] == ["Open it", "Save"]


@pytest.mark.asyncio
async def test_publish_lists_the_skill_with_teaching_and_republish_keeps_its_id_and_name(app: FastAPI) -> None:
    async with client(app) as http:
        project, voice = await _workspace(http)
        html = skill_page(extra=f"<h2>Notes</h2><p>The project agent {chip('agent', f'project/{project['id']}', 'Writing (WR)')} "
                                f"files follow-ups; connect {chip('mcp', 'user_browser', 'user_browser')}.</p>").replace("{doc}", voice["id"])
        page = (await http.post("/projects/documents", json={"project_id": project["id"], "title": "Weekly brief", "content": html})).json()
        assert (await http.get(f"/projects/documents/{page['id']}/skill", params=GUEST)).json() == {"skill": None}

        published = await http.post(f"/projects/documents/{page['id']}/skill", json=GUEST)
        assert published.status_code == 200, published.text
        body = published.json()
        skill_id = f"doc-{page['id'].replace('-', '')}"
        assert body["status"] == "published"
        assert body["skill"] | {"created_at": None, "updated_at": None} == {
            "id": skill_id, "name": "weekly-brief", "description": "Write a weekly brief about a topic from current sources.",
            "agent_id": "panel", "created_at": None, "updated_at": None, "published_version": 1, "current": True,
            "steps": 2, "listed": True,
            "files": ["SKILL.md", "workflow.sop.md", "tool-group.json", "capabilities.json",
                      f"references/voice-guide-{voice['id'].replace('-', '')[:8]}.md", "manifest.json"]}

        # Listed where taught skills are, with the native discovery entry.
        listed = (await http.get("/teaching/skills", params=GUEST)).json()["skills"]
        assert [(item["id"], item["name"], item["memory_registered"]) for item in listed] == [(skill_id, "weekly-brief", True)]
        service = teaching.get_teaching_service()
        manifest = await service.read_skill("default", "panel", skill_id)
        steps = _group_steps(manifest)  # the same validation use_skill runs
        project_tools = await document_skills._project_tool_names("default", project["id"])
        assert "read_issue" in project_tools and "create_issue" in project_tools
        assert steps[0].tools == sorted({"http_request", "current_time", "mcp_client", *project_tools})
        assert manifest["approval"]["source"] == "document" and manifest["source_document"]["version"] == 1

        directory = service.root / _scope("default", "panel") / "skills" / skill_id / "weekly-brief"
        skill = Skill.from_file(directory, strict=True)
        assert skill.name == "weekly-brief" and "@[Ron](ron://agent/ron)" in skill.instructions
        capabilities = json.loads((directory / "capabilities.json").read_text())
        assert set(capabilities["tools"]) == {"http_request", "current_time"}
        assert capabilities["mcp_servers"] == ["user_browser"] and capabilities["mcp_connections"]["user_browser"]["command"]
        assert capabilities["specialists"] == {"Ren": document_skills_a2a_url()}
        assert capabilities["project_agents"]["Writing (WR)"]["project_id"] == project["id"]
        reference = (directory / f"references/voice-guide-{voice['id'].replace('-', '')[:8]}.md").read_text()
        assert reference.startswith("# Voice guide") and "**No jargon.**" in reference
        sop = (directory / "workflow.sop.md").read_text()
        assert "## Overview" in sop and 'mcp_client(action="connect", connection_id="user_browser"' in sop
        assert "You MUST validate this outcome before advancing: at least three sources are read." in sop

        # Editing the page marks the skill stale until it is republished, under the same id and name.
        edited = await http.patch(f"/projects/documents/{page['id']}", json={"version": page["version"], "title": "Renamed brief",
                                  "content": html.replace("Write a weekly brief", "Write a short weekly brief")})
        assert edited.status_code == 200, edited.text
        assert (await http.get(f"/projects/documents/{page['id']}/skill", params=GUEST)).json()["skill"]["current"] is False
        again = (await http.post(f"/projects/documents/{page['id']}/skill", json=GUEST)).json()
        assert again["status"] == "updated" and again["skill"]["id"] == skill_id and again["skill"]["name"] == "weekly-brief"
        assert again["skill"]["created_at"] == body["skill"]["created_at"] and again["skill"]["current"] is True
        assert [item["description"] for item in (await http.get("/teaching/skills", params=GUEST)).json()["skills"]] == [
            "Write a short weekly brief about a topic from current sources."]
        found = await service.get_memory_store("default", "panel").search("short weekly brief")
        assert any("Write a short weekly brief" in entry.content for entry in found)


def document_skills_a2a_url() -> str:
    from agent.api.core.a2a_tools import panel_a2a_url

    return panel_a2a_url()


@pytest.mark.asyncio
async def test_unknown_references_are_one_422_and_nothing_is_published(app: FastAPI) -> None:
    async with client(app) as http:
        project, voice = await _workspace(http)
        missing = "00000000-0000-4000-8000-0000000000aa"
        html = skill_page(tool="no_such_tool", extra=(
            f"<p>{chip('mcp', 'nowhere', 'nowhere')} {chip('skill', 'ghost-skill', 'ghost-skill')} "
            f"{chip('agent', 'specialist/' + missing, 'Researcher')} {chip('agent', 'gremlin', 'Gremlin')}</p>")).replace("{doc}", missing)
        page = (await http.post("/projects/documents", json={"project_id": project["id"], "title": "Broken", "content": html})).json()
        response = await http.post(f"/projects/documents/{page['id']}/skill", json=GUEST)
        assert response.status_code == 422
        detail = response.json()["detail"]
        for expected in ("tool “no_such_tool” is not in the tool catalog", "mcp “nowhere” is not a configured MCP server",
                         "skill “ghost-skill” is not one of this agent's skills", "agent “Researcher” needs a signed-in account",
                         "agent “Gremlin” is not an agent Ren knows", "document “Voice guide” is not a page you can open"):
            assert expected in detail, detail
        assert (await http.get("/teaching/skills", params=GUEST)).json() == {"skills": []}

        # A page cannot reference itself, and the content rules are 422s with the reason.
        own = skill_page().replace("{doc}", page["id"])
        assert (await http.patch(f"/projects/documents/{page['id']}", json={"version": page["version"], "content": own})).status_code == 200
        assert "is this page itself" in (await http.post(f"/projects/documents/{page['id']}/skill", json=GUEST)).json()["detail"]
        for title, content, reason in (
            ("No description", "<h2>Steps</h2><ol><li><p>Do it.</p></li></ol>", "under Description"),
            ("No steps", "<h2>Description</h2><p>Does a thing.</p>", "at least one step"),
            ("Untitled", "<h2>Description</h2><p>Does a thing.</p><h2>Steps</h2><ol><li><p>Do it.</p></li></ol>", "Name this page first"),
        ):
            draft = (await http.post("/projects/documents", json={"project_id": project["id"], "title": title, "content": content})).json()
            failed = await http.post(f"/projects/documents/{draft['id']}/skill", json=GUEST)
            assert failed.status_code == 422 and reason in failed.json()["detail"], failed.text
        assert voice["id"]


@pytest.mark.asyncio
async def test_publishing_is_owner_bound(app: FastAPI) -> None:
    async with client(app) as http:
        project, voice = await _workspace(http)
        html = skill_page().replace("{doc}", voice["id"])
        page = (await http.post("/projects/documents", json={"project_id": project["id"], "title": "Weekly brief", "content": html})).json()
        assert (await http.post(f"/projects/documents/{page['id']}/skill", json={"user_id": "someone", "agent_id": "panel"})).status_code == 403
        assert (await http.post(f"/projects/documents/{page['id']}/skill", json={**GUEST, "agent_id": "issue:1"})).status_code == 422
        # Same name as another skill of this agent: the second page must be renamed.
        assert (await http.post(f"/projects/documents/{page['id']}/skill", json=GUEST)).status_code == 200
        twin = (await http.post("/projects/documents", json={"project_id": project["id"], "title": "Weekly Brief!", "content": html})).json()
        clash = await http.post(f"/projects/documents/{twin['id']}/skill", json=GUEST)
        assert clash.status_code == 422 and "already named “weekly-brief”" in clash.json()["detail"]
    async with client(app, None) as anonymous:
        assert (await anonymous.post(f"/projects/documents/{page['id']}/skill", json=GUEST)).status_code == 401
    async with client(app, {"X-Ron-Workspace": "f" * 64}) as stranger:
        assert (await stranger.post(f"/projects/documents/{page['id']}/skill", json=GUEST)).status_code == 404
        assert (await stranger.get(f"/projects/documents/{page['id']}/skill", params=GUEST)).status_code == 404


@pytest.mark.asyncio
async def test_reference_catalog_offers_assignable_tools_mcp_servers_skills_and_ron(app: FastAPI) -> None:
    async with client(app) as http:
        project, voice = await _workspace(http)
        page = (await http.post("/projects/documents", json={"project_id": project["id"], "title": "Weekly brief",
                                                             "content": skill_page().replace("{doc}", voice["id"])})).json()
        assert (await http.post(f"/projects/documents/{page['id']}/skill", json=GUEST)).status_code == 200
        catalog = (await http.get("/teaching/references", params={"user_id": "default"})).json()
    tools = {item["id"]: item for item in catalog["tools"]}
    assert {"http_request", "brave_web_search", "render_ui", "mcp_client"} <= tools.keys()
    assert tools["http_request"]["group"] == "Core tools" and tools["current_time"]["group"].startswith("Library · ")
    assert not {"use_skill", "think", "ask_user", "tool_catalog", "create_harness"} & tools.keys()
    assert not [name for name in tools if name.startswith("strands_")]
    assert {"user_browser", "cloud_browser"} <= {item["id"] for item in catalog["mcp_servers"]}
    assert [(item["id"], item["group"]) for item in catalog["skills"] if item["group"] == "Learned skills"] == [("weekly-brief", "Learned skills")]
    assert catalog["agents"][0]["id"] == "ron" and catalog["agents"][0]["a2a_url"] == document_skills_a2a_url()


class SopChild(Model):
    """Scripted SOP child: answers with the native structured-output tool on its first turn."""

    def __init__(self) -> None:
        self.seen: dict[str, Any] = {}

    def update_config(self, **config: Any) -> None:
        pass

    def get_config(self) -> dict[str, Any]:
        return {"model_id": "sop-child"}

    async def structured_output(self, *args: Any, **kwargs: Any):  # type: ignore[override]
        raise NotImplementedError
        yield {}

    async def stream(self, messages: list[dict[str, Any]], tool_specs: list[dict[str, Any]] | None = None,
                     system_prompt: str | None = None, **_: Any):
        self.seen = {"tools": [spec["name"] for spec in tool_specs or []], "system": system_prompt or "",
                     "prompt": "".join(block.get("text", "") for block in messages[0]["content"])}
        outcome = next(spec["name"] for spec in tool_specs or [] if spec["name"] == "StepOutcome")
        yield {"messageStart": {"role": "assistant"}}
        yield {"contentBlockStart": {"contentBlockIndex": 0, "start": {"toolUse": {"toolUseId": "o1", "name": outcome}}}}
        yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"toolUse": {"input": json.dumps(
            {"complete": True, "evidence": "followed workflow.sop.md", "result": "brief written"})}}}}
        yield {"contentBlockStop": {"contentBlockIndex": 0}}
        yield {"messageStop": {"stopReason": "tool_use"}}


@pytest.mark.asyncio
async def test_use_skill_runs_a_published_page_through_the_native_sop(app: FastAPI) -> None:
    async with client(app) as http:
        project, voice = await _workspace(http)
        page = (await http.post("/projects/documents", json={"project_id": project["id"], "title": "Weekly brief",
                                                             "content": skill_page().replace("{doc}", voice["id"])})).json()
        assert (await http.post(f"/projects/documents/{page['id']}/skill", json=GUEST)).status_code == 200
    from agent.api.core.panel_agent import PROJECT_TOOLS_DIR
    from agent.api.core.panel_tools import load_library_tool

    root = PROJECT_TOOLS_DIR.expanduser().resolve()
    library = document_skills._library_tools()["current_time"]
    assigned = [*document_skills._core_tools().values(), load_library_tool(root, root / library["path"], "current_time")]
    child = SopChild()
    _, use_skill = teaching.create_learned_skill_tools("default", "panel", lambda _name: child, additional_tools=assigned)
    outcome = await use_skill(skill_name="weekly-brief", request="Brief me on solar power")  # type: ignore[operator]
    assert outcome["status"] == "completed" and outcome["results"][0]["result"] == "brief written"
    assert {"http_request", "current_time", "read_skill_file", "a2a_send_message"} <= set(child.seen["tools"])
    assert "# Weekly brief" in child.seen["system"] and "### 1. Gather sources" in child.seen["prompt"]
    assert "Brief me on solar power" in child.seen["prompt"]


@pytest.mark.asyncio
async def test_use_skill_names_a_library_tool_the_agent_has_not_loaded(app: FastAPI) -> None:
    async with client(app) as http:
        project, voice = await _workspace(http)
        page = (await http.post("/projects/documents", json={"project_id": project["id"], "title": "Weekly brief",
                                                             "content": skill_page().replace("{doc}", voice["id"])})).json()
        assert (await http.post(f"/projects/documents/{page['id']}/skill", json=GUEST)).status_code == 200
    _, use_skill = teaching.create_learned_skill_tools("default", "panel", lambda _name: SopChild(),
                                                       additional_tools=list(document_skills._core_tools().values()))
    with pytest.raises(ValueError, match="SOP requires unavailable tools: current_time"):
        await use_skill(skill_name="weekly-brief", request="x")  # type: ignore[operator]
