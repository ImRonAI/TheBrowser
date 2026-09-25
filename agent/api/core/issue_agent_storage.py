"""RLS-backed byte storage for native Strands snapshots and native A2A tasks."""
from __future__ import annotations

import base64

from a2a.server.tasks import TaskStore
from a2a.types import Task
from strands.storage import Storage

from agent.api.core.panel_storage import _path
from agent.api.core.projects import ProjectService


class IssueAgentStorage(Storage):
    def __init__(self, service: ProjectService, agent_id: str):
        self.service, self.agent_id = service, agent_id

    async def write(self, key: str, data: bytes) -> None:
        await self.service.request("POST", "rpc/put_issue_agent_blob", body={
            "p_agent": self.agent_id, "p_key": _path(key),
            "p_payload": base64.b64encode(data).decode("ascii"),
        })

    async def read(self, key: str) -> bytes | None:
        rows = await self.service.rows("issue_agent_blobs", agent_id=f"eq.{self.agent_id}", key=f"eq.{_path(key)}")
        return base64.b64decode(rows[0]["payload"], validate=True) if rows else None

    async def delete(self, key: str) -> None:
        await self.service.request("DELETE", "issue_agent_blobs", params={
            "agent_id": f"eq.{self.agent_id}", "key": f"eq.{_path(key)}",
        })

    async def list(self, query: str = "") -> list[str]:
        prefix = _path(query, prefix=True)
        keys, offset = [], 0
        while True:
            rows = await self.service.request("GET", "issue_agent_blobs", params={
                "select": "key", "agent_id": f"eq.{self.agent_id}",
                "order": "key.asc", "offset": offset, "limit": 200,
            })
            keys.extend(row["key"] for row in rows if row["key"].startswith(prefix))
            if len(rows) < 200:
                return keys
            offset += len(rows)


class IssueA2ATaskStore(TaskStore):
    def __init__(self, storage: Storage):
        self.storage = storage

    async def save(self, task: Task, context=None) -> None:
        await self.storage.write(f"a2a/{task.id}", task.model_dump_json().encode())

    async def get(self, task_id: str, context=None) -> Task | None:
        data = await self.storage.read(f"a2a/{task_id}")
        return Task.model_validate_json(data) if data else None

    async def delete(self, task_id: str, context=None) -> None:
        await self.storage.delete(f"a2a/{task_id}")