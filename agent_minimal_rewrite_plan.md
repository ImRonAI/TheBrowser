# Minimal Panel Agent Rewrite Plan

## Goal

Replace the over-engineered `agent/` backend and the custom SSE frontend with a **single text sidebar Panel Agent** that:

- Uses the Strands SDK directly (`Agent`, `stream_async`, built-in session/conversation managers).
- Streams raw SDK events over SSE/NDJSON to the frontend.
- Has a small, curated tool set.
- Requires only one model API key to start.

## Files to delete

### Backend (`agent/`)

Delete these files/directories entirely. They are dead code, duplicate implementations, or non-SDK scaffolding:

- `agent/api/core/superagent.py`
- `agent/api/core/agent_factory.py`
- `agent/api/core/streaming.py`
- `agent/api/core/context_builder.py`
- `agent/api/core/hooks.py`
- `agent/api/core/tools/panel_tools.py`
- `agent/api/core/prompts/agent_panel.py`
- `agent/api/endpoints/agents.py`
- `agent/api/endpoints/tools.py`
- `agent/api/endpoints/mcp_servers.py`
- `agent/api/endpoints/openapi_specs.py`
- `agent/api/endpoints/projects.py`
- `agent/api/endpoints/browser_sessions.py`
- `agent/api/endpoints/chat_sessions.py`
- `agent/api/schemas.py`
- `agent/superagent_with_rollover.py`
- `agent/lancedb_session_repository.py`
- `agent/aisdk_stream.py`
- `agent/docker/`

Keep:

- `agent/api/main.py` — simplify
- `agent/api/core/config.py` — strip secrets and unused values
- `agent/api/endpoints/__init__.py`
- `agent/api/core/__init__.py`
- `agent/tests/test_sandbox.py` — expand with agent loop tests

### Frontend (`src/`)

Delete or stop importing from the Panel Agent only. These files are still used by other routes (SuperAgent, Search, RonTab), so if those routes are also being removed they can be deleted globally; otherwise leave them and remove only the Panel Agent imports.

- `src/utils/orchestration-stream.ts` — remove from `AgentPanel.tsx`
- `src/components/ai-elements/chain-of-thought-message.tsx` — remove from `AgentPanel.tsx`
- `src/components/agent-panel/AgentPanel.tsx` — replace with the simplified version below
- `src/stores/panelAgentStore.ts` — replace `UIMessage` with a plain message type

## Files to create / modify

### 1. `agent/api/core/config.py`

Strip everything except host/port/CORS, storage dir, model keys, and optional feature flags. Remove all hardcoded AWS keys, Bedrock IDs, and imaginary model defaults.

```python
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",")
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8765"))

SESSION_STORAGE_DIR = Path(os.getenv("SESSION_STORAGE_DIR", ".sessions"))

# Model keys (one required)
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
NVIDIA_NIM_API_KEY = os.getenv("NVIDIA_NIM_API_KEY")

# Model overrides
OPENAI_PANEL_MODEL = os.getenv("OPENAI_PANEL_MODEL", "gpt-4o")
GOOGLE_PANEL_MODEL = os.getenv("GOOGLE_PANEL_MODEL", "gemini-2.0-flash")
NVIDIA_NIM_MODEL_ID = os.getenv("NVIDIA_NIM_MODEL_ID", "nvidia_nim/moonshotai/kimi-k2.5")

# Optional AWS credentials for the Bedrock-backed code interpreter
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")

# Browser / sandbox
BROWSER_CDP_PORT = int(os.getenv("BROWSER_CDP_PORT", "9222"))
BROWSER_HEADLESS = os.getenv("BROWSER_HEADLESS", "false").lower() in {"1", "true", "yes"}
AGENT_SANDBOX_ROOT = Path(os.getenv("RON_AGENT_SANDBOX_ROOT", str(Path.home() / ".ronbrowser" / "sandbox")))
AGENT_SANDBOX_ROOT.mkdir(parents=True, exist_ok=True)
```

### 2. `agent/api/endpoints/chat.py` (new)

Single endpoint, one cached `Agent` per `(session_id, user_id)`, raw SDK event streaming.

```python
import os
import json
import logging
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from strands import Agent
from strands.session import FileSessionManager
from strands.agent.conversation_manager import SlidingWindowConversationManager
from strands.models.openai_responses import OpenAIResponsesModel
from strands.models.gemini import GeminiModel
from strands.models.litellm import LiteLLMModel

import strands_tools.http_request
import strands_tools.file_read
import strands_tools.file_write
import strands_tools.python_repl
import strands_tools.shell
import strands_tools.think
import strands_tools.load_tool
import strands_tools.current_time

from agent.api.core.config import (
    OPENAI_API_KEY,
    OPENAI_PANEL_MODEL,
    GOOGLE_API_KEY,
    GOOGLE_PANEL_MODEL,
    NVIDIA_NIM_API_KEY,
    NVIDIA_NIM_MODEL_ID,
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
    SESSION_STORAGE_DIR,
)

logger = logging.getLogger(__name__)
router = APIRouter()

PANEL_SYSTEM_PROMPT = """You are Ron, a helpful browser sidebar assistant.
You can read and write files, run shell commands and Python, make HTTP requests, control the browser, and think step-by-step.
Be concise. When you use a tool, explain briefly what you are doing."""


def _build_model():
    if OPENAI_API_KEY:
        return OpenAIResponsesModel(
            client_args={"api_key": OPENAI_API_KEY},
            model_id=OPENAI_PANEL_MODEL,
        )
    if GOOGLE_API_KEY:
        return GeminiModel(
            client_args={"api_key": GOOGLE_API_KEY},
            model_id=GOOGLE_PANEL_MODEL,
        )
    if NVIDIA_NIM_API_KEY:
        return LiteLLMModel(
            client_args={"api_key": NVIDIA_NIM_API_KEY},
            model_id=NVIDIA_NIM_MODEL_ID,
        )
    raise RuntimeError(
        "No model API key configured. Set OPENAI_API_KEY, GOOGLE_API_KEY, or NVIDIA_NIM_API_KEY."
    )


def _build_tools() -> list[Any]:
    tools: list[Any] = [
        strands_tools.http_request,
        strands_tools.file_read,
        strands_tools.file_write,
        strands_tools.python_repl,
        strands_tools.shell,
        strands_tools.think,
        strands_tools.load_tool,
        strands_tools.current_time,
    ]

    try:
        from strands_tools.browser.local_chromium_browser import LocalChromiumBrowser
        tools.append(LocalChromiumBrowser().browser)
    except Exception as exc:
        logger.warning("Browser tool unavailable: %s", exc)

    if AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY:
        try:
            from strands_tools.code_interpreter import AgentCoreCodeInterpreter
            tools.append(AgentCoreCodeInterpreter)
        except Exception as exc:
            logger.warning("Code interpreter unavailable: %s", exc)

    return tools


_agents: dict[tuple[str, str], Agent] = {}


def _get_agent(session_id: str, user_id: str) -> Agent:
    key = (session_id, user_id)
    if key not in _agents:
        _agents[key] = Agent(
            model=_build_model(),
            system_prompt=PANEL_SYSTEM_PROMPT,
            tools=_build_tools(),
            session_manager=FileSessionManager(
                session_id=session_id,
                storage_dir=str(SESSION_STORAGE_DIR.resolve()),
            ),
            conversation_manager=SlidingWindowConversationManager(window_size=40),
        )
    return _agents[key]


class ChatRequest(BaseModel):
    session_id: str
    user_id: str = "default"
    message: str
    browser_context: dict = {}


@router.post("/chat")
async def chat(req: ChatRequest):
    try:
        agent = _get_agent(req.session_id, req.user_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    async def event_stream() -> AsyncIterator[str]:
        invocation_state = {
            "user_id": req.user_id,
            "browser_context": req.browser_context,
        }
        async for event in agent.stream_async(
            req.message,
            invocation_state=invocation_state,
        ):
            yield f"data: {json.dumps(event, default=str, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.delete("/chat/{session_id}")
async def clear_session(session_id: str, user_id: str = "default"):
    _agents.pop((session_id, user_id), None)
    return {"ok": True}
```

### 3. `agent/api/main.py`

Simplify to the chat endpoint, health, and config.

```python
import os
import sys
from pathlib import Path
from contextlib import asynccontextmanager

_project_root = str(Path(__file__).resolve().parent.parent.parent)
if _project_root not in sys.path:
    sys.path.append(_project_root)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from agent.api.core.config import CORS_ORIGINS, SESSION_STORAGE_DIR
from agent.api.endpoints import chat


@asynccontextmanager
async def lifespan(app: FastAPI):
    import logging
    logging.basicConfig(level=logging.INFO)
    SESSION_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="Ron Browser API", version="4.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router, tags=["chat"])


@app.get("/health")
async def health_check():
    from datetime import datetime, timezone
    return {"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.get("/config")
async def get_config():
    from agent.api.core.config import (
        OPENAI_API_KEY, GOOGLE_API_KEY, NVIDIA_NIM_API_KEY,
    )
    return {
        "features": {
            "chat": bool(OPENAI_API_KEY or GOOGLE_API_KEY or NVIDIA_NIM_API_KEY),
        }
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)
```

### 4. `src/stores/panelAgentStore.ts`

Drop the `UIMessage` dependency and use a plain message type.

```typescript
import { create } from 'zustand'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
}

export type PanelMode = 'narrow' | 'wide' | 'fullscreen'

interface PanelAgentState {
  panelMode: PanelMode
  panelWidth: number
  setPanelMode: (mode: PanelMode) => void
  setPanelWidth: (width: number) => void
}

export const usePanelAgentStore = create<PanelAgentState>((set) => ({
  panelMode: 'narrow',
  panelWidth: 420,
  setPanelMode: (panelMode) => set({ panelMode }),
  setPanelWidth: (panelWidth) => set({ panelWidth }),
}))
```

### 5. `src/components/agent-panel/AgentPanel.tsx` (simplified sketch)

Replace `useChat` / `DefaultChatTransport` with a small `usePanelChat` hook and render plain text bubbles.

```typescript
import { useState, useRef, useEffect, useCallback, Fragment } from 'react'
import { Transition } from '@headlessui/react'
import { XMarkIcon, PlusIcon } from '@heroicons/react/24/outline'
import { useAgentUi } from '@/context/AgentUiContext'
import { subscribeAgentPanelMessages } from '@/services/agentChatBridge'
import { cn } from '@/utils/cn'
import { usePanelAgentStore, type ChatMessage } from '@/stores/panelAgentStore'
import { useAuthStore } from '@/stores/authStore'

const API_URL = 'http://localhost:8765/chat'

type Status = 'ready' | 'streaming' | 'error'

function usePanelChat(sessionId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<Status>('ready')

  const sendMessage = useCallback(
    async (text: string, browserContext: Record<string, unknown>) => {
      if (!text.trim() || status === 'streaming') return

      const userId = useAuthStore.getState().user?.id || 'default'
      const assistantId = `${Date.now()}-a`

      setMessages((prev) => [
        ...prev,
        { id: `${Date.now()}-u`, role: 'user', text },
        { id: assistantId, role: 'assistant', text: '' },
      ])
      setStatus('streaming')

      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            user_id: userId,
            message: text,
            browser_context: browserContext,
          }),
        })
        if (!res.ok) throw new Error(await res.text())

        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let assistantText = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (!data) continue
            const event = JSON.parse(data)
            if (event.event === 'data' && typeof event.data === 'string') {
              assistantText += event.data
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, text: assistantText } : m
                )
              )
            }
          }
        }
        setStatus('ready')
      } catch (err) {
        setStatus('error')
        console.error('[PanelAgent] stream error:', err)
      }
    },
    [sessionId, status]
  )

  return { messages, status, sendMessage, setMessages }
}

export function AgentPanel() {
  const { isPanelOpen, closePanel } = useAgentUi()
  const { panelWidth } = usePanelAgentStore()
  const sessionIdRef = useRef(
    `agent-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  )
  const { messages, status, sendMessage, setMessages } = usePanelChat(
    sessionIdRef.current
  )
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = useCallback(async () => {
    const text = input.trim()
    if (!text || status === 'streaming') return
    setInput('')

    let browserContext: Record<string, unknown> = {}
    try {
      browserContext =
        (await window.electron?.browser?.getPanelContext?.()) ?? {}
    } catch (err) {
      console.error('Failed to fetch browser context:', err)
    }

    sendMessage(text, browserContext)
  }, [input, status, sendMessage])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleNewChat = () => {
    sessionIdRef.current = `agent-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 9)}`
    setMessages([])
  }

  return (
    <Transition.Root show={isPanelOpen} as={Fragment}>
      <div className="absolute inset-0 z-50 flex pointer-events-none">
        <Transition.Child
          as={Fragment}
          enter="transform transition ease-smooth duration-400"
          enterFrom="translate-x-full"
          enterTo="translate-x-0"
          leave="transform transition ease-smooth duration-400"
          leaveFrom="translate-x-0"
          leaveTo="translate-x-full"
        >
          <div
            className="relative ml-auto h-full pointer-events-auto"
            style={{ width: panelWidth }}
          >
            <div className="h-full flex flex-col bg-white dark:bg-surface-900 border-l border-surface-200 dark:border-surface-700">
              <div className="flex-shrink-0 px-5 py-4 flex items-center justify-between border-b">
                <h2 className="text-lg font-semibold">Ron</h2>
                <div className="flex items-center gap-2">
                  <button onClick={handleNewChat} title="New Chat">
                    <PlusIcon className="w-5 h-5" />
                  </button>
                  <button onClick={closePanel}>
                    <XMarkIcon className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={cn(
                      'max-w-[85%] rounded-2xl px-4 py-3 whitespace-pre-wrap',
                      msg.role === 'user'
                        ? 'ml-auto bg-indigo-600 text-white rounded-br-md'
                        : 'mr-auto bg-surface-100 dark:bg-surface-800 rounded-bl-md'
                    )}
                  >
                    {msg.text}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              <div className="flex-shrink-0 p-4 border-t">
                <div className="flex items-center gap-2">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask anything..."
                    rows={1}
                    className="flex-1 resize-none bg-transparent outline-none"
                  />
                  <button
                    onClick={handleSubmit}
                    disabled={!input.trim() || status === 'streaming'}
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Transition.Child>
      </div>
    </Transition.Root>
  )
}
```

## Tests

Expand `agent/tests/test_sandbox.py` or add `agent/tests/test_chat.py`:

```python
import pytest
from fastapi.testclient import TestClient
from agent.api.main import app

client = TestClient(app)


def test_health():
    res = client.get("/health")
    assert res.status_code == 200


@pytest.mark.skipif(not os.getenv("OPENAI_API_KEY"), reason="No model key")
def test_chat_stream():
    res = client.post(
        "/chat",
        json={"session_id": "test-sid", "user_id": "test-user", "message": "say hi"},
    )
    assert res.status_code == 200
    chunks = []
    for line in res.iter_lines():
        if line.startswith("data: "):
            chunks.append(json.loads(line[6:]))
    assert any(c.get("event") == "data" for c in chunks)
```

## Verification checklist

- [ ] `npm run typecheck` passes with no errors.
- [ ] `pytest agent/` passes, including new chat stream tests.
- [ ] `npm run dev:backend` starts without import errors when `OPENAI_API_KEY` is set.
- [ ] `curl` test returns streamed text events:
  ```bash
  curl -N -X POST http://localhost:8765/chat \
    -H "Content-Type: application/json" \
    -d '{"session_id":"s1","user_id":"u1","message":"hello"}'
  ```
- [ ] The frontend `AgentPanel` connects to `/chat`, sends a message, and displays the streamed response as plain text.
- [ ] `agent/api/core/config.py` contains no hardcoded secrets or default credentials.

## Environment

Required in `.env`:

```env
OPENAI_API_KEY=...
# or
GOOGLE_API_KEY=...
# or
NVIDIA_NIM_API_KEY=...
```

Optional:

```env
OPENAI_PANEL_MODEL=gpt-4o
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
```
