<!-- Source: https://strandsagents.com/docs/api/python/strands.types.session/index.md -->
Data models for session management.

## SessionType

```python
class SessionType(str, Enum)
```

Defined in: [src/strands/types/session.py:17](https://github.com/strands-agents/harness-sdk/blob/main/strands-py/src/strands/types/session.py#L17)

Enumeration of session types.

As sessions are expanded to support new use cases like multi-agent patterns, new types will be added here.

#### encode\_bytes\_values

```python
def encode_bytes_values(obj: Any) -> Any
```

Defined in: [src/strands/types/session.py:27](https://github.com/strands-agents/harness-sdk/blob/main/strands-py/src/strands/types/session.py#L27)

Recursively encode any bytes values in an object to base64.

Handles dictionaries, lists, and nested structures.

#### decode\_bytes\_values

```python
def decode_bytes_values(obj: Any) -> Any
```

Defined in: [src/strands/types/session.py:42](https://github.com/strands-agents/harness-sdk/blob/main/strands-py/src/strands/types/session.py#L42)

Recursively decode any base64-encoded bytes values in an object.

Handles dictionaries, lists, and nested structures.

## SessionMessage

```python
@dataclass
class SessionMessage()
```

Defined in: [src/strands/types/session.py:58](https://github.com/strands-agents/harness-sdk/blob/main/strands-py/src/strands/types/session.py#L58)

Message within a SessionAgent.

**Attributes**:

-   `message` - Message content
-   `message_id` - Index of the message in the conversation history
-   `redact_message` - If the original message is redacted, this is the new content to use
-   `created_at` - ISO format timestamp for when this message was created
-   `updated_at` - ISO format timestamp for when this message was last updated

#### from\_message

```python
@classmethod
def from_message(cls, message: Message, index: int) -> "SessionMessage"
```

Defined in: [src/strands/types/session.py:76](https://github.com/strands-agents/harness-sdk/blob/main/strands-py/src/strands/types/session.py#L76)

Convert from a Message, base64 encoding bytes values.

#### to\_message

```python
def to_message() -> Message
```

Defined in: [src/strands/types/session.py:85](https://github.com/strands-agents/harness-sdk/blob/main/strands-py/src/strands/types/session.py#L85)

Convert SessionMessage back to a Message, decoding any bytes values.

If the message was redacted, return the redact content instead.

#### from\_dict

```python
@classmethod
def from_dict(cls, env: dict[str, Any]) -> "SessionMessage"
```

Defined in: [src/strands/types/session.py:96](https://github.com/strands-agents/harness-sdk/blob/main/strands-py/src/strands/types/session.py#L96)

Initialize a SessionMessage from a dictionary, ignoring keys that are not class parameters.

#### to\_dict

```python
def to_dict() -> dict[str, Any]
```

Defined in: [src/strands/types/session.py:101](https://github.com/strands-agents/harness-sdk/blob/main/strands-py/src/strands/types/session.py#L101)

Convert the SessionMessage to a dictionary representation.

## SessionAgent

```python
@dataclass
class SessionAgent()
```

Defined in: [src/strands/types/session.py:107](https://github.com/strands-agents/harness-sdk/blob/main/strands-py/src/strands/types/session.py#L107)

Agent that belongs to a Session.

**Attributes**:

-   `agent_id` - Unique id for the agent.
-   `state` - User managed state.
-   `conversation_manager_state` - State for conversation management.
-   `created_at` - Created at time.
-   `updated_at` - Updated at time.

#### from\_agent

```python
@classmethod
def from_agent(cls, agent: "LocalAgent") -> "SessionAgent"
```

Defined in: [src/strands/types/session.py:126](https://github.com/strands-agents/harness-sdk/blob/main/strands-py/src/strands/types/session.py#L126)

Convert a local agent to a SessionAgent.

#### from\_dict

```python
@classmethod
def from_dict(cls, env: dict[str, Any]) -> "SessionAgent"
```

Defined in: [src/strands/types/session.py:150](https://github.com/strands-agents/harness-sdk/blob/main/strands-py/src/strands/types/session.py#L150)

Initialize a SessionAgent from a dictionary, ignoring keys that are not class parameters.

#### to\_dict

```python
def to_dict() -> dict[str, Any]
```

Defined in: [src/strands/types/session.py:155](https://github.com/strands-agents/harness-sdk/blob/main/strands-py/src/strands/types/session.py#L155)

Convert the SessionAgent to a dictionary representation.

#### initialize\_internal\_state

```python
def initialize_internal_state(agent: "LocalAgent") -> None
```

Defined in: [src/strands/types/session.py:159](https://github.com/strands-agents/harness-sdk/blob/main/strands-py/src/strands/types/session.py#L159)

Restore internal state for Agent instances.

## Session

```python
@dataclass
class Session()
```

Defined in: [src/strands/types/session.py:173](https://github.com/strands-agents/harness-sdk/blob/main/strands-py/src/strands/types/session.py#L173)

Session data model.

#### from\_dict

```python
@classmethod
def from_dict(cls, env: dict[str, Any]) -> "Session"
```

Defined in: [src/strands/types/session.py:182](https://github.com/strands-agents/harness-sdk/blob/main/strands-py/src/strands/types/session.py#L182)

Initialize a Session from a dictionary, ignoring keys that are not class parameters.

#### to\_dict

```python
def to_dict() -> dict[str, Any]
```

Defined in: [src/strands/types/session.py:186](https://github.com/strands-agents/harness-sdk/blob/main/strands-py/src/strands/types/session.py#L186)

Convert the Session to a dictionary representation.