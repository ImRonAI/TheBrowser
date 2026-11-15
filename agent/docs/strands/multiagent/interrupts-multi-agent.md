<!-- Source: https://strandsagents.com/docs/user-guide/sdk/interrupts-multi-agent/index.md -->
Interrupts work across multi-agent orchestration, so you can pause a swarm or graph for human approval or input the same way you pause a single agent. Raise an interrupt from a `BeforeNodeCallEvent` hook that runs before each node, or from within the nodes themselves. Session management works here too, so you can persist an interrupted multi-agent run and resume it later.

The interfaces mirror those used for [single-agent interrupts](/docs/user-guide/sdk/interrupts/index.md). Read that page first if you have not built an interrupt/resume loop before.

## Agents as Tools

An agent used as a tool with [Agents as Tools](/docs/user-guide/sdk/multi-agent/agents-as-tools/index.md) propagates its interrupts to the orchestrator, where they are raised and answered like any other interrupt. The interrupt ids are scoped to the orchestrator’s tool call; treat them as opaque.

## Swarm

A [Swarm](/docs/user-guide/sdk/multi-agent/swarm/index.md) is a collaborative agent orchestration system where multiple agents work together as a team to solve complex tasks. The following example interrupts a swarm invocation through a `BeforeNodeCallEvent` hook.

(( tab "Python" ))
```python
import json

from strands import Agent
from strands.hooks import BeforeNodeCallEvent, HookProvider, HookRegistry
from strands.multiagent import Swarm, Status


class ApprovalHook(HookProvider):
    def __init__(self, app_name: str) -> None:
        self.app_name = app_name

    def register_hooks(self, registry: HookRegistry) -> None:
        registry.add_callback(BeforeNodeCallEvent, self.approve)

    def approve(self, event: BeforeNodeCallEvent) -> None:
        if event.node_id != "cleanup":
            return

        approval = event.interrupt(f"{self.app_name}-approval", reason={"resources": "example"})
        if approval.lower() != "y":
            event.cancel_node = "User denied permission to cleanup resources"


swarm = Swarm(
    [
        Agent(name="cleanup", system_prompt="You clean up resources older than 5 days.", callback_handler=None),
    ],
    hooks=[ApprovalHook("myapp")],
)

result = swarm("Clean up my resources")
while result.status == Status.INTERRUPTED:
    responses = []
    for interrupt in result.interrupts:
        if interrupt.name == "myapp-approval":
            user_input = input(f"Do you want to cleanup {interrupt.reason['resources']} (y/N): ")
            responses.append({
                "interruptResponse": {
                    "interruptId": interrupt.id,
                    "response": user_input,
                },
            })

    result = swarm(responses)

print(f"MESSAGE: {json.dumps(result.results['cleanup'].result.message, indent=2)}")
```
(( /tab "Python" ))

(( tab "TypeScript" ))
```typescript
import { Agent, Swarm, Status, BeforeNodeCallEvent } from '@strands-agents/sdk'

const cleanupAgent = new Agent({
  id: 'cleanup',
  systemPrompt: 'You clean up resources older than 5 days.',
})

const swarm = new Swarm({ nodes: [cleanupAgent], start: 'cleanup' })

swarm.addHook(BeforeNodeCallEvent, (event) => {
  if (event.nodeId !== 'cleanup') return

  const approval = event.interrupt<string>({
    name: 'myapp-approval',
    reason: { resources: 'example' },
  })
  if (approval.toLowerCase() !== 'y') {
    event.cancel = 'User denied permission to cleanup resources'
  }
})

let result = await swarm.invoke('Clean up my resources')

while (result.status === Status.INTERRUPTED) {
  const responses = result.interrupts!.map((interrupt) => ({
    interruptResponse: {
      interruptId: interrupt.id,
      // In a real app, collect user input here
      response: 'y',
    },
  }))

  result = await swarm.invoke(responses)
}

console.log('MESSAGE:', JSON.stringify(result.results, null, 2))
```
(( /tab "TypeScript" ))

Swarms also support interrupts raised from within the nodes themselves, following any of the [single-agent interrupt patterns](/docs/user-guide/sdk/interrupts/index.md).

### Components

(( tab "Python" ))
-   `event.interrupt` - Raises an interrupt with a unique name and optional reason
    -   The `name` must be unique across all interrupt calls configured on the `BeforeNodeCallEvent`. In the example above, we demonstrate using `app_name` to namespace the interrupt call. This is particularly helpful if you plan to vend your hooks to other users.
    -   You can assign additional context for raising the interrupt to the `reason` field. Note, the `reason` must be JSON-serializable.
-   `result.status` - Check if the swarm stopped due to `Status.INTERRUPTED`
-   `result.interrupts` - List of interrupts that were raised
    -   Each `interrupt` contains the user provided name and reason, along with an instance id.
-   `interruptResponse` - Content block type for configuring the interrupt responses.
    -   Each `response` is uniquely identified by their interrupt’s id and will be returned from the associated interrupt call when invoked the second time around. Note, the `response` must be JSON-serializable.
-   `event.cancel_node` - Cancel node execution based on interrupt response
    -   You can either set `cancel_node` to `True` or provide a custom cancellation message.
(( /tab "Python" ))

(( tab "TypeScript" ))
-   `BeforeNodeCallEvent`: orchestrator hook event that exposes the ability to interrupt before a node runs
    -   `event.interrupt({ name, reason? })`: halts the orchestrator. `name` is a string identifier and `reason` is an optional JSON-serializable value providing context for why the interrupt was raised.
    -   The `name` must be unique across all interrupt calls configured on the same event. In the example above, we demonstrate using a namespace prefix for the interrupt call. This is particularly helpful if you plan to vend your hooks to other users.
    -   `event.cancel`: cancel node execution based on the interrupt response. Set to `true` for a default message or provide a custom cancellation message string.
-   `MultiAgentResult`: returned by `invoke()` / `stream()`, contains interrupt information when the orchestrator pauses
    -   `result.status`: check if the swarm stopped due to `Status.INTERRUPTED`
    -   `result.interrupts`: array of `Interrupt` objects, each with `name`, `reason`, and a unique `id`. Each interrupt’s `source` field is `'multiagent-hook'` when raised from `BeforeNodeCallEvent`.
-   `InterruptResponseContent`: content block type for resuming from an interrupt
    -   Pass an array of these to `swarm.invoke()` to resume. The orchestrator routes each response to the node that raised the matching interrupt.
(( /tab "TypeScript" ))

### Rules

Strands enforces the following rules for interrupts in swarm:

-   All hooks configured on the interrupted event will execute
-   All hooks configured on the interrupted event are allowed to raise an interrupt
-   A single hook can raise multiple interrupts but only one at a time
    -   In other words, within a single hook, you can interrupt, respond to that interrupt, and then proceed to interrupt again.
-   A single node can raise multiple interrupts following any of the single-agent interrupt patterns outlined above.

## Graph

A [Graph](/docs/user-guide/sdk/multi-agent/graph/index.md) is a deterministic agent orchestration system based on a directed graph, where agents are nodes executed according to edge dependencies. The following example interrupts a graph invocation through a `BeforeNodeCallEvent` hook.

(( tab "Python" ))
```python
import json

from strands import Agent
from strands.hooks import BeforeNodeCallEvent, HookProvider, HookRegistry
from strands.multiagent import GraphBuilder, Status


class ApprovalHook(HookProvider):
    def __init__(self, app_name: str) -> None:
        self.app_name = app_name

    def register_hooks(self, registry: HookRegistry) -> None:
        registry.add_callback(BeforeNodeCallEvent, self.approve)

    def approve(self, event: BeforeNodeCallEvent) -> None:
        if event.node_id != "cleanup":
            return

        approval = event.interrupt(f"{self.app_name}-approval", reason={"resources": "example"})
        if approval.lower() != "y":
            event.cancel_node = "User denied permission to cleanup resources"


inspector_agent = Agent(name="inspector", system_prompt="You inspect resources.", callback_handler=None)
cleanup_agent = Agent(name="cleanup", system_prompt="You clean up resources older than 5 days.", callback_handler=None)

builder = GraphBuilder()
builder.add_node(inspector_agent, "inspector")
builder.add_node(cleanup_agent, "cleanup")
builder.add_edge("inspector", "cleanup")
builder.set_entry_point("inspector")
builder.set_hook_providers([ApprovalHook("myapp")])
graph = builder.build()

result = graph("Inspect and clean up my resources")
while result.status == Status.INTERRUPTED:
    responses = []
    for interrupt in result.interrupts:
        if interrupt.name == "myapp-approval":
            user_input = input(f"Do you want to cleanup {interrupt.reason['resources']} (y/N): ")
            responses.append({
                "interruptResponse": {
                    "interruptId": interrupt.id,
                    "response": user_input,
                },
            })

    result = graph(responses)

print(f"MESSAGE: {json.dumps(result.results['cleanup'].result.message, indent=2)}")
```
(( /tab "Python" ))

(( tab "TypeScript" ))
```typescript
import { Agent, Graph, Status, BeforeNodeCallEvent } from '@strands-agents/sdk'

const inspectorAgent = new Agent({
  id: 'inspector',
  systemPrompt: 'You inspect resources.',
})
const cleanupAgent = new Agent({
  id: 'cleanup',
  systemPrompt: 'You clean up resources older than 5 days.',
})

const graph = new Graph({
  nodes: [inspectorAgent, cleanupAgent],
  edges: [['inspector', 'cleanup']],
})

graph.addHook(BeforeNodeCallEvent, (event) => {
  if (event.nodeId !== 'cleanup') return

  const approval = event.interrupt<string>({
    name: 'myapp-approval',
    reason: { resources: 'example' },
  })
  if (approval.toLowerCase() !== 'y') {
    event.cancel = 'User denied permission to cleanup resources'
  }
})

let result = await graph.invoke('Inspect and clean up my resources')

while (result.status === Status.INTERRUPTED) {
  const responses = result.interrupts!.map((interrupt) => ({
    interruptResponse: {
      interruptId: interrupt.id,
      // In a real app, collect user input here
      response: 'y',
    },
  }))

  result = await graph.invoke(responses)
}

console.log('MESSAGE:', JSON.stringify(result.results, null, 2))
```
(( /tab "TypeScript" ))

Graphs also support interrupts raised from within the nodes themselves, following any of the [single-agent interrupt patterns](/docs/user-guide/sdk/interrupts/index.md).

### Components

(( tab "Python" ))
-   `event.interrupt` - Raises an interrupt with a unique name and optional reason
    -   The `name` must be unique across all interrupt calls configured on the `BeforeNodeCallEvent`. In the example above, we demonstrate using `app_name` to namespace the interrupt call. This is particularly helpful if you plan to vend your hooks to other users.
    -   You can assign additional context for raising the interrupt to the `reason` field. Note, the `reason` must be JSON-serializable.
-   `result.status` - Check if the graph stopped due to `Status.INTERRUPTED`
-   `result.interrupts` - List of interrupts that were raised
    -   Each `interrupt` contains the user provided name and reason, along with an instance id.
-   `interruptResponse` - Content block type for configuring the interrupt responses
    -   Each `response` is uniquely identified by their interrupt’s id and will be returned from the associated interrupt call when invoked the second time around. Note, the `response` must be JSON-serializable.
-   `event.cancel_node` - Cancel node execution based on interrupt response
    -   You can either set `cancel_node` to `True` or provide a custom cancellation message.
(( /tab "Python" ))

(( tab "TypeScript" ))
-   `BeforeNodeCallEvent`: orchestrator hook event that exposes the ability to interrupt before a node runs
    -   `event.interrupt({ name, reason? })`: halts the orchestrator. `name` is a string identifier and `reason` is an optional JSON-serializable value providing context for why the interrupt was raised.
    -   The `name` must be unique across all interrupt calls configured on the same event. In the example above, we demonstrate using a namespace prefix for the interrupt call. This is particularly helpful if you plan to vend your hooks to other users.
    -   `event.cancel`: cancel node execution based on the interrupt response. Set to `true` for a default message or provide a custom cancellation message string.
-   `MultiAgentResult`: returned by `invoke()` / `stream()`, contains interrupt information when the orchestrator pauses
    -   `result.status`: check if the graph stopped due to `Status.INTERRUPTED`
    -   `result.interrupts`: array of `Interrupt` objects, each with `name`, `reason`, and a unique `id`. Each interrupt’s `source` field is `'multiagent-hook'` when raised from `BeforeNodeCallEvent`.
-   `InterruptResponseContent`: content block type for resuming from an interrupt
    -   Pass an array of these to `graph.invoke()` to resume. The orchestrator routes each response to the node that raised the matching interrupt; concurrent nodes already in flight run to completion.
(( /tab "TypeScript" ))

### Rules

Strands enforces the following rules for interrupts in graph:

-   All hooks configured on the interrupted event will execute
-   All hooks configured on the interrupted event are allowed to raise an interrupt
-   A single hook can raise multiple interrupts but only one at a time
    -   In other words, within a single hook, you can interrupt, respond to that interrupt, and then proceed to interrupt again.
-   A single node can raise multiple interrupts following any of the single-agent interrupt patterns outlined above
-   All nodes running concurrently will execute
-   All nodes running concurrently are interruptible

## Related pages

- [Interrupts](/docs/user-guide/sdk/interrupts/index.md) (3 shared tags)
- [Build a custom plugin](/docs/user-guide/sdk/plugins/custom-plugins/index.md) (2 shared tags)
- [Plugins](/docs/user-guide/sdk/plugins/index.md) (2 shared tags)
- [Production Lifecycle Controls](/docs/user-guide/sdk/agents/lifecycle-controls/index.md) (2 shared tags)
- [Retry Strategies](/docs/user-guide/sdk/agents/retry-strategies/index.md) (2 shared tags)
- [Agent Loop](/docs/user-guide/sdk/agents/agent-loop/index.md) (2 shared tags)
- [Hook events](/docs/user-guide/sdk/agents/hooks-events/index.md) (2 shared tags)
- [Hooks](/docs/user-guide/sdk/agents/hooks/index.md) (2 shared tags)
- [GoalLoop](/docs/user-guide/sdk/plugins/goal-loop/index.md) (2 shared tags)
- [Steering](/docs/user-guide/sdk/agents/interventions/steering/index.md) (2 shared tags)


## Implementation

### Python

- [harness-sdk/strands-py/src/strands/agent/_agent_as_tool.py](https://github.com/strands-agents/harness-sdk/blob/main/strands-py/src/strands/agent/_agent_as_tool.py)
- [harness-sdk/strands-py/src/strands/multiagent/swarm.py](https://github.com/strands-agents/harness-sdk/blob/main/strands-py/src/strands/multiagent/swarm.py)
- [harness-sdk/strands-py/src/strands/multiagent/graph.py](https://github.com/strands-agents/harness-sdk/blob/main/strands-py/src/strands/multiagent/graph.py)
- [harness-sdk/strands-py/src/strands/hooks/events.py](https://github.com/strands-agents/harness-sdk/blob/main/strands-py/src/strands/hooks/events.py)

### TypeScript

- [harness-sdk/strands-ts/src/multiagent/events.ts](https://github.com/strands-agents/harness-sdk/blob/main/strands-ts/src/multiagent/events.ts)
