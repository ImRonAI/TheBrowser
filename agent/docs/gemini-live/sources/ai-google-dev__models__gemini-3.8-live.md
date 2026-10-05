<!-- ARCHIVED COPY. Source: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live.md.txt
     Retrieved: 2026-10-01 (UTC) via curl (HTTP 200). Verbatim content follows; do not edit. -->

<br />

Gemini 3.8 Live is the default option for most low-latency voice agent
experiences and real-time dialogue without reasoning-induced delays. It supports
interleaved reasoning, asynchronous function calling, full session client
content updates, and built-in audio streaming.
[Try in Google AI Studio](https://aistudio.google.com/live?model=gemini-3.8-live)

## Documentation

Visit the [Live API](https://ai.google.dev/gemini-api/docs/live-api) guide for full coverage
of features and capabilities.

## gemini-3.8-live

| Property | Description |
|---|---|
| Model code | `gemini-3.8-live` |
| Supported data types | **Inputs** Text, images, audio, video **Output** Text and audio |
| Token limits^[\[\*\]](https://ai.google.dev/gemini-api/docs/tokens)^ | **Input token limit** 131,072 **Output token limit** 65,536 |
| Capabilities | **[Audio generation](https://ai.google.dev/gemini-api/docs/speech-generation)** Supported **[Caching](https://ai.google.dev/gemini-api/docs/caching)** Not supported **[Code execution](https://ai.google.dev/gemini-api/docs/code-execution)** Not supported **[File search](https://ai.google.dev/gemini-api/docs/file-search)** Not supported **[Function calling](https://ai.google.dev/gemini-api/docs/function-calling)** Supported **[Grounding with Google Maps](https://ai.google.dev/gemini-api/docs/maps-grounding)** Not supported **[Image generation](https://ai.google.dev/gemini-api/docs/image-generation)** Not supported **[Live API](https://ai.google.dev/gemini-api/docs/live-api)** Supported **[Search grounding](https://ai.google.dev/gemini-api/docs/google-search)** Supported **[Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)** Not supported **[Thinking](https://ai.google.dev/gemini-api/docs/thinking)** Supported (interleaved reasoning) **[URL context](https://ai.google.dev/gemini-api/docs/url-context)** Not supported |
| Consumption options | **[Batch API](https://ai.google.dev/gemini-api/docs/batch-api)** Not supported |
| Versions | Read the [model version patterns](https://ai.google.dev/gemini-api/docs/models/gemini#model-versions) for more details. - Stable: `gemini-3.8-live` |
| Latest update | September 2026 |
| Model card | [Model card](https://deepmind.google/models/model-cards/gemini-3-8-audio/) |

## Migrating from Gemini 3.1 Flash Live

Gemini 3.8 Live delivers ultra-low latency audio-to-audio interactions
and expands support for asynchronous workflows. When migrating from
`gemini-3.1-flash-live-preview`, review the following updates:

- **Model string** : Update your model string from `gemini-3.1-flash-live-preview` to `gemini-3.8-live`.
- **Thinking level** : `thinking_level` is not supported for `gemini-3.8-live`. Omit `thinking_level` (or `thinking_config`) from your session setup.
- **Asynchronous function calling** : Async execution (`behavior: NON_BLOCKING`) is now the default function calling mode. You can still use synchronous blocking mode for backwards compatibility by setting `behavior: BLOCKING` on your tool declarations. Function scheduling (`SILENT`, `WHEN_IDLE`, `INTERRUPTED`) is supported.
- **Client content updates** : `send_client_content` is supported throughout the entire session lifecycle with explicit roles (`user` or `model`). Setting `turn_complete=true` unconditionally interrupts active model generation. If you send content without `turn_complete`, the server waits for subsequent messages before responding.
- **Proactive audio** : Proactive audio is now permanently enabled. Setting `proactive_audio: false` returns an error.
- **Affective dialogue** : Affective dialogue is removed from the API. Remove any `enable_affective_dialog` configurations from your code.
- **Turn coverage** : Defaults to `TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO`. Video frames are sent to the model by default, so only send frames when needed to manage context and cost.
- **Response modalities**: Audio is the supported response modality. Enable output audio transcription if your application requires a text transcript.

For a feature comparison across all Live API models, see the
[Model comparison](https://ai.google.dev/gemini-api/docs/live-api/capabilities#model-comparison)
table.