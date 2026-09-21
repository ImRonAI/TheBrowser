"""Tool catalog manager — records tools loaded into the active Strands agent.

This module implements the missing piece of the RonBrowser tools surface
referenced by ``agent_orchestration.load_tool``,
``agent_orchestration.mcp_client``, and ``devops.tool_execute``. It maintains
an in-memory registry of tool entries plus a method to project the catalog
into a JSON-serialisable overview for inclusion in tool responses.
"""

from __future__ import annotations

import threading
from typing import Any


class ToolCatalogEntry:
    """One catalog record — either a live tool object or a metadata-only stub."""

    def __init__(
        self,
        name: str,
        description: str,
        input_schema: dict[str, Any],
        origin: str,
        category: str,
        path: str | None = None,
        load_pathway: str | None = None,
        execute_pathway: str | None = None,
        unload_pathway: str | None = None,
        tool_obj: Any | None = None,
    ) -> None:
        self.name = name
        self.description = description
        self.input_schema = input_schema
        self.origin = origin
        self.category = category
        self.path = path
        self.load_pathway = load_pathway
        self.execute_pathway = execute_pathway
        self.unload_pathway = unload_pathway
        self.tool_obj = tool_obj

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
            "origin": self.origin,
            "category": self.category,
            "path": self.path,
            "load_pathway": self.load_pathway,
            "execute_pathway": self.execute_pathway,
            "unload_pathway": self.unload_pathway,
            "has_tool_obj": self.tool_obj is not None,
        }


class ToolCatalogManager:
    """Process-wide catalog of loaded Strands tools."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._entries: dict[str, ToolCatalogEntry] = {}

    def register_tool(
        self,
        tool_obj: Any,
        origin: str,
        category: str,
        load_pathway: str | None = None,
    ) -> None:
        name = getattr(tool_obj, "name", None) or getattr(tool_obj, "__name__", None)
        if not name:
            return
        description = (getattr(tool_obj, "description", None) or "").strip()
        input_schema = getattr(tool_obj, "parameters", None) or {}
        if not isinstance(input_schema, dict):
            input_schema = {}
        with self._lock:
            self._entries[name] = ToolCatalogEntry(
                name=name,
                description=description,
                input_schema=input_schema,
                origin=origin,
                category=category,
                load_pathway=load_pathway,
                tool_obj=tool_obj,
            )

    def register_entry(
        self,
        name: str,
        description: str,
        input_schema: dict[str, Any],
        origin: str,
        category: str,
        path: str | None = None,
        load_pathway: str | None = None,
        execute_pathway: str | None = None,
        unload_pathway: str | None = None,
    ) -> None:
        with self._lock:
            self._entries[name] = ToolCatalogEntry(
                name=name,
                description=description,
                input_schema=input_schema,
                origin=origin,
                category=category,
                path=path,
                load_pathway=load_pathway,
                execute_pathway=execute_pathway,
                unload_pathway=unload_pathway,
            )

    def build_catalog_overview(self) -> dict[str, Any]:
        with self._lock:
            entries = [entry.to_dict() for entry in self._entries.values()]
        return {
            "tool_count": len(entries),
            "tools": entries,
        }


_MANAGER_SINGLETON: ToolCatalogManager | None = None
_SINGLETON_LOCK = threading.Lock()


def get_tool_catalog_manager() -> ToolCatalogManager:
    """Return the process-wide catalog manager singleton."""
    global _MANAGER_SINGLETON
    with _SINGLETON_LOCK:
        if _MANAGER_SINGLETON is None:
            _MANAGER_SINGLETON = ToolCatalogManager()
        return _MANAGER_SINGLETON
