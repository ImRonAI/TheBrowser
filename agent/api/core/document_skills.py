"""Agent Skills authored as project pages (Documents -> "Agent Skill" template -> Publish as skill).

A page becomes a native Agent Skill: an AgentSkills.io ``SKILL.md`` (YAML ``name``/``description``,
validated with the SDK's ``Skill.from_file(strict=True)``, strands/vended_plugins/skills/skill.py:254)
plus a native Agent SOP ``workflow.sop.md`` (read by the unmodified ``strands_agents_sops`` loader and MCP
server, ``core/native_sop.py``). It is stored where taught skills live, ``TeachingService`` storage under
the user/agent scope, with the same manifest, ``tool_group`` and ``_register_memory`` entry
(``TeachingService.install_skill``), so ``list_learned_skills``, ``use_skill`` and ``GET /teaching/skills``
find and run it without a separate registry. Republishing the page replaces the skill with the same id
(``doc-<page uuid hex>``) and keeps its name, because other skills and agents call it by that name.

The page's ``@`` references (the editor's ReferenceMention chips:
``<span data-type="reference" data-kind data-id data-label>``) are resolved against the real catalogs:
tools (the panel's core tools + the vendored library ``tool_catalog`` lists), MCP servers (``mcp.json`` and
the browser servers the panel catalog loads), agents (Ron's A2A server, the user's stored specialists, a
project's agent), skills (this agent's learned skills + configured ``PANEL_SKILLS_DIRS``) and pages (read
with the caller's own project access). An unknown reference is a 422.

NOT NATIVE (minimal): reading the page's sections (Description, When to use, Inputs, Steps, Completion
criteria) and turning the resolved references into the SOP's step assignments and ``capabilities.json``.
"""

from __future__ import annotations

import asyncio
import functools
import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from html import escape
from typing import Any
from uuid import UUID

import yaml
from bs4 import BeautifulSoup, NavigableString, Tag
from markdownify import MarkdownConverter

from agent.api.core.projects import ProjectIdentity, ProjectService
from agent.api.core.teaching import GroupMember, GroupStep, Step, TeachingService, ToolGroup, _configured_skills, _scope

#: The panel's guest user id (renderer: ``useAuthStore user?.id || 'default'``); guests teach under it too.
GUEST_USER_ID = "default"
REFERENCE_KINDS = ("document", "tool", "agent", "mcp", "skill")
#: Tools a skill step can never be assigned: the panel agent's ``skill_tools()`` leaves them out of the
#: tools ``use_skill`` lends a skill (panel_agent.py ``create_panel_agent``), as it does ``strands_*`` and
#: browser tools.
NOT_ASSIGNABLE = frozenset({"use_skill", "list_learned_skills", "think", "ask_user", "tool_catalog", "create_harness"})
#: The project agent's media tool depends on its lead model (``media_understanding.media_tools``).
MEDIA_TOOLS = frozenset({"view_media", "understand_media"})
SECTIONS = {
    "description": "description", "summary": "description",
    "when to use": "use_when", "when to use it": "use_when", "use when": "use_when",
    "inputs": "inputs", "parameters": "inputs",
    "steps": "steps", "workflow": "steps", "procedure": "steps",
    "completion criteria": "criteria", "done when": "criteria", "success criteria": "criteria",
}
OUTCOME_PREFIX = re.compile(r"^\s*(done when|outcome|expected outcome)\s*:\s*", re.IGNORECASE)


class SkillDocumentError(ValueError):
    """The page cannot be published as written (HTTP 422)."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# --- Page HTML -> Markdown ----------------------------------------------------------------------


def reference_markdown(kind: str, ref_id: str, label: str) -> str:
    """How a reference reads in Markdown: ``@[label](ron://<kind>/<id>)`` (same as the editor's renderMarkdown)."""
    text = re.sub(r"\s+", " ", label or ref_id).strip().replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]")
    return f"@[{text}](ron://{kind}/{ref_id})"


class _PageMarkdown(MarkdownConverter):
    """markdownify, with ReferenceMention chips written as ``@[label](ron://kind/id)`` (unescaped)."""

    def convert_span(self, el: Tag, text: str, parent_tags: set[str]) -> str:
        if el.get("data-type") == "reference":
            return reference_markdown(str(el.get("data-kind", "")), str(el.get("data-id", "")), str(el.get("data-label", "")))
        return text


def _soup(html: str) -> BeautifulSoup:
    """The page as the editor wrote it, with Tiptap task items flattened to ``[x] text`` list items."""
    soup = BeautifulSoup(html or "", "html.parser")
    for item in soup.select('li[data-type="taskItem"]'):
        label = item.find("label", recursive=False)
        if label is not None:
            label.decompose()
        body = item.find("div", recursive=False)
        if body is not None:
            body.unwrap()
        first = item.find("p")
        if first is not None and len(item.find_all("p", recursive=False)) == 1:
            first.unwrap()
        item.insert(0, NavigableString("[x] " if item.get("data-checked") == "true" else "[ ] "))
    return soup


def _markdown(nodes: list[Any] | BeautifulSoup) -> str:
    """Markdown of a whole page, or of some of its nodes (re-serialized, so the page tree is untouched)."""
    if not isinstance(nodes, BeautifulSoup):
        nodes = BeautifulSoup("".join(node.decode() if isinstance(node, Tag) else escape(str(node)) for node in nodes), "html.parser")
    return _PageMarkdown(heading_style="ATX", bullets="-").convert_soup(nodes).strip()


def page_markdown(html: str) -> str:
    """A page's HTML as Markdown, references as ``@[label](ron://kind/id)`` (what agents read)."""
    return _markdown(_soup(html))


# --- Reading a skill page -----------------------------------------------------------------------


@dataclass
class Reference:
    kind: str
    id: str
    label: str


@dataclass
class PageStep:
    title: str
    instructions: str
    outcome: str
    references: list[Reference] = field(default_factory=list)


@dataclass
class SkillPage:
    title: str
    description: str
    use_when: str
    inputs: list[str]
    steps: list[PageStep]
    criteria: list[str]
    #: References outside Steps apply to every step.
    references: list[Reference]
    markdown: str


def _is_note(node: Tag) -> bool:
    """An author note: a paragraph that is only italic text (the templates' guidance). Never published."""
    if node.name != "p":
        return False
    children = [child for child in node.children if not (isinstance(child, NavigableString) and not child.strip())]
    return len(children) == 1 and isinstance(children[0], Tag) and children[0].name in {"em", "i"}


def _references(nodes: list[Tag]) -> list[Reference]:
    found: list[Reference] = []
    for node in nodes:
        chips = [node] if node.get("data-type") == "reference" else node.select('span[data-type="reference"]')
        for chip in chips:
            kind, ref_id = str(chip.get("data-kind", "")), str(chip.get("data-id", ""))
            label = str(chip.get("data-label") or chip.get_text() or ref_id).lstrip("@")
            found.append(Reference(kind, ref_id, label))
    return found


def _text(node: Tag) -> str:
    return re.sub(r"\s+", " ", node.get_text(" ")).strip()


def _item_markdown(item: Tag) -> str:
    """One list item's content as one line of Markdown (without its bullet)."""
    return re.sub(r"\s+", " ", _markdown(list(item.children))).strip()


def _items(nodes: list[Tag]) -> list[str]:
    """List items (or paragraphs) of a section as one-line Markdown entries."""
    entries: list[str] = []
    for node in nodes:
        if node.name in {"ul", "ol"}:
            entries += [_item_markdown(item) for item in node.find_all("li", recursive=False)]
        elif node.name == "p":
            entries.append(re.sub(r"\s+", " ", _markdown([node])).strip())
    return [entry for entry in entries if entry and entry not in {"[ ]", "[x]"}]


def _step(title: str, nodes: list[Any]) -> PageStep:
    """A step: its instructions, its outcome (a "Done when:" paragraph) and the references it makes."""
    outcome = next((OUTCOME_PREFIX.sub("", _text(node)) for node in nodes
                    if isinstance(node, Tag) and node.name == "p" and OUTCOME_PREFIX.match(_text(node))), "")
    tags = [node for node in nodes if isinstance(node, Tag)]
    return PageStep(title=title, instructions=_markdown(nodes), outcome=outcome, references=_references(tags))


def parse_skill_page(title: str, html: str) -> SkillPage:
    """Sections by H1/H2 heading; steps are the H3 headings under Steps (or the items of its numbered list).

    Author notes (italic-only paragraphs) are dropped first. References outside Steps (and above its
    first step) apply to every step.
    """
    soup = _soup(html)
    # Notes, empty headings and an unfilled "Done when:" line are template scaffolding, not content.
    for note in [node for node in soup.find_all(["p", "h1", "h2", "h4", "h5", "h6"])
                 if _is_note(node) or (node.name != "p" and not _text(node))
                 or (node.name == "p" and OUTCOME_PREFIX.match(_text(node)) and not OUTCOME_PREFIX.sub("", _text(node)))]:
        note.decompose()
    # So are unfilled bullets and to-dos (the templates' empty list items), and lists they leave empty.
    for item in [li for li in soup.find_all("li") if not re.sub(r"^\[[ x]\]", "", _text(li)).strip() and not _references([li])]:
        item.decompose()
    for empty in [lst for lst in soup.find_all(["ul", "ol"]) if not lst.find("li")]:
        empty.decompose()
    sections: dict[str, list[Tag]] = {}
    other: list[Tag] = []
    current: list[Tag] = other
    for node in soup.children:
        if not isinstance(node, Tag):
            continue
        if node.name in {"h1", "h2"}:
            key = SECTIONS.get(_text(node).lower().rstrip(":"))
            if key:
                current = sections.setdefault(key, [])
                continue
            current = other
        current.append(node)

    # Plain text: the frontmatter description is what agents match a request against.
    description = " ".join(_text(node) for node in sections.get("description", []) if _text(node)).strip()
    if not description:
        raise SkillDocumentError("Write what the skill does and when to use it under Description; it becomes the skill's description.")
    if len(description) > 1024:
        raise SkillDocumentError(f"The Description is {len(description)} characters; an Agent Skill description is at most 1024.")

    blocks = sections.get("steps", [])
    steps: list[PageStep] = []
    unassigned: list[Tag] = []
    if any(node.name == "h3" for node in blocks):
        groups: list[tuple[str, list[Tag]]] = []
        for node in blocks:
            if node.name == "h3":
                groups.append((re.sub(r"^\s*(step\s*)?\d+\s*[.):-]?\s*", "", _text(node), flags=re.IGNORECASE), []))
            elif groups:
                groups[-1][1].append(node)
            else:
                unassigned.append(node)
        steps = [_step(heading, nodes) for heading, nodes in groups]
    else:
        numbered = next((node for node in blocks if node.name == "ol"), None)
        unassigned = [node for node in blocks if node is not numbered]
        for item in numbered.find_all("li", recursive=False) if numbered is not None else []:
            line = _item_markdown(item)
            steps.append(_step(re.split(r"(?<=[.!?])\s", line, maxsplit=1)[0].rstrip(".")[:200], list(item.children)))
    # An unedited template slot (no heading text, nothing written under it) is not a step.
    steps = [step for step in steps if step.title or step.instructions]
    if not steps:
        raise SkillDocumentError("Add at least one step under Steps: a ### heading per step with what Ren does, or a numbered list.")
    for index, step in enumerate(steps, 1):
        if len(step.instructions) > 12000:
            raise SkillDocumentError(f"Step {index} is {len(step.instructions)} characters; a step holds at most 12000.")
        step.title = (step.title or f"Step {index}")[:200]
        step.instructions = step.instructions or step.title

    outside = [node for key, nodes in sections.items() if key != "steps" for node in nodes] + other + unassigned
    for heading in [node for node in soup.find_all("h3") if not _text(node)]:
        heading.decompose()
    return SkillPage(
        title=title, description=description,
        use_when=re.sub(r"\s+", " ", _markdown(sections.get("use_when", []))).strip(),
        inputs=_items(sections.get("inputs", [])), steps=steps,
        criteria=_items(sections.get("criteria", [])),
        references=_references(outside), markdown=_markdown(soup),
    )


def skill_name(title: str) -> str:
    """The AgentSkills.io name for a page title: lowercase letters, digits and single hyphens, <= 64."""
    ascii_title = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", ascii_title).strip("-")[:64].rstrip("-")


# --- Catalogs ----------------------------------------------------------------------------------


@functools.cache
def _core_tools() -> dict[str, Any]:
    """The panel's always-registered tools (``build_core_tools``; ``tool_catalog`` is never lent to a skill)."""
    from agent.api.core.panel_agent import PROJECT_TOOLS_DIR
    from agent.api.core.panel_tools import build_core_tools

    return {value.tool_name: value for value in build_core_tools(PROJECT_TOOLS_DIR) if value.tool_name not in NOT_ASSIGNABLE}


@functools.cache
def _library_tools() -> dict[str, dict[str, Any]]:
    """What ``tool_catalog`` lists from the vendored library (same scan and exclusions)."""
    from agent.api.core.panel_agent import PROJECT_TOOLS_DIR
    from agent.api.core.panel_tools import CORE_TOOL_NAMES, scan_vendored_tools

    excluded = (*CORE_TOOL_NAMES, "tool_catalog", "ask_user", "think")
    entries: dict[str, dict[str, Any]] = {}
    for item in scan_vendored_tools(PROJECT_TOOLS_DIR.expanduser().resolve(), exclude=excluded):
        if item["name"] not in NOT_ASSIGNABLE and not item["name"].startswith("strands_"):
            entries.setdefault(item["name"], item)
    return entries


def _summary(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().split("\n\n")[0])[:300]


def tool_catalog_entries() -> list[dict[str, str]]:
    core = [{"id": name, "label": name, "description": _summary(value.tool_spec.get("description", "")), "group": "Core tools"}
            for name, value in sorted(_core_tools().items())]
    library = [{"id": name, "label": name, "description": _summary(item["description"]),
                "group": f"Library · {item['category'] or 'general'}"}
               for name, item in sorted(_library_tools().items()) if name not in _core_tools()]
    return core + library


def mcp_servers() -> dict[str, dict[str, Any]]:
    """MCP servers by name with their stdio config: ``mcp.json`` plus the browser servers the panel loads.

    ``mcp.json`` is checked into the repository, so its entries carry no secrets.
    """
    from agent.api.core.panel_browser import BROWSERS, REPO_ROOT, browser_server_config

    servers: dict[str, dict[str, Any]] = {}
    path = REPO_ROOT / "mcp.json"
    if path.is_file():
        for name, entry in (json.loads(path.read_text(encoding="utf-8")).get("mcpServers") or {}).items():
            servers[name] = {"command": entry.get("command", ""), "args": list(entry.get("args", [])), "env": dict(entry.get("env", {}))}
    for browser in BROWSERS:
        servers.update(browser_server_config(browser))
    return servers


def _mcp_description(name: str) -> str:
    from agent.api.core.panel_browser import BROWSERS, server_name

    if name == server_name("user"):
        return "The user's browser (this Ren window) through electron-playwright-mcp."
    if name == server_name("cloud"):
        return "The headless cloud browser through electron-playwright-mcp."
    if name in {server_name(browser) for browser in BROWSERS}:
        return "A browser through electron-playwright-mcp."
    return "MCP server from mcp.json (stdio)."


async def reference_catalog(service: TeachingService, user_id: str, agent_id: str) -> dict[str, Any]:
    """What the page editor's ``@`` menu offers besides pages and the user's own agents (renderer)."""
    from agent.api.core.a2a_tools import a2a_enabled, panel_a2a_url

    learned = await service.list_skills(user_id, agent_id)
    skills = [{"id": item["name"], "label": item["name"], "description": _summary(item.get("description", "")),
               "group": "Learned skills"} for item in learned]
    skills += [{"id": name, "label": name, "description": _summary(skill.description), "group": "Configured skills"}
               for name, skill in sorted(_configured_skills().items()) if name not in {item["id"] for item in skills}]
    tools = await asyncio.to_thread(tool_catalog_entries)
    return {
        "tools": tools,
        "mcp_servers": [{"id": name, "label": name, "description": _mcp_description(name), "group": "MCP servers"}
                        for name in sorted(mcp_servers())],
        "skills": skills,
        "agents": [{"id": "ron", "label": "Ren", "description": "Ren's own agent over A2A.", "group": "Agents",
                    "a2a_url": panel_a2a_url()}] if a2a_enabled() else [],
    }


# --- Resolving references and publishing --------------------------------------------------------


def bind_owner(identity: ProjectIdentity, user_id: str) -> None:
    """A signed-in caller publishes for themselves; a guest for the panel's guest scope (as Teach Ron does)."""
    from fastapi import HTTPException

    if identity.guest and user_id != GUEST_USER_ID:
        raise HTTPException(403, f"Guest workspaces publish skills for the guest agent (user_id={GUEST_USER_ID!r}).")
    if not identity.guest and identity.user_id != user_id:
        raise HTTPException(403, "The project credential belongs to another user")


def skill_id_for(document_id: str) -> str:
    return f"doc-{UUID(document_id).hex}"


def _slug(text: str, fallback: str) -> str:
    return skill_name(text)[:48].rstrip("-") or fallback


async def _project_tool_names(user_id: str, project_id: str) -> list[str]:
    """The project agent's own tools (``project_agent.project_agent_tools``), minus its model-specific media tool."""
    from agent.api.core.project_agent import project_agent_tools

    tools = await asyncio.to_thread(project_agent_tools, user_id, "document-skill", project_id,
                                    provider="perplexity", model_id="")
    return [value.tool_name for value in tools if value.tool_name not in MEDIA_TOOLS]


async def _resolve(page: SkillPage, *, identity: ProjectIdentity, service: TeachingService, user_id: str,
                   agent_id: str, document_id: str, skill_id: str) -> dict[str, Any]:
    """Every reference, checked against the real catalogs. Collects all failures into one 422."""
    from agent.api.core.a2a_tools import a2a_enabled, panel_a2a_url
    from agent.api.core.panel_agent import PROJECT_TOOLS_DIR
    from agent.api.core.panel_tools import load_library_tool

    projects = ProjectService(identity)
    learned = {item["name"]: item for item in await service.list_skills(user_id, agent_id) if item["id"] != skill_id}
    configured = _configured_skills()
    servers = mcp_servers()
    core, library = await asyncio.to_thread(_core_tools), await asyncio.to_thread(_library_tools)
    own_name = await _existing_name(service, user_id, agent_id, skill_id)
    errors: list[str] = []
    seen: set[tuple[str, str]] = set()
    resolved: dict[tuple[str, str], dict[str, Any]] = {}
    for ref in [*page.references, *[ref for step in page.steps for ref in step.references]]:
        key = (ref.kind, ref.id)
        if key in seen:
            continue
        seen.add(key)
        try:
            if ref.kind == "tool":
                if ref.id in core:
                    resolved[key] = {"name": ref.id, "spec": core[ref.id].tool_spec, "source": "core"}
                elif ref.id in library:
                    item = library[ref.id]
                    root = PROJECT_TOOLS_DIR.expanduser().resolve()
                    try:
                        loaded = await asyncio.to_thread(load_library_tool, root, root / item["path"], ref.id)
                    except (ImportError, ValueError) as error:
                        raise SkillDocumentError(f"cannot be imported: {error}") from error
                    resolved[key] = {"name": ref.id, "spec": loaded.tool_spec, "source": "library", "path": item["path"]}
                else:
                    raise SkillDocumentError("is not in the tool catalog")
            elif ref.kind == "mcp":
                if ref.id not in servers:
                    raise SkillDocumentError("is not a configured MCP server")
                resolved[key] = {"name": ref.id, "config": servers[ref.id]}
            elif ref.kind == "skill":
                if ref.id == own_name:
                    raise SkillDocumentError("is this skill itself")
                if ref.id not in learned and ref.id not in configured:
                    raise SkillDocumentError("is not one of this agent's skills")
                resolved[key] = {"name": ref.id}
            elif ref.kind == "agent":
                resolved[key] = await _resolve_agent(ref, projects, user_id, a2a_enabled(), panel_a2a_url())
            elif ref.kind == "document":
                if str(UUID(ref.id)) == document_id:
                    raise SkillDocumentError("is this page itself")
                rows = await projects.rows("project_documents", id=f"eq.{UUID(ref.id)}")
                if not rows:
                    raise SkillDocumentError("is not a page you can open")
                row = rows[0]
                resolved[key] = {"title": row["title"], "id": row["id"], "project_id": row["project_id"],
                                 "version": row["version"], "markdown": page_markdown(row.get("content") or ""),
                                 "path": f"references/{_slug(row['title'], 'page')}-{UUID(row['id']).hex[:8]}.md"}
            else:
                raise SkillDocumentError("has an unknown reference kind")
        except SkillDocumentError as error:
            errors.append(f"{ref.kind} “{ref.label}” {error}")
        except ValueError:
            errors.append(f"{ref.kind} “{ref.label}” has an invalid id")
    if errors:
        raise SkillDocumentError("Unknown or unusable references: " + "; ".join(errors) + ".")
    return {f"{kind}:{ref_id}": value for (kind, ref_id), value in resolved.items()}


async def _existing_name(service: TeachingService, user_id: str, agent_id: str, skill_id: str) -> str | None:
    data = await service.storage.read(f"{_scope(user_id, agent_id)}/skills/{skill_id}/manifest.json")
    return json.loads(data)["name"] if data else None


async def _resolve_agent(ref: Reference, projects: ProjectService, user_id: str, a2a_on: bool, a2a_url: str) -> dict[str, Any]:
    if ref.id == "ron":
        if not a2a_on:
            raise SkillDocumentError("needs Ren's A2A server, which is turned off (PANEL_A2A_ENABLED=0)")
        return {"kind": "ron", "name": "Ren", "url": a2a_url}
    kind, _, target = ref.id.partition("/")
    if kind == "specialist":
        from agent.api.core.harness_agents import SignInRequired, agent_url, harness_table, owner_uuid

        try:
            owner = owner_uuid(user_id)
        except SignInRequired as error:
            raise SkillDocumentError(f"needs a signed-in account: {error}") from error
        try:
            rows = (await (await harness_table()).select("id,name").eq("id", str(UUID(target))).eq("owner_id", owner).limit(1).execute()).data
        except RuntimeError as error:
            raise SkillDocumentError(f"cannot be checked: {error}") from error
        if not rows:
            raise SkillDocumentError("is not one of your specialist agents")
        return {"kind": "specialist", "name": rows[0]["name"], "url": agent_url(rows[0]["id"])}
    if kind == "project":
        rows = await projects.rows("projects", select="id,name,key", id=f"eq.{UUID(target)}")
        if not rows:
            raise SkillDocumentError("is not a project you can open")
        project = rows[0]
        return {"kind": "project", "name": f"{project['name']} ({project['key']})", "project_id": project["id"],
                "tools": await _project_tool_names(user_id, project["id"])}
    raise SkillDocumentError("is not an agent Ren knows")


def _assignments(refs: list[Reference], resolved: dict[str, Any]) -> tuple[list[str], list[str]]:
    """The tools and skills a step is assigned from the references it (or the page) makes."""
    tools: list[str] = []
    skills: list[str] = []
    for ref in refs:
        value = resolved[f"{ref.kind}:{ref.id}"]
        if ref.kind == "tool":
            tools.append(value["name"])
        elif ref.kind == "mcp":
            tools.append("mcp_client")
        elif ref.kind == "skill":
            skills.append(value["name"])
        elif ref.kind == "agent" and value["kind"] == "project":
            tools += value["tools"]
    return sorted(set(tools)), sorted(set(skills))


def _required_capabilities(resolved: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    for key, value in resolved.items():
        kind = key.split(":", 1)[0]
        if kind == "tool":
            lines.append(f"- You MUST use the `{value['name']}` tool where a step assigns it and verify its result before advancing.")
        elif kind == "mcp":
            config = value["config"]
            lines.append(
                f"- You MUST connect the `{value['name']}` MCP server before the steps that use it with "
                f"mcp_client(action=\"connect\", connection_id=\"{value['name']}\", transport=\"stdio\", "
                f"command={json.dumps(config['command'])}, args={json.dumps(config['args'])}, env={json.dumps(config['env'])}), "
                f"list its tools with mcp_client(action=\"list_tools\", connection_id=\"{value['name']}\") and call them with "
                f"mcp_client(action=\"call_tool\", connection_id=\"{value['name']}\", tool_name=..., tool_args=...).")
        elif kind == "skill":
            lines.append(f"- You MUST run the skill `{value['name']}` with use_assigned_skill(name=\"{value['name']}\", request=...) where a step assigns it.")
        elif kind == "agent" and value["kind"] in {"ron", "specialist"}:
            lines.append(f"- You MUST delegate the steps that name `{value['name']}` with a2a_send_message(message_text=..., "
                         f"target_agent_url=\"{value['url']}\") and verify its reply before advancing.")
        elif kind == "agent":
            lines.append(f"- The steps that name the project agent `{value['name']}` use that project's tools "
                         f"({', '.join(value['tools'])}). They act with the user's own project access and exist only when this "
                         f"skill runs from that project's agent in the Agent Panel; if they are missing, stop and report it.")
        elif kind == "document":
            lines.append(f"- You MUST read `{value['path']}` with read_skill_file(path=\"{value['path']}\") before the steps that cite "
                         f"the page “{value['title']}” (it is the page as it was when this skill was published).")
    lines.append("- You MUST NOT execute a step with missing or unverified capabilities, because a step that runs without its "
                 "tool produces a fabricated or partial result the user did not ask for.")
    lines.append("- You MUST NOT modify existing tools or skills, because other skills and agents depend on them; copy before adapting.")
    return lines


def _build(page: SkillPage, *, name: str, resolved: dict[str, Any], document: dict[str, Any]) -> tuple[list[Step], ToolGroup, dict[str, str]]:
    version = int(document["version"])
    page_tools, page_skills = _assignments(page.references, resolved)
    steps: list[Step] = []
    for index, page_step in enumerate(page.steps, 1):
        tools, skills = _assignments(page_step.references, resolved)
        tools, skills = sorted({*tools, *page_tools}), sorted({*skills, *page_skills})
        if len(tools) > 30 or len(skills) > 10:
            raise SkillDocumentError(f"Step {index} references {len(tools)} tools and {len(skills)} skills; a step takes at most 30 tools and 10 skills.")
        # Step.evidence_sequences is required (teaching.py Step): a page skill cites its own numbered step.
        steps.append(Step(title=page_step.title, instructions=page_step.instructions or page_step.title,
                          tools=tools, skills=skills, scripts=[],
                          expected_outcome=page_step.outcome or f"“{page_step.title}” is done as written, verified with actual tool results.",
                          evidence_sequences=[index]))
    members: dict[tuple[str, str], GroupMember] = {}
    mappings: list[GroupStep] = []
    for index, step in enumerate(steps, 1):
        ids = []
        for kind, targets in (("tool", step.tools), ("skill", step.skills)):
            for target in targets:
                member = members.setdefault((kind, target), GroupMember(
                    id="cap-" + hashlib.sha256(f"{kind}:{target}".encode()).hexdigest()[:20], kind=kind, target=target))  # type: ignore[arg-type]
                ids.append(member.id)
        mappings.append(GroupStep(step=index, member_ids=ids))
    group = ToolGroup(id=f"group-{skill_id_for(document['id'])}", name=name, members=list(members.values()),
                      steps=mappings, approval_revision=version)

    documents = {value["path"]: value for key, value in resolved.items() if key.startswith("document:")}
    parameters = "\n".join(f"- {value}" for value in page.inputs) or "No inputs."
    overview = page.description + (f"\n\nUse it when: {page.use_when}" if page.use_when else "")
    sop = (f"# {page.title}\n\n## Overview\n\n{overview}\n\n## Parameters\n\n{parameters}\n\n"
           f"## Required capabilities\n\n" + "\n".join(_required_capabilities(resolved)) + "\n\n## Steps\n")
    for index, step in enumerate(steps, 1):
        sop += (f"\n### {index}. {step.title}\n\n{step.instructions}\n\n**Constraints:**\n"
                f"- You MUST execute this step in the documented order.\n"
                f"- You MUST validate this outcome before advancing: {step.expected_outcome}\n"
                f"- You MUST NOT claim success without tool evidence, skip failed verification, or advance with missing inputs, "
                f"because the user wrote this process expecting each outcome to be verified.\n"
                f"- Assigned tools: {', '.join(step.tools) or 'none'}\n"
                f"- Assigned skills: {', '.join(step.skills) or 'none'}\n"
                f"- Source: step {index} of the page “{page.title}” (version {version})\n")
    criteria = "\n".join(f"- {value}" for value in page.criteria) or "- The outcome in the Overview is produced and verified with actual tool results."
    sop += f"\n## Completion criteria\n\n{criteria}\n"

    frontmatter = yaml.safe_dump(dict(name=name, description=page.description), sort_keys=False, allow_unicode=True)
    skill_md = f"---\n{frontmatter}---\n\n# {page.title}\n\n{page.markdown}\n\n## Running this skill\n\n"
    skill_md += ("Run it with use_skill(skill_name=\"" + name + "\", request=...): a native Agent SOP child follows "
                 "workflow.sop.md in order with the capabilities in tool-group.json, validating each outcome before advancing. "
                 "capabilities.json lists every referenced tool, MCP server, agent, skill and page. Library tools must be "
                 "registered in the calling agent first (tool_catalog(action=\"load\", name=...)); project agent tools exist only "
                 "when the skill runs from that project's agent.\n")
    if documents:
        skill_md += "\n## Supporting files\n\n" + "\n".join(f"- [{path}]({path}): the page “{value['title']}”" for path, value in sorted(documents.items())) + "\n"

    def of(kind: str) -> list[dict[str, Any]]:
        return [value for key, value in resolved.items() if key.startswith(f"{kind}:")]

    capabilities = {
        "tools": {value["name"]: value["spec"] for value in of("tool")},
        "mcp_servers": sorted(value["name"] for value in of("mcp")),
        "mcp_connections": {value["name"]: value["config"] for value in of("mcp")},
        "specialists": {value["name"]: value["url"] for value in of("agent") if value["kind"] in {"ron", "specialist"}},
        "project_agents": {value["name"]: {"project_id": value["project_id"], "tools": value["tools"]}
                           for value in of("agent") if value["kind"] == "project"},
        "skills": sorted(value["name"] for value in of("skill")),
        "documents": {value["title"]: {"path": value["path"], "id": value["id"], "version": value["version"]} for value in of("document")},
    }
    files = {"SKILL.md": skill_md, "workflow.sop.md": sop, "tool-group.json": group.model_dump_json(indent=2),
             "capabilities.json": json.dumps(capabilities, indent=2, ensure_ascii=False)}
    files.update({path: f"# {value['title']}\n\n{value['markdown']}\n" for path, value in documents.items()})
    return steps, group, files


def skill_summary(manifest: dict[str, Any], document_version: int | None = None) -> dict[str, Any]:
    source = manifest.get("source_document") or {}
    return {"id": manifest["id"], "name": manifest["name"], "description": manifest["description"],
            "agent_id": manifest.get("agent_id"), "files": manifest.get("files", []),
            "created_at": manifest.get("created_at"), "updated_at": manifest.get("updated_at"),
            "published_version": source.get("version"),
            "current": document_version is None or source.get("version") == document_version,
            "steps": len(manifest.get("steps", [])), "listed": bool(manifest.get("memory_registered"))}


async def _document(identity: ProjectIdentity, document_id: str) -> dict[str, Any]:
    from fastapi import HTTPException

    rows = await ProjectService(identity).rows("project_documents", id=f"eq.{UUID(document_id)}")
    if not rows:
        raise HTTPException(404, "Document not found or not accessible")
    return rows[0]


async def document_skill(service: TeachingService, identity: ProjectIdentity, *, user_id: str, agent_id: str,
                         document_id: str) -> dict[str, Any] | None:
    """The skill a page was published as (``None`` when it never was)."""
    document = await _document(identity, document_id)
    data = await service.storage.read(f"{_scope(user_id, agent_id)}/skills/{skill_id_for(document_id)}/manifest.json")
    return skill_summary(json.loads(data), int(document["version"])) if data else None


async def publish_document_skill(service: TeachingService, identity: ProjectIdentity, *, user_id: str, agent_id: str,
                                 document_id: str) -> dict[str, Any]:
    """Publish (or republish) a page as this agent's skill. Raises ``SkillDocumentError`` (422) on bad content."""
    if agent_id.startswith("issue:"):
        raise SkillDocumentError("Issue agents learn skills from their own issue (Teach Ren in the issue's Ren tab).")
    scope = _scope(user_id, agent_id)
    document = await _document(identity, document_id)
    document_id = str(UUID(document["id"]))
    skill_id = skill_id_for(document_id)
    title = (document.get("title") or "").strip()
    previous_name = await _existing_name(service, user_id, agent_id, skill_id)
    name = previous_name or skill_name(title)
    if not previous_name and (not name or title.lower() == "untitled"):
        raise SkillDocumentError("Name this page first: its title becomes the skill's name.")
    taken = [item for item in await service.list_skills(user_id, agent_id) if item["name"] == name and item["id"] != skill_id]
    if taken:
        raise SkillDocumentError(f"Another skill of this agent is already named “{name}”. Rename the page before publishing it.")
    page = parse_skill_page(title, document.get("content") or "")
    resolved = await _resolve(page, identity=identity, service=service, user_id=user_id, agent_id=agent_id,
                              document_id=document_id, skill_id=skill_id)
    steps, group, files = _build(page, name=name, resolved=resolved, document=document)
    previous = await service.storage.read(f"{scope}/skills/{skill_id}/manifest.json")
    now = _now()
    manifest = dict(
        id=skill_id, name=name, description=page.description, agent_id=agent_id,
        created_at=json.loads(previous)["created_at"] if previous else now, updated_at=now,
        steps=[step.model_dump() for step in steps], tool_group=group.model_dump(),
        approval_revision=group.approval_revision,
        approval=dict(source="document", document_id=document_id, version=group.approval_revision,
                      approved_by=identity.user_id, approved_at=now),
        source_document=dict(id=document_id, project_id=document["project_id"], title=title, version=group.approval_revision),
        script_verification="no scripts",
    )
    published = await service.install_skill(user_id, agent_id, manifest, files)
    return {"status": "updated" if previous else "published", "skill": skill_summary(published, group.approval_revision)}


__all__ = [
    "GUEST_USER_ID", "SkillDocumentError", "bind_owner", "document_skill", "mcp_servers", "page_markdown",
    "parse_skill_page", "publish_document_skill", "reference_catalog", "reference_markdown", "skill_id_for", "skill_name",
]
