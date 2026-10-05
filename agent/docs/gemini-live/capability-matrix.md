# Gemini 3.8 Live — official capability matrix vs native Strands `strands.bidi`

Grounding snapshot for the Ron Live (voice + teaching) build. Every row cites an archived
official source in `sources/` (verbatim copies, retrieved 2026-10-01, verified to be article
bodies — no login/401 boilerplate; see `MANIFEST.md`). Strands facts cite the pinned clone
`agent/api/core/harness-sdk` @ `563f57d7a387931760a2c3106014cd7c0db4c9bc` (editable install from
`agent/api/requirements.txt`; `deploy/prepare-strands.sh` reapplies `deploy/strands-bidi.patch`).

Agreed architecture (do not reintroduce alternatives): one editable install of the pinned clone,
**no `sys.path` insertion**, **no `RonLiveModel` subclass**; new Live protocol fields are mapped
inside the native provider/types by `deploy/strands-bidi.patch` at the SDK boundary; the
`_AgentLoop` is unchanged and forwards new `TypedEvent`s verbatim.

Legend — **Official**: what Google states for the specific model. **Native @563f57d**: unpatched
clone. **Patch**: behavior delivered by `deploy/strands-bidi.patch`. Status as of 2026-10-02 01:30 UTC:
the patch touches `bidi/models/google.py`, `bidi/agent/agent.py`,
`bidi/types/{events,media,content,agent,__init__}.py` and tests `test_agent.py`, `test_google.py`,
`test_openai.py`, `types/test_events.py` (the former `test_media.py` was merged into `test_events.py`;
no unexported source/tests remain); **`bidi/agent/loop.py` is not in the patch — the native loop is
unchanged**. Root-reported offline results for the final export: clean GitHub-clone reconstruction
206 Google + types tests pass; 215 native agent-loop tests pass (3 optional Bedrock constructor tests
skipped, deps absent); app suite 456 and renderer 140 pass (counts drift; do not treat as gates).
Real smokes **ACCEPTED**: regular `gemini-3.8-live` 7.93 s; extended-thinking 58.82 s with exactly one
harmless delayed tool, speech *during* the tool, and an explicit final `idle`. Schema fix (final):
`parameters_json_schema` is omitted **only** for a bare empty object schema; `additionalProperties`,
`$ref`/`$defs`, `oneOf`, `required`-only and non-object schemas are forwarded unchanged (tested).
Reviewer fixes H1/H2/H3 are on disk in the clone with passing tests (verified here: 14 targeted tests
pass); the exported patch file is being regenerated to include them. Rows below use **VERIFIED**
(offline-tested), **SMOKE** (live-exercised), **NOT IMPLEMENTED**. Not all native Live features are
implemented — see the NOT IMPLEMENTED rows.

Vertex AI / Google Cloud: not archived here. Extended-thinking support is **verified on the Gemini
Developer API docs only; Vertex support is unverified** (absence of a Cloud page is not evidence of
absence).

## 1. Model-specific constraints (do not assume generic Live API fields apply)

| Topic | `gemini-3.8-live` | `gemini-3.8-live-extended-thinking` | Source |
|---|---|---|---|
| Model string | `gemini-3.8-live` (stable) | `gemini-3.8-live-extended-thinking` (stable); latest update Sept 2026 | model cards |
| Inputs / outputs | Text, images, audio, video → text and audio | same | model cards |
| Token limits | 131,072 in / 65,536 out | same | model cards |
| `thinking_config.thinking_level` | **Not supported — omit** `thinking_level`/`thinking_config` | `low` \| `medium` \| `high`; **`MINIMAL` not supported** (SKILL.md lists `minimal`; migration.md, thinking.md, capabilities.md and model card all say not supported → treat as unsupported) | thinking.md; capabilities.md "Model comparison"; migration.md |
| `include_thoughts` | not documented for this model | documented (`thinking_config.include_thoughts=True`) | capabilities.md "Thinking" |
| Function calling `behavior` | `NON_BLOCKING` is the **default**; `BLOCKING` opt-in | **`NON_BLOCKING` required on every declaration**; BLOCKING returns a hard error | migration.md §1/§2; model cards |
| `FunctionResponse.scheduling` (`SILENT`/`WHEN_IDLE`/`INTERRUPT`) | supported | **not supported** | capabilities.md comparison; model card |
| `interaction_status` | present but `turnComplete: true` reliably means idle | **lifecycle signal**: `IN_PROGRESS` (reasoning / fillers / awaiting async tools) vs `IDLE`; `turnComplete: true` only ends an utterance | thinking.md; ext. model card |
| Conversational fillers | model waits for tools before speaking | streams spoken fillers with `turnComplete: true` + `IN_PROGRESS`; tool call arrives with `IN_PROGRESS`; final answer `turnComplete: true` + `IDLE` | thinking.md protocol walk-through |
| Proactive audio | permanently enabled; `proactive_audio: false` → error | same | migration.md |
| Affective dialog | **removed**; drop `enable_affective_dialog` | same | migration.md §1 (ext. card silent; capabilities.md still documents the field generically — model-specific statement wins) |
| Response modalities | `AUDIO` only; use `output_audio_transcription` for text | same | migration.md; capabilities.md Limitations |
| Turn coverage default | `TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO` — video frames always sent; send only when needed | same | migration.md |
| Search grounding | Supported | Supported | model cards |
| Code execution / URL context / Maps / caching / structured output / file search / image gen / Batch | Not supported | Not supported | model cards |
| Session limits | audio-only 15 min, audio+video 2 min without compression; connection ≈10 min; GoAway before close | same | session-management.md; SKILL.md Limitations |
| Resumption handle validity | 2 h after last session termination (Strands doc page says 24 h — Google is authoritative) | same | session-management.md |
| Context window | 128k native-audio models | same | capabilities.md |
| Languages | 99 listed; native-audio models auto-switch; language restriction via system instruction, **not** `language_code` | same | capabilities.md |

## 2. Protocol facts (WebSocket reference `api/live`)

| Fact | Statement | Source |
|---|---|---|
| Setup once | `BidiGenerateContentSetup` only in the first message; "Clients should wait for a `BidiGenerateContentSetupComplete` message before sending any additional messages." | live reference |
| One message kind | Client JSON must have **exactly one** of `setup`, `clientContent`, `realtimeInput`, `toolResponse` | live reference "Send messages" |
| `clientContent` interrupts | "A message here will interrupt any current model generation." `turnComplete=false` → server awaits more messages before generating. Model pages: `turn_complete=true` **unconditionally** interrupts. → **Never promise non-interrupting context via `clientContent`.** | live reference; model cards |
| `realtimeInput` ordering | audio/video/text "are handled as concurrent streams. The ordering across these streams is not guaranteed." Mixing with `clientContent`: "server attempts to optimize … no guarantees." Can be sent continuously "without interruption to model generation"; end of turn is derived from activity, data processed incrementally. → realtime text may still trigger a response; it is *not* an ephemeral side-channel. | live reference |
| `mediaChunks` deprecated | use `audio` / `video` / `text` | live reference; SKILL.md warning |
| `interactionStatus` location | field of **`BidiGenerateContentServerContent`** (nested under `serverContent`), "Always sent alongside `turnComplete`." Not a top-level union member. python-genai 2.24.0 exposes `LiveServerContent.interaction_status`; `getattr(message, "interaction_status")` in Google samples is a convenience that is `None` on the SDK message object. | live reference; venv introspection |
| Other `serverContent` fields | `generationComplete`, `turnComplete`, `interrupted`, `groundingMetadata`, `inputTranscription`, `interimInputTranscription`, `outputTranscription`, `urlContextMetadata`, `waitingForInput`, `speechState` (deprecated → `voiceActivity`), `modelTurn` | live reference |
| `toolCallCancellation.ids` | previously issued tool calls "should not have been executed and should be cancelled"; occurs "only in cases where the clients interrupt server turns"; clients *may* attempt to undo side effects | live reference |
| Session resumption | `SessionResumptionUpdate{newHandle, resumable}`; `resumable=false` means **no new resumable handle at this point** (`newHandle` empty — e.g. while the model executes function calls or generates; resuming *then* would lose some data). It does **not** invalidate the last good handle: the official sample updates the stored handle only on `resumable and new_handle` (session-management.md). Correction 2026-10-02: an earlier version of this row wrongly said "client must invalidate the old handle". | live reference; session-management.md |
| `historyConfig.initialHistoryInClientContent` | after `setupComplete` the server first consumes `clientContent` until `turnComplete=true` without a model call; then realtime begins | live reference |
| Config immutability | no field exists to update setup config on an open connection; `sessionResumption.handle` reopens the same session on a *new* connection with a fixed model | live reference (absence of any update message) |
| VAD | server VAD default (`automaticActivityDetection`: start/end sensitivity, `prefixPaddingMs`, `silenceDurationMs`≈800 ms default); `audioStreamEnd` = hybrid finalize (only with auto VAD); `disabled=true` → client `activityStart`/`activityEnd`, no `audioStreamEnd` | capabilities.md VAD; live reference |
| Transcription config | `customVocabulary[]`, `diarization`, `mode` VERBATIM\|SMART (timestamps/diarization incompatible with SMART), `languageCodes`, `languageHints` | live reference `AudioTranscriptionConfig` |
| Media resolution | `mediaResolution` in setup or per `realtimeInput` | live reference; capabilities.md |

## 3. Native Strands `strands.bidi` @563f57d vs needs

| Capability | Native @563f57d (`bidi/models/google.py`, `bidi/agent/loop.py`) | Gap vs official 3.8 | Patch — status |
|---|---|---|---|
| Declaration `behavior` / schema | not set (`_format_tools_for_live_api` → `genai.Schema`, no `behavior`) | **G1** hard error on extended | **VERIFIED** (`test_live_tool_uses_json_schema_and_non_blocking_for_3_8`, `test_live_tool_without_parameters_omits_schema`, `test_live_tool_constrained_schema_is_forwarded`): `behavior=NON_BLOCKING` when `"gemini-3.8-live" in model_id` (`_NON_BLOCKING_MODEL_MARKER`), else `None`; `parameters_json_schema` forwarded, omitted only for a bare empty object (keys ⊆ {type, properties, required, title, description}, no properties/required); no `scheduling`/`will_continue`. **SMOKE** accepted on both models |
| `interaction_status` (+ `turn_complete_reason`, `waiting_for_input`) | unmapped; loop's `_turn_complete` latch treats `turn_complete` as idle (`loop.py` `_update_turn_state`) | **G2** | **VERIFIED** (emitted independently of response, unknown→`unspecified`, reason forwarded, no-status still closes, in_progress defers `bidi_response_stop` until idle/`requires_action`, delayed idle closes, in_progress w/o turn_complete does not defer): `BidiInteractionStatusEvent` `{"type":"bidi_interaction_status","status":"in_progress"\|"idle"\|"requires_action"\|"unspecified","turn_complete","turn_complete_reason","waiting_for_input"}`; `_TurnState.completion_deferred`; absent field → legacy path. Reviewer fixes on disk + tested: **H1** assistant transcript/text blocks close at every `turn_complete` even while the response stop is deferred (`test_filler_transcript_survives_restart_during_deferred_completion`); **H2** barge-in or `waiting_for_input` closes a deferred response and the next reply gets its own `bidi_response_start` (`test_barge_in_closes_deferred_response_and_next_reply_is_distinct`, `…_on_next_boundary`). **SMOKE** accepted (extended 58.82 s, explicit final idle) |
| `tool_call_cancellation` | ignored; results still sent (`_run_tools` → `send_tool_response`) | **G3** | **VERIFIED** (3 tests: cancelled results not sent, only-cancelled sends nothing, ids survive restart): `BidiToolCancelEvent` `{"type":"bidi_tool_cancel","tool_use_ids":[…]}`; `_send_message` drops those function responses; host tool still runs/records; nothing undone |
| Realtime text / video / VAD signals through the send gate | none: `send()` handles `BidiMessage` (→ `send_client_content(turn_complete=True)`) and `AudioDelta` only; video needed a private `_live_session` reach-in | **G6/G8** | **VERIFIED** (agent: streams without history, waits for send gate, preserves model ValueError; google: streams without ending turn, video requires bytes, text message still completes turn; openai: rejects `RealtimeInput`): `RealtimeInput(text\|video\|audio_stream_end\|activity)` exactly-one-field dataclass + `{"realtime_input": {...}}` dict form; maps to `send_realtime_input(...)` kwargs; not recorded in history |
| Resumption handle | retain last good handle; update only on `resumable and new_handle`; a refused handle is dropped in `_try_resume` and `restart()` falls back to a fresh start with text-only history replay | none — upstream semantics match Google's sample (former "G7" withdrawn) | **VERIFIED on disk** (`test_unresumable_update_keeps_last_handle_for_restart`): upstream retain-last-good semantics kept; native refusal fallback unchanged. Reviewer H3 overturned the interim "clear on `resumable=False`" change; that interim behavior and its test are being removed from the exported patch |
| Provider-executed tools (Google Search) | no seam; only `params` merge | — | **VERIFIED** (3 `hosted_tools` tests): `GoogleGeminiLiveModel(hosted_tools=[{"google_search": {}}])` appended to `tools` in setup; `params["tools"]` override replaces the whole list; present even without agent tools. Ron: `bidi_agent.py` passes it when search is enabled. Live grounding behavior **not SMOKE-tested** |
| Grounding / URL-context metadata | ignored | nice-to-have | **VERIFIED** (`test_grounding_metadata_forwarded`, defaults test): `BidiGroundingEvent` `{"type":"bidi_grounding", web_search_queries, chunks, supports, url_metadata}` |
| End-to-end live smokes | — | — | **SMOKE** accepted: regular `gemini-3.8-live` 7.93 s (one delayed tool + speech + completion); extended-thinking 58.82 s (exactly one harmless delayed tool, speech during the tool, explicit final `idle`). Single runs, no mic/video; not a regression suite |
| `interim_input_transcription` | ignored | official field exists | **NOT IMPLEMENTED** |
| `speech_state` (deprecated) / `voice_activity` beyond ACTIVITY_START | ACTIVITY_START only | — | **NOT IMPLEMENTED** (unchanged) |
| Transcription language metadata (`language_codes`, `language_hints`, diarization, SMART mode) | pass-through via `params` only; no typed support or events | — | **NOT IMPLEMENTED** (config pass-through only) |
| `include_thoughts` typed option | `params` pass-through | — | **NOT IMPLEMENTED** as a typed option (works via `params["thinking_config"]`) |
| Function-response `scheduling` | not set | unsupported on extended; supported on regular | **NOT IMPLEMENTED** (deliberate) |
| Manual VAD config (`automatic_activity_detection.disabled`) | `params` pass-through | — | signals **VERIFIED** (`activity` start/end); setup config remains `params` pass-through |
| Reasoning parts | `part.thought` → `BidiReasoning*` | ok (needs `include_thoughts` to receive) | — |
| GoAway → restart; proactive `restart_after_s=540`; sliding-window compression default; handle-based resume else text-only replay | present | ok | — |
| `history_config.initial_history_in_client_content` seed on fresh start with text messages | present | ok — the sanctioned text→voice context transfer (one-time seed at `start()`) | — |
| Snapshot persistence | `SnapshotSessionManager` supports `BidiAgent` (`bidi_agent_save_latest_on` = `message`\|`stop`\|`trigger`); `BidiAgent(session_manager=, storage=)` | ok; **ctor has no `tool_executor` kwarg** (teaching code passing it fails) | — (Ron side: drop the kwarg) |
| Interrupts | `_run_tool` raises on `ToolInterruptEvent`; docs page "in development" | `BrowserAvailabilityHook`/`ask_user` must stay off the Live agent | — |
| `cancel()` | effective only after a tool group completes | known | — |
| Deprecated path | `strands.experimental.bidi` shim (DeprecationWarning, removed v1.60) | import `strands.bidi` | — |

## 4. Ron-side constraints derived above

- Mid-session context from chat → Live: only `RealtimeInput(text=...)` (concurrent, unordered, may
  elicit a reply) or a `clientContent` user turn (interrupts). Neither is "ephemeral" or
  "non-interrupting"; UI copy must not promise that. The lossless path is the one-time history seed
  at `start()`. Backend (in progress, root/backend-owned): the initial context frame becomes
  text-only **USER/assistant seed messages** (`create_bidi_agent(..., seed_messages=)`), not a system
  prompt change; `/bidi` settings are validated in `core/bidi_runtime.py`. See `docs/panel-runtime.md`
  (root-owned) for the authoritative contract.
- Thinking level is a connect-time `params["thinking_config"]`; it cannot change on an open session
  (reconnect with the same resumption handle keeps the model fixed).
- Teaching observer: frames must go through `RealtimeInput(video=...)` (not `ImageBlock` user turns,
  which are recorded and replayed on fresh restarts and interrupt generation); finish gating must
  use `bidi_interaction_status: idle`, not `bidi_response_stop`.
- Voice names: Live uses the TTS voice catalogue (`speech_config.voice_config.prebuilt_voice_config`);
  explicit `language_code` is not honoured by native-audio models.

## 5. Gemini 3.8 TTS (documentation only — separate from Live; no implementation planned)

TTS is the unary/streaming `generateContent` / Interactions API speech path, **not** the Live API.
Google: "The TTS capability differs from speech generation provided through the Live API … TTS …
is tailored for scenarios that require exact text recitation with fine-grained control over style
and sound." Live voice output in Ron stays on the Live models; nothing here is wired.
Sources: `sources/ai-google-dev__speech-generation.md`,
`sources/ai-google-dev__models__gemini-3.8-flash-tts.md`,
`sources/ai-google-dev__models__gemini-3.8-flash-lite-tts.md` (retrieved 2026-10-02).

| Topic | `gemini-3.8-flash-tts` | `gemini-3.8-flash-lite-tts` | Source |
|---|---|---|---|
| Positioning | flagship creative tier: fidelity, acting nuance, dialects, long-form multi-turn stability | fast/cost-efficient workhorse; replacement for `gemini-3.1-flash-tts-preview`; voice-agent cascades, read-aloud | model cards |
| I/O | text in → audio out (text-only inputs, audio-only outputs) | same | model cards; guide Limitations |
| Token limits | 8,192 in / 16,384 out (Gemini API serving limit) | same | model cards |
| Capabilities | Audio generation, Caching supported; Function calling, Live API, Thinking, Search grounding, structured outputs, code execution, URL context, image gen, file search, Maps: not supported | same | model cards |
| Consumption | Batch API, Flex inference, Priority inference supported | same | model cards |
| Languages | >130, auto-detected | >100 (101), auto-detected | model cards |
| Latest update | September 2026 | September 2026 | model cards |
| API schema | identical for both: `speech_metadata {speaker, style}` per part/content block (input text is a verbatim transcript; inline stage directions may be spoken); angle-bracket inline tags only for point-in-time events (`<laugh>`, `<sigh>`, `<short pause>`) | same | guide "Migration guide" |
| Multi-speaker | `speech_config.speakers`, up to 2 speakers with prebuilt voices; every turn must carry `speech_metadata.speaker`; custom voices → synthesize per speaker and concatenate | same | guide Limitations |
| Output format | unary default **`audio/wav`** (RIFF, 24 kHz mono 16-bit LE PCM); streaming (`stream=true`) default **`audio/l16`** headerless; `response_format.mime_type` ∈ `audio/wav`, `audio/l16`, `audio/mulaw`, `audio/alaw`; optional `sample_rate` (e.g. 24000/16000/8000). Earlier TTS models defaulted to raw L16 — do not pre-wrap WAV headers | same | guide "Audio output formats" |
| Voices | 30 prebuilt studio voices (Zephyr, Puck, Charon, Kore, Fenrir, Leda, Orus, Aoede, Callirrhoe, Autonoe, Enceladus, Iapetus, Umbriel, Algieba, Despina, Erinome, Algenib, Rasalgethi, Laomedeia, Achernar, Alnilam, Schedar, Gacrux, Pulcherrima, Achird, Zubenelgenubi, Vindemiatrix, Sadachbia, Sadaltager, Sulafat); Extended Voice Library via `GET /v1beta/voices` (`client.voices.list()`, google-genai 2.25.0+ — venv has 2.24.0); Voice design (`POST /v1beta/voices type=prompted` → `voice_…`); Voice replication (`type=replicated`, `store=True` default, stateless `voicekey_…`) | same | guide "Voice options" |
| Custom voice limits | stateful `voice_…`: 200 per project, 1-year TTL reset on use; stateless `voicekey_…`: 7-day TTL | same | guide |
| Voice-agent guidance | one TTS call per turn; identity carried by `voice`, not re-sent persona; empty/short constant `style`; split long responses | same | guide "Multi-turn dialogue and voice agents" |
| Relation to Live voices | Live `speech_config.voice_config.prebuilt_voice_config` uses the TTS voice catalogue (Live capabilities page); Ron's `voice-settings.ts` 8-voice list is a subset of the 30 prebuilt voices | — | capabilities.md; guide |
