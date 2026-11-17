"""Ron's second brain, every agent's journal, and the dream that files one into the other.

Layout, under the user's storage scope (``panel/users/<sha256(user_id)>/``):

* ``memory/brain/<agent>/<topic>.md``: what one agent has learned. ``memory/brain/shared/`` holds
  what every agent should know. :func:`agent_memory` gives each agent the whole tree to read, so an
  agent's folder comes from its name alone and a new agent reads everything from its first turn.
* ``memory/journal/<agent>/<time>-<note|turn>.md``: the agent's journal. Notes come from its
  ``journal`` tool; turns come from native extraction with no extractor, where the SDK hands each
  invocation's messages to ``add_messages`` and no model is called.
* ``memory/dreams/<time>.json``: one version per dream, holding every topic it changed as it was
  before, which is what :func:`undo_dream` puts back.

Only :func:`dream` writes the brain. It runs once a user has journaled nothing for
``RON_MEMORY_IDLE_SECONDS``, on :data:`DREAM_MODELS` in order, and removes the journal entries it filed.
The brain is searched by meaning with Mistral embeddings (:class:`_Embedded`).
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
from array import array
from collections import defaultdict
from collections.abc import Coroutine
from datetime import UTC, datetime
from itertools import groupby
from operator import mul
from typing import Final, Literal

from strands import Agent, tool
from strands.memory import MemoryManager
from strands.memory.extraction.model_extractor import _render_message
from strands.memory.extraction.triggers import InvocationTrigger
from strands.memory.extraction.types import ExtractionConfig
from strands.memory.types import AddMessagesContext, MemoryEntry, MemoryStore, Metadata, SearchOptions
from strands.models.routing import ModelRouter, RoutingCandidate
from strands.storage.storage import _NAMESPACED, StorageSearchResult
from strands.types.content import Message
from strands.types.tools import AgentTool
from strands.vended_memory_stores.file_memory_store import FileMemoryStore
from strands.vended_memory_stores.file_memory_store.store import _slugify

from agent.api.core import config
from agent.api.core.panel_storage import _ScopedStorage, get_user_session_storage

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
SHARED: Final = "shared"

BRAIN_DESCRIPTION: Final = (
    "Long-term memory shared by all of the user's agents: who the user is, their people, projects, preferences "
    "and decisions, and what each agent has learned about doing its work for them."
)
JOURNAL_DESCRIPTION: Final = "This agent's journal since it was last filed into long-term memory."
JOURNAL_TOOL: Final = (
    "Your private journal. Pass `entry` to jot down anything worth carrying into later conversations: what the user "
    "wants, likes or rejects, decisions and their reasons, people, projects, open threads, what worked and what did "
    "not. Call it with no entry to read back what you have jotted since it was last filed into long-term memory."
)

#: Appended to the system prompt of every agent that carries :func:`agent_memory`.
JOURNAL_DIRECTIVE: Final = """

## Journal and long-term memory
You keep a private journal with the journal tool. Write to it often, in passing, whenever you learn
something that would help you or another agent later: what the user wants, prefers or rejects, a
decision and its reason, people and projects, what worked and what failed. Read it often by calling
it with no entry. Check long-term memory with search_memory before you answer anything that may have
come up before. While the user is away your journal is filed into long-term memory, where every agent
finds it. Never mention the journal, or that you are writing to it, reading it or checking memory:
just use what you know."""

DREAM_PROMPT: Final = """You are the long-term memory of Ren, a personal browser with several AI agents. \
While the user is away you file one agent's journal into memory. Nobody reads your reply: only your add_memory \
calls count.

The journal lists the agent's own notes ("note") and the conversations it had ("turn"), oldest first, each under \
its UTC time. Memory is topic files in two stores:
- the agent's own store: what this agent needs to do its job better for this user next time. How the user wants \
this kind of work done, what worked or failed, ongoing work and where it stands.
- brain/shared: what every agent should know about the user. Who they are, their people, places, preferences, \
projects, decisions and dates.

Existing topics that look relevant arrive in a <memory> block, and search_memory reads any other. For each topic \
the journal changes, call add_memory with one entry and the one store it belongs in. The entry is the whole topic \
file as it should now read: a markdown heading naming the topic on the first line ("# Travel preferences"), then \
one fact per line. It replaces the file with that heading, so read an existing topic before you rewrite it, keep \
every fact that is still true, merge the new ones in, correct what the journal corrects and drop what it \
contradicts. Reuse an existing heading exactly when the facts belong under it. An entry that is only a heading \
deletes that topic.

Keep only what will still be true and useful in a later, unrelated conversation. Write each fact so it stands \
alone: names instead of "he", dates instead of "tomorrow". Leave out greetings, tool output, page content, the \
agent's step-by-step progress and anything you would have to guess. Never store a password, key or card number. \
If the journal holds nothing worth keeping, call nothing."""

_tasks: set[asyncio.Future[object]] = set()
_timers: dict[str, asyncio.TimerHandle] = {}
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
    with the files first, so a topic written by the dream, edited in the Memory panel or put back by an undo is
    embedded once, the next time anything searches.
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


class Journal(FileMemoryStore):
    """One agent's journal: its notes and its turns, kept until the next dream files them."""

    def __init__(self, user_id: str, agent: str) -> None:
        super().__init__(name=f"journal/{agent}", description=JOURNAL_DESCRIPTION,
                         storage=get_user_session_storage(user_id))
        # No extractor: the SDK hands each invocation's messages to add_messages and calls no model.
        self.extraction = ExtractionConfig(trigger=InvocationTrigger())
        self._user_id = user_id

    async def add(self, content: str, metadata: Metadata | None = None) -> str:
        """Keep one entry (a note unless ``metadata`` says ``kind``) and restart the user's idle countdown."""
        kind = (metadata or {}).get("kind", "note")
        key = f"{datetime.now(UTC).strftime('%Y%m%dT%H%M%S%f')}-{kind}.md"
        await self._storage.write(key, content.encode("utf-8"))
        _dream_when_idle(self._user_id)
        return key

    async def add_messages(self, messages: list[Message], context: AddMessagesContext | None = None) -> str:
        return await self.add("\n".join(_render_message(message) for message in messages), {"kind": "turn"})

    async def search(self, query: str, options: SearchOptions | None = None) -> list[MemoryEntry]:
        """Nothing: a turn must never be injected back into the conversation it came from. Notes are read with the tool."""
        return []

    async def notes(self) -> str:
        keys = sorted(key for key in await self._storage.list("") if key.endswith("-note.md"))
        texts = await asyncio.gather(*(self._storage.read(key) for key in keys))
        return "\n".join(f"- {text.decode('utf-8', 'replace')}" for text in texts if text)

    def get_tools(self) -> list[AgentTool]:
        @tool(name="journal", description=JOURNAL_TOOL)
        async def journal(entry: str = "") -> str:
            """Write to or read the journal.

            Args:
                entry: What to jot down. Leave empty to read the journal back.
            """
            if entry.strip():
                _background(self.add(entry.strip()))
                return "Noted."
            try:
                return await self.notes() or "Nothing jotted yet."
            except Exception as error:  # noqa: BLE001 - a storage failure must not surface in the conversation
                logger.warning("journal read failed: %s", error)
                return "Nothing jotted yet."

        return [journal]


def agent_memory(user_id: str, agent: str) -> list[MemoryStore]:
    """What every agent carries: the whole brain to read and its own journal to write."""
    return [
        FileMemoryStore(name="brain", description=BRAIN_DESCRIPTION, storage=_brain(user_id), writable=False),
        Journal(user_id, folder(agent)),
    ]


class Topics(FileMemoryStore):
    """One brain folder as the dream writes it: ``add`` replaces a whole topic and records what it replaced."""

    def __init__(self, user_id: str, agent: str, before: dict[str, str | None]) -> None:
        super().__init__(name=f"brain/{agent}", storage=get_user_session_storage(user_id), description=(
            "What every agent should know about the user." if agent == SHARED
            else f"What the {agent} agent has learned about doing its work for the user."))
        self._before = before
        self._read: set[str] = set()

    async def search(self, query: str, options: SearchOptions | None = None) -> list[MemoryEntry]:
        entries = await super().search(query, options)
        self._read.update(entry.metadata["path"] for entry in entries if entry.metadata)
        return entries

    async def add(self, content: str, metadata: Metadata | None = None) -> str:
        heading, _, body = content.strip().partition("\n")
        key = f"{_slugify(heading.lstrip('# '))}.md"
        if key == ".md":
            raise ValueError("The first line must be a markdown heading that names the topic.")
        old = await self._storage.read(key)
        if old is not None and key not in self._read:
            raise ValueError(f"Topic {heading!r} exists. Read it with search_memory, then send the whole file.")
        self._before.setdefault(f"memory/{self.name}/{key}", None if old is None else old.decode("utf-8", "replace"))
        if body.strip():
            await self._storage.write(key, content.strip().encode("utf-8"))
        elif old is not None:
            await self._storage.delete(key)
        return key


def dream_model() -> ModelRouter:
    """The dream's models, built as the panel builds its own. A host without the panel (ren mobile's Strands
    service) assigns its own builder to this name."""
    from agent.api.core.panel_agent import build_model, provider_api_key  # panel_agent imports core.memory

    return ModelRouter([RoutingCandidate(build_model(provider, model), name=f"{provider}:{model}")
                        for provider, model in DREAM_MODELS if provider_api_key(provider)])


async def _file(agent: str, journal: str, stores: list[Topics]) -> None:
    """One dream call: a fresh agent files ``journal`` into ``stores`` with the native memory tools.

    Raises:
        RuntimeError: When it tried to write and no write succeeded, so the journal is kept.
    """
    listed = [f"Topics in {store.name}: " + (", ".join(
        key.removesuffix(".md") for key in await store._storage.list("")) or "none yet") for store in stores]
    dreamer = Agent(model=dream_model(), system_prompt=DREAM_PROMPT, callback_handler=None,
                    memory_manager=MemoryManager(stores=[*stores], add_tool_config=True))
    result = await dreamer.invoke_async(
        f"Agent: {agent}\nIts own store: {stores[0].name}\n" + "\n".join(listed) + f"\n\nJournal:\n{journal}")
    writes = result.metrics.tool_metrics.get("add_memory")
    if writes and not writes.success_count:
        raise RuntimeError("none of the dream's writes succeeded")


async def dream(user_id: str) -> str | None:
    """File every agent's journal into the brain as one version. Returns the version, or ``None`` if nothing changed.

    A journal is filed in batches of :data:`DREAM_BATCH_CHARS`, and a batch's entries are removed once it is
    filed. An agent whose filing fails keeps the rest of its journal for the next dream; the others are still filed.
    """
    async with _locks[user_id]:
        storage = get_user_session_storage(user_id)
        before: dict[str, str | None] = {}
        shared = Topics(user_id, SHARED, before)
        pending = sorted(key for key in await storage.list("memory/journal/") if key.endswith(".md"))
        for agent, group in groupby(pending, key=lambda key: key.split("/")[2]):
            stores = [shared] if agent == SHARED else [Topics(user_id, agent, before), shared]
            keys = list(group)
            batch: dict[str, str] = {}
            try:
                for index, key in enumerate(keys):
                    text = (await storage.read(key) or b"").decode("utf-8", "replace")[:DREAM_BATCH_CHARS]
                    batch[key] = f"[{key.rsplit('/', 1)[-1].removesuffix('.md')}]\n{text}"
                    following = keys[index + 1:index + 2]
                    if not following or sum(map(len, batch.values())) >= DREAM_BATCH_CHARS:
                        await _file(agent, "\n\n".join(batch.values()), stores)
                        for filed in batch:
                            await storage.delete(filed)
                        batch = {}
            except Exception as error:  # noqa: BLE001 - one agent's failure must not cost the others their dream
                logger.warning("dream failed for agent %s: %s", agent, error)
        if not before:
            return None
        version = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%f")
        await storage.write(f"memory/dreams/{version}.json", json.dumps(before).encode("utf-8"))
        _background(_brain(user_id).vectors())  # embed what changed now, not in the user's next turn
        return version


async def undo_dream(user_id: str) -> str | None:
    """Put back every topic the newest dream changed and drop that version. Returns it, or ``None`` if there is none."""
    async with _locks[user_id]:
        storage = get_user_session_storage(user_id)
        versions = sorted(key for key in await storage.list("memory/dreams/") if key.endswith(".json"))
        if not versions:
            return None
        before: dict[str, str | None] = json.loads(await storage.read(versions[-1]) or b"{}")
        for key, text in before.items():
            if text is None:
                await storage.delete(key)
            else:
                await storage.write(key, text.encode("utf-8"))
        await storage.delete(versions[-1])
        return versions[-1].rsplit("/", 1)[-1].removesuffix(".json")


def _dream_when_idle(user_id: str) -> None:
    """Restart the user's countdown: the dream runs once nothing was journaled for ``RON_MEMORY_IDLE_SECONDS``."""
    if (timer := _timers.pop(user_id, None)) is not None:
        timer.cancel()
    _timers[user_id] = asyncio.get_running_loop().call_later(
        config.RON_MEMORY_IDLE_SECONDS, lambda: _background(dream(user_id)))
