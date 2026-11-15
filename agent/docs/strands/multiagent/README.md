# Strands Python SDK — Multi-Agent Documentation & Pinned Source Verification

Official Strands documentation pulled from `https://strandsagents.com` and cross-checked line-by-line against the repo's pinned Strands Python SDK commit:

- **Pinned SHA**: `563f57d7a387931760a2c3106014cd7c0db4c9bc` (`https://github.com/strands-agents/harness-sdk.git`)
- **Installed Python package root**: `agent/api/core/harness-sdk/strands-py/src/strands/`

---

## 1. Document Index

### Multi-Agent User Guides
- [`multi-agent-patterns.md`](./multi-agent-patterns.md) — Pattern selection (`Agents as tools`, `A2A`, `Swarm`, `Graph`, `Workflow`) and `invocation_state` sharing
- [`graph.md`](./graph.md) — `GraphBuilder`, `Graph`, conditional edges (`EdgeCondition`, `EdgeConditionWithContext`), OR-semantics vs AND-joins, nested orchestrators, `A2AAgent`, custom `MultiAgentBase` nodes, cyclic graphs, streaming
- [`graph-components.md`](./graph-components.md) — `GraphNode`, `GraphEdge`, `GraphBuilder` building blocks
- [`swarm.md`](./swarm.md) — `Swarm`, `handoff_to_agent`, `SharedContext`, repetitive handoff detection, safety limits, streaming
- [`workflow.md`](./workflow.md) — Sequential/DAG workflow patterns vs `Graph`
- [`agents-as-tools.md`](./agents-as-tools.md) — Direct agent tool passing, `Agent.as_tool(preserve_context=..., delegate=...)`, custom `@tool` wrappers
- [`agent-to-agent.md`](./agent-to-agent.md) — A2A protocol (`A2AServer`, `A2AAgent`, `A2AClientToolProvider`)
- [`a2a-server-configuration.md`](./a2a-server-configuration.md) — `A2AServer` configuration and mounting
- [`interrupts-multi-agent.md`](./interrupts-multi-agent.md) — Interrupts and resumption across `Agents as Tools`, `Swarm`, and `Graph`

### State, Sessions, Snapshots, Hooks & Streaming Guides
- [`state.md`](./state.md) — Conversation history, `AgentState`, and `invocation_state`
- [`session-management.md`](./session-management.md) — Single-agent and multi-agent session persistence (`SnapshotSessionManager`, `FileSessionManager`, `S3SessionManager`, `RepositorySessionManager`)
- [`snapshots.md`](./snapshots.md) — Point-in-time `Snapshot` capture/restore (`take_snapshot`, `load_snapshot`)
- [`hooks.md`](./hooks.md) — Hook registration (`HookProvider`, `add_hook`, `HookOrder`)
- [`hooks-events.md`](./hooks-events.md) — Complete lifecycle hook events (`MultiAgentInitializedEvent`, `BeforeMultiAgentInvocationEvent`, `BeforeNodeCallEvent`, `AfterNodeCallEvent`, `AfterMultiAgentInvocationEvent`)
- [`streaming-events.md`](./streaming-events.md) — Streaming event schemas (`multiagent_node_start`, `multiagent_node_stream`, `multiagent_node_stop`, `multiagent_handoff`, `multiagent_result`, etc.)
- [`streaming-async-iterators.md`](./streaming-async-iterators.md) — Consuming `stream_async` in async servers (FastAPI SSE)

### Python API Reference
- **Multi-Agent & Agent Bases**:
  - [`api-strands.multiagent.base.md`](./api-strands.multiagent.base.md) — `Status`, `NodeResult`, `MultiAgentResult`, `MultiAgentBase`
  - [`api-strands.multiagent.graph.md`](./api-strands.multiagent.graph.md) — `EdgeConditionWithContext`, `GraphState`, `GraphResult`, `GraphEdge`, `GraphNode`, `GraphBuilder`, `Graph`
  - [`api-strands.multiagent.swarm.md`](./api-strands.multiagent.swarm.md) — `SwarmNode`, `SharedContext`, `SwarmState`, `SwarmResult`, `Swarm`
  - [`api-strands.multiagent.a2a.server.md`](./api-strands.multiagent.a2a.server.md) — `A2AServer`
  - [`api-strands.multiagent.a2a.executor.md`](./api-strands.multiagent.a2a.executor.md) — `StrandsA2AExecutor`
  - [`api-strands.agent.base.md`](./api-strands.agent.base.md) — `AgentBase` protocol
  - [`api-strands.agent.agent.md`](./api-strands.agent.agent.md) — `Agent` (`__call__`, `invoke_async`, `stream_async`, `as_tool`, `add_hook`, `take_snapshot`, `load_snapshot`)
  - [`api-strands.agent.agent_result.md`](./api-strands.agent.agent_result.md) — `AgentResult`
  - [`api-strands.agent.a2a_agent.md`](./api-strands.agent.a2a_agent.md) — `A2AAgent`
- **Hooks, Plugins, Sessions, Interrupts & Streaming**:
  - [`api-strands.hooks.events.md`](./api-strands.hooks.events.md)
  - [`api-strands.hooks.registry.md`](./api-strands.hooks.registry.md)
  - [`api-strands.plugins.multiagent_plugin.md`](./api-strands.plugins.multiagent_plugin.md)
  - [`api-strands.plugins.multiagent_registry.md`](./api-strands.plugins.multiagent_registry.md)
  - [`api-strands.session.session_manager.md`](./api-strands.session.session_manager.md)
  - [`api-strands.session.snapshot_session_manager.md`](./api-strands.session.snapshot_session_manager.md)
  - [`api-strands.session.repository_session_manager.md`](./api-strands.session.repository_session_manager.md)
  - [`api-strands.session.file_session_manager.md`](./api-strands.session.file_session_manager.md)
  - [`api-strands.session.s3_session_manager.md`](./api-strands.session.s3_session_manager.md)
  - [`api-strands.session.session_repository.md`](./api-strands.session.session_repository.md)
  - [`api-strands.interrupt.md`](./api-strands.interrupt.md)
  - [`api-strands.types.interrupt.md`](./api-strands.types.interrupt.md)
  - [`api-strands.types.session.md`](./api-strands.types.session.md)
  - [`api-strands.types.streaming.md`](./api-strands.types.streaming.md)
  - [`api-strands.event_loop.streaming.md`](./api-strands.event_loop.streaming.md)

---

## 2. Verified Differences: Upstream `strandsagents.com` Docs vs Pinned Commit `563f57d7a387931760a2c3106014cd7c0db4c9bc`

Every discrepancy below was verified directly against `agent/api/core/harness-sdk/strands-py/src/strands/`:

1. **Upstream-only modules NOT present in pinned `563f57d7`**:
   - `strands.multiagent.spec` (`Fixed`, `Inherit`, `Open`, `Choice`, `Preset`) does **not** exist in `563f57d7`.
   - `strands.vended_tools.graph`, `strands.vended_tools.swarm`, and `strands.vended_tools.subagent` do **not** exist in `563f57d7`. Use `strands.multiagent.{GraphBuilder, Swarm}`, `Agent.as_tool()`, `strands.vended_plugins.skills.AgentSkills`, and `strands_harness.tools.subagent`.
2. **`Status.DISPATCHED` does NOT exist in `563f57d7`** (`strands/multiagent/base.py:29-39`):
   - `api-strands.multiagent.base.md` lists `DISPATCHED`; pinned `Status(Enum)` has exactly 5 members: `PENDING`, `EXECUTING`, `COMPLETED`, `FAILED`, `INTERRUPTED`.
3. **`invocation_context` / `InvocationContext` does NOT exist in `563f57d7`** (`base.py:139-147`, `graph.py:586-630`, `swarm.py:362-406`):
   - Upstream API docs show `invocation_context: InvocationContext | None = None` on `Graph`/`Swarm` execution methods and `MultiAgentResult.invocation_context`. Neither exists in `563f57d7`.
4. **`invocation_state` is NOT serialized in `Graph` or `Swarm` checkpoints** (`graph.py:1270-1292, 1422-1427`, `swarm.py:1012-1037`):
   - `graph.md` (line 221) claims `invocation_state` is serialized with the graph checkpoint across interrupt/resume. In `563f57d7`, `Graph.serialize_state()` evaluates edge conditions using in-memory `self._current_invocation_state` to compute `next_nodes_to_execute`, and does **not** persist `invocation_state` itself. On resume, re-pass `invocation_state={...}` if subsequent edges, hooks, or tools read it.
5. **Streaming `multiagent_node_start["node_type"]` & extra multiagent event types** (`graph.py:992`, `swarm.py:938`, `types/_events.py:556-624`):
   - `streaming-events.md` says `node_type` is `"agent" | "swarm" | "graph"`. Actual runtime code emits **only** `"multiagent"` (for any `MultiAgentBase` subclass, including `Graph` and `Swarm`) or `"agent"` (for `AgentBase`).
   - In addition to the 5 events listed in `streaming-events.md`, Python also emits:
     - `{"type": "multiagent_node_cancel", "node_id": str, "message": str}` (`MultiAgentNodeCancelEvent`)
     - `{"type": "multiagent_node_interrupt", "node_id": str, "interrupts": list[Interrupt]}` (`MultiAgentNodeInterruptEvent`)
   - Note: `graph.py:639` and `swarm.py:415` docstrings contain a typo (`multi_agent_node_start`); actual emitted `"type"` keys use `"multiagent_*"` (no underscore in `multiagent`).
6. **`Graph` conversation history table claim in `multi-agent-patterns.md`**:
   - Table says Graph nodes share a "Full Transcript". In Python (`graph.py:1203-1243`, `_build_node_input`), downstream nodes receive formatted text blocks containing `"Original Task: ..."` plus `"Inputs from previous nodes:\nFrom <dep_id>:\n  - Agent: <str(result)>"` for satisfied incoming edges (flattened recursively via `NodeResult.get_agent_results()`), not upstream `agent.messages` tool-call transcripts.
7. **`Graph.deserialize_state` resume condition in `563f57d7`** (`graph.py:1311` vs `api-strands.multiagent.graph.md:521`):
   - In `563f57d7`, `deserialize_state` checks `if not payload.get("next_nodes_to_execute"):` (upstream later added `and not payload.get("interrupted_nodes")`). Standard DAG entry/downstream interrupted nodes appear in `next_nodes_to_execute`; cyclic revisits whose entry edge condition evaluates to `False` at serialize time would have empty `next_nodes_to_execute`.
8. **Exports not in `strands.multiagent.__all__`** (`strands/multiagent/__init__.py`):
   - `strands.multiagent` exports `EdgeCondition`, `EdgeConditionWithContext`, `GraphBuilder`, `GraphResult`, `MultiAgentBase`, `MultiAgentResult`, `Status`, `Swarm`, `SwarmResult`.
   - Import `Graph`, `GraphNode`, `GraphEdge`, `GraphState` from `strands.multiagent.graph`; `NodeResult` from `strands.multiagent.base`; `SwarmNode`, `SharedContext`, `SwarmState` from `strands.multiagent.swarm`; `MultiAgentInput` from `strands.types.multiagent`.
