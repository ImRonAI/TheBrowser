"""SQLite persistence for account-free workspaces; never accesses account tables.

The browser holds a random 256-bit capability. Only its digest reaches this
store. All queries are scoped to that digest, including snapshots and runs.
Native Strands/A2A execution continues through the same ProjectService API.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import HTTPException

TABLES = {"projects", "issues", "issue_links", "issue_events", "activity_log",
          "issue_agents", "issue_agent_runs", "issue_agent_blobs", "project_documents", "document_issue_links",
          "document_conversations"}
DEFAULT_TYPES = [{"key": key, "label": key.title(), "level": level} for key, level in
                 [("initiative", 1), ("epic", 2), ("story", 3), ("task", 4), ("bug", 4), ("subtask", 5)]]


def fail(message, status=422):
    raise HTTPException(status, message)


def matches(row, params):
    for key, expression in params.items():
        if key in {"select", "order", "offset", "limit"}:
            continue
        if key == "or":
            if not any(matches(row, dict([part.split(".", 1)])) for part in expression.strip("()").split(",")):
                return False
        elif str(expression).startswith("eq."):
            if str(row.get(key)) != str(expression)[3:]:
                return False
        elif str(expression).startswith("in.("):
            if str(row.get(key)) not in expression[4:-1].split(","):
                return False
        else:
            fail("Unsupported workspace filter")
    return True


class Workspace:
    def __init__(self, db, identity):
        self.db, self.identity = db, identity

    def rows(self, table):
        return [json.loads(row[0]) for row in self.db.execute(
            "select payload from workspace_rows where workspace=? and kind=?", (self.identity.token, table))]

    def put(self, table, row):
        key = row["agent_id"] + ":" + row["key"] if table == "issue_agent_blobs" else row["id"]
        self.db.execute("insert into workspace_rows values (?,?,?,?) on conflict(workspace,kind,id) do update set payload=excluded.payload",
                        (self.identity.token, table, key, json.dumps(row)))
        return row

    def require(self, table, id):
        rows = [row for row in self.rows(table) if row.get("id") == id]
        if not rows:
            fail("Record not found in this workspace. Check that Projects is connected to the same API/database where it was created; your draft has not been saved.", 404)
        return rows[0]

    def configuration(self, row, old):
        config = row["settings"]
        if not isinstance(config, dict):
            fail("Invalid project configuration")
        config.setdefault("issueTypes", DEFAULT_TYPES)
        config.setdefault("fields", [])
        for definitions, is_type in [(config["issueTypes"], True), (config["fields"], False)]:
            if not isinstance(definitions, list) or (is_type and not definitions):
                fail("Invalid project configuration")
            keys = set()
            for definition in definitions:
                if not isinstance(definition, dict):
                    fail("Invalid definition")
                key = definition.get("key", "")
                if not isinstance(key, str) or not re.fullmatch(r"[a-z][a-z0-9-]{0,49}", key) or key in keys or not str(definition.get("label", "")).strip():
                    fail("Invalid or duplicate definition")
                keys.add(key)
                if is_type:
                    if type(definition.get("level")) is not int or not 1 <= definition["level"] <= 5:
                        fail("Invalid hierarchy level")
                elif definition.get("type") not in {"text", "rich-text", "number", "currency", "checkbox", "date", "datetime", "single-select", "multi-select", "person", "url", "issue"}:
                    fail("Invalid field type")
                elif definition["type"] in {"single-select", "multi-select"} and not isinstance(definition.get("options"), list):
                    fail("Select fields require options")
        if old:
            levels = {d["key"]: d["level"] for d in config["issueTypes"]}
            previous = {d["key"]: d["level"] for d in old["settings"]["issueTypes"]}
            for issue in self.rows("issues"):
                if issue["project_id"] == row["id"] and levels.get(issue["type"]) != previous.get(issue["type"]):
                    fail("Cannot remove or change an in-use hierarchy level")
            fields = {d["key"]: d["type"] for d in config["fields"]}
            if any(fields.get(d["key"]) != d["type"] for d in old["settings"]["fields"]):
                fail("Archive fields instead of deleting or changing their type")

    def validate_issue(self, row, old):
        project = self.require("projects", row["project_id"])
        config = project["settings"]
        levels = {d["key"]: d["level"] for d in config["issueTypes"]}
        level = levels.get(row["type"])
        if level is None:
            fail("Unknown issue type")
        if row.get("parent_id"):
            parent = self.require("issues", row["parent_id"])
            if parent["project_id"] != row["project_id"]:
                fail("Cross-project parents are disabled")
            parent_config = self.require("projects", parent["project_id"])["settings"]
            parent_level = next(d["level"] for d in parent_config["issueTypes"] if d["key"] == parent["type"])
            if parent_level + 1 != level:
                fail("Parent must be exactly one level above child")
            seen = {row["id"]}
            while parent:
                if parent["id"] in seen:
                    fail("Hierarchy cycle")
                seen.add(parent["id"])
                parent = self.require("issues", parent["parent_id"]) if parent.get("parent_id") else None
        elif level == 5:
            fail("Subtasks require a parent")
        for child in self.rows("issues"):
            if child.get("parent_id") == row["id"]:
                child_config = self.require("projects", child["project_id"])["settings"]
                child_level = next(d["level"] for d in child_config["issueTypes"] if d["key"] == child["type"])
                if child_level != level + 1:
                    fail("Issue type conflicts with existing children")
        if not row.get("title", "").strip() or row.get("status") not in {"backlog", "in-progress", "review", "blocked", "done"} or row.get("priority") not in {"critical", "high", "medium", "low"}:
            fail("Invalid issue values")
        for key in ("start_date", "end_date", "due_date"):
            if row.get(key):
                datetime.fromisoformat(row[key])
        if row.get("start_date") and row.get("end_date") and datetime.fromisoformat(row["start_date"]) > datetime.fromisoformat(row["end_date"]):
            fail("End date precedes start date")
        values = row["custom_fields"]
        if not isinstance(values, dict) or not isinstance(row["work_products"], list) or not isinstance(row.get("context", []), list):
            fail("Invalid issue values")
        if values.keys() - {d["key"] for d in config["fields"]}:
            fail("Unknown custom field")
        for field in config["fields"]:
            key, kind = field["key"], field["type"]
            value = values.get(key)
            if field.get("archived"):
                if value != (old or {}).get("custom_fields", {}).get(key):
                    fail("Archived fields are read-only")
                continue
            if field.get("issueTypes") and row["type"] not in field["issueTypes"]:
                if value is not None:
                    fail("Field does not apply to this issue type")
                continue
            if not old and key not in values and "default" in field:
                value = values[key] = field["default"]
            if value is None or value == "":
                if field.get("required"):
                    fail(f"Required field: {field['label']}")
                continue
            if kind in {"number", "currency"}:
                valid = type(value) in (int, float)
            elif kind == "checkbox":
                valid = type(value) is bool
            elif kind == "multi-select":
                valid = isinstance(value, list) and all(v in field["options"] for v in value)
            else:
                valid = isinstance(value, str)
                if valid and kind == "single-select": valid = value in field["options"]
                if valid and kind == "url": valid = value.startswith(("http://", "https://"))
                if valid and kind == "date": date.fromisoformat(value)
                if valid and kind == "datetime": datetime.fromisoformat(value)
                if valid and kind == "person": UUID(value)
                if valid and kind == "issue": self.require("issues", value)
            if not valid:
                fail(f"Invalid field: {field['label']}")

    def validate_document(self, row):
        """Mirrors 015_project_documents.sql: title/content bounds, same-project parent, no cycles."""
        if not isinstance(row.get("title"), str) or not 1 <= len(row["title"].strip()) <= 300:
            fail("Page title must be 1-300 characters")
        if not isinstance(row.get("content"), str) or len(row["content"]) > 2_000_000:
            fail("Page content is too large")
        ancestor, depth = row.get("parent_id"), 0
        while ancestor:
            if ancestor == row["id"]:
                fail("A page cannot be nested under itself")
            parent = self.require("project_documents", ancestor)
            if parent["project_id"] != row["project_id"]:
                fail("Parent page must belong to the same project")
            depth += 1
            if depth > 50:
                fail("Pages are nested too deeply")
            ancestor = parent.get("parent_id")

    def document_subtree(self, root_id):
        """The page and every page nested under it (deleted together, like the SQL cascade)."""
        pages = self.rows("project_documents")
        ids, frontier = {root_id}, [root_id]
        while frontier:
            current = frontier.pop()
            for page in pages:
                if page.get("parent_id") == current and page["id"] not in ids:
                    ids.add(page["id"])
                    frontier.append(page["id"])
        return ids

    def insert(self, table, body):
        now = datetime.now(timezone.utc).isoformat()
        row = {"id": str(uuid4()), "created_at": now, **body}
        if table == "projects":
            row = {"settings": {"allowCrossProjectParents": False}, "summary": "", "lifecycle": "active", **row,
                   "version": 1, "issue_counter": 0, "updated_at": now, "user_id": self.identity.user_id, "owner_id": self.identity.user_id}
            if any(p["key"] == row["key"] for p in self.rows(table)):
                fail("Project key already exists", 409)
            self.configuration(row, None)
        elif table == "issues":
            project = self.require("projects", row["project_id"])
            row = {"parent_id": None, "description": "", "assignees": [], "labels": [], "custom_fields": {}, "work_products": [], "context": [],
                   "status": "backlog", "priority": "medium", "rank": 100, **row,
                   "number": project["issue_counter"] + 1, "version": 1, "updated_at": now, "created_by": self.identity.user_id}
            self.validate_issue(row, None)
            project["issue_counter"] += 1
            self.put("projects", project)
        elif table == "issue_links":
            self.require("issues", row["source_id"])
            self.require("issues", row["target_id"])
            if row["source_id"] == row["target_id"]:
                fail("Cannot link an issue to itself")
            if any(all(link[k] == row[k] for k in ("source_id", "target_id", "type")) for link in self.rows(table)):
                fail("Relationship already exists", 409)
        elif table == "issue_events":
            self.require("issues", row["issue_id"])
            if datetime.fromisoformat(row["ends_at"]) <= datetime.fromisoformat(row["starts_at"]):
                fail("Event end must be after start")
        elif table == "document_issue_links":
            # Mirrors 015_project_documents.sql: both ends exist (any project), one link per pair.
            row = {"document_id": row["document_id"], "issue_id": row["issue_id"], "id": row["id"], "created_at": now,
                   "created_by": self.identity.user_id}
            self.require("project_documents", row["document_id"])
            self.require("issues", row["issue_id"])
            if any(link["document_id"] == row["document_id"] and link["issue_id"] == row["issue_id"] for link in self.rows(table)):
                fail("This page is already linked to that issue", 409)
        elif table == "document_conversations":
            # Mirrors 018_document_conversations.sql: the page exists, the store assigns the session id.
            self.require("project_documents", row["document_id"])
            row = {"id": row["id"], "document_id": row["document_id"], "user_id": self.identity.user_id,
                   "session_id": f"doc-{row['id']}", "title": self.conversation_title(row.get("title")),
                   "goal": bool(row.get("goal", False)), "created_at": now, "updated_at": now}
        elif table == "project_documents":
            self.require("projects", row["project_id"])
            row = {"parent_id": None, "title": "Untitled", "content": "", **row,
                   "version": 1, "updated_at": now, "created_by": self.identity.user_id}
            self.validate_document(row)
        else:
            fail("Unsupported workspace insert")
        self.put(table, row)
        if table == "issues": self.audit(row, None)
        return [row]

    @staticmethod
    def conversation_title(title):
        if not isinstance(title, str) or not 1 <= len(title.strip()) <= 200:
            fail("Conversation title must be 1 to 200 characters")
        return title

    def audit(self, row, old):
        self.put("activity_log", {"id": str(uuid4()), "project_id": row["project_id"], "issue_id": row["id"],
            "actor_id": self.identity.user_id, "actor_name": "You", "actor_type": "user",
            "action": "Updated issue" if old else "Created issue", "old_value": json.dumps(old) if old else None,
            "new_value": json.dumps(row), "timestamp": datetime.now(timezone.utc).isoformat()})

    def rpc(self, resource, body):
        if resource == "rpc/put_issue_agent_blob":
            self.require("issue_agents", body["p_agent"])
            self.put("issue_agent_blobs", {"agent_id": body["p_agent"], "key": body["p_key"], "payload": body["p_payload"]})
            return None
        if resource != "rpc/start_issue_agent_run":
            fail("Unknown workspace operation")
        self.require("issues", body["p_issue"])
        agent = next((a for a in self.rows("issue_agents") if a["issue_id"] == body["p_issue"]), None)
        now = datetime.now(timezone.utc).isoformat()
        if not agent:
            agent = self.put("issue_agents", {"id": str(uuid4()), "issue_id": body["p_issue"], "user_id": self.identity.user_id,
                "provider": body["p_provider"], "model_id": body["p_model"], "created_at": now})
        if any(r["agent_id"] == agent["id"] and r["status"] == "running" for r in self.rows("issue_agent_runs")):
            fail("A run is already active", 409)
        run = self.put("issue_agent_runs", {"id": str(uuid4()), "agent_id": agent["id"], "message": body["p_message"],
            "output": "", "status": "running", "error": None, "created_at": now, "finished_at": None})
        return {"agent": agent, "run": run}

    def request(self, method, resource, params, body):
        if resource.startswith("rpc/") and method == "POST":
            return self.rpc(resource, body)
        if resource not in TABLES:
            fail("Unknown workspace resource")
        if method == "POST":
            return self.insert(resource, body)
        rows = [row for row in self.rows(resource) if matches(row, params)]
        if method == "GET":
            for order in reversed(params.get("order", "id.asc").split(",")):
                key, _, direction = order.partition(".")
                rows.sort(key=lambda r: (r.get(key) is not None, r.get(key)), reverse=direction == "desc")
            offset = int(params.get("offset", 0))
            return rows[offset:offset + int(params.get("limit", len(rows)))]
        if method == "DELETE" and resource == "project_documents":
            for row in rows:
                pages = self.document_subtree(row["id"])
                for page_id in pages:
                    self.db.execute("delete from workspace_rows where workspace=? and kind=? and id=?", (self.identity.token, resource, page_id))
                # document_issue_links.document_id ... on delete cascade
                for link in self.rows("document_issue_links"):
                    if link["document_id"] in pages:
                        self.db.execute("delete from workspace_rows where workspace=? and kind=? and id=?", (self.identity.token, "document_issue_links", link["id"]))
                # document_conversations.document_id ... on delete cascade
                for conversation in self.rows("document_conversations"):
                    if conversation["document_id"] in pages:
                        self.db.execute("delete from workspace_rows where workspace=? and kind=? and id=?", (self.identity.token, "document_conversations", conversation["id"]))
            return rows
        if method == "DELETE" and resource in {"issue_links", "issue_agent_blobs", "document_issue_links"}:
            for row in rows:
                key = row["agent_id"] + ":" + row["key"] if resource == "issue_agent_blobs" else row["id"]
                self.db.execute("delete from workspace_rows where workspace=? and kind=? and id=?", (self.identity.token, resource, key))
            return rows
        if method == "PATCH" and resource == "document_conversations":
            if set(body) - {"title"}:
                fail("Conversation identity is immutable")
            result = []
            for old in rows:
                row = {**old, "title": self.conversation_title(body.get("title", old["title"])),
                       "updated_at": datetime.now(timezone.utc).isoformat()}
                self.put(resource, row)
                result.append(row)
            return result
        if method == "PATCH" and resource in {"projects", "issues", "issue_agent_runs", "project_documents"}:
            result = []
            for old in rows:
                immutable = {"id", "user_id", "owner_id", "project_id", "number", "created_by", "agent_id", "issue_counter", "version", "key"}
                if body.keys() & immutable:
                    fail("Record identity is immutable")
                row = {**old, **body}
                if resource != "issue_agent_runs":
                    row.update(version=old["version"] + 1, updated_at=datetime.now(timezone.utc).isoformat())
                if resource == "projects": self.configuration(row, old)
                if resource == "issues": self.validate_issue(row, old)
                if resource == "project_documents": self.validate_document(row)
                self.put(resource, row)
                if resource == "issues": self.audit(row, old)
                result.append(row)
            return result
        fail("Unsupported workspace operation")


def request(identity, method, resource, params, body):
    from agent.api.core.config import SESSION_STORAGE_DIR

    path = Path(os.getenv("PROJECTS_GUEST_DB", str(SESSION_STORAGE_DIR / "projects.sqlite3")))
    path.parent.mkdir(parents=True, exist_ok=True)
    # Create with private permissions, without exposing an empty world-readable file.
    descriptor = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    os.close(descriptor)
    db = sqlite3.connect(path, timeout=30)
    try:
        db.execute("create table if not exists workspace_rows (workspace text not null, kind text not null, id text not null, payload text not null, primary key(workspace,kind,id))")
        db.execute("begin immediate")
        result = Workspace(db, identity).request(method, resource, params, body)
        db.commit()
        return result
    except (ValueError, TypeError, KeyError) as error:
        db.rollback()
        raise HTTPException(422, "Invalid workspace values") from error
    except sqlite3.Error as error:
        db.rollback()
        raise HTTPException(503, "Workspace database unavailable; no save was confirmed") from error
    finally:
        db.close()