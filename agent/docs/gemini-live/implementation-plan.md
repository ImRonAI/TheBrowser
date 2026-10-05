# Ron Live implementation plan (grounded, aligned with the agreed native approach)

Status: planning record for the current build. Architecture decisions below were confirmed on
the coordination board on 2026-10-01/02; this document records them so later work does not
reintroduce competing designs. Sources: `capability-matrix.md`, `sources/`.

## Architecture (decided)

1. **One SDK source**: the pinned GitHub clone `agent/api/core/harness-sdk` @ `563f57d7…`,
   installed editable by `agent/api/requirements.txt`
   (`-e ./agent/api/core/harness-sdk/strands-py[a2a,mistral,openai,anthropic,gemini,bidi-google]`).
   `deploy/prepare-strands.sh` clones (sparse) and (re)applies `deploy/strands-bidi.patch`.
   **No `sys.path` insertion** anywhere (`agent/api/main.py` no longer references `BidiAgent/`).
2. **Native provider patch, not a Ron subclass**: Live protocol fields that the clone does not map
   (`interaction_status`, `tool_call_cancellation`, grounding metadata, realtime text/video/VAD
   input, NON_BLOCKING declarations, bare-empty-schema omission) are implemented inside
   `strands.bidi` (`models/google.py`, `types/media.py`, `types/content.py`, `types/agent.py`)
   via the patch. `_AgentLoop` and `BidiAgent` lifecycle are unchanged; new `TypedEvent`s flow
   through `agent.receive()` verbatim.
3. Ron imports `strands.bidi.*` (never the `strands.experimental.bidi` shim).

## SDK boundary contract — IMPLEMENTED in `deploy/strands-bidi.patch` (offline-verified)

Status 2026-10-02 01:30 UTC: the patch applies to the pinned clone; `bidi/agent/loop.py` is not
touched. Both live smokes are **accepted** (regular 7.93 s; extended 58.82 s with one harmless delayed
tool, speech during the tool, explicit final idle). Final schema rule: omit `parameters_json_schema`
only for a bare empty object. Reviewer fixes H1 (close transcripts every turn even while the response
stop is deferred), H2 (barge-in / `waiting_for_input` close a deferred response) and H3 (revert handle
clearing to upstream retain-last-good) are on disk with passing tests; the exported patch file is being
regenerated to include them. Per-row VERIFIED / SMOKE / NOT IMPLEMENTED labels live in
`capability-matrix.md` §3. Not all native Live features are implemented.

Input (`BidiAgent.send`, gated, not recorded, Google only):

| Call | Wire | Semantics |
|---|---|---|
| `RealtimeInput(text=str)` / `{"realtime_input": {"text": ...}}` | `send_realtime_input(text=)` | concurrent stream, no ordering guarantee, may elicit a reply; not ephemeral |
| `RealtimeInput(video=ImageContent)` | `send_realtime_input(video=Blob(image/<fmt>))` | one frame; max 1 fps per Google |
| `RealtimeInput(audio_stream_end=True)` | `send_realtime_input(audio_stream_end=True)` | hybrid-VAD finalize (auto VAD only) |
| `RealtimeInput(activity="start"\|"end")` | `activity_start`/`activity_end` | manual VAD only |
| `"text"` / `TextBlock` / `ImageBlock` (unchanged) | `send_client_content(turn_complete=True)` | **always interrupts**, recorded in history |
| `{"audio_delta": ...}` (unchanged) | `send_realtime_input(audio=)` | — |

Output (new events, lower-case values):

- `{"type":"bidi_interaction_status","status":"in_progress"|"idle"|"requires_action"|"unspecified","turn_complete":bool,"turn_complete_reason":str|null,"waiting_for_input":bool|null}`
- `{"type":"bidi_tool_cancel","tool_use_ids":[...]}` — provider drops those function responses.
- `{"type":"bidi_grounding","web_search_queries":[],"chunks":[{title,uri,domain}],"supports":[{text,chunk_indices}],"url_metadata":[{url,status}]}`
- `bidi_response_stop` for extended-thinking is deferred while `turn_complete` arrives with
  `IN_PROGRESS` and closes on `IDLE`.

Declarations: `behavior=NON_BLOCKING` + `parameters_json_schema` when `"gemini-3.8-live"` is in the
model id (`_NON_BLOCKING_MODEL_MARKER`); other Gemini ids keep `behavior=None`. No `scheduling`,
`will_continue`, `enable_affective_dialog`, `proactivity`; `thinking_config` only via `params` for the
extended model. Schema rule (final, tested): omit `parameters_json_schema` only for a bare empty object; forward `additionalProperties`/`$ref`/`oneOf`/`required`-only/non-object schemas unchanged.

Provider-executed tools: `GoogleGeminiLiveModel(hosted_tools=[{"google_search": {}}])` appends to the
setup `tools` list (verified); `params["tools"]` replaces the whole list.

Not implemented (do not describe as done): `interim_input_transcription`, transcription language /
diarization / SMART-mode metadata as typed options or events, typed `include_thoughts`,
function-response `scheduling`, `speech_state`. These remain `params` pass-through where Google
accepts them in setup.

Out of scope: Gemini 3.8 TTS (`gemini-3.8-flash-tts`, `gemini-3.8-flash-lite-tts`) is documented in
`capability-matrix.md` §5 for reference only; no read-aloud/TTS pipeline is planned (user decision).
Vertex AI: extended-thinking support verified on Developer API docs only; Vertex unverified.

## Ordered work (Ron-side; SDK patch owned by the native-protocol peer)

Progress snapshot 2026-10-02 (01:10 UTC, unchanged since) (root/backend-owned code; this list is the original plan,
not a completion claim): `RonLiveModel` removed; `build_live_model(model_id, voice=, effort=)` sets
`thinking_config` only for extended; `core/bidi_runtime.py` validates `/bidi` settings;
`create_bidi_agent(..., seed_messages=)` seeds text-only USER/assistant history (not system prompt);
`teaching_observe.py` streams frames via `{"realtime_input": {"video": …}}` and `audio_stream_end`;
`agent/tests/test_bidi*.py` holds 45 tests. Live extended-thinking acceptance is still pending.
Authoritative runtime contract: `docs/panel-runtime.md` (root-owned, not edited here).

1. `agent/api/core/bidi_agent.py`: delete `RonLiveModel`; build `GoogleGeminiLiveModel(model_id,
   client_args, voice=, params=)` with `params["thinking_config"]={"thinking_level": low|medium|high}`
   only for `gemini-3.8-live-extended-thinking`; reject `thinking_level` for `gemini-3.8-live`.
2. `agent/api/endpoints/bidi.py`: query `model`, `voice`, `thinking_level`; validate against
   `voice-settings.ts` lists server-side; forward `bidi_interaction_status`, `bidi_tool_cancel`,
   `bidi_grounding` to the client; `video_start` frames → `agent.send({"realtime_input": {"video": …}})`;
   `{type:'context'}` frame → `RealtimeInput(text=)` or a user turn — label as "shared as context",
   never "non-interrupting"; error frames carry `code`.
3. Continuity: `BidiAgent(session_manager=SnapshotSessionManager(session_id=<conversation_id>,
   bidi_agent_save_latest_on="stop"), messages=<text-only seed>)`; the seed is replayed once by
   `history_config.initial_history_in_client_content` at `start()`. Separate native sessions for
   chat and Live remain; no tool replay.
4. `agent/api/endpoints/teaching_observe.py`: remove `tool_executor=` kwarg (ctor has none);
   frames → `RealtimeInput(video=…)`; remove the every-5-frames text checkpoint (each is an
   interrupting turn); stop waiting for a non-existent `bidi_error` event (errors surface as
   exceptions from `receive()`); gate `finish` on `bidi_interaction_status: idle` and empty
   `pending_tools`; `record_step`/`finish_observation` declarations become NON_BLOCKING via the
   patch automatically.
5. Renderer (`VoiceAgent.tsx`, `VoiceSettings.tsx`, `TeachSkill.tsx`): send `voice`/`thinking_level`/
   `model` params; UI idle on `bidi_interaction_status: idle`, "thinking" on `in_progress`; honour
   `bidi_tool_cancel` by marking pending tool rows cancelled; drop `bidi_error`/`bidi_interruption`
   handlers in favour of `error` and `bidi_barge_in`.
6. Docs: `AGENTS.md` Voice/Gemini Live bullet and `docs/skill-teaching.md` to reflect the editable
   install, `strands.bidi` imports, `RealtimeInput`, and the interaction-status lifecycle.

## Critical tests (offline; mock `genai.Client`)

SDK (clone `tests/strands/bidi/models/test_google.py`, needs `moto` from the root conftest):
- a. extended/regular 3.8 declarations all carry `behavior=NON_BLOCKING` and `parameters_json_schema`
  (with `additionalProperties` preserved); non-3.8 Gemini ids unchanged.
- b. `server_content(turn_complete=True, interaction_status=IN_PROGRESS)` → `bidi_interaction_status`
  `in_progress`, no `bidi_response_stop`; following `IDLE` closes the response. Absent field → legacy
  bracketing identical to existing tests.
- c. `tool_call_cancellation{ids}` → `bidi_tool_cancel`; subsequent tool results for those ids are not
  passed to `send_tool_response`.
- d. `session_resumption_update(resumable=False)` keeps the last good handle (upstream semantics; corrected per reviewer H3); only `resumable and new_handle` updates it; a refused handle makes `restart()` start fresh.
- e. `RealtimeInput` variants map to the exact `send_realtime_input` kwargs; zero/multiple fields raise;
  not recorded in `agent.messages`; OpenAI/Bedrock raise `ValueError`.
- f. `send("text")` still `send_client_content(turn_complete=True)`.

Ron (`agent/tests`):
- g. `build_live_model`: `thinking_config` absent for `gemini-3.8-live`, `{low,medium,high}` only for
  extended; `voice` reaches `speech_config`; no `proactivity`/`enable_affective_dialog`.
- h. `BidiAgent(...)` construction smoke with the real clone (catches `tool_executor` regressions).
- i. `test_bidi_video`: frame delivery uses `RealtimeInput(video)` and never `ImageBlock` user turns
  (replace the `RonLiveModel` import); bound the ffmpeg test with a timeout.
- j. `/bidi` rejects `thinking_level` for `gemini-3.8-live` and unknown voices with a coded error.
- k. teaching observe: finish gating on `idle`; no text checkpoints sent per frame.

## Explicit non-promises

- No non-interrupting / ephemeral mid-session context injection exists in the Live API.
- No live reconfiguration of thinking level, voice, tools, or system prompt on an open session.
- `scheduling`, affective dialog, `proactive_audio=false`, `MINIMAL` thinking, code execution,
  URL context: unsupported on the 3.8 Live models.
- Tool cancellation does not undo host side effects; results are dropped only at the provider boundary.
