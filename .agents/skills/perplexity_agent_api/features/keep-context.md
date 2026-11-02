> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Keep context

> Carry a conversation across turns by replaying it in the input array, so a follow-up understands what came before.

Replay the conversation yourself in the `input` array when you need precise control over exactly what context is sent, for example to summarize, redact, reorder, or omit earlier turns before the follow-up. See [Replay conversation turns yourself](/docs/agent-api/conversation-state#replay-conversation-turns-yourself) for the pattern and code examples.

## Storage-backed continuity

For most multi-turn conversations, use `previous_response_id` to continue from a completed prior response without resending the conversation yourself. See [Conversation state](/docs/agent-api/conversation-state) for the full guide.

## Next steps

<CardGroup cols={2}>
  <Card title="Image Attachments" icon="eye" href="/docs/agent-api/image-attachments">
    Attach images to a request.
  </Card>

  <Card title="Output Control" icon="sliders" href="/docs/agent-api/output-control">
    Control streaming, background runs, error handling, and structured output.
  </Card>
</CardGroup>
