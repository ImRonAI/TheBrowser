"""Fold the panel's old ``facts``, ``remember``, ``feedback`` and ``people`` stores into the second brain, once.

``python -m agent.api.core.migrate_brain`` copies every entry of every user into ``memory/brain/shared`` (facts and
remember), ``memory/brain/panel`` (feedback) and ``memory/brain/people`` with the SDK's ``FileMemoryStore.add``,
which merges an entry into a topic with the same heading. The old folders are left as they are, and
``memory/brain-migrated`` marks a user as done.
"""

from __future__ import annotations

import asyncio
from typing import Final

from strands.vended_memory_stores.file_memory_store import FileMemoryStore

from agent.api.core.panel_storage import _ScopedStorage, get_panel_storage

FOLDS: Final = {"facts": "shared", "remember": "shared", "feedback": "panel", "people": "people"}
DONE: Final = "memory/brain-migrated"


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
        await storage.write(DONE, str(moved).encode("ascii"))
        print(f"{scope}: {moved} entries folded into the brain")


if __name__ == "__main__":
    asyncio.run(migrate())
