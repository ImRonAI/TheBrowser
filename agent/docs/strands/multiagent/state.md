<!-- Source: https://strandsagents.com/docs/user-guide/sdk/agents/state/index.md -->
A Strands agent carries state in three forms, each with its own lifetime and job:

1.  **Conversation history:** the sequence of messages between the user and the agent.
2.  **Agent state:** key-value data that lives outside the conversation context and persists across requests.
3.  **Invocation state:** contextual data that lives for a single invocation.

Knowing which one to reach for is what lets you keep context across multi-turn interactions without leaking data into the model’s prompt when you don’t want it there.

## Conversation History

Conversation history is the primary form of context in a Strands agent. You read it directly off the agent:

(( tab "Python" ))
```python
from strands import Agent

# Create an agent
agent = Agent()

# Send a message and get a response
agent("Hello!")

# Access the conversation history
print(agent.messages)  # Shows all messages exchanged so far
```
(( /tab "Python" ))

(( tab "TypeScript" ))
```typescript
// Create an agent
const agent = new Agent()

// Send a message and get a response
await agent.invoke('Hello!')

// Access the conversation history
console.log(agent.messages) // Shows all messages exchanged so far
```
(( /tab "TypeScript" ))

`agent.messages` contains every user and assistant message, including tool calls and tool results. It’s the primary way to inspect what happened in a conversation.

Initialize an agent with existing messages to continue a prior conversation or pre-fill its context:

(( tab "Python" ))
```python
from strands import Agent

# Create an agent with initial messages
agent = Agent(messages=[
    {"role": "user", "content": [{"text": "Hello, my name is Strands!"}]},
    {"role": "assistant", "content": [{"text": "Hi there! How can I help you today?"}]}
])

# Continue the conversation
agent("What's my name?")
```
(( /tab "Python" ))

(( tab "TypeScript" ))
```typescript
// Create an agent with initial messages
const agent = new Agent({
  messages: [
    { role: 'user', content: [{ text: 'Hello, my name is Strands!' }] },
    { role: 'assistant', content: [{ text: 'Hi there! How can I help you today?' }] },
  ],
})

// Continue the conversation
await agent.invoke("What's my name?")
```
(( /tab "TypeScript" ))

Strands manages conversation history for you. It:

-   Persists it between calls to the agent
-   Sends it to the model on each inference
-   Supplies it as context for tool execution
-   Trims it to stay within the model’s context window

### Direct Tool Calling

Direct tool calls are (by default) recorded in the conversation history:

(( tab "Python" ))
```python
from strands import Agent
from strands.vended_tools import notebook

agent = Agent(tools=[notebook])

# Direct tool call with recording (default behavior)
agent.tool.notebook(mode="create", name="ideas", new_str="# Project ideas")

# Direct tool call without recording
agent.tool.notebook(mode="list", record_direct_tool_call=False)

print(agent.messages)
```

The first `agent.tool.notebook()` call lands in the conversation history. The second does not, because it passes `record_direct_tool_call=False`.
(( /tab "Python" ))

(( tab "TypeScript" ))
```typescript
import { Agent } from '@strands-agents/sdk'
import { notebook } from '@strands-agents/sdk/vended-tools/notebook'

const agent = new Agent({
  tools: [notebook],
})

// notebook is registered when the agent is created, so the non-null assertion is safe.
await agent.tool.notebook!.invoke({ mode: 'list' })
const recordedMessageCount = agent.messages.length

await agent.tool.notebook!.invoke({ mode: 'list' }, { recordDirectToolCall: false })

console.log(recordedMessageCount > 0) // true
console.log(agent.messages.length === recordedMessageCount) // true
```
(( /tab "TypeScript" ))

### Conversation Manager

A conversation manager keeps the history within the model’s context window. The default, [`SlidingWindowConversationManager`](/docs/api/python/strands.agent.conversation_manager.sliding_window_conversation_manager#SlidingWindowConversationManager), keeps recent messages and drops older ones when the window fills:

(( tab "Python" ))
```python
from strands import Agent
from strands.agent.conversation_manager import SlidingWindowConversationManager

# Create a conversation manager with custom window size
# By default, SlidingWindowConversationManager is used even if not specified
conversation_manager = SlidingWindowConversationManager(
    window_size=10,  # Maximum number of message pairs to keep
)

# Use the conversation manager with your agent
agent = Agent(conversation_manager=conversation_manager)
```
(( /tab "Python" ))

(( tab "TypeScript" ))
```typescript
import { SlidingWindowConversationManager } from '@strands-agents/sdk'
// Create a conversation manager with custom window size
// By default, SlidingWindowConversationManager is used even if not specified
const conversationManager = new SlidingWindowConversationManager({
  windowSize: 10,
})

const agent = new Agent({
  conversationManager,
})
```
(( /tab "TypeScript" ))

The sliding window conversation manager:

-   Keeps the most recent N message pairs
-   Removes the oldest messages when the window size is exceeded
-   Handles context window overflow exceptions by reducing context
-   Ensures conversations don’t exceed model context limits

See [Conversation Management](/docs/user-guide/sdk/agents/conversation-management/index.md) for more information about conversation managers.

## Agent State

Agent state (also called app state) gives you key-value storage that lives outside the conversation context. Strands does not pass it to the model during inference, but your tools and application logic can read and modify it freely.

### Basic Usage

(( tab "Python" ))
```python
from strands import Agent

# Create an agent with initial state
agent = Agent(state={"user_preferences": {"theme": "dark"}, "session_count": 0})


# Access state values
theme = agent.state.get("user_preferences")
print(theme)  # {"theme": "dark"}

# Set new state values
agent.state.set("last_action", "login")
agent.state.set("session_count", 1)

# Get entire state
all_state = agent.state.get()
print(all_state)  # All state data as a dictionary

# Delete state values
agent.state.delete("last_action")
```
(( /tab "Python" ))

(( tab "TypeScript" ))
```typescript
// Create an agent with initial state
const agent = new Agent({
  appState: { user_preferences: { theme: 'dark' }, session_count: 0 },
})

// Access state values
const theme = agent.appState.get('user_preferences')
console.log(theme) // { theme: 'dark' }

// Set new state values
agent.appState.set('last_action', 'login')
agent.appState.set('session_count', 1)

// Get state values individually
console.log(agent.appState.get('user_preferences'))
console.log(agent.appState.get('session_count'))

// Delete state values
agent.appState.delete('last_action')
```
(( /tab "TypeScript" ))

### State Validation and Safety

Agent state enforces JSON serialization validation to ensure data can be persisted and restored:

(( tab "Python" ))
```python
from strands import Agent

agent = Agent()

# Valid JSON-serializable values
agent.state.set("string_value", "hello")
agent.state.set("number_value", 42)
agent.state.set("boolean_value", True)
agent.state.set("list_value", [1, 2, 3])
agent.state.set("dict_value", {"nested": "data"})
agent.state.set("null_value", None)

# Invalid values will raise ValueError
try:
    agent.state.set("function", lambda x: x)  # Not JSON serializable
except ValueError as e:
    print(f"Error: {e}")
```
(( /tab "Python" ))

(( tab "TypeScript" ))
```typescript
const agent = new Agent()

// Valid JSON-serializable values
agent.appState.set('string_value', 'hello')
agent.appState.set('number_value', 42)
agent.appState.set('boolean_value', true)
agent.appState.set('list_value', [1, 2, 3])
agent.appState.set('dict_value', { nested: 'data' })
agent.appState.set('null_value', null)

// Invalid values will raise an error
try {
  agent.appState.set('function', () => 'test') // Not JSON serializable
} catch (error) {
  console.log(`Error: ${error}`)
}
```
(( /tab "TypeScript" ))

### Using State in Tools

Note

To use `ToolContext` in your tool function, the parameter must be named `tool_context`. See [ToolContext documentation](/docs/user-guide/sdk/tools/custom-tools/index.md#toolcontext) for more information.

Agent state is particularly useful for maintaining information across tool executions:

(( tab "Python" ))
```python
from strands import Agent, tool, ToolContext

@tool(context=True)
def track_user_action(action: str, tool_context: ToolContext):
    """Track user actions in agent state.

    Args:
        action: The action to track
    """
    # Get current action count
    action_count = tool_context.agent.state.get("action_count") or 0

    # Update state
    tool_context.agent.state.set("action_count", action_count + 1)
    tool_context.agent.state.set("last_action", action)

    return f"Action '{action}' recorded. Total actions: {action_count + 1}"

@tool(context=True)
def get_user_stats(tool_context: ToolContext):
    """Get user statistics from agent state."""
    action_count = tool_context.agent.state.get("action_count") or 0
    last_action = tool_context.agent.state.get("last_action") or "none"

    return f"Actions performed: {action_count}, Last action: {last_action}"

# Create agent with tools
agent = Agent(tools=[track_user_action, get_user_stats])

# Use tools that modify and read state
agent("Track that I logged in")
agent("Track that I viewed my profile")
print(f"Actions taken: {agent.state.get('action_count')}")
print(f"Last action: {agent.state.get('last_action')}")
```
(( /tab "Python" ))

(( tab "TypeScript" ))
```typescript
const trackUserActionTool = tool({
  name: 'track_user_action',
  description: 'Track user actions in agent state',
  inputSchema: z.object({
    action: z.string().describe('The action to track'),
  }),
  callback: (input, context?: ToolContext) => {
    if (!context) {
      throw new Error('Context is required')
    }

    // Get current action count
    const actionCount = (context.agent.appState.get('action_count') as number) || 0

    // Update state
    context.agent.appState.set('action_count', actionCount + 1)
    context.agent.appState.set('last_action', input.action)

    return `Action '${input.action}' recorded. Total actions: ${actionCount + 1}`
  },
})

const getUserStatsTool = tool({
  name: 'get_user_stats',
  description: 'Get user statistics from agent state',
  inputSchema: z.object({}),
  callback: (input, context?: ToolContext) => {
    if (!context) {
      throw new Error('Context is required')
    }

    const actionCount = (context.agent.appState.get('action_count') as number) || 0
    const lastAction = (context.agent.appState.get('last_action') as string) || 'none'

    return `Actions performed: ${actionCount}, Last action: ${lastAction}`
  },
})

// Create agent with tools
const agent = new Agent({
  tools: [trackUserActionTool, getUserStatsTool],
})

// Use tools that modify and read state
await agent.invoke('Track that I logged in')
await agent.invoke('Track that I viewed my profile')
console.log(`Actions taken: ${agent.appState.get('action_count')}`)
console.log(`Last action: ${agent.appState.get('last_action')}`)
```
(( /tab "TypeScript" ))

## Invocation State

Each agent interaction maintains an invocation state dictionary that persists across the agent loop cycles and is **not** included in the agent’s context:

(( tab "Python" ))
```python
from strands import Agent, tool, ToolContext

@tool(context=True)
def whoami(tool_context: ToolContext) -> str:
    """Return the user ID carried in the invocation state."""
    user_id = tool_context.invocation_state.get("user_id", "unknown")
    return f"Current user: {user_id}"

agent = Agent(tools=[whoami])

# Pass per-invocation state when invoking. Hooks and tools read and
# mutate it during the invocation.
result = agent("Who am I?", invocation_state={"request_id": "r-42", "user_id": "u-1"})
```
(( /tab "Python" ))

(( tab "TypeScript" ))
```typescript
const agent = new Agent()

// Pass per-invocation state when invoking
const result = await agent.invoke('Hi there!', {
  invocationState: { requestId: 'r-42', userId: 'u-1' },
})

// Hooks and tools can read and mutate invocationState during
// the invocation. The same object is returned on the result.
console.log(result.invocationState)
// { requestId: 'r-42', userId: 'u-1', ... }
```
(( /tab "TypeScript" ))

Invocation state (`invocation_state``invocationState`):

-   Comes from the `invocation_state``invocationState` argument you pass to the invocation, and defaults to `{}` when omitted
-   Persists through the recursive agent loop cycles within a single invocation
-   Is shared by reference across all hook events and tools, so mutations are visible to later hooks and tools in the same invocation
-   Surfaces on the result: TypeScript returns the full invocation state as `result.invocationState`; Python returns its `request_state` slot as `result.state`
-   Is **not** included in the agent’s model context

## Persisting State Across Sessions

For automatic persistence of agent state and conversation history across application restarts, see [Session Management](/docs/user-guide/sdk/agents/session-management/index.md). For manual, point-in-time capture and restore of agent state, see [Snapshots](/docs/user-guide/sdk/agents/snapshots/index.md).

## Related pages

- [Persist state across sessions](/docs/user-guide/sdk/agents/session-management/index.md) (3 shared tags)
- [Session Management](/docs/user-guide/sdk/bidi/session-management/index.md) (2 shared tags)
- [Search Strategies](/docs/user-guide/sdk/storage/search-strategies/index.md) (1 shared tag)
- [Storage](/docs/user-guide/sdk/storage/index.md) (1 shared tag)
- [OpenAI Responses API](/docs/user-guide/sdk/model-providers/openai-responses/index.md) (1 shared tag)
- [Conversation Management](/docs/user-guide/sdk/agents/conversation-management/index.md) (1 shared tag)


## Implementation

### Python

- [harness-sdk/strands-py/src/strands/agent/state.py](https://github.com/strands-agents/harness-sdk/blob/main/strands-py/src/strands/agent/state.py)
- [harness-sdk/strands-py/src/strands/types/json_dict.py](https://github.com/strands-agents/harness-sdk/blob/main/strands-py/src/strands/types/json_dict.py)

### TypeScript

- [harness-sdk/strands-ts/src/agent/agent.ts](https://github.com/strands-agents/harness-sdk/blob/main/strands-ts/src/agent/agent.ts)
