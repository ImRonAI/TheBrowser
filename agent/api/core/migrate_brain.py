"""Fold the panel's old ``facts``, ``remember``, ``feedback`` and ``people`` stores into the second brain, once.

``python -m agent.api.core.migrate_brain`` copies every entry of every user into ``memory/brain/shared`` (facts and
remember), ``memory/brain/panel`` (feedback) and ``memory/brain/people`` with the SDK's ``FileMemoryStore.add``,
which merges an entry into a topic with the same heading, and turns each dream the brain kept before review existed
(``{topic: text before}``) into an applied ``DreamRecord``, so it can still be undone. The old folders are left as
they are, an old dream's file is kept under ``memory/dreams-v1``, and ``memory/brain-migrated`` marks a user as done.
"""

from __future__ import annotations

import asyncio
import json
from typing import Final

from strands.vended_memory_stores.file_memory_store import FileMemoryStore

from agent.api.core.dreaming import DreamRecord, TopicChange
from agent.api.core.panel_storage import _ScopedStorage, get_panel_storage

FOLDS: Final = {"facts": "shared", "remember": "shared", "feedback": "panel", "people": "people"}
DONE: Final = "memory/brain-migrated"


async def _old_dreams(storage: _ScopedStorage) -> int:
    """Each old dream as applied, its ``after`` being what the next dream found or, for the newest, the live text."""
    old: list[tuple[str, dict[str, str | None]]] = []
    for key in sorted(await storage.list("memory/dreams/")):
        data = await storage.read(key) if key.endswith(".json") else None
        if data and "status" not in (before := json.loads(data)):
            old.append((key, before))
    for index, (key, before) in enumerate(old):
        topics: dict[str, TopicChange] = {}
        for topic, text in before.items():
            found = [later[topic] for _, later in old[index + 1:] if topic in later]
            live = None if found else await storage.read(topic)
            after = found[0] if found else None if live is None else live.decode("utf-8", "replace")
            topics[topic] = TopicChange(before=text, after=after)
        await storage.write(key.replace("memory/dreams/", "memory/dreams-v1/", 1), json.dumps(before).encode("utf-8"))
        await storage.write(key, json.dumps(DreamRecord(status="applied", topics=topics, applied=list(topics))).encode("utf-8"))
    return len(old)


async def migrate() -> None:
    panel = get_panel_storage()
    users = sorted({"/".join(key.split("/")[:3]) for key in await panel.list("panel/users/")})
    for scope in users:
        storage = _ScopedStorage(panel, scope)
        if await storage.read(DONE) is not None:
            continue
        moved = 0
        for old, new in FOLDS.items():
            brain = FileMemoryStore(name=f"brain/{new}", storage=storage)
            for key in sorted(await storage.list(f"memory/{old}/")):
                data = await storage.read(key) if key.endswith(".md") else None
                if data and data.strip():
                    await brain.add(data.decode("utf-8", "replace").strip())
                    moved += 1
        dreams = await _old_dreams(storage)
        await storage.write(DONE, str(moved).encode("ascii"))
        print(f"{scope}: {moved} entries folded into the brain, {dreams} earlier dreams kept for undo")


if __name__ == "__main__":
    asyncio.run(migrate())
