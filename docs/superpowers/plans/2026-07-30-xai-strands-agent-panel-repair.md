# xAI Strands Agent Panel Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Ron’s agent panel responsive using xAI exclusively while displaying documented Strands answer, reasoning, tool, structured-output, and completion events through the official AI Elements chain-of-thought UI.

**Architecture:** Keep Strands `Agent.stream_async` as the only agent loop and add a narrow transport adapter that serializes documented SDK events to SSE. Parse SSE frames in a focused frontend module, reduce them immutably into AI SDK-compatible message parts, and render assistant messages through `ChainOfThoughtMessage`. Provider-side xAI calls remain provider-executed; the bridge only exposes their documented stream markers/metadata as display events.

**Tech Stack:** Python 3, FastAPI, Pydantic, Strands Agents SDK, `strands-xai`, xAI SDK, React 19, TypeScript, AI SDK UI message parts, AI Elements 1.9.0, pytest, Electron Vite.

---

## Constraints and source contracts

- xAI is the sole model provider. Remove Perplexity imports, routing, configuration, and model-catalogue behavior from this endpoint.
- Register `web_search`, `x_search`, `code_execution`, and `collections_search` in `xAIModel.xai_tools`; these remain server-side xAI tools and must not be added to `Agent.tools`.
- Consume documented Strands event keys: `data`, `reasoningText`, `current_tool_use`, `structured_output`, and `result`.
- Render only SDK-provided `reasoningText`. Never render `reasoningRedactedContent`, signatures, or encrypted xAI state.
- xAI server-tool markers arrive under `data` as `[xAI Tool: NAME(ARGUMENTS)]`; raw provider metadata may additionally expose `event.metadata.serverToolCalls`.
- Restore `src/components/ai-elements/chain-of-thought.tsx` to the official 1.9.0 source contract. Do not alter its types, animations, subcomponents, or open/close behavior.
- Stop immediately on any failed validation. Report the failure and request approval before attempting a fix.
- Git commits are intentionally omitted because the user has not requested commits.

## File map

### Create

- `src/components/agent-panel/agent-stream.ts` — SSE framing parser, transport-event types, and immutable event-to-message-part reducer.

### Modify

- `agent/api/core/config.py` — remove Perplexity settings and retain xAI-only configuration.
- `agent/api/endpoints/chat.py` — remove Perplexity provider code; register all four xAI tools; serialize documented Strands events consistently.
- `agent/tests/test_chat.py` — define the backend SSE contract and xAI-only model/tool behavior.
- `src/components/agent-panel/ModelSelector.tsx` — use the xAI fallback and consume the single-provider catalogue.
- `src/stores/panelAgentStore.ts` — store AI SDK-compatible parts and citations on assistant messages.
- `src/components/agent-panel/AgentPanel.tsx` — consume the parser/reducer and render `ChainOfThoughtMessage`.
- `src/components/ai-elements/chain-of-thought.tsx` — exact official 1.9.0 restoration.
- `src/components/ai-elements/chain-of-thought-message.tsx` — only minimal compatibility changes required by the restored official component or new transport parts.

## SSE contract

The backend emits JSON payloads in standard `data: ...\n\n` frames:

```ts
type PanelStreamEvent =
  | { type: 'start'; model_id: string }
  | { type: 'delta'; data: string }
  | { type: 'reasoning'; reasoningText: string }
  | { type: 'tool'; current_tool_use: { id?: string; name?: string; input?: unknown } }
  | { type: 'server_tool'; server_tool_call: unknown }
  | { type: 'panel'; data: AgentPanelPayload }
  | { type: 'result' }
  | { type: 'error'; error: string }
```

`[DONE]` remains the final non-JSON sentinel. Empty deltas are preserved by explicit key checks.

---

### Task 1: Lock the backend stream contract with failing tests

**Files:**
- Modify: `agent/tests/test_chat.py:37-93`
- Test: `agent/tests/test_chat.py`

- [ ] **Step 1: Upgrade the fake stream to accept structured output and emit every documented event**

Replace `FakeAgent.stream_async` with a fake that accepts `structured_output_model` and yields representative events:

```python
class FakeStructuredOutput:
    def model_dump(self):
        return {
            "answer": "hello",
            "reasoning": "",
            "steps": [],
            "results": [],
            "images": [],
            "citations": [],
        }


class FakeResult:
    structured_output = FakeStructuredOutput()


class FakeAgent:
    def __init__(self):
        self.state = FakeState()
        self.stream_kwargs = None

    async def stream_async(
        self,
        message,
        invocation_state=None,
        limits=None,
        structured_output_model=None,
    ):
        self.stream_kwargs = {
            "message": message,
            "invocation_state": invocation_state,
            "limits": limits,
            "structured_output_model": structured_output_model,
        }
        yield {"data": "hello"}
        yield {"reasoningText": "checking sources"}
        yield {
            "type": "tool_use_stream",
            "current_tool_use": {"id": "tool-1", "name": "sandbox_list_dir", "input": {}},
        }
        yield {
            "event": {
                "metadata": {
                    "serverToolCalls": [{"id": "server-1", "name": "web_search"}]
                }
            }
        }
        yield {"structured_output": FakeStructuredOutput()}
        yield {"result": FakeResult()}
```

- [ ] **Step 2: Replace the obsolete `data` assertion with explicit transport assertions**

Parse all JSON frames except `[DONE]`, then assert:

```python
events = [
    json.loads(line[6:])
    for line in res.iter_lines()
    if line.startswith("data: ") and line != "data: [DONE]"
]

assert {event["type"] for event in events} >= {
    "start", "delta", "reasoning", "tool", "server_tool", "panel", "result"
}
assert next(event for event in events if event["type"] == "delta")["data"] == "hello"
assert next(event for event in events if event["type"] == "reasoning")["reasoningText"] == "checking sources"
assert next(event for event in events if event["type"] == "tool")["current_tool_use"]["name"] == "sandbox_list_dir"
assert next(event for event in events if event["type"] == "panel")["data"]["answer"] == "hello"
assert sum(event["type"] == "panel" for event in events) == 1
```

- [ ] **Step 3: Assert the structured-output model reaches Strands**

Add to `test_chat_stream_passes_limits_and_invocation_state`:

```python
assert fake_agent.stream_kwargs["structured_output_model"] is chat_endpoint.AgentPanelResponse
```

- [ ] **Step 4: Run the focused tests and confirm they fail for the current key mismatch and missing event forwarding**

Run:

```bash
./venv/bin/pytest agent/tests/test_chat.py::test_chat_stream agent/tests/test_chat.py::test_chat_stream_passes_limits_and_invocation_state -v
```

Expected: FAIL because the current backend emits answer deltas as `text`, does not forward tool/server-tool events, and does not emit the specified terminal event contract.

---

### Task 2: Make model construction xAI-only and register all required server tools

**Files:**
- Modify: `agent/api/core/config.py:17-58`
- Modify: `agent/api/endpoints/chat.py:25-88,168-259,637-673`
- Modify: `agent/tests/test_chat.py:95-132,235-249`

- [ ] **Step 1: Write failing xAI-only tests**

Add assertions that `/models` returns only the configured xAI model, unsupported requested models return 503, and all four provider tools are configured:

```python
def test_models_endpoint_reports_only_xai_model():
    res = client.get("/models")
    assert res.status_code == 200
    assert res.json() == {
        "data": [{"id": chat_endpoint.XAI_MODEL, "owned_by": "xai"}],
        "default_model": chat_endpoint.XAI_MODEL,
    }


def test_build_model_rejects_non_xai_selection():
    with pytest.raises(RuntimeError, match="Unsupported model"):
        chat_endpoint._build_model("anthropic/claude-opus-4-8")


def test_xai_native_tools_are_registered_server_side():
    model = chat_endpoint._build_model()
    native = model.config["xai_tools"]
    assert len(native) == 4
    agent = chat_endpoint._create_agent("native", "default", None)
    for name in ("web_search", "x_search", "code_execution", "collections_search"):
        assert name not in agent.tool_names
```

- [ ] **Step 2: Run the xAI-only tests and verify failure**

Run:

```bash
./venv/bin/pytest agent/tests/test_chat.py -k "models_endpoint or non_xai or native_tools" -v
```

Expected: FAIL because Perplexity routing/catalogue remains and `collections_search` is conditional.

- [ ] **Step 3: Remove Perplexity configuration and provider code**

Delete Perplexity constants/imports, `_build_perplexity_model`, `httpx`, and `OpenAIResponsesModel`. Narrow `_build_model` to `xAIModel` and reject a nonempty model ID different from `XAI_MODEL`:

```python
def _build_model(model_id: str | None = None) -> xAIModel:
    selected = (model_id or "").strip() or XAI_MODEL
    if selected != XAI_MODEL:
        raise RuntimeError(f"Unsupported model: {selected}. Ron supports xAI only.")
    if not XAI_API_KEY:
        raise RuntimeError("XAI_API_KEY is not configured in the environment.")
    # Existing xAI configuration and validation remain unchanged.
```

- [ ] **Step 4: Register `collections_search` unconditionally**

Build the fourth tool with configured IDs when present and provider defaults otherwise:

```python
collection_tool = (
    collections_search(collection_ids=XAI_COLLECTION_IDS)
    if XAI_COLLECTION_IDS
    else collections_search()
)
return [
    web_search(enable_image_understanding=True, enable_image_search=True),
    x_search(enable_image_understanding=True, enable_video_understanding=True),
    code_execution(),
    collection_tool,
]
```

- [ ] **Step 5: Return a static xAI model catalogue**

Replace `get_models` with:

```python
@router.get("/models")
async def get_models():
    return {
        "data": [{"id": XAI_MODEL, "owned_by": "xai"}],
        "default_model": XAI_MODEL,
    }
```

- [ ] **Step 6: Run the xAI-only tests**

Run the command from Step 2.

Expected: PASS. Stop and report if `collections_search()` requires a collection ID in the installed xAI SDK; do not invent a fallback implementation.

---

### Task 3: Serialize documented Strands events without leaking private reasoning state

**Files:**
- Modify: `agent/api/endpoints/chat.py:575-634`
- Test: `agent/tests/test_chat.py`

- [ ] **Step 1: Add small boundary helpers**

Introduce helpers that dump Pydantic structured output and safely inspect provider metadata:

```python
def _model_dump(value: Any) -> dict[str, Any] | None:
    if isinstance(value, BaseModel):
        return value.model_dump()
    return value if isinstance(value, dict) else None


def _server_tool_calls(event: dict[str, Any]) -> list[Any]:
    raw = event.get("event")
    if not isinstance(raw, dict):
        return []
    metadata = raw.get("metadata")
    if not isinstance(metadata, dict):
        return []
    calls = metadata.get("serverToolCalls")
    return calls if isinstance(calls, list) else []
```

- [ ] **Step 2: Replace the `elif` chain with independent documented-key checks**

Use independent checks because one normalized event may carry more than one relevant field:

```python
panel_emitted = False
async for event in agent.stream_async(...):
    if "data" in event:
        yield _sse({"type": "delta", "data": event["data"]})
    if "reasoningText" in event:
        yield _sse({"type": "reasoning", "reasoningText": event["reasoningText"]})
    if "current_tool_use" in event:
        yield _sse({"type": "tool", "current_tool_use": event["current_tool_use"]})
    for server_call in _server_tool_calls(event):
        yield _sse({"type": "server_tool", "server_tool_call": server_call})
    if "structured_output" in event and not panel_emitted:
        payload = _model_dump(event["structured_output"])
        if payload is not None:
            panel_emitted = True
            yield _sse({"type": "panel", "data": payload})
    if "result" in event:
        if not panel_emitted:
            payload = _model_dump(getattr(event["result"], "structured_output", None))
            if payload is not None:
                panel_emitted = True
                yield _sse({"type": "panel", "data": payload})
        yield _sse({"type": "result"})
```

Do not serialize `reasoningRedactedContent`, `reasoning_signature`, or raw encrypted content.

- [ ] **Step 3: Run the focused backend stream tests**

Run the Task 1 command.

Expected: PASS.

---

### Task 4: Restore the official AI Elements chain-of-thought component

**Files:**
- Modify: `src/components/ai-elements/chain-of-thought.tsx:1-227`
- Reference: `.tmp/external-context/ai-elements/chain-of-thought-1.9.0.md`
- Reference: `src/components/ai-elements/theapp/components/ai-elements/chain-of-thought.tsx`

- [ ] **Step 1: Replace the component with the official source contract**

Use the nested reference as the restoration source. In particular, `ChainOfThoughtProps` must be exactly:

```tsx
export type ChainOfThoughtProps = ComponentProps<'div'> & {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}
```

Remove `isStreaming` and `autoCollapseDelay`. Preserve all official exports, context behavior, status types, animation classes, and display names.

- [ ] **Step 2: Verify no nonofficial behavior remains**

Confirm the root file differs from the nested official reference only in formatting or explicitly additive app styling. Do not modify the nested reference.

- [ ] **Step 3: Typecheck the restoration**

Run:

```bash
npm run typecheck
```

Expected: PASS. On failure, stop and report before making compatibility edits.

---

### Task 5: Add a robust frontend SSE parser and immutable message reducer

**Files:**
- Create: `src/components/agent-panel/agent-stream.ts`
- Modify: `src/stores/panelAgentStore.ts:1-10`

- [ ] **Step 1: Define transport and message-part types**

In `agent-stream.ts`, define the `PanelStreamEvent` union from the SSE contract and export:

```ts
export type AssistantMessageState = {
  text: string
  parts: UIMessage['parts']
  citations: Citation[]
}

export function parseSseChunk(buffer: string, chunk: string): {
  events: PanelStreamEvent[]
  buffer: string
  done: boolean
}

export function reducePanelEvent(
  state: AssistantMessageState,
  event: PanelStreamEvent,
): AssistantMessageState
```

- [ ] **Step 2: Parse complete SSE frames rather than individual lines**

`parseSseChunk` must:

1. Append the decoder output to the existing buffer.
2. Normalize CRLF to LF.
3. Split only on blank-line frame boundaries (`\n\n`).
4. Join multiple `data:` lines per SSE rules.
5. Recognize `[DONE]` without calling `JSON.parse`.
6. Return incomplete trailing bytes as `buffer`.
7. Ignore comments and unsupported fields.
8. Throw a descriptive error for malformed JSON transport frames.

- [ ] **Step 3: Reduce transport events into AI SDK-compatible parts**

Apply these mappings immutably:

```text
delta        -> append to one text part and state.text
reasoning    -> append to one reasoning part
tool         -> upsert dynamic tool part by tool id/name with input-streaming state
server_tool  -> append/upsert a dynamic tool part marked output-available
panel        -> add data-agent-panel, replace visible answer with payload.answer,
                and set payload.citations
result/start -> no visible part
error        -> throw Error(event.error)
```

When a `delta.data` exactly matches the documented xAI tool marker, create a server-tool part instead of appending that marker to the visible answer. Do not interpret arbitrary bracketed answer text.

- [ ] **Step 4: Extend `ChatMessage`**

Use AI SDK parts and citation types:

```ts
import type { UIMessage } from 'ai'
import type { Citation } from '@/components/ai-elements/response-with-citations'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  parts?: UIMessage['parts']
  citations?: Citation[]
}
```

- [ ] **Step 5: Run typecheck**

Run `npm run typecheck`.

Expected: PASS for the isolated parser/store types. Stop on failure.

---

### Task 6: Wire the agent panel to structured parts and AI Elements rendering

**Files:**
- Modify: `src/components/agent-panel/AgentPanel.tsx:1-183,385-390,473-493`
- Modify: `src/components/agent-panel/ModelSelector.tsx:10`
- Modify: `src/components/ai-elements/chain-of-thought-message.tsx` only if typecheck identifies a documented compatibility issue

- [ ] **Step 1: Use the backend-provided xAI fallback**

Change the frontend fallback constant to the configured xAI default:

```ts
export const DEFAULT_AGENT_MODEL = 'grok-4.5'
```

- [ ] **Step 2: Initialize assistant messages with parts**

Create the assistant placeholder as:

```ts
{
  id: assistantId,
  role: 'assistant',
  text: '',
  parts: [],
  citations: [],
}
```

- [ ] **Step 3: Replace line parsing with `parseSseChunk`**

Feed every decoded chunk into the parser, process all returned events in order, retain the returned partial buffer, and process `decoder.decode()` at EOF. For each event, call `reducePanelEvent` inside the existing immutable `setMessages` update.

- [ ] **Step 4: Make completion and errors explicit**

Set status to `idle` only after `[DONE]` or clean stream completion. On an error event or parser exception, preserve already-streamed content, append/display the error only when no answer exists, and set status to `error`.

- [ ] **Step 5: Render assistant messages with `ChainOfThoughtMessage`**

Replace the assistant paragraph with:

```tsx
<ChainOfThoughtMessage
  parts={message.parts ?? [{ type: 'text', text: message.text }]}
  citations={message.citations}
  isStreaming={isStreaming}
  messageId={message.id}
/>
```

Pass streaming state only for the current assistant message. Keep the existing user bubble unchanged.

- [ ] **Step 6: Run typecheck**

Run `npm run typecheck`.

Expected: PASS. Do not alter the restored `ChainOfThought` API to solve consumer errors; update only call sites.

---

### Task 7: Complete backend and build validation

**Files:**
- Test: `agent/tests/test_chat.py`
- Validate: all modified frontend files

- [ ] **Step 1: Run the complete backend endpoint test file**

Run:

```bash
./venv/bin/pytest agent/tests/test_chat.py -v
```

Expected: all tests PASS. Because existing tests contain stale MCP-prefix and environment assumptions, any unrelated failure must be reported rather than automatically rewritten.

- [ ] **Step 2: Run TypeScript validation**

Run:

```bash
npm run typecheck
```

Expected: PASS with no diagnostics.

- [ ] **Step 3: Run the production build**

Run:

```bash
npm run build
```

Expected: Electron Vite build exits successfully.

- [ ] **Step 4: Inspect the final diff**

Verify:

- No Perplexity imports, constants, routes, or fallback model IDs remain in the changed agent-panel path.
- No hidden/redacted reasoning fields are serialized or rendered.
- The four xAI server-side tools are configured only in `xai_tools`.
- Text uses `data` consistently end-to-end.
- `reasoningText`, `current_tool_use`, provider server-tool activity, structured output, result, errors, and `[DONE]` are handled.
- `chain-of-thought.tsx` retains the official 1.9.0 API and animations.

- [ ] **Step 5: Optional runtime smoke test (requires explicit approval because it starts processes and may call xAI)**

After requesting approval, run the backend and Electron app, send one prompt that requires web search and one simple prompt, then verify:

1. Answer deltas appear without waiting for completion.
2. `reasoningText` appears only inside the expandable chain.
3. `web_search` activity appears as a tool step rather than answer text.
4. Structured steps/citations replace or finalize the streamed answer without duplication.
5. The chain opens/closes with official behavior.
6. A second turn preserves the Strands session.

---

## Self-review

- **Spec coverage:** xAI-only routing, all required provider tools, documented Strands events, reasoning privacy, structured output, official AI Elements restoration, SSE fragmentation, errors, and validation each map to explicit tasks.
- **Placeholder scan:** No implementation steps use TBD/TODO placeholders. Backend helpers and test assertions are concrete; frontend parser behavior and reducer mappings are fully enumerated.
- **Type consistency:** Backend payload keys (`data`, `reasoningText`, `current_tool_use`, `server_tool_call`, `data` for panel payload) match the `PanelStreamEvent` contract consumed by the frontend.
