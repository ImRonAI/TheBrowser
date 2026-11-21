"""Ron's second brain, every agent's memory tool and journal, and the dream that consolidates them.

Built as Anthropic documents agent memory: the memory tool
(https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool), a small index in front of the agent
with the rest read on demand (https://www.anthropic.com/research/components-of-agent-memory,
https://code.claude.com/docs/en/memory), and dreams that write a separate store the user reviews before it is used
(https://platform.claude.com/docs/en/managed-agents/dreams).

Layout, under the user's storage scope (``panel/users/<sha256(user_id)>/``):

* ``memory/brain/<agent>/<topic>.md``: what one agent has learned; ``memory/brain/shared/`` holds what every agent
  should know and ``memory/brain/people/`` one file per person. Every agent reads the whole tree as ``/memories``
  with its ``memory`` tool and writes only its own folder, during the conversation. The index of every topic
  (:func:`memory_index`) is injected with each user turn; ``search_memory`` finds a topic by meaning.
* ``memory/journal/<agent>/<time>-<note|turn>.md``: what happened since the last dream. Turns come from native
  extraction with no extractor, where the SDK hands each invocation's messages to ``add_messages`` and no model is
  called. A dream moves what it read to ``memory/transcripts/<agent>/``, which is kept: the ground truth a dream
  checks memory against.
* ``memory/dreams/<time>.json``: one version per dream, holding every topic it would change as it read before and
  as the dream wrote it. A version is ``pending`` until the user reviews it; only the topics the user approves reach
  the brain (:func:`apply_dream`), each only if it still reads as it did when the dream ran, and any applied version
  can be undone (:func:`undo_dream`).
* ``memory/brain/dreaming/``: the dreaming agent's own folder, what the user's reviews of its dreams taught it.

ren's API is the one dreamer (:func:`run_dreams`): a dream runs once a user has journaled nothing for
``RON_MEMORY_IDLE_SECONDS`` and no earlier dream waits for review. Any process that journals marks the user under
``panel/dreams-pending/``. The brain is searched by meaning with Mistral embeddings (:class:`_Embedded`).
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import posixpath
import re
import time
from array import array
from collections import defaultdict
from collections.abc import Coroutine, Mapping
from datetime import UTC, datetime
from itertools import groupby
from operator import mul
from typing import Final, Literal, TypedDict

from strands import Agent, tool
from strands.memory import MemoryManager
from strands.memory.extraction.model_extractor import _render_message
from strands.memory.extraction.triggers import InvocationTrigger
from strands.memory.extraction.types import ExtractionConfig
from strands.memory.types import (
    AddMessagesContext,
    InjectionFormatContext,
    InjectionQueryContext,
    MemoryEntry,
    MemoryInjectionConfig,
    MemoryStore,
    Metadata,
    SearchOptions,
)
from strands.models.routing import ModelRouter, RoutingCandidate
from strands.storage import Storage
from strands.storage.storage import _NAMESPACED, StorageSearchResult
from strands.types.content import Message
from strands.types.tools import AgentTool
from strands.vended_memory_stores.file_memory_store import FileMemoryStore
from strands.vended_memory_stores.file_memory_store.store import _slugify

from agent.api.core import config
from agent.api.core.panel_storage import _ScopedStorage, get_panel_storage, get_user_session_storage

logger = logging.getLogger(__name__)

#: The dream's models, tried in this order (owner, 2026-11-15; NIM's DeepSeek v4.1 Flash reached its end of life on
#: 2026-11-16 and answers 410).
DREAM_MODELS: Final[tuple[tuple[Literal["nim", "mistral"], str], ...]] = (
    ("nim", "minimaxai/minimax-m3.1-flash"),
    ("mistral", "zai-glm-5-3-flash"),
    ("mistral", "mistral-medium-latest"),
)
EMBEDDING_MODEL: Final = "mistral-embed"
#: Bytes of a text that are embedded. A token is at least one byte, so this many bytes is at most this many tokens.
EMBEDDING_BYTES: Final = 8000
#: Journal characters per dream call: about 50,000 tokens, inside the 200,000-token window the SDK assumes for a
#: model whose window it does not know.
DREAM_BATCH_CHARS: Final = 200_000
#: The most a topic file holds, Managed Agents' cap per memory (https://platform.claude.com/docs/en/managed-agents/memory).
TOPIC_BYTES: Final = 100_000
#: Topics the index lists, and the characters it holds: what Claude Code loads of MEMORY.md (200 lines or 25 KB).
INDEX_LINES: Final = 200
INDEX_CHARS: Final = 25_000
#: Characters a ``view`` of a file returns before it asks for ``view_range``, as the memory tool's own description says.
VIEW_CHARS: Final = 16_000
SHARED: Final = "shared"
PEOPLE: Final = "people"
#: The dreaming agent's own folder: what the user's reviews of its dreams taught it.
DREAMING: Final = "dreaming"
PENDING: Final = "panel/dreams-pending"
ROOT: Final = "/memories"
#: What a subagent inherits from its parent: the parent's own brain search and memory tool, the same tools.
INHERITED_TOOLS: Final = ("search_memory", "memory", "journal")
#: The injection's query. :class:`Brain` answers it with the index; it has no word any other store can match.
INDEX_QUERY: Final = "\x00"

BRAIN_DESCRIPTION: Final = (
    "Long-term memory shared by all of the user's agents: who the user is, their people, projects, preferences "
    "and decisions, and what each agent has learned about doing its work for them."
)
JOURNAL_DESCRIPTION: Final = "This agent's turns and notes since the last dream."
JOURNAL_TOOL: Final = (
    "Your private journal. Pass `entry` to jot down anything worth carrying into later conversations: what the user "
    "wants, likes or rejects, decisions and their reasons, people, projects, open threads, what worked and what did "
    "not. Call it with no entry to read back what you have jotted since it was last filed into long-term memory."
)
MEMORY_TOOL: Final = (
    "Your long-term memory, a directory of markdown files at /memories that lasts across conversations: "
    "/memories/shared (what every agent knows about the user), /memories/people (one file per person) and one "
    "folder per agent. You can read every file and write only your own folder, {own}, one topic per file named "
    "like travel-preferences.md. Commands: view (a directory, or a file with optional view_range [start, end]), "
    "create (path, file_text), str_replace (path, old_str, new_str), insert (path, insert_line, insert_text), "
    "delete (path) and rename (old_path, new_path)."
)

#: Appended to the system prompt of every agent that carries :func:`agent_memory`: the protocol the memory tool's API
#: adds to Claude's prompt (https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool), its note on
#: keeping memory organized, and what memory is for (https://www.anthropic.com/research/components-of-agent-memory).
MEMORY_PROTOCOL: Final = """

## Memory
IMPORTANT: ALWAYS VIEW YOUR MEMORY DIRECTORY BEFORE DOING ANYTHING ELSE.
MEMORY PROTOCOL:
1. Use the `view` command of your `memory` tool to check for earlier progress.
2. ... (work on the task) ...
     - As you make progress, record status / progress / thoughts etc in your memory.
ASSUME INTERRUPTION: Your context window might be reset at any moment, so you risk losing any progress that is not \
recorded in your memory directory.

Note: when editing your memory folder, always try to keep its content up-to-date, coherent and organized. You can \
rename or delete files that are no longer relevant. Do not create new files unless necessary.

Memory is for what will help you or another of the user's agents in a later conversation. The index of every topic \
arrives in a <memory_index> block; search_memory finds a topic by meaning. End each fact you write with its date, \
your name and whether the user confirmed it, like "(2026-11-20, panel, confirmed)". Jot passing notes with the \
journal tool; while the user is away a dream files them into memory, once the user approves. Don't tell the user \
you are reading or writing memory or the journal: just use what you know."""

DREAM_PROMPT: Final = """You are the long-term memory of Ren, a personal browser with several AI agents. \
While the user is away you file one agent's journal into memory. Nobody reads your reply: only your add_memory \
calls count, and the user reviews every change before it is used.

The journal lists the agent's own notes ("note") and the conversations it had ("turn"), oldest first, each under \
its UTC time. Memory is topic files in two stores:
- the agent's own store: what this agent needs to do its job better for this user next time. How the user wants \
this kind of work done, what worked or failed, ongoing work and where it stands.
- brain/shared: what every agent should know about the user. Who they are, their people, places, preferences, \
projects, decisions and dates.

Existing topics that look relevant arrive in a <memory> block, and search_memory reads any other; the store \
"transcripts" holds every earlier conversation. For each topic the journal changes, call add_memory with one \
entry and the one store it belongs in. The entry is the whole topic file as it should now read: a markdown heading \
naming the topic on the first line ("# Travel preferences"), then one fact per line. It replaces the file with that \
heading, so read an existing topic before you rewrite it, keep every fact that is still true, merge the new ones \
in, correct what the journal corrects and drop what it contradicts. Reuse an existing heading exactly when the \
facts belong under it. When two topics say the same thing, merge them into one and send the other as only its \
heading, which deletes it.

End every fact with its date, the agent it came from, and "confirmed" when the user said it or a transcript shows \
it, "unconfirmed" when it is inferred: "The user flies from Ogden. (2026-11-20, panel, confirmed)". Check a fact \
you keep or change against the journal and the transcripts.

Keep only what will still be true and useful in a later, unrelated conversation. Write each fact so it stands \
alone: names instead of "he", dates instead of "tomorrow". Leave out greetings, tool output, page content, the \
agent's step-by-step progress and anything you would have to guess. Never store a password, key or card number. \
If the journal holds nothing worth keeping, call nothing."""

FEEDBACK_PROMPT: Final = """The user reviewed the dream of {version}. The topics marked right are now in memory; \
the topics marked wrong were not applied, and memory still reads as it did before that dream. Each line says \
which, with the user's comment:
{items}

For every topic marked wrong, write it again as the comment says, in the store that holds it. Then write in your \
own store (brain/dreaming) what this review teaches you about how this user wants their memory kept, so every \
later dream follows it."""


class TopicChange(TypedDict):
    before: str | None
    after: str | None


class DreamRecord(TypedDict):
    status: Literal["pending", "applied", "dismissed", "undone"]
    topics: dict[str, TopicChange]
    applied: list[str]


_tasks: set[asyncio.Future[object]] = set()
_marked: dict[str, float] = {}
_locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)


def _background(work: Coroutine[object, object, object]) -> None:
    """Run ``work`` without making anyone wait for it; a failure is logged."""
    def done(task: asyncio.Future[object]) -> None:
        _tasks.discard(task)
        if not task.cancelled() and task.exception() is not None:
            logger.warning("memory background work failed: %s", task.exception())

    task = asyncio.ensure_future(work)
    _tasks.add(task)
    task.add_done_callback(done)


def folder(agent: str) -> str:
    """An agent's folder name: its kind for Ron's own agents (``issue:42`` is ``issue``), its name for a specialist."""
    name = _slugify(agent.partition(":")[0])
    if not name:
        raise ValueError(f"agent {agent!r} has no letters or digits to name its memory folder")
    return name


async def embed(texts: list[str]) -> list[array[float]]:
    """Mistral embeddings, one request per text. Mistral's vectors have norm 1, so a dot product is the cosine."""
    from mistralai.client import Mistral

    vectors: list[array[float]] = []
    async with Mistral(api_key=config.MISTRAL_API_KEY) as client:
        for text in texts:
            cut = text.encode("utf-8")[:EMBEDDING_BYTES].decode("utf-8", errors="ignore")
            response = await client.embeddings.create_async(
                model=EMBEDDING_MODEL, inputs=[cut], timeout_ms=int(config.RON_MEMORY_SEARCH_SECONDS * 1000))
            vectors.append(array("f", response.data[0].embedding or []))
    return vectors


class _Embedded(_ScopedStorage):
    """A storage folder searched by meaning, used by ``FileMemoryStore`` as given.

    ``vectors.json`` in the folder maps each file's content hash to its embedding. A search brings it up to date
    with the files first, so a topic written by an agent, a dream, the Memory panel or an undo is embedded once,
    the next time anything searches.
    """

    _namespaced = _NAMESPACED
    INDEX: Final = "vectors.json"

    async def vectors(self) -> dict[str, array[float]]:
        """Every topic file's embedding by key, embedding only the files whose content has no vector yet."""
        keys = [key for key in await self.list("") if key.endswith(".md")]
        texts = [data or b"" for data in await asyncio.gather(*(self.read(key) for key in keys))]
        digests = [hashlib.sha256(text).hexdigest() for text in texts]
        saved: dict[str, str] = json.loads(await self.read(self.INDEX) or b"{}")
        new = {digest: text for digest, text in zip(digests, texts, strict=True) if digest not in saved}
        if new:
            for digest, vector in zip(new, await embed([text.decode("utf-8", "replace") for text in new.values()]),
                                      strict=True):
                saved[digest] = base64.b64encode(vector.tobytes()).decode("ascii")
        if new or saved.keys() - set(digests):
            await self.write(self.INDEX, json.dumps({digest: saved[digest] for digest in digests}).encode("ascii"))
        found: dict[str, array[float]] = {}
        for key, digest in zip(keys, digests, strict=True):
            found[key] = array("f")
            found[key].frombytes(base64.b64decode(saved[digest]))
        return found

    async def search(self, query: str) -> list[StorageSearchResult]:
        vectors = await self.vectors() if query.strip() else {}
        if not vectors:
            return []
        wanted = (await embed([query]))[0]
        scores = {key: sum(map(mul, vector, wanted)) for key, vector in vectors.items()}
        return [StorageSearchResult(key=key, score=scores[key]) for key in sorted(scores, key=scores.__getitem__, reverse=True)]


def _brain(user_id: str) -> _Embedded:
    return _Embedded(get_user_session_storage(user_id), "memory/brain")


async def _topics(storage: Storage) -> list[str]:
    """The brain's topic files, ``<folder>/<topic>.md``, sorted."""
    return sorted(key for key in await storage.list("") if key.endswith(".md") and key.count("/") == 1)


async def memory_index(user_id: str) -> str:
    """Every topic in the user's brain as one ``/memories`` path per line, up to :data:`INDEX_LINES` and
    :data:`INDEX_CHARS` (the dreaming agent's own folder left out), or an empty string for an empty brain."""
    paths = [f"{ROOT}/{key}" for key in await _topics(_brain(user_id)) if not key.startswith(f"{DREAMING}/")]
    lines: list[str] = []
    for path in paths[:INDEX_LINES]:
        if sum(map(len, lines)) + len(path) + 3 > INDEX_CHARS:
            break
        lines.append(f"- {path}")
    if len(lines) < len(paths):
        lines.append(f"... and {len(paths) - len(lines)} more: view {ROOT} to see them all.")
    return "\n".join(lines)


def render_index(context: InjectionFormatContext) -> str:
    """The index :class:`Brain` returned, as the ``<memory_index>`` block; an empty string skips the injection."""
    index = next((entry.content for entry in context.entries
                  if entry.metadata and entry.metadata.get("path") == INDEX_QUERY), "")
    return ("<memory_index>\nEvery topic in your long-term memory. Open one with the memory tool's view command, or "
            f"find one by meaning with search_memory.\n{index}\n</memory_index>") if index else ""


def _index_query(context: InjectionQueryContext) -> str:
    return INDEX_QUERY


#: Injection as the SDK does it, before each model call, carrying only the index.
INDEX_INJECTION: Final = MemoryInjectionConfig(query=_index_query, format=render_index)


def _path(path: str, agent: str, *, write: bool) -> str:
    """A ``/memories`` path as a key in the brain, validated as the memory tool's docs require: inside
    ``/memories`` after normalizing, and for a write a ``<topic>.md`` file in the agent's own folder."""
    if not path.startswith(ROOT) or ".." in path.split("/") or "%2e" in path.lower() or "\\" in path:
        raise ValueError(f"Error: {path} is outside {ROOT}.")
    key = posixpath.normpath(path)[len(ROOT):].strip("/")
    if posixpath.normpath(path) not in (ROOT, f"{ROOT}/{key}"):
        raise ValueError(f"Error: {path} is outside {ROOT}.")
    if write:
        parts = key.split("/")
        if parts[0] != agent:
            raise ValueError(f"Error: {path} is read-only. You write only {ROOT}/{agent}.")
        if len(parts) != 2 or not re.fullmatch(r"[a-z0-9][a-z0-9-]*\.md", parts[1]):
            raise ValueError(f"Error: name a memory file like {ROOT}/{agent}/travel-preferences.md.")
    return key


def _sized(text: str) -> bytes:
    data = text.encode("utf-8")
    if len(data) > TOPIC_BYTES:
        raise ValueError(f"Error: a memory file holds at most {TOPIC_BYTES // 1000} kB. Split it into smaller topics.")
    return data


async def memory_command(user_id: str, agent: str, command: str, path: str = "", *, file_text: str | None = None,
                         view_range: list[int] | None = None, old_str: str | None = None, new_str: str | None = None,
                         insert_line: int | None = None, insert_text: str | None = None, old_path: str = "",
                         new_path: str = "") -> str:
    """One command of the memory tool, with the results its docs specify. A failure raises ``ValueError``."""
    storage = _brain(user_id)
    if command == "view":
        key = _path(path, agent, write=False)
        topics = await _topics(storage)
        if not key or f"{key}/" in {f"{topic.split('/')[0]}/" for topic in topics}:
            shown = [topic for topic in topics if not key or topic.startswith(f"{key}/")]
            folders = sorted({topic.split("/")[0] for topic in shown}) if not key else []
            listing = [f"{ROOT}/{name}" for name in folders] + [f"{ROOT}/{topic}" for topic in shown]
            return (f"Here're the files and directories up to 2 levels deep in {path}, excluding hidden items:\n"
                    + "\n".join(sorted(listing)))
        data = await storage.read(key) if key.endswith(".md") else None
        if data is None:
            if key.count("/") == 0:
                return f"Here're the files and directories up to 2 levels deep in {path}, excluding hidden items:\n"
            raise ValueError(f"The path {path} does not exist. Please provide a valid path.")
        lines = data.decode("utf-8", "replace").split("\n")
        start, end = (view_range[0], view_range[1]) if view_range and len(view_range) == 2 else (1, len(lines))
        end = len(lines) if end == -1 else end
        if not 1 <= start <= max(end, 1) <= len(lines):
            raise ValueError(f"Error: Invalid `view_range` parameter: {view_range}. It should be within [1, {len(lines)}].")
        numbered = "\n".join(f"{number:>6}\t{line}" for number, line in enumerate(lines[start - 1:end], start))
        if len(numbered) > VIEW_CHARS:
            numbered = numbered[:VIEW_CHARS] + "\n... (truncated: use view_range to read the rest)"
        return f"Here's the content of {path} with line numbers:\n{numbered}"
    async with _locks[user_id]:
        if command == "create":
            key = _path(path, agent, write=True)
            if await storage.read(key) is not None:
                raise ValueError(f"Error: File {path} already exists")
            await storage.write(key, _sized(file_text or ""))
            return f"File created successfully at: {path}"
        if command in ("str_replace", "insert"):
            key = _path(path, agent, write=True)
            data = await storage.read(key)
            if data is None:
                raise ValueError(f"Error: The path {path} does not exist")
            text = data.decode("utf-8", "replace")
            if command == "str_replace":
                found = text.count(old_str) if old_str else 0
                if not old_str or found == 0:
                    raise ValueError(f"No replacement was performed, old_str `{old_str}` did not appear verbatim in {path}.")
                if found > 1:
                    lines = [str(number) for number, line in enumerate(text.split("\n"), 1) if old_str in line]
                    raise ValueError(f"No replacement was performed. Multiple occurrences of old_str `{old_str}` in "
                                     f"lines: {', '.join(lines)}. Please ensure it is unique")
                await storage.write(key, _sized(text.replace(old_str, new_str or "", 1)))
                return "The memory file has been edited."
            lines = text.split("\n")
            if insert_line is None or not 0 <= insert_line <= len(lines):
                raise ValueError(f"Error: Invalid `insert_line` parameter: {insert_line}. It should be within the range "
                                 f"of lines of the file: [0, {len(lines)}]")
            lines[insert_line:insert_line] = (insert_text or "").split("\n")
            await storage.write(key, _sized("\n".join(lines)))
            return f"The file {path} has been edited."
        if command == "delete":
            key = _path(path, agent, write=True)
            if await storage.read(key) is None:
                raise ValueError(f"Error: The path {path} does not exist")
            await storage.delete(key)
            return f"Successfully deleted {path}"
        if command == "rename":
            old, new = _path(old_path, agent, write=True), _path(new_path, agent, write=True)
            data = await storage.read(old)
            if data is None:
                raise ValueError(f"Error: The path {old_path} does not exist")
            if await storage.read(new) is not None:
                raise ValueError(f"Error: The destination {new_path} already exists")
            await storage.write(new, data)
            await storage.delete(old)
            return f"Successfully renamed {old_path} to {new_path}"
    raise ValueError(f"Error: unknown command {command!r}.")


def memory_tool(user_id: str, agent: str) -> AgentTool:
    """The memory tool over the user's brain, writing only ``agent``'s folder."""

    @tool(name="memory", description=MEMORY_TOOL.format(own=f"{ROOT}/{agent}"))
    async def memory(command: Literal["view", "create", "str_replace", "insert", "delete", "rename"], path: str = "",
                     file_text: str | None = None, view_range: list[int] | None = None, old_str: str | None = None,
                     new_str: str | None = None, insert_line: int | None = None, insert_text: str | None = None,
                     old_path: str = "", new_path: str = "") -> str:
        """View and edit your long-term memory.

        Args:
            command: view, create, str_replace, insert, delete or rename.
            path: The file or directory, starting with /memories.
            file_text: The new file's content (create).
            view_range: The lines to view, [start, end], end -1 for the last line (view of a file).
            old_str: The exact text to replace, appearing once (str_replace).
            new_str: Its replacement (str_replace).
            insert_line: The line to insert after, 0 for the top (insert).
            insert_text: The text to insert (insert).
            old_path: The file to rename (rename).
            new_path: Its new path (rename).
        """
        return await memory_command(user_id, agent, command, path, file_text=file_text, view_range=view_range,
                                    old_str=old_str, new_str=new_str, insert_line=insert_line,
                                    insert_text=insert_text, old_path=old_path, new_path=new_path)

    return memory


class Brain(FileMemoryStore):
    """The whole brain for one agent: searched by meaning, answering the injection with the index, and carrying
    the agent's memory tool."""

    def __init__(self, user_id: str, agent: str) -> None:
        super().__init__(name="brain", description=BRAIN_DESCRIPTION, storage=_brain(user_id), writable=False)
        self._user_id, self._agent = user_id, agent

    async def search(self, query: str, options: SearchOptions | None = None) -> list[MemoryEntry]:
        if query != INDEX_QUERY:
            return await super().search(query, options)
        index = await memory_index(self._user_id)
        return [MemoryEntry(content=index, metadata={"path": INDEX_QUERY})] if index else []

    def get_tools(self) -> list[AgentTool]:
        return [memory_tool(self._user_id, self._agent)]


class Journal(FileMemoryStore):
    """One agent's turns and notes, kept until the next dream files them."""

    def __init__(self, user_id: str, agent: str) -> None:
        super().__init__(name=f"journal/{agent}", description=JOURNAL_DESCRIPTION,
                         storage=get_user_session_storage(user_id))
        # No extractor: the SDK hands each invocation's messages to add_messages and calls no model.
        self.extraction = ExtractionConfig(trigger=InvocationTrigger())
        self._user_id = user_id

    async def add(self, content: str, metadata: Metadata | None = None) -> str:
        """Keep one entry (a note unless ``metadata`` says ``kind``) and mark the user for a dream."""
        kind = (metadata or {}).get("kind", "note")
        key = f"{datetime.now(UTC).strftime('%Y%m%dT%H%M%S%f')}-{kind}.md"
        await self._storage.write(key, content.encode("utf-8"))
        _mark_pending(self._user_id)
        return key

    async def add_messages(self, messages: list[Message], context: AddMessagesContext | None = None) -> str:
        return await self.add("\n".join(_render_message(message) for message in messages), {"kind": "turn"})

    async def search(self, query: str, options: SearchOptions | None = None) -> list[MemoryEntry]:
        """Nothing: a turn must never be injected back into the conversation it came from."""
        return []

    async def notes(self) -> str:
        keys = sorted(key for key in await self._storage.list("") if key.endswith("-note.md"))
        texts = await asyncio.gather(*(self._storage.read(key) for key in keys))
        return "\n".join(f"- {text.decode('utf-8', 'replace')}" for text in texts if text)

    async def jot(self, entry: str) -> str:
        """The journal tool: keep ``entry``, or read the notes back when it is empty."""
        if entry.strip():
            await self.add(entry.strip())
            return "Noted."
        return await self.notes() or "Nothing jotted yet."

    def get_tools(self) -> list[AgentTool]:
        @tool(name="journal", description=JOURNAL_TOOL)
        async def journal(entry: str = "") -> str:
            """Write to or read the journal.

            Args:
                entry: What to jot down. Leave empty to read the journal back.
            """
            return await self.jot(entry)

        return [journal]


def agent_memory(user_id: str, agent: str) -> list[MemoryStore]:
    """What every agent carries: the whole brain with its memory tool, and its own journal."""
    name = folder(agent)
    return [Brain(user_id, name), Journal(user_id, name)]


def brain_memory(user_id: str, agent: str, stores: list[MemoryStore] | None = None) -> MemoryManager:
    """The SDK's ``MemoryManager`` over ``stores`` and :func:`agent_memory`, injecting the index."""
    return MemoryManager(stores=[*(stores or []), *agent_memory(user_id, agent)], injection=INDEX_INJECTION)


def agent_memory_tools(user_id: str, agent: str) -> list[AgentTool]:
    """``search_memory``, ``memory`` and ``journal`` over :func:`agent_memory`, for an agent that takes no plugins."""
    return MemoryManager(stores=agent_memory(user_id, agent), injection=False).tools


async def index_block(user_id: str) -> str:
    """The ``<memory_index>`` block for the prompt of an agent that takes no plugins and so gets no injection."""
    return render_index(InjectionFormatContext(entries=await Brain(user_id, SHARED).search(INDEX_QUERY)))


def inherited_memory(tools: Mapping[str, AgentTool]) -> list[AgentTool]:
    """A subagent's memory: its parent's own ``search_memory``, ``memory`` and ``journal`` among ``tools``."""
    return [tools[name] for name in INHERITED_TOOLS if name in tools]


class Proposal(FileMemoryStore):
    """One brain folder as a dream sees it: the live topics with the dream's own changes over them. ``add`` writes
    a whole topic into the dream's changes, never into the brain."""

    def __init__(self, user_id: str, agent: str, changes: dict[str, str | None]) -> None:
        super().__init__(name=f"brain/{agent}", storage=get_user_session_storage(user_id), description=(
            "What every agent should know about the user." if agent == SHARED
            else "One file per person in the user's life." if agent == PEOPLE
            else f"What the {agent} agent has learned about doing its work for the user."))
        self._changes = changes
        self._read: set[str] = set()

    def _full(self, key: str) -> str:
        return f"memory/{self.name}/{key}"

    async def search(self, query: str, options: SearchOptions | None = None) -> list[MemoryEntry]:
        entries: list[MemoryEntry] = []
        for entry in await super().search(query, options):
            key = str((entry.metadata or {}).get("path", ""))
            self._read.add(key)
            text = self._changes.get(self._full(key), entry.content)
            if text is not None:
                entries.append(MemoryEntry(content=text, metadata=entry.metadata))
        return entries

    async def add(self, content: str, metadata: Metadata | None = None) -> str:
        heading, _, body = content.strip().partition("\n")
        key = f"{_slugify(heading.lstrip('# '))}.md"
        if key == ".md":
            raise ValueError("The first line must be a markdown heading that names the topic.")
        full = self._full(key)
        if full not in self._changes and key not in self._read and await self._storage.read(key) is not None:
            raise ValueError(f"Topic {heading!r} exists. Read it with search_memory, then send the whole file.")
        _sized(content.strip())
        self._changes[full] = content.strip() if body.strip() else None
        return key


def dream_model() -> ModelRouter:
    """The dream's models, built as the panel builds its own."""
    from agent.api.core.panel_agent import build_model, provider_api_key  # panel_agent imports core.memory

    return ModelRouter([RoutingCandidate(build_model(provider, model), name=f"{provider}:{model}")
                        for provider, model in DREAM_MODELS if provider_api_key(provider)])


async def _file(user_id: str, agent: str, journal: str, stores: list[Proposal]) -> None:
    """One dream call: a fresh agent files ``journal`` into ``stores`` with the native memory tools, reading the
    whole brain and the transcripts, and following what the user's reviews taught it (``brain/dreaming``).

    Raises:
        RuntimeError: When it tried to write and no write succeeded, so the journal is kept.
    """
    listed = [f"Topics in {store.name}: " + (", ".join(
        key.removesuffix(".md") for key in await store._storage.list("")) or "none yet") for store in stores]
    own = get_user_session_storage(user_id).namespace(f"memory/brain/{DREAMING}")
    lessons = [text.decode("utf-8", "replace") for text in await asyncio.gather(
        *(own.read(key) for key in sorted(await own.list("")) if key.endswith(".md"))) if text]
    readable: list[MemoryStore] = [
        FileMemoryStore(name="brain", description=BRAIN_DESCRIPTION, storage=_brain(user_id), writable=False),
        FileMemoryStore(name="transcripts", description="Every earlier conversation of the user's agents.",
                        storage=get_user_session_storage(user_id), writable=False)]
    dreamer = Agent(model=dream_model(), system_prompt=DREAM_PROMPT, callback_handler=None,
                    memory_manager=MemoryManager(stores=[*stores, *readable], add_tool_config=True))
    taught = ("How this user wants their memory kept, from their reviews of earlier dreams:\n"
              + "\n\n".join(lessons) + "\n\n") if lessons else ""
    result = await dreamer.invoke_async(
        taught + f"Agent: {agent}\nIts own store: {stores[0].name}\n" + "\n".join(listed) + f"\n\nJournal:\n{journal}")
    writes = result.metrics.tool_metrics.get("add_memory")
    if writes and not writes.success_count:
        raise RuntimeError("none of the dream's writes succeeded")


async def dream_versions(storage: Storage) -> list[tuple[str, DreamRecord]]:
    """Every dream's version and record, oldest first."""
    keys = sorted(key for key in await storage.list("memory/dreams/") if key.endswith(".json"))
    records = await asyncio.gather(*(storage.read(key) for key in keys))
    return [(key.rsplit("/", 1)[-1].removesuffix(".json"), json.loads(data)) for key, data in zip(keys, records, strict=True) if data]


async def pending_dream(user_id: str) -> tuple[str, DreamRecord] | None:
    """The dream that waits for the user's review, if any."""
    return next(((version, record) for version, record in await dream_versions(get_user_session_storage(user_id))
                 if record["status"] == "pending"), None)


async def dream(user_id: str) -> str | None:
    """File every agent's journal into one pending version. Returns it, or ``None`` if nothing would change or an
    earlier dream still waits for review.

    A journal is filed in batches of :data:`DREAM_BATCH_CHARS`, and a batch's entries move to the transcripts once
    it is filed. An agent whose filing fails keeps the rest of its journal for the next dream; the others are still
    filed.
    """
    async with _locks[user_id]:
        storage = get_user_session_storage(user_id)
        if await pending_dream(user_id) is not None:
            return None
        changes: dict[str, str | None] = {}
        shared = Proposal(user_id, SHARED, changes)
        pending = sorted(key for key in await storage.list("memory/journal/") if key.endswith(".md"))
        # Every folder an agent has written or journaled into, so a review can correct a topic not yet in the brain.
        folders = sorted({key.split("/")[2] for prefix in ("memory/brain/", "memory/transcripts/")
                          for key in await storage.list(prefix) if key.endswith(".md")} - {SHARED, DREAMING})
        for agent, group in groupby(pending, key=lambda key: key.split("/")[2]):
            stores = [shared] if agent == SHARED else [Proposal(user_id, agent, changes), shared]
            if agent == DREAMING:  # a review can correct any agent's topics
                stores += [Proposal(user_id, name, changes) for name in folders]
            keys = list(group)
            batch: dict[str, str] = {}
            try:
                for index, key in enumerate(keys):
                    text = (await storage.read(key) or b"").decode("utf-8", "replace")
                    batch[key] = f"[{key.rsplit('/', 1)[-1].removesuffix('.md')}]\n{text[:DREAM_BATCH_CHARS]}"
                    following = keys[index + 1:index + 2]
                    if not following or sum(map(len, batch.values())) >= DREAM_BATCH_CHARS:
                        await _file(user_id, agent, "\n\n".join(batch.values()), stores)
                        for filed in batch:
                            await storage.write(filed.replace("memory/journal/", "memory/transcripts/", 1),
                                                await storage.read(filed) or b"")
                            await storage.delete(filed)
                        batch = {}
            except Exception as error:  # noqa: BLE001 - one agent's failure must not cost the others their dream
                logger.warning("dream failed for agent %s: %s", agent, error)
        if not any(key.endswith(".md") for key in await storage.list("memory/journal/")):
            await get_panel_storage().delete(_pending_key(user_id))
        befores = await asyncio.gather(*(storage.read(key) for key in changes))
        topics: dict[str, TopicChange] = {}
        for (key, after), data in zip(changes.items(), befores, strict=True):
            before = None if data is None else data.decode("utf-8", "replace")
            if after != before:
                topics[key] = TopicChange(before=before, after=after)
        if not topics:
            return None
        version = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%f")
        record = DreamRecord(status="pending", topics=topics, applied=[])
        await storage.write(f"memory/dreams/{version}.json", json.dumps(record).encode("utf-8"))
        return version


async def _set(storage: Storage, key: str, text: str | None) -> None:
    if text is None:
        await storage.delete(key)
    else:
        await storage.write(key, text.encode("utf-8"))


async def apply_dream(user_id: str, version: str, review: list[tuple[str, bool, str]]) -> list[str]:
    """The user's review of a pending dream, as ``(topic key, right, comment)``: every topic marked right reaches the
    brain if it still reads as it did when the dream ran (Managed Agents' ``content_sha256`` precondition); the
    others stay as they are and go to the dreaming agent with their comments. An empty review dismisses the dream.
    Returns the topics applied."""
    async with _locks[user_id]:
        storage = get_user_session_storage(user_id)
        path = f"memory/dreams/{version}.json"
        data = await storage.read(path)
        if data is None:
            return []
        record: DreamRecord = json.loads(data)
        if record["status"] != "pending":
            return []
        right = {key for key, marked, _ in review if marked}
        for key, change in record["topics"].items():
            live = await storage.read(key)
            if key in right and (None if live is None else live.decode("utf-8", "replace")) == change["before"]:
                await _set(storage, key, change["after"])
                record["applied"].append(key)
        record["status"] = "applied" if review else "dismissed"
        await storage.write(path, json.dumps(record).encode("utf-8"))
    wrong = [(key, comment) for key, marked, comment in review if not marked and key in record["topics"]]
    if wrong:
        items = "\n".join(f"- {key}: wrong" + (f". {comment.strip()}" if comment.strip() else "") for key, comment in wrong)
        items += "".join(f"\n- {key}: right" for key in record["applied"])
        await Journal(user_id, DREAMING).add(FEEDBACK_PROMPT.format(version=version, items=items))
    if record["applied"]:
        _background(_brain(user_id).vectors())  # embed what changed now, not in the user's next turn
    return record["applied"]


async def undo_dream(user_id: str, version: str | None = None) -> str | None:
    """Put back every topic an applied dream changed (the newest when ``version`` is ``None``) that still reads as
    the dream wrote it. Returns the version, or ``None`` if there is none."""
    async with _locks[user_id]:
        storage = get_user_session_storage(user_id)
        applied = [(name, record) for name, record in await dream_versions(storage)
                   if record["status"] == "applied" and (version is None or name == version)]
        if not applied:
            return None
        name, record = applied[-1]
        for key in record["applied"]:
            live = await storage.read(key)
            change = record["topics"][key]
            if (None if live is None else live.decode("utf-8", "replace")) == change["after"]:
                await _set(storage, key, change["before"])
        record["status"] = "undone"
        await storage.write(f"memory/dreams/{name}.json", json.dumps(record).encode("utf-8"))
        return name


def _pending_key(user_id: str) -> str:
    return f"{PENDING}/{hashlib.sha256(user_id.encode('utf-8')).hexdigest()}"


def _mark_pending(user_id: str) -> None:
    """Mark the user for a dream, at most once per idle period from this process."""
    now, last = time.monotonic(), _marked.get(user_id)
    if last is not None and now - last < config.RON_MEMORY_IDLE_SECONDS:
        return
    _marked[user_id] = now
    _background(get_panel_storage().write(_pending_key(user_id), user_id.encode("utf-8")))


async def dream_due() -> None:
    """Dream for every marked user who has journaled nothing for ``RON_MEMORY_IDLE_SECONDS``."""
    panel = get_panel_storage()
    for key in await panel.list(f"{PENDING}/"):
        user = await panel.read(key)
        if user is None:
            continue
        user_id = user.decode("utf-8")
        journal = [name.rsplit("/", 1)[-1] for name in await get_user_session_storage(user_id).list("memory/journal/")
                   if name.endswith(".md")]
        if not journal:
            await panel.delete(key)
            continue
        newest = datetime.strptime(max(journal).split("-", 1)[0], "%Y%m%dT%H%M%S%f").replace(tzinfo=UTC)
        if (datetime.now(UTC) - newest).total_seconds() >= config.RON_MEMORY_IDLE_SECONDS:
            await dream(user_id)


async def run_dreams() -> None:
    """ren's API is the one dreamer: every ``RON_MEMORY_IDLE_SECONDS`` it dreams for each user who is due, whichever
    process journaled, signed in or not."""
    while True:
        try:
            await dream_due()
        except Exception as error:  # noqa: BLE001 - a storage hiccup must not end the dreams
            logger.warning("dreams could not run: %s", error)
        await asyncio.sleep(config.RON_MEMORY_IDLE_SECONDS)
