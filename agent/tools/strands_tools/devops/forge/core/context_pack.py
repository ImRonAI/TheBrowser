"""Context pack registry and policy resolution for Forge invocations."""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
import uuid
from typing import Any


class ContextPackStore:
    """SQLite-backed registry for context packs."""

    def __init__(self, db_path: str | None = None):
        if db_path is None:
            db_path = os.path.join(os.getcwd(), "data", "forge_context_packs.db")
        self.db_path = db_path
        self._local = threading.local()
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        if not hasattr(self._local, "conn") or self._local.conn is None:
            self._local.conn = sqlite3.connect(self.db_path)
            self._local.conn.row_factory = sqlite3.Row
        return self._local.conn

    def _init_db(self) -> None:
        conn = self._get_conn()
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS context_packs (
                id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            )
            """
        )
        conn.commit()

    def upsert_pack(
        self,
        pack_id: str,
        pack: dict[str, Any],
        merge: bool = False,
    ) -> dict[str, Any]:
        conn = self._get_conn()
        now = time.time()
        existing = self.get_pack(pack_id)
        payload = pack
        created_at = now

        if existing is not None:
            created_at = float(existing["createdAt"])
            if merge:
                payload = _deep_merge_dicts(existing["pack"], pack)

        conn.execute(
            """
            INSERT INTO context_packs (id, payload, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                payload = excluded.payload,
                updated_at = excluded.updated_at
            """,
            (pack_id, json.dumps(payload), created_at, now),
        )
        conn.commit()
        return {
            "id": pack_id,
            "pack": payload,
            "createdAt": created_at,
            "updatedAt": now,
        }

    def get_pack(self, pack_id: str) -> dict[str, Any] | None:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT id, payload, created_at, updated_at FROM context_packs WHERE id = ?",
            (pack_id,),
        ).fetchone()
        if row is None:
            return None
        return {
            "id": row["id"],
            "pack": json.loads(row["payload"]),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    def list_packs(self, query: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
        conn = self._get_conn()
        max_rows = max(1, min(int(limit), 1000))

        if query:
            q = f"%{query.lower()}%"
            rows = conn.execute(
                """
                SELECT id, payload, created_at, updated_at
                FROM context_packs
                WHERE lower(id) LIKE ? OR lower(payload) LIKE ?
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (q, q, max_rows),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT id, payload, created_at, updated_at
                FROM context_packs
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (max_rows,),
            ).fetchall()

        return [
            {
                "id": row["id"],
                "pack": json.loads(row["payload"]),
                "createdAt": row["created_at"],
                "updatedAt": row["updated_at"],
            }
            for row in rows
        ]

    def delete_pack(self, pack_id: str) -> bool:
        conn = self._get_conn()
        cursor = conn.execute("DELETE FROM context_packs WHERE id = ?", (pack_id,))
        conn.commit()
        return cursor.rowcount > 0


def _dict_or_empty(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _deep_merge_dicts(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    result = dict(base)
    for key, value in override.items():
        if (
            key in result
            and isinstance(result[key], dict)
            and isinstance(value, dict)
        ):
            result[key] = _deep_merge_dicts(result[key], value)
        else:
            result[key] = value
    return result


def resolve_invoke_inputs_with_context(
    *,
    operation_id: str,
    args: dict[str, Any] | None = None,
    auth: dict[str, Any] | None = None,
    base_url: str | None = None,
    allow_http: bool | None = None,
    timeout: float | None = None,
    extra_headers: dict[str, str] | None = None,
    context_pack: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Resolve invocation inputs by merging context-pack policy with call-time inputs.

    Call-time values win over context-pack values.
    """
    incoming_args = _dict_or_empty(args)
    incoming_auth = _dict_or_empty(auth)
    incoming_headers = {
        k: str(v)
        for k, v in _dict_or_empty(extra_headers).items()
        if isinstance(k, str)
    }
    policy = _dict_or_empty(_dict_or_empty(context_pack).get("invokePolicy"))

    default_args = _dict_or_empty(policy.get("defaultArgs"))
    op_args = _dict_or_empty(_dict_or_empty(policy.get("argsByOperationId")).get(operation_id))
    merged_args = {**default_args, **op_args, **incoming_args}

    default_auth = _dict_or_empty(policy.get("defaultAuth"))
    op_auth = _dict_or_empty(_dict_or_empty(policy.get("authByOperationId")).get(operation_id))
    merged_auth = {**default_auth, **op_auth, **incoming_auth}

    default_headers = {
        k: str(v)
        for k, v in _dict_or_empty(policy.get("headers")).items()
        if isinstance(k, str)
    }
    op_headers = {
        k: str(v)
        for k, v in _dict_or_empty(_dict_or_empty(policy.get("headersByOperationId")).get(operation_id)).items()
        if isinstance(k, str)
    }
    merged_headers = {**default_headers, **op_headers, **incoming_headers}

    idempotency_header = policy.get("idempotencyKeyHeader")
    if isinstance(idempotency_header, str) and idempotency_header and idempotency_header not in merged_headers:
        merged_headers[idempotency_header] = str(uuid.uuid4())

    resolved_base_url = base_url if base_url is not None else policy.get("baseUrl")
    if resolved_base_url is not None and not isinstance(resolved_base_url, str):
        resolved_base_url = None

    resolved_allow_http = allow_http if allow_http is not None else bool(policy.get("allowHttp", False))

    policy_timeout = policy.get("timeout")
    if timeout is not None:
        resolved_timeout = float(timeout)
    elif isinstance(policy_timeout, (int, float)):
        resolved_timeout = float(policy_timeout)
    else:
        resolved_timeout = 60.0
    if resolved_timeout <= 0:
        raise ValueError("timeout must be > 0")

    required_scopes_default = policy.get("requiredScopes")
    required_scopes_by_op = _dict_or_empty(policy.get("requiredScopesByOperationId")).get(operation_id)
    required_scopes: list[str] = []
    if isinstance(required_scopes_default, list):
        required_scopes.extend([s for s in required_scopes_default if isinstance(s, str)])
    if isinstance(required_scopes_by_op, list):
        required_scopes.extend([s for s in required_scopes_by_op if isinstance(s, str)])
    required_scopes = sorted(set(required_scopes))

    provided_scopes = merged_auth.get("scopes")
    provided_scope_set = {
        s for s in provided_scopes if isinstance(s, str)
    } if isinstance(provided_scopes, list) else set()
    missing_scopes = [scope for scope in required_scopes if scope not in provided_scope_set]

    return {
        "args": merged_args,
        "auth": merged_auth if merged_auth else None,
        "baseUrl": resolved_base_url,
        "allowHttp": resolved_allow_http,
        "timeout": resolved_timeout,
        "extraHeaders": merged_headers,
        "requiredScopes": required_scopes,
        "missingScopes": missing_scopes,
    }


_default_context_pack_store: ContextPackStore | None = None


def get_context_pack_store(db_path: str | None = None) -> ContextPackStore:
    global _default_context_pack_store
    if _default_context_pack_store is None:
        _default_context_pack_store = ContextPackStore(db_path)
    return _default_context_pack_store

