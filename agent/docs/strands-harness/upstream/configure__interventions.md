An intervention decides whether a tool call runs. By default Strands harness applies none, so every call proceeds. Pass `interventions` to gate calls behind human approval or a policy. The option is sugar over the Strands Harness SDK’s intervention handlers: a preset, a policy string, a Cedar file, a Strands Harness SDK handler instance, or a list of these.

## Approve every call, or only risky ones

The two presets cover the common cases:

-   `"ask"` gates every tool call for approval.
-   `"smart"` uses the Strands Harness SDK’s risk classifier to flag risky calls and gates only those.

(( tab "Strands harness" ))
(( tab "Python" ))
```python
# pip install strands-harness
from strands_harness import create_harness

agent = create_harness(interventions="ask")  # approve every tool call
```
(( /tab "Python" ))

(( tab "TypeScript" ))
```typescript
// npm install @strands-agents/harness
import { createHarness } from '@strands-agents/harness'

const agent = await createHarness({ interventions: 'ask' })
```
(( /tab "TypeScript" ))
(( /tab "Strands harness" ))

(( tab "SDK" ))
(( tab "Python" ))
```python
# pip install strands-agents
from strands import Agent
from strands.vended_tools import shell
from strands.vended_interventions.hitl import HumanInTheLoop

# HumanInTheLoop gates every tool call for approval.
agent = Agent(tools=[shell], interventions=[HumanInTheLoop()])
result = agent("Delete the temp files")
if result.stop_reason == "interrupt":
    result = agent([{"interruptResponse":
        {"interruptId": result.interrupts[0].id, "response": "yes"}}])
```
(( /tab "Python" ))

(( tab "TypeScript" ))
```typescript
// npm install @strands-agents/sdk
import { Agent } from '@strands-agents/sdk'
import { bash } from '@strands-agents/sdk/vended-tools/bash'
import { HumanInTheLoop } from '@strands-agents/sdk/vended-interventions/hitl'

// HumanInTheLoop gates every tool call for approval.
const agent = new Agent({ tools: [bash], interventions: [new HumanInTheLoop()] })
const result = await agent.invoke('Delete the temp files')
// result.stopReason === 'interrupt': present the prompt, then resume
```
(( /tab "TypeScript" ))
(( /tab "SDK" ))

## Gate against a natural-language rule

Any string that is not a preset and does not end in `.cedar` is treated as a natural-language risk policy. It becomes the risk classifier’s prompt, so the model judges each call against your rule and escalates a match for approval, like `"smart"` with your own rubric:

(( tab "Strands harness" ))
(( tab "Python" ))
```python
# pip install strands-harness
from strands_harness import create_harness

agent = create_harness(
    interventions="Ask before deleting files or making any network request.",
)
```
(( /tab "Python" ))

(( tab "TypeScript" ))
```typescript
// npm install @strands-agents/harness
import { createHarness } from '@strands-agents/harness'

const agent = await createHarness({
  interventions: 'Ask before deleting files or making any network request.',
})
```
(( /tab "TypeScript" ))
(( /tab "Strands harness" ))

(( tab "SDK" ))
(( tab "Python" ))
```python
# pip install strands-agents
from strands import Agent
from strands.vended_tools import shell
from strands.vended_interventions.hitl import HumanInTheLoop

# The Strands Harness SDK has no natural-language risk policy (a Strands harness convenience).
# Gate tool calls with a HumanInTheLoop handler instead.
agent = Agent(tools=[shell], interventions=[HumanInTheLoop()])
```
(( /tab "Python" ))

(( tab "TypeScript" ))
```typescript
// npm install @strands-agents/sdk
import { Agent } from '@strands-agents/sdk'
import { bash } from '@strands-agents/sdk/vended-tools/bash'
import { HumanInTheLoop } from '@strands-agents/sdk/vended-interventions/hitl'

// The Strands Harness SDK has no natural-language risk policy (a Strands harness convenience).
// Gate tool calls with a HumanInTheLoop handler instead.
const agent = new Agent({ tools: [bash], interventions: [new HumanInTheLoop()] })
```
(( /tab "TypeScript" ))
(( /tab "SDK" ))

## Enforce a Cedar policy

A string ending in `.cedar` loads a [Cedar](/docs/user-guide/sdk/agents/interventions/cedar-authorization/index.md) policy file for programmatic authorization. Cedar needs an optional dependency: `strands-agents[cedar]` in Python, or the `@cedar-policy/cedar-wasm` package in TypeScript.

(( tab "Python" ))
```python
from strands_harness import create_harness

agent = create_harness(interventions="./policies/agent.cedar")
```
(( /tab "Python" ))

(( tab "TypeScript" ))
```typescript
import { createHarness } from '@strands-agents/harness'

const agent = await createHarness({ interventions: './policies/agent.cedar' })
```
(( /tab "TypeScript" ))

Inline Cedar text is not auto-detected (it is indistinguishable from prose), so pass a `CedarAuthorization` instance directly for that.

## Pass a Strands Harness SDK handler, or layer several

For anything the presets do not cover (a custom approval callback, a Cedar principal resolver, bespoke trust rules), construct the Strands Harness SDK handler yourself and pass it; a handler instance passes through untouched. You can also pass a list to layer a Cedar policy with one human-approval gate. Two handlers of the same kind collide, since an agent registers at most one per name, so layer different kinds rather than duplicates.

## The generalist inherits the policy

The built-in `generalist` [subagent](/docs/user-guide/harness/configure/subagents/index.md) inherits whatever `interventions` you set, so a subagent cannot bypass the gate you put on the main agent. For the underlying handlers, see the Strands Harness SDK’s [interventions](/docs/user-guide/sdk/agents/interventions/index.md) documentation. For the full option list, see the [configuration reference](/docs/user-guide/harness/reference/configuration/index.md).

## Implementation

### Python

- [harness-sdk/harness-py/src/strands_harness/interventions.py](https://github.com/strands-agents/harness-sdk/blob/main/harness-py/src/strands_harness/interventions.py)
- [harness-sdk/harness-py/src/strands_harness/agent.py](https://github.com/strands-agents/harness-sdk/blob/main/harness-py/src/strands_harness/agent.py)

### TypeScript

- [harness-sdk/harness-ts/src/interventions.ts](https://github.com/strands-agents/harness-sdk/blob/main/harness-ts/src/interventions.ts)
