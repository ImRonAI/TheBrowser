# Ron learning: memory, dreaming, and tool repair

Distilled from session `ses_f0d7aaad1ffeUGdhruIpjnFvvE`. OpenCode / Oh My OpenAgent routing, model inheritance, and unrelated process noise are omitted. The session did not implement these features. The durable product statement is `.omo/plans/ron-learning-linear.md`. Linear issues CAT-45–CAT-51 hold the detailed specs. SDK notes below were checked against the harness checkout pinned by `deploy/prepare-strands.sh` (`563f57d7a387931760a2c3106014cd7c0db4c9bc`) and the published `MemoryManager` docs.

## Product purpose

A native-Strands learning capability that retains useful experience, recalls current information on the main and think paths, consolidates during genuine user inactivity, observes tool failures with precise provenance, and produces verified, reversible improvements.

Existing surfaces named by the plan:

| Path | Role |
|---|---|
| `agent/api/core/memory_agent.py` | Recall |
| `agent/api/core/panel_storage.py` | Journal and memory storage |
| `agent/api/core/panel_runtime.py` | Session, stream, activity |
| `agent/api/core/panel_tools.py` | Tool catalogue and think |
| `agent/tools/strands_tools/research/think.py` | Vendored think |
| `agent/tools/strands_tools/devops/journal.py` | Vendored journal |
| `agent/tools/strands_tools/devops/cron.py` | Vendored scheduler |
| `agent/api/endpoints/memory.py` | Dream, status, entries |

Prior repo commits already sketched a shared Memory Agent (`121b5fb`, `7e95df2`, `c904504`, `da1c86a`, `781a844`): recall before model calls, journal grammar, nested `search_memories`, and a one-minute dreaming tick. The CAT work is meant to replace timer-only dreaming and ad-hoc recall with the contracts below. `AGENTS.md` now describes the later wiring: `MemoryManager`, `SerializedFileMemoryStore`, extraction, injection, and the `recall` subagent.

## Waves

1. Verify CAT-45. In parallel, inspect CAT-49 and acceptance gaps. Foundation verification gates integration.
2. CAT-46 and CAT-49 in separately owned files. One integrator owns shared composition.
3. CAT-47 and CAT-48 with explicit backend/frontend ownership. CAT-50 only after CAT-49 contracts.
4. CAT-51 after those dependencies, then independent review on the real deployment surface.

## CAT-45 — Native runtime and persistence

Verify native runtime contracts, durable Hugging Face persistence, restart recovery, user isolation, and native think behavior. Do not import a sibling SDK checkout through `sys.path`. Application types are not SDK APIs. Durable storage must not silently fall back to ephemeral storage.

**Harness (native, no extra memory stack):** `MemoryManager` is a plugin (`strands.memory.memory_manager`). Pass it on the agent. It initializes stores, runs extraction, and injects retrieved memory into the model input without writing that text into durable history. `search_memory` is on by default. `add_memory` is off unless `add_tool_config` is set. Call `memory_manager.flush()` at shutdown so background extraction finishes. `FileMemoryStore` (`strands.vended_memory_stores.file_memory_store`) is the file-backed store. Hugging Face bucket layout and per-user locks stay application code (`panel_storage.py`).

Think is not a harness primitive. The vendored `research/think.py` child agent is the existing implementation. Do not invent a second think tool.

## CAT-46 — Durable journal and current memory

Durable journal revisions, scoped current memory, supersession of outdated facts, and incremental processing checkpoints. Historical evidence stays distinct from what is currently applicable. A correction must change later use, not leave the old fact active.

**Harness:** `MemoryManager.add` writes to writable stores (optional metadata and store targeting). Automatic extraction (`ExtractionConfig`) turns conversation messages into discrete facts via `ModelExtractor`, or hands filtered messages to a store’s `add_messages` when the store extracts server-side. Default message filter drops `toolUse` / `toolResult` blocks. Triggers fire on a high-water mark, so skipped turns are still included when extraction runs.

Supersession, journal revision history, and “current vs evidence” are not store APIs. Those remain application journal semantics (`journal.py` and whatever scopes the memory namespace).

## CAT-47 — Request-scoped streamed recall

Request-scoped recall with streamed status on both the main path and the think path. Cancellation, explicit fallback, and isolation between concurrent requests. A correction must change behavior in both paths.

**Harness:** `MemoryManager.search` and the `search_memory` tool query configured stores. Injection (`MemoryInjectionConfig`, default on) folds results into each model call. That injection is not a streamed, cancellable, request-scoped subagent. Streamed recall as Chain-of-Thought events is application composition: a child agent whose tool events are mapped in `panel-stream.ts`. The SDK does not provide a “recall before every call, stream status, cancel mid-flight” product. Use `search` / injection for the read, and keep request isolation in the panel runtime.

## CAT-48 — Browser-idle incremental dreaming

Schedule consolidation from genuine browser inactivity and relevant runtime activity, not a bare timer. Incremental processing for many users. Resume from durable checkpoints. Prove idle conditions on the real Mac and VPS surfaces.

**Harness:** Built-in extraction triggers are only `InvocationTrigger` (after every invocation) and `IntervalTrigger(turns=N)` (default cadence is every 5 turns when the trigger is omitted). Both attach to `AfterInvocationEvent`. There is no idle, browser, or wall-clock dreaming trigger.

A custom `ExtractionTrigger` can call `context.fire()` from its own hook, which is the extension point if dreaming should stay inside `MemoryManager`. Deciding “the browser is idle,” multi-user checkpoints, and launchd/systemd ticks are application scheduling (`cron.py`, `endpoints/memory.py`, deploy timers). Do not reimplement fact extraction if `ModelExtractor` already covers the consolidation step.

## CAT-49 — Tool provenance and bounded failure observation

Record which tool implementation actually ran. Observe failures through native hooks without stalling the foreground run. Evidence must be attributable for later repair.

**Harness:** `BeforeToolCallEvent` and `AfterToolCallEvent` are the native observation points (`strands.hooks`). Callbacks can record the selected tool and the result. The panel already uses `BeforeToolCallEvent` for browser availability and think-tool rewriting. Provenance of “which file/revision was loaded” is not a hook field; the catalog that loaded the tool has to stamp that. Bounding the hook so it cannot block the run is an application constraint on the callback, not a separate SDK mode.

## CAT-50 — Verified repair, activation, and rollback

A repair specialist proposes a change, verifies it reproducibly, then activates or rolls it back. The repaired revision must be the one that runs. In-flight work stays on the old revision. Restart must recover. Never replay an external action whose effects are unknown.

**Harness:** There is no repair, activation, or rollback API. Hooks can cancel or rewrite a tool call (`BeforeToolCallEvent`). They do not version tool source, run a candidate in isolation, or roll a revision back. `tool_catalog` load/publish is the existing way tools enter the agent. The specialist, the verification run, and rollback are application code. Keep them off the native tool executor.

## CAT-51 — Learning destination and evaluation

Route a proposed improvement to the right destination and compare behavior before and after. The plan does not define the destination list, promotion thresholds, or schemas.

**Harness:** Nothing here maps to a learning-destination router. Evaluation is application tests against the same agent and tools.

## Verification still required

Each wave needs changed-file records, failing-first tests, passing regressions, real-runtime evidence, cleanup, and an honest gap list. Use dedicated QA identities. Do not write fabricated preferences into a real user’s memory. Do not print secrets.

Final checks called out by the plan: persistence across restart; user and request isolation; corrections reaching main and think behavior; real scheduler idle conditions; the repaired revision actually executing; in-flight revision isolation; rollback and restart recovery; visual check of any changed UI; measured timings; test artifacts removed. Local success is not VPS success.

## What this session did not establish

No RED/GREEN proof, runtime artifact, or reviewer sign-off exists in the transcript for CAT-45–CAT-51. Checkboxes in `.omo/plans/ron-learning-linear.md` were still open when the session was distilled.
