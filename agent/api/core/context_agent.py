"""Context Agent: the agent behind the Context widget (bottom-right Ron orb).

It runs on the panel runtime as ``ChatRequest.destination="context"`` (``chat._create_runtime_agent``),
one native session per user, with the panel composition's tools plus the two tools below. The renderer
drives it with prompt turns:

* ``[browsing]`` — pages the user visited (title + URL). The agent revises the interest graph with
  :func:`update_interest_graph` and, when an interest is strong and recurring, proposes one specialist
  agent with :func:`recommend_agent`.
* ``[context added]`` — an item the user collected (see below).
* ``[phone]`` — from ren mobile: the apps the user used on the phone and what Ren did there.
* ``[approve_agent <id>]`` — the user approved a recommendation: the agent writes the specialist's
  system prompt (``instructions``), assigns tools and Agent Skills, and saves it with the existing
  ``create_harness`` tool (strands_harness portable agent config, stored in Supabase ``harness_agents``).
* ``[approve_app <id>]`` — the user approved an app :func:`recommend_app` suggested (only when Ren's workspace
  computer is configured): OpenCode builds it there and :func:`register_application_tool` lists it under
  Applications, a web app in the desktop sidebar and on the phone's home, an Android app on the phone's home,
  which downloads its APK (``GET /context/applications/{id}/apk``) and installs it.

Both tools return a native tool result whose first block is ``{"json": {...}}``. The panel runtime
forwards ``content`` verbatim and the SDK keeps it in the session, so the renderer applies the graph and
shows the recommendation from the run's own events, with no side channel (same as ``render_ui``).

Context items: every item the user adds (a search, a Discover article, a link, an image or video, a
highlighted passage, a chat thread, a project document, a screenshot or a screen recording) is one
Markdown file in the user's native ``FileMemoryStore`` named ``context`` (``memory.user_stores``), on
the user's panel storage. So every Ron agent reads it with the native ``search_memory`` tool and gets
relevant items through memory injection, and specialists get a read-only ``search_context`` tool over
the same store (``harness_agents.build_specialist``). Binary captures are stored beside it on the same
storage under ``context-files/<id>``.

Agent tools MCP server: ``RON_AGENT_TOOLS_MCP_URL`` names the MCP server that will supply specialist
tools. When it is set the prompt tells the agent to add it to the specialist's ``mcpServers`` (native
``MCPServerConfig`` with ``toolFilters.allowed``); until then specialists get Ron's tool library tools.
"""

from __future__ import annotations

import os
import re
import secrets
import time
from datetime import UTC, datetime
from typing import Any, Final, Literal

from pydantic import BaseModel, ConfigDict, Field
from strands import tool
from strands.storage import Storage
from strands.types.tools import AgentTool
from strands.vended_memory_stores.file_memory_store import FileMemoryStore

from agent.api.core import config as app_config
from agent.api.core.hosted_mcp import HostedMCP
from agent.api.core.panel_storage import get_user_session_storage

CONTEXT_STORE: Final = "context"
CONTEXT_STORE_DESCRIPTION: Final = (
    "Context the user collected for Ren, one Markdown file per item: searches, articles, links, images, "
    "videos, highlighted passages, chat threads, project documents, screenshots and screen recordings."
)
FILES_PREFIX: Final = "context-files"
MAX_MARKDOWN_CHARS: Final = 200_000
MAX_FILE_BYTES: Final = 100 * 1024 * 1024
MAX_INTERESTS: Final = 10

ContextKind = Literal["search", "article", "link", "image", "video", "selection", "thread", "document",
                      "screenshot", "recording", "file", "note"]
CONTEXT_KINDS: Final[tuple[str, ...]] = ("search", "article", "link", "image", "video", "selection", "thread",
                                         "document", "screenshot", "recording", "file", "note")
InterestCategory = Literal["technology", "design", "ai", "privacy", "productivity", "learning",
                           "entertainment", "news", "other"]

_ID = re.compile(r"^ctx-[0-9a-f]{11}[0-9a-f]{4}$")
_META = re.compile(r"^- (kind|source|title|added|file): (.*)$")


def agent_tools_mcp_url() -> str:
    return os.getenv("RON_AGENT_TOOLS_MCP_URL", "").strip()


CONTEXT_AGENT_PROMPT: Final = """
You are Context Agent. You are Ren living in the Context widget (the Ren orb at the bottom right of every
page), not in the Agent Panel. You keep a living picture of what the user cares about, who is in their life,
and what they are trying to get done, and turn it into real help.

Notes, people and contacts (every turn):
- Take concise notes with `journal` on every search, every page, every chat, every response from the user, every
  saved context item, every app notification, and every phone report: what they looked for, used, chose, said or
  replied, open threads, recurring chores, and ideas worth revisiting in your twice-daily review.
- Whenever a person appears (in a message, notification, call, text, chat, search, page or project), call
  `remember_person` to record or update who they are, their friendship or relationship with the user, their contact
  details, and which interests, projects or plans they apply to. When the user's phone is reachable (`phone` in
  `tool_catalog`) and you learn a person's name with a phone number, email or organization not yet saved on the
  phone, load `phone` (`tool_catalog(action="load", name="phone")`), check `phone_contacts_search`, and call
  `phone_contact_save` so their contact stays up to date in the phone's own Contacts app.

Turns you receive:
- "[browsing]" lists pages the user visited, searches they ran, and chats and user responses across Ren, with
  the current interest graph. Jot what matters in `journal`, update `remember_person` for any people mentioned,
  and revise the graph with update_interest_graph: send the COMPLETE revised graph (at most 10 interests), keep
  stable labels for interests that persist, raise the weight of interests the activity reinforces, add an
  interest only when repeated or clearly deliberate activity supports it, let one-off visits fade, and give each
  interest a one-line reason. Labels are short topics a news search understands ("Formula 1", "Home espresso",
  "Rust programming"), never site names or page titles. The Discover feed is built from these labels.
- "[context added]" describes an item the user saved to their context. Journal what matters and fold it into the
  graph the same way.
- "[phone]" comes from Ren on the user's phone since the last report: the apps they used (with time on screen),
  what Ren did on the phone for them, and their calls and texts. Journal what matters, update `remember_person`
  (and `phone_contact_save` when new contact details appear) for the people in calls and texts, and fold app usage
  into the interest graph: an app used often or for long supports the interest it clearly serves (a running app
  supports "Running"), while everyday utilities (launcher, settings, phone, messages, camera, browser) say nothing
  about interests on their own. Pages and searches in the phone's browser and chats with Ren on the phone arrive as
  "[browsing]"; each notification arrives as its own "[notification]".
- "[notification]" is a live notification or text message an app on the user's phone just posted. Every time:
  1. Jot a note in `journal` about what arrived and why it matters.
  2. If it is from or about a person, call `remember_person` (updating their friendship/relationship context,
     contact info, and what they connect to) and, when new contact details appear and `phone` is available, save
     them to the phone with `phone_contact_save`.
  3. If it is a text message or application message from a person or group that calls for a reply (never one-time
     passcodes, automated receipts, shipping updates or marketing blasts), check `search_memory` so the tone and
     context match your user's relationship with them, and call `draft_reply` ONCE with a natural, ready-to-send
     reply (`notification_key` when `can_reply` is true, `to` when a phone number is given). Never send a reply
     yourself during "[notification]": the widget shows the draft with a Send button that asks for approval first.
- "[send_reply <id>]" means the user clicked Send on that drafted reply from desktop: load `phone`
  (`tool_catalog(action="load", name="phone")`), call `phone_request_approval(action_type="send_messages", details=...)`
  FIRST with the exact recipient, app and text, and ONLY when `approved` is true call `phone_notification_reply`
  (when `notification_key` is given) or `phone_sms_send` (when `to` is given). If the user denies approval, stop
  and say it was not sent.
- "[review]" is your twice-daily review. Read your `journal` (call `journal` with no entry) and `search_memory`
  across your notes, `people`, `context` and `tasks`, and check `list_projects` and `list_harness_agents` (plus
  earlier recommendations) so you never duplicate existing work. Think carefully about what the user has been
  doing, what can be automated, which people in `people` memory apply to each effort, and — when OpenCode is
  available on the workspace computer — consult OpenCode FIRST before proposing anything (see Collaborating with
  OpenCode below). Then propose only high-value, non-duplicate items: `recommend_project` for multi-step efforts
  or collaborations (naming relevant people in starter issues), `recommend_app` (when the computer is available)
  for a custom web or Android app, and `recommend_agent` for recurring automated work (at most one of each kind
  per review).
- When an interest outside "[review]" is strong (weight >= 0.6) and recurring, and the user has no agent for it yet
  (check list_harness_agents and your earlier recommendations), call recommend_agent ONCE for a specialist that
  would do real recurring work for that interest. Outside "[review]", at most one recommendation per turn; never
  repeat one.
- "[approve_project <id>]" means the user approved that project recommendation (or asked you directly to spin up
  a project). Create it now with `create_project`, add each starter issue with `create_issue` (referencing any
  people from `people` memory and saved context that apply), and add a concise project brief & automation plan
  with `create_document`. Report the project and starter issues in two sentences.
- "[approve_agent <id>]" means the user approved that recommendation. Build it now: write the specialist's
  system prompt as `instructions` (who it serves, what it does, how it works step by step, which sources it
  trusts, how it reports, what it must never do; specific to this user's interest, at least 150 words),
  choose its tools (library tools from tool_catalog describe as {"module": "./<path>", "export": "<name>"},
  plus "user_browser" in mcpServers only when it must browse), choose Agent Skills from list_learned_skills
  when one fits, then call create_harness with the portable config (name, description, instructions, tools,
  skills, mcpServers). Every specialist already gets the configured web search and reading tools (Tavily,
  Exa, Bright Data and Olostep, those whose keys this host has), http_request, the async Deep Research tools
  (deep_research_start, deep_research_status, deep_research_cancel), the A2A tools and search_context (the
  user's saved context and people): do not list those, and name them in the instructions as its research tools. Never
  pick a search provider's library tools: the configured ones are already there, and the rest need API keys
  this host does not have and fail when the agent runs. Add library tools only for capabilities those lack. When create_harness reports an
  error (a missing field, a tool that cannot load), fix the config and call it again.
  Then give it its run times with schedule_agent: the cadence its recurring work needs (a daily digest every day at
  a morning hour, a price watch every few hours, a weekly review once a week) in the user's time zone, and the task
  each run does. Report the saved agent's name, what it will do and when it runs in two sentences (the user can
  change the schedule on the agent's card in the Agents tab; Ren notifies them after each run).
- Anything else is the user talking to you about their interests, people, projects, context or agents: answer briefly,
  and jot anything lasting in `journal` or `remember_person`.

Use search_memory to read the user's saved context (store "context") and people (store "people"). Reply in at most
two short sentences after tool calls; the widget shows the graph, reply drafts and recommendations itself.
"""


OPENCODE_PROMPT: Final = """
Apps: Ren can build the user small apps of their own. When what the user does (browsing, searches, chats,
notifications, the apps on their phone, saved context) shows a recurring need that an app would serve better than
a specialist (a tracker, a planner, a calculator, a dashboard for something they check often), call recommend_app
ONCE: kind "web" for an app their browser opens, "android" for an app on their phone. Outside "[review]", at most
one recommendation per turn, agent, app or project; never repeat one.
- "[approve_app <id>]" means the user approved that app. Build it now with OpenCode as below, register it, and
  report in two sentences what it does and where it is (a web app: Applications in the sidebar and on the phone's
  home; an Android app: Applications on the home page of Ren on their phone, where a tap installs it).

Collaborating with OpenCode on "[review]":
Before calling recommend_project, recommend_app or recommend_agent during a "[review]" turn, ask OpenCode first:
run `computer_start_process` with
`cd /config/workspace && REN_USER_ID={user_id} opencode run --standalone --auto "<review brief>"`
and read its output with `computer_read_process_output` until it exits. In `<review brief>`, summarize your recent
journal notes, recurring workflows, messages, and relevant people, and ask OpenCode (1) what parts can be automated
today and how, (2) whether a web or Android app is worth building (without building anything yet during review),
(3) what specialist agent could run on a schedule, and (4) what multi-step effort should become a Project with
starter issues. Fold OpenCode's sharpest ideas into your recommendations.

Building software: OpenCode, a coding agent, runs on Ren's workspace computer (its computer_* tools, Desktop
Commander, in the home /config). When the user approves an app, wants a web app for their browser or an Android app,
or a specialist needs code no library tool provides, hand the build to OpenCode instead of writing the code yourself:
1. computer_create_directory /config/workspace/<project> (a short kebab-case name).
2. computer_start_process with
   `cd /config/workspace/<project> && REN_USER_ID={user_id} opencode run --standalone --auto "<brief>"`
   (REN_USER_ID gives OpenCode the user's long-term memory and its own journal), then computer_read_process_output
   until it exits.
3. Check what it reports with computer_list_directory and computer_read_file, and tell the user where it is.
4. Put it in the user's Applications (register_application): a web app once OpenCode has deployed dist/ with
   `vercel deploy dist --prod --yes` (the Vercel CLI is signed in on the computer), with the URL it printed and its
   icon at <url>/icon.png; an Android app with the APK's full path.
The brief says what to build and for whom, the stack, where the result goes and how OpenCode checks it works:
- Web app: a static site or a Vite app the browser opens on a desktop and on a phone, built to dist/, with its own
  index.html and a 512x512 icon.png at the root of dist/ that index.html links as its icon and apple-touch-icon.
- Android app: Kotlin and Jetpack Compose in Ren's Ink & Volt look (volt #5543FF in light and #8D98FE in dark,
  ink #0B0C17, flat surfaces, 10 dp controls, 12 dp cards, Bricolage Grotesque, Inter and JetBrains Mono), with a
  launcher icon. The computer has JDK 21 (JAVA_HOME), the Android SDK with platform 36 and build-tools 36.0.0
  (ANDROID_HOME, /config/Android/Sdk) and Gradle 8.14.3 on PATH: the project uses AGP 8.13.2 and Kotlin 2.3.21,
  compileSdk and targetSdk 36, minSdk 29, applicationId com.ren.apps.<project without dashes>, and a wrapper made
  with `gradle wrapper --gradle-version 8.14.3`; `./gradlew assembleDebug` builds
  app/build/outputs/apk/debug/app-debug.apk, whose full path OpenCode reports.
- Code for a specialist: a Strands @tool module the specialist's config lists in tools, nothing else.
Specialists themselves are always create_harness configs with schedule_agent run times, never code OpenCode writes.
"""


def context_agent_prompt(user_id: str) -> str:
    prompt = CONTEXT_AGENT_PROMPT
    url = agent_tools_mcp_url()
    if url:
        prompt += (
            "\nAgent tools come from Ren's agent tools MCP server. When you build a specialist, add "
            f'"mcpServers": {{"ron_tools": {{"url": "{url}", "toolFilters": {{"allowed": [<tool names>]}}}}}} '
            "listing only the tools that specialist needs.\n"
        )
    if app_config.COMPUTER_MCP_URL and app_config.COMPUTER_MCP_TOKEN:
        prompt += OPENCODE_PROMPT.replace("{user_id}", user_id)
    return prompt


class Interest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = Field(min_length=1, max_length=60, description="Short topic a news search understands.")
    weight: float = Field(ge=0, le=1, description="Strength of the interest, 0-1.")
    category: InterestCategory = Field(description="Closest category.")
    reason: str = Field(default="", max_length=300, description="One line: what supports this interest.")


@tool
async def update_interest_graph(interests: list[Interest]) -> dict[str, Any]:
    """Replace the user's interest graph with the complete revised graph.

    The Context widget draws it and the Discover feed searches news for the strongest labels.

    Args:
        interests: Every interest the user has after this revision (at most 10), strongest first.
    """
    parsed = [Interest.model_validate(item) for item in interests]
    if len(parsed) > MAX_INTERESTS:
        raise ValueError(f"An interest graph holds at most {MAX_INTERESTS} interests; keep the strongest.")
    seen: set[str] = set()
    graph: list[dict[str, Any]] = []
    for item in sorted(parsed, key=lambda value: value.weight, reverse=True):
        key = item.label.strip().lower()
        if key in seen:
            continue
        seen.add(key)
        graph.append({**item.model_dump(), "label": item.label.strip(), "weight": round(item.weight, 3)})
    return {"status": "success", "content": [
        {"json": {"interests": graph}},
        {"text": f"Interest graph updated: {', '.join(item['label'] for item in graph) or 'empty'}."},
    ]}


@tool
async def recommend_agent(name: str, description: str, interest: str, rationale: str,
                          tools: list[str] | None = None, skills: list[str] | None = None) -> dict[str, Any]:
    """Recommend one specialist agent the user could approve for one of their interests.

    The widget shows it with Build and Dismiss buttons; approval arrives as "[approve_agent <id>]".

    Args:
        name: Agent name, 2-5 words (e.g. "Espresso Gear Scout").
        description: One sentence: what it does for the user, recurring and concrete.
        interest: The interest label it serves.
        rationale: One sentence: why now, from what the user did.
        tools: Tool names it would need (library tool names or "user_browser").
        skills: Learned skill names it would use, if any.
    """
    clean = {"name": name.strip(), "description": description.strip(), "interest": interest.strip(),
             "rationale": rationale.strip()}
    if not 1 <= len(clean["name"]) <= 80 or not clean["description"] or not clean["interest"]:
        raise ValueError("A recommendation needs a name (1-80 characters), a description and an interest.")
    recommendation = {"id": "rec-" + secrets.token_hex(5), **clean,
                      "tools": [value for value in (tools or []) if isinstance(value, str)][:20],
                      "skills": [value for value in (skills or []) if isinstance(value, str)][:10]}
    return {"status": "success", "content": [
        {"json": {"agent_recommendation": recommendation}},
        {"text": f"Recommended {recommendation['name']} ({recommendation['id']}); the user decides."},
    ]}


@tool
async def recommend_app(name: str, kind: Literal["web", "android"], description: str, interest: str,
                        rationale: str) -> dict[str, Any]:
    """Recommend one app OpenCode could build for the user, a web app or an Android app.

    The widget shows it with Build and Dismiss buttons; approval arrives as "[approve_app <id>]".

    Args:
        name: App name, 1-4 words (e.g. "Espresso Log").
        kind: "web" for an app the browser opens, "android" for an app installed on the user's phone.
        description: One sentence: what the app does for the user.
        interest: The interest label or need it serves.
        rationale: One sentence: why now, from what the user did.
    """
    clean = {"name": name.strip(), "description": description.strip(), "interest": interest.strip(),
             "rationale": rationale.strip()}
    if not 1 <= len(clean["name"]) <= 80 or not clean["description"]:
        raise ValueError("An app recommendation needs a name (1-80 characters) and a description.")
    recommendation = {"id": "rec-" + secrets.token_hex(5), "kind": kind, **clean, "tools": [], "skills": []}
    return {"status": "success", "content": [
        {"json": {"agent_recommendation": recommendation}},
        {"text": f"Recommended the {kind} app {recommendation['name']} ({recommendation['id']}); the user decides."},
    ]}


@tool
async def recommend_project(name: str, key: str, description: str, interest: str, rationale: str,
                            issues: list[str] | None = None) -> dict[str, Any]:
    """Recommend one multi-step project the user could spin up in Projects, with starter issues.

    The widget shows it with Create and Not now buttons; approval arrives as "[approve_project <id>]".

    Args:
        name: Project name, 2-6 words (e.g. "Austin Half Marathon").
        key: 2-5 uppercase letters for issue keys (e.g. "AHM").
        description: One sentence: what the project tracks and automates.
        interest: The interest label or goal it serves.
        rationale: One sentence: why now, from your journal and OpenCode's review.
        issues: 2-5 concise starter issue titles (naming relevant people where appropriate).
    """
    clean_key = re.sub(r"[^A-Z]", "", (key or "").upper())[:5]
    clean = {"name": name.strip(), "key": clean_key, "description": description.strip(),
             "interest": interest.strip(), "rationale": rationale.strip()}
    if not 1 <= len(clean["name"]) <= 80 or len(clean_key) < 2 or not clean["description"]:
        raise ValueError("A project recommendation needs a name (1-80 chars), a 2-5 letter key, and a description.")
    recommendation = {"id": "rec-" + secrets.token_hex(5), "kind": "project", **clean,
                      "issues": [value.strip() for value in (issues or []) if isinstance(value, str) and value.strip()][:8],
                      "tools": [], "skills": []}
    return {"status": "success", "content": [
        {"json": {"agent_recommendation": recommendation}},
        {"text": f"Recommended project {recommendation['name']} ({recommendation['id']}); the user decides."},
    ]}


@tool
async def draft_reply(sender: str, app: str, incoming: str, draft: str,
                      notification_key: str = "", to: str = "") -> dict[str, Any]:
    """Draft a reply to a text message or app notification so the user can review and tap Send (approval first).

    Never sends the message itself; the Context widget shows the draft card with Send and Not now.

    Args:
        sender: Who sent the message (e.g. "Dana Kim").
        app: App name (e.g. "Messages", "WhatsApp", "Slack").
        incoming: Short summary or quote of the incoming message.
        draft: Ready-to-send reply text in the user's voice.
        notification_key: The notification's `key` from "[notification]" when `can_reply` is true.
        to: Recipient phone number when replying by SMS without an active notification reply action.
    """
    clean_sender, clean_app, clean_draft = sender.strip(), app.strip(), draft.strip()
    if not clean_sender or not clean_app or not clean_draft:
        raise ValueError("A reply draft needs sender, app and draft text.")
    if not notification_key.strip() and not to.strip():
        raise ValueError("Give notification_key (from a replyable notification) or `to` (phone number for SMS).")
    reply = {
        "id": "rpl-" + secrets.token_hex(5),
        "sender": clean_sender[:120],
        "app": clean_app[:80],
        "incoming": incoming.strip()[:400],
        "draft": clean_draft[:2000],
        "notification_key": notification_key.strip(),
        "to": to.strip(),
    }
    return {"status": "success", "content": [
        {"json": {"reply_draft": reply}},
        {"text": f"Drafted reply to {reply['sender']} in {reply['app']} ({reply['id']}); waiting for Send."},
    ]}


def schedule_agent_tool(user_id: str) -> AgentTool:
    """``schedule_agent`` bound to one signed-in user: a saved specialist's run times (``core/agent_schedules.py``)."""

    @tool
    async def schedule_agent(agent_id: str, every: Literal["hours", "day", "weekdays", "week"], task: str,
                             timezone: str, hours: int = 24, time: str = "08:00", weekday: int = 0) -> dict[str, Any]:
        """Run a saved specialist at fixed times, as Schedule on its card in the Agents tab does.

        Args:
            agent_id: The specialist's id, from create_harness or list_harness_agents.
            every: "hours" (every `hours` hours), "day", "weekdays" (Monday to Friday) or "week" (on `weekday`).
            task: What each run does, in one or two sentences.
            timezone: The user's IANA time zone, e.g. "America/Los_Angeles".
            hours: Hours between runs when every is "hours" (1-168).
            time: Local time of day, 24-hour "HH:MM", for day, weekdays and week.
            weekday: 0 = Monday ... 6 = Sunday, for week.
        """
        from agent.api.core.agent_schedules import Cadence, bound_scheduler, cadence_label
        from agent.api.core.harness_agents import owner_uuid

        cadence = Cadence(every=every, hours=hours, time=time, weekday=weekday, timezone=timezone)
        schedule = await bound_scheduler().set_schedule(owner_uuid(user_id), agent_id, cadence, task=task)
        return {"status": "success", "content": [
            {"json": {"agent_schedule": {"agent_id": agent_id, **schedule}}},
            {"text": f"Scheduled {cadence_label(cadence)}; next run {schedule['next_run_at']}."},
        ]}

    return schedule_agent


APPLICATIONS_KEY: Final = "applications.json"
# Where OpenCode's projects are on Ren's workspace computer; on the VM the backend mounts that home read-only, so it
# serves the APKs OpenCode builds there (``GET /context/applications/{id}/apk``).
APPS_DIR: Final = os.getenv("RON_APPS_DIR", "/config/workspace").rstrip("/")


class Application(BaseModel):
    """An app OpenCode built for the user, listed under Applications in the sidebar."""

    model_config = ConfigDict(extra="forbid")
    id: str
    name: str = Field(min_length=1, max_length=80)
    kind: Literal["web", "android"]
    location: str = Field(min_length=1, max_length=2048)
    description: str = Field(max_length=400)
    created_at: float
    icon: str = Field(default="", max_length=2048)


class Applications(BaseModel):
    model_config = ConfigDict(extra="forbid")
    applications: list[Application]


async def read_applications(user_id: str) -> list[Application]:
    data = await get_user_session_storage(user_id).read(APPLICATIONS_KEY)
    return Applications.model_validate_json(data).applications if data else []


async def write_applications(user_id: str, applications: list[Application]) -> None:
    await get_user_session_storage(user_id).write(
        APPLICATIONS_KEY, Applications(applications=applications).model_dump_json().encode())


def register_application_tool(user_id: str) -> AgentTool:
    """``register_application`` bound to one signed-in user: the apps listed under Applications in the sidebar."""

    @tool
    async def register_application(name: str, kind: Literal["web", "android"], location: str,
                                   description: str, icon: str = "") -> dict[str, Any]:
        """List an app OpenCode built under the user's Applications; one with the same name is replaced.

        Args:
            name: The app's name, 1-80 characters.
            kind: "web" for a web app the browser opens, "android" for an APK.
            location: The web app's https URL, or the APK's full path on the workspace computer (under /config/workspace).
            description: One sentence: what the app does for the user.
            icon: The web app's icon, https (its <url>/icon.png); empty for an Android app.
        """
        clean = name.strip()
        if kind == "web" and not location.startswith("https://"):
            raise ValueError("A web app's location is its https:// URL.")
        if kind == "android" and not (location.startswith(APPS_DIR + "/") and location.endswith(".apk")):
            raise ValueError(f"An Android app's location is its APK's full path under {APPS_DIR}.")
        if icon and not icon.startswith("https://"):
            raise ValueError("An icon is an https:// URL.")
        application = Application(id="app-" + secrets.token_hex(5), name=clean, kind=kind, location=location.strip(),
                                  description=description.strip(), created_at=time.time(), icon=icon.strip())
        others = [item for item in await read_applications(user_id) if item.name.casefold() != clean.casefold()]
        await write_applications(user_id, [application, *others])
        return {"status": "success", "content": [
            {"json": {"application": application.model_dump()}},
            {"text": f"{application.name} is under Applications in the sidebar."},
        ]}

    return register_application


_computer = HostedMCP("computer")


def computer_tools() -> list[AgentTool]:
    """Desktop Commander on Ren's workspace computer, where OpenCode runs; none unless both RON_COMPUTER_MCP_* are set."""
    if not (app_config.COMPUTER_MCP_URL and app_config.COMPUTER_MCP_TOKEN):
        return []
    return _computer.tools(app_config.COMPUTER_MCP_URL, app_config.COMPUTER_MCP_TOKEN)


def context_agent_tools(user_id: str) -> list[AgentTool]:
    tools = [update_interest_graph, recommend_agent, recommend_project, draft_reply, schedule_agent_tool(user_id)]
    computer = computer_tools()
    return [*tools, recommend_app, *computer, register_application_tool(user_id)] if computer else tools


# --------------------------------------------------------------------------- context items


def context_store(user_id: str, storage: Storage | None = None) -> FileMemoryStore:
    """The user's ``context`` store (the same native store ``memory.user_stores`` registers)."""
    return FileMemoryStore(name=CONTEXT_STORE, description=CONTEXT_STORE_DESCRIPTION,
                           storage=storage or get_user_session_storage(user_id))


def _entries(storage: Storage) -> Storage:
    return storage.namespace(f"memory/{CONTEXT_STORE}")


def new_item_id() -> str:
    """Time-ordered: the hex millisecond clock first, so keys sort oldest to newest."""
    return f"ctx-{int(time.time() * 1000):011x}{secrets.token_hex(2)}"


def _one_line(value: str, limit: int) -> str:
    return " ".join((value or "").split())[:limit]


def item_markdown(item_id: str, *, kind: str, title: str, body: str = "", source: str = "",
                  file: dict[str, Any] | None = None, added: str | None = None) -> str:
    """One context item as the Markdown file agents read."""
    lines = [f"# {item_id} {_one_line(title, 200) or kind}", "", f"- kind: {kind}",
             f"- title: {_one_line(title, 300)}", f"- added: {added or datetime.now(UTC).isoformat(timespec='seconds')}"]
    if source:
        lines.append(f"- source: {_one_line(source, 4096)}")
    if file:
        lines.append(f"- file: {file['media_type']} {int(file['size'])} {_one_line(file.get('name', ''), 200)}".rstrip())
    text = (body or "").strip()
    if len(text) > MAX_MARKDOWN_CHARS:
        text = text[:MAX_MARKDOWN_CHARS] + "\n\n[truncated]"
    return "\n".join(lines) + ("\n\n" + text if text else "") + "\n"


def parse_item(key: str, data: bytes) -> dict[str, Any] | None:
    text = data.decode("utf-8", errors="replace")
    first, _, rest = text.partition("\n")
    heading = first.removeprefix("# ").strip()
    item_id = heading.split(" ", 1)[0]
    if not _ID.match(item_id):
        return None
    meta: dict[str, str] = {}
    body_lines: list[str] = []
    in_meta = True
    for line in rest.split("\n"):
        match = _META.match(line) if in_meta else None
        if match:
            meta[match.group(1)] = match.group(2)
            continue
        if in_meta and not line.strip() and not meta:
            continue
        in_meta = False
        body_lines.append(line)
    file = None
    if "file" in meta:
        media_type, _, remainder = meta["file"].partition(" ")
        size, _, name = remainder.partition(" ")
        file = {"media_type": media_type, "size": int(size) if size.isdigit() else 0, "name": name}
    body = "\n".join(body_lines).strip()
    return {"id": item_id, "key": key, "kind": meta.get("kind", "note"), "title": meta.get("title", ""),
            "source": meta.get("source", ""), "added": meta.get("added", ""), "file": file,
            "preview": body[:400], "chars": len(body)}


async def add_item(user_id: str, *, kind: str, title: str, body: str = "", source: str = "",
                   data: bytes | None = None, media_type: str = "", file_name: str = "",
                   storage: Storage | None = None) -> dict[str, Any]:
    if kind not in CONTEXT_KINDS:
        raise ValueError(f"kind must be one of {CONTEXT_KINDS}")
    storage = storage or get_user_session_storage(user_id)
    item_id = new_item_id()
    file = None
    if data is not None:
        if len(data) > MAX_FILE_BYTES:
            raise ValueError(f"Context files are limited to {MAX_FILE_BYTES // (1024 * 1024)} MB")
        await storage.write(f"{FILES_PREFIX}/{item_id}", data)
        file = {"media_type": media_type or "application/octet-stream", "size": len(data), "name": file_name}
    markdown = item_markdown(item_id, kind=kind, title=title, body=body, source=source, file=file)
    key = await context_store(user_id, storage).add(markdown)
    parsed = parse_item(key, markdown.encode())
    assert parsed is not None
    return parsed


async def _keys(storage: Storage) -> list[str]:
    return sorted((key for key in await _entries(storage).list("") if key.endswith(".md")
                   and _ID.match(key.rsplit("/", 1)[-1][:19])), reverse=True)


async def list_items(user_id: str, *, limit: int = 100, storage: Storage | None = None) -> list[dict[str, Any]]:
    import asyncio

    entries = _entries(storage or get_user_session_storage(user_id))
    keys = (await _keys(storage or get_user_session_storage(user_id)))[:limit]
    blobs = await asyncio.gather(*(entries.read(key) for key in keys))
    return [item for key, blob in zip(keys, blobs, strict=True) if blob and (item := parse_item(key, blob))]


async def _find_key(storage: Storage, item_id: str) -> str | None:
    if not _ID.match(item_id):
        raise ValueError("Unknown context item id")
    return next((key for key in await _keys(storage) if key.rsplit("/", 1)[-1].startswith(item_id)), None)


async def read_item(user_id: str, item_id: str, storage: Storage | None = None) -> tuple[dict[str, Any], str] | None:
    storage = storage or get_user_session_storage(user_id)
    key = await _find_key(storage, item_id)
    data = await _entries(storage).read(key) if key else None
    if not data:
        return None
    item = parse_item(key, data)  # type: ignore[arg-type]
    return (item, data.decode("utf-8", errors="replace")) if item else None


async def read_file(user_id: str, item_id: str, storage: Storage | None = None) -> bytes | None:
    if not _ID.match(item_id):
        raise ValueError("Unknown context item id")
    return await (storage or get_user_session_storage(user_id)).read(f"{FILES_PREFIX}/{item_id}")


async def delete_item(user_id: str, item_id: str, storage: Storage | None = None) -> bool:
    storage = storage or get_user_session_storage(user_id)
    key = await _find_key(storage, item_id)
    data = await _entries(storage).read(key) if key else None
    if key is None or data is None:
        return False
    item = parse_item(key, data)
    await _entries(storage).delete(key)
    if item and item["file"]:
        await storage.delete(f"{FILES_PREFIX}/{item_id}")
    return True


def thread_markdown(messages: list[dict[str, Any]]) -> str:
    """A native session's messages as a readable transcript (text, reasoning skipped, tools by name)."""
    parts: list[str] = []
    for message in messages:
        role = message.get("role")
        lines: list[str] = []
        for block in message.get("content") or []:
            if not isinstance(block, dict):
                continue
            if isinstance(block.get("text"), str) and block["text"].strip():
                lines.append(block["text"].strip())
            elif isinstance(block.get("toolUse"), dict):
                lines.append(f"_Used tool `{block['toolUse'].get('name', 'tool')}`._")
        if not lines:
            continue
        speaker = "User" if role == "user" else "Ren"
        parts.append(f"**{speaker}:** " + "\n\n".join(lines))
    return "\n\n".join(parts)


def interest_graph_from_result(content: list[dict[str, Any]]) -> list[dict[str, Any]] | None:
    """The graph inside an ``update_interest_graph`` tool result (used by tests and callers)."""
    for block in content:
        payload = block.get("json") if isinstance(block, dict) else None
        if isinstance(payload, dict) and isinstance(payload.get("interests"), list):
            return payload["interests"]
    return None


__all__ = ["CONTEXT_AGENT_PROMPT", "CONTEXT_KINDS", "CONTEXT_STORE", "CONTEXT_STORE_DESCRIPTION", "Interest",
           "add_item", "agent_tools_mcp_url", "context_agent_prompt", "context_agent_tools", "context_store",
           "delete_item", "draft_reply", "interest_graph_from_result", "item_markdown", "list_items", "new_item_id",
           "parse_item", "read_file", "read_item", "recommend_agent", "recommend_app", "recommend_project",
           "thread_markdown", "update_interest_graph"]

