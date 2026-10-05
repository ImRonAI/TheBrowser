<!-- ARCHIVED COPY. Source: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live-extended-thinking.md.txt
     Retrieved: 2026-10-01 (UTC) via curl (HTTP 200). Verbatim content follows; do not edit. -->

<br />

Gemini 3.8 Live Extended Thinking is our high-reasoning audio-to-audio model
recommended when higher background reasoning is required for complex, multi-step
problem solving during real-time voice interactions. It processes background
reasoning and asynchronous tool calls while streaming continuous audio
responses.
[Try in Google AI Studio](https://aistudio.google.com/live?model=gemini-3.8-live-extended-thinking)

## Documentation

Visit the [Live API](https://ai.google.dev/gemini-api/docs/live-api) guide for full coverage
of features and capabilities.

## gemini-3.8-live-extended-thinking

| Property | Description |
|---|---|
| Model code | `gemini-3.8-live-extended-thinking` |
| Supported data types | **Inputs** Text, images, audio, video **Output** Text and audio |
| Token limits^[\[\*\]](https://ai.google.dev/gemini-api/docs/tokens)^ | **Input token limit** 131,072 **Output token limit** 65,536 |
| Capabilities | **[Audio generation](https://ai.google.dev/gemini-api/docs/speech-generation)** Supported **[Caching](https://ai.google.dev/gemini-api/docs/caching)** Not supported **[Code execution](https://ai.google.dev/gemini-api/docs/code-execution)** Not supported **[File search](https://ai.google.dev/gemini-api/docs/file-search)** Not supported **[Function calling](https://ai.google.dev/gemini-api/docs/function-calling)** Supported (Async only) **[Grounding with Google Maps](https://ai.google.dev/gemini-api/docs/maps-grounding)** Not supported **[Image generation](https://ai.google.dev/gemini-api/docs/image-generation)** Not supported **[Live API](https://ai.google.dev/gemini-api/docs/live-api)** Supported **[Search grounding](https://ai.google.dev/gemini-api/docs/google-search)** Supported **[Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)** Not supported **[Thinking](https://ai.google.dev/gemini-api/docs/thinking)** Supported **[URL context](https://ai.google.dev/gemini-api/docs/url-context)** Not supported |
| Consumption options | **[Batch API](https://ai.google.dev/gemini-api/docs/batch-api)** Not supported |
| Versions | Read the [model version patterns](https://ai.google.dev/gemini-api/docs/models/gemini#model-versions) for more details. - Stable: `gemini-3.8-live-extended-thinking` |
| Latest update | September 2026 |
| Model card | [Model card](https://deepmind.google/models/model-cards/gemini-3-8-audio/) |

## Upgrading to Gemini 3.8 Live Extended Thinking

Gemini 3.8 Live Extended Thinking introduces background reasoning during live
audio sessions. When integrating this model, update your client state management
to handle asynchronous reasoning signals:

- **Asynchronous reasoning protocol** : When interacting with models that use asynchronous reasoning, `turnComplete: true` no longer indicates that the model is idle. The server may continue processing background reasoning or tool calls. Your client must continue listening for subsequent server messages (such as tool calls or audio frames) after `turnComplete: true` arrives.
- **Monitoring `interaction_status`** : Use the `interaction_status` field on incoming server messages to determine current server state:
  - `IN_PROGRESS`: The server is actively processing user input, running background reasoning, or awaiting responses for asynchronous tool calls. Additional model output or tool calls may follow.
  - `IDLE`: The server has finished all processing, reasoning, and tool calls. The session is idle and waiting for user input.
- **Asynchronous function calling** : Only asynchronous non-blocking execution (`behavior: NON_BLOCKING`) is supported. Synchronous blocking mode is not supported and returns a hard error. Function scheduling configurations are not supported.
- **Thinking configuration** : Configure background reasoning using `thinking_config` in your setup configuration (`thinking_level`: `low`, `medium`, or `high`). Note that `MINIMAL` is not supported.
- **Client content updates** : `send_client_content` is supported throughout the entire session lifecycle with explicit roles (`user` or `model`). Setting `turn_complete=true` immediately interrupts active generation.
- **Proactive audio** : Permanently enabled. Setting `proactive_audio: false` returns an error.

For a feature comparison across all Live API models, see the
[Model comparison](https://ai.google.dev/gemini-api/docs/live-api/capabilities#model-comparison)
table.