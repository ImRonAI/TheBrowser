# Ron Learning System
## Cleaned feature scope

**Source:** Pasted text.txt, especially the embedded "Ron learning implementation - CAT-45 through CAT-51" plan, source lines 5119-5148.

This document preserves the product workstreams, integration references, dependency order, and verification requirements present in the source. It is not a claim that the features have been implemented. The detailed issue specifications referenced by the source are not included in the attachment. The companion PRD supplies explicitly proposed engineering details.

## Product purpose

Develop a native-Strands learning capability that retains useful experience, recalls current information in the main and think paths, consolidates new information during genuine user inactivity, observes tool failures with precise provenance, and produces verified, reversible improvements.

## CAT-45 - Native runtime and persistence foundations

Verify the native runtime contracts, durable persistence in the environment identified as HF, restart recovery, user isolation, and native think behavior. Preserve the SDK version pinned by `deploy/prepare-strands.sh`:

`563f57d7a387931760a2c3106014cd7c0db4c9bc`

Use supported native SDK integration points. Do not import an adjacent SDK checkout through `sys.path`. Treat newly introduced application types as application types, not as existing SDK APIs. The source does not expand the term HF; its exact deployment meaning must be confirmed before deployment-specific acceptance.

## CAT-46 - Durable journal and current memory

Implement durable journal revisions, scoped current memory, supersession of outdated information, and incremental processing checkpoints. Preserve the distinction between historical evidence and the information currently considered applicable. Corrections must affect subsequent use of memory rather than leaving obsolete information active.

## CAT-47 - Request-scoped streamed recall

Implement request-scoped recall with streamed status and integration into both the main and think paths. Support cancellation and explicit fallback behavior. Concurrent requests must remain isolated. Verify that a correction actually changes behavior in both consuming paths.

## CAT-48 - Browser-idle incremental dreaming

Implement scheduling based on genuine browser inactivity and relevant runtime activity, rather than merely running a timer. Support incremental processing for multiple users. Resume from durable checkpoints and verify the scheduler's idle conditions on actual deployment surfaces.

## CAT-49 - Tool provenance and bounded failure observation

Capture provenance for the tool implementation actually resolved and executed. Observe failures through native hooks, with bounded impact on the foreground runtime. Produce attributable evidence suitable for downstream analysis and repair.

## CAT-50 - Verified repair, activation, and rollback

Implement a native repair specialist that produces candidate changes, verifies them reproducibly, and supports controlled activation and rollback. Verify execution of the actual repaired revision, isolation of in-flight work, rollback behavior, and restart recovery. Never replay an external action whose effects are unknown.

## CAT-51 - Learning destination routing and evaluation

Route learning to its appropriate destination and evaluate behavior before and after the proposed improvement. The source names this capability but does not enumerate the destination taxonomy, promotion thresholds, or schemas. These are proposed in the companion PRD.

## Source dependency order

| Wave | Work | Required relationship |
|---|---|---|
| 1 | CAT-45 verification; inspect CAT-49 and acceptance gaps in parallel | Foundation verification gates integration, not independent investigation. |
| 2 | CAT-46 and CAT-49 | Separate ownership of implementation files; one integrator owns shared composition. |
| 3 | CAT-47 and CAT-48; CAT-50 after CAT-49 contracts | Explicit frontend/backend ownership; repair depends on provenance. |
| 4 | CAT-51 and final independent review | Integrate after dependency acceptance; verify actual deployment behavior. |

The companion PRD improves this sequence by starting baseline evaluation and destination contracts in the foundation phase while retaining final learning promotion as a later release gate.

## Verification and delivery requirements

Every workstream must provide changed-file records, failing-first test evidence, passing regressions, real-runtime evidence, cleanup records, and a candid statement of unresolved gaps. Durable storage must never silently fall back to ephemeral storage.

Use dedicated QA identities and uniquely attributable test artifacts. Do not put fabricated preferences into a real user's memory. Do not expose credentials or secret values. Local success is not evidence of successful hosted or VPS deployment.

Final acceptance covers persistence through restart; user and request isolation; corrections reaching main and think behavior; real scheduler idle conditions; actual repaired revision execution; in-flight revision isolation; rollback and restart recovery; visual verification of changed UI; measured performance distributions; and removal of test artifacts.

## Source-referenced integration surfaces

| Existing path named in the source | Relevant responsibility |
|---|---|
| `AGENTS.md` | Runtime and development boundaries |
| `deploy/prepare-strands.sh` | SDK pin and environment preparation |
| `deploy/strands-bidi.patch` | Declared SDK patch mechanism, where already required |
| `agent/api/core/memory_agent.py` | Recall integration |
| `agent/api/core/panel_storage.py` | Journal and memory storage |
| `agent/api/core/panel_runtime.py` | Session, stream, and activity integration |
| `agent/api/core/panel_tools.py` | Tool catalogue and think integration |
| `agent/tools/strands_tools/research/think.py` | Existing think implementation reference |
| `agent/tools/strands_tools/devops/journal.py` | Existing journal implementation reference |
| `agent/tools/strands_tools/devops/cron.py` | Existing scheduling implementation reference |
| `agent/api/endpoints/memory.py` | Memory, status, and dreaming endpoints |

These are source-referenced paths, not a newly verified repository inventory. Their current contents and behavior must be inspected before modification.
