Strands harness’s built-in contract already handles how the agent behaves; your `instructions` tell it who it is and what it is for, and your `tools` give it the capabilities your application needs. Both add to the built-ins rather than replacing them.

## Add instructions

You tell the agent who it is with `instructions`, a domain block appended after the built-in contract: the agent’s identity, scope, and any rules you want it to follow. The harness’s contract handles the general “how to act like an agent” behavior, so keep `instructions` to what is specific to your use case.

(( tab "Strands harness" ))
(( tab "Python" ))
```python
from strands_harness import create_harness

agent = create_harness(
    instructions="You are a support assistant. Always link the ticket you acted on.",
)
```
(( /tab "Python" ))

(( tab "TypeScript" ))
```typescript
import { createHarness } from '@strands-agents/harness'

const agent = await createHarness({
  instructions: 'You are a support assistant. Always link the ticket you acted on.',
})
```
(( /tab "TypeScript" ))
(( /tab "Strands harness" ))

(( tab "SDK" ))
(( tab "Python" ))
```python
# pip install strands-agents
from strands import Agent

agent = Agent(
    system_prompt="You are a support assistant. Always link the ticket.",
)
```
(( /tab "Python" ))

(( tab "TypeScript" ))
```typescript
// npm install @strands-agents/sdk
import { Agent } from '@strands-agents/sdk'

const agent = new Agent({
  systemPrompt: 'You are a support assistant. Always link the ticket.',
})
```
(( /tab "TypeScript" ))
(( /tab "SDK" ))

If you pass a full `system_prompt` through to the `Agent` instead, `instructions` is ignored: the prompt you supply replaces the contract entirely. To build on the contract programmatically, see [compose with the Strands Harness SDK](/docs/user-guide/harness/composing-with-sdk/index.md).

## Register your own tools

You give the agent your own capabilities by passing `tools`, which sit alongside the built-in ones. Define them the same way you would for any Strands agent:

(( tab "Python" ))
```python
from strands import tool
from strands_harness import create_harness

@tool
def get_ticket(ticket_id: str) -> str:
    """Fetch a support ticket by id."""
    return f"Ticket {ticket_id}: open, assigned to support."

agent = create_harness(
    instructions="You are a support assistant. Always link the ticket.",
    tools=[get_ticket],
)
```
(( /tab "Python" ))

(( tab "TypeScript" ))
```typescript
import { tool } from '@strands-agents/sdk'
import { z } from 'zod'
import { createHarness } from '@strands-agents/harness'

const getTicket = tool({
  name: 'get_ticket',
  description: 'Fetch a support ticket by id.',
  inputSchema: z.object({ ticketId: z.string() }),
  callback: ({ ticketId }) => `Ticket ${ticketId}: open, assigned to support.`,
})

const agent = await createHarness({
  instructions: 'You are a support assistant. Always link the ticket.',
  tools: [getTicket],
})
```
(( /tab "TypeScript" ))

A tool name must be unique across every source (built-in tools, `tools`, and plugin-vended tools). A collision fails at construction and names the two sources, so nothing silently disappears. To reuse a built-in’s name, drop the built-in first.

## Select or disable built-in tools

The built-in tools are `shell`, `read`, `write`, `edit`, `web_fetch`, `web_search`, `programmatic_tool_caller`, and `subagent`, all on by default. Pass `builtin_tools` a subset to narrow the set, or an empty list to turn them all off and bring your own:

(( tab "Strands harness" ))
(( tab "Python" ))
```python
from strands_harness import create_harness

agent = create_harness(builtin_tools=["read", "shell"])  # just these two; [] for none
```
(( /tab "Python" ))

(( tab "TypeScript" ))
```typescript
import { createHarness } from '@strands-agents/harness'

const agent = await createHarness({ builtinTools: ['read', 'shell'] }) // [] for none
```
(( /tab "TypeScript" ))
(( /tab "Strands harness" ))

(( tab "SDK" ))
(( tab "Python" ))
```python
# pip install strands-agents
from strands import Agent
from strands.vended_tools import file_editor, shell

# The Strands Harness SDK has no built-in toggle; pass exactly the tools you want
agent = Agent(tools=[file_editor, shell])
```
(( /tab "Python" ))

(( tab "TypeScript" ))
```typescript
// npm install @strands-agents/sdk
import { Agent } from '@strands-agents/sdk'
import { bash } from '@strands-agents/sdk/vended-tools/bash'
import { fileEditor } from '@strands-agents/sdk/vended-tools/file-editor'

// The Strands Harness SDK has no built-in toggle; pass exactly the tools you want
const agent = new Agent({ tools: [fileEditor, bash] })
```
(( /tab "TypeScript" ))
(( /tab "SDK" ))

An unknown name fails at construction with the list of valid names. For what each tool does, see [shell and file tools](/docs/user-guide/harness/tools/shell-and-files/index.md), [web access](/docs/user-guide/harness/tools/web-access/index.md), and [programmatic tool calling](/docs/user-guide/harness/tools/programmatic-tool-calling/index.md).

## Change the web\_fetch summarizer

`web_fetch` answers over a fetched page using a small, fast summarizer model chosen for your main provider so credentials line up. Override it with `{"web_fetch": {"model": ...}}` in `builtin_tools`, which takes the same forms as `model`. This is covered on the [web access](/docs/user-guide/harness/tools/web-access/index.md) page.

For the full option list, see the [configuration reference](/docs/user-guide/harness/reference/configuration/index.md).

## Implementation

### Python

- [harness-sdk/harness-py/src/strands_harness/agent.py](https://github.com/strands-agents/harness-sdk/blob/main/harness-py/src/strands_harness/agent.py)
- [harness-sdk/harness-py/src/strands_harness/prompt.py](https://github.com/strands-agents/harness-sdk/blob/main/harness-py/src/strands_harness/prompt.py)

### TypeScript

- [harness-sdk/harness-ts/src/agent.ts](https://github.com/strands-agents/harness-sdk/blob/main/harness-ts/src/agent.ts)
