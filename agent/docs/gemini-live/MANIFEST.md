# agent/docs/gemini-live — manifest

Grounding archive for Ron's Gemini Live work (plus documentation-only Gemini 3.8 TTS references).
All `sources/*.md` are **verbatim** copies with a provenance comment at the top; do not edit them —
re-fetch and replace. Live sources retrieved 2026-10-01 (UTC); TTS sources 2026-10-02 (UTC).

## Verification performed on every archived page

- HTTP status 200 and body is the article: each file was checked for login/consent markers
  (`sign in`, `login`, `accounts.google`, `<html`, `<!doctype`, `401`, `unauthori`, `enable javascript`)
  → **0 hits in every file**; each has Markdown headings and the expected Live-API key terms
  (`interaction_status`, `NON_BLOCKING`, `turnComplete`, `send_realtime_input`, `session_resumption`,
  `thinking_level`, `gemini-3.8`). Word/heading/key-term counts are listed below.
- Earlier reports of a 401 login body from ai.google.dev did **not** reproduce for the `.md.txt`
  endpoints on this retrieval; the GitHub `gemini-skills` copies are kept as an independent source.

| File | Source URL | Words | Headings | Key terms |
|---|---|---|---|---|
| `sources/ai-google-dev__live-api__thinking.md` | https://ai.google.dev/gemini-api/docs/live-api/thinking.md.txt | 1805 | 19 | 55 |
| `sources/ai-google-dev__models__gemini-3.8-live-extended-thinking.md` | https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live-extended-thinking.md.txt | 465 | 3 | 11 |
| `sources/ai-google-dev__models__gemini-3.8-live.md` | https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live.md.txt | 439 | 3 | 10 |
| `sources/ai-google-dev__live-api__capabilities.md` | https://ai.google.dev/gemini-api/docs/live-api/capabilities.md.txt | 4681 | 74 | 51 |
| `sources/ai-google-dev__live-api__tools.md` | https://ai.google.dev/gemini-api/docs/live-api/tools.md.txt (tables still reference 3.1/2.5 models; async/scheduling section generic) | 1762 | 16 | 8 |
| `sources/ai-google-dev__live-api__session-management.md` | https://ai.google.dev/gemini-api/docs/live-api/session-management.md.txt | 911 | 14 | 14 |
| `sources/ai-google-dev__api__live-websocket-reference.md` | https://ai.google.dev/api/live.md.txt | 3984 | 41 | 14 |
| `sources/ai-google-dev__live-overview.md` | https://ai.google.dev/gemini-api/docs/live.md.txt | 1268 | 7 | 1 |
| `sources/gemini-skills__gemini-live-api-dev__SKILL.md` | https://github.com/google-gemini/gemini-skills/blob/main/skills/gemini-live-api-dev/SKILL.md @ `6fee1bec…` (2026-09-23) | 1995 | 45 | 20 |
| `sources/gemini-skills__gemini-live-api-dev__migration.md` | …/skills/gemini-live-api-dev/references/migration.md @ `6fee1bec…` | 1007 | 9 | 33 |
| `sources/ai-google-dev__speech-generation.md` (TTS, docs-only) | https://ai.google.dev/gemini-api/docs/speech-generation.md.txt | 6104 | 45 | n/a (TTS terms: `speech_metadata`, `audio/wav`, `audio/l16`, `voices.list`) |
| `sources/ai-google-dev__models__gemini-3.8-flash-tts.md` (TTS, docs-only) | https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-tts.md.txt | 1138 | 5 | n/a |
| `sources/ai-google-dev__models__gemini-3.8-flash-lite-tts.md` (TTS, docs-only) | https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-lite-tts.md.txt | 1038 | 5 | n/a |

TTS pages passed the same login/boilerplate scan. The single regex hit (`speech-generation`,
line ~1230) is the substring "sign in" inside "…upfront in Voice de**sign in**stead of long style…" —
a false positive, not a login page. The two model cards have 0 hits; all three are full articles
with model property tables.

Known internal contradiction in the sources: `SKILL.md` lists `"minimal"` as a thinking level for the
extended model; `migration.md`, `thinking.md`, `capabilities.md` and the model card say `MINIMAL` is
not supported. Treat `MINIMAL` as unsupported.

Not retrieved (Google Cloud / Vertex AI docs): out of scope for this archive. Consequently
`gemini-3.8-live-extended-thinking` is **verified on the Gemini Developer API docs (`GOOGLE_API_KEY`
path); Vertex AI support is unverified** — do not read the missing Cloud page as evidence of no
support.

## Patch status (as of 2026-10-02 01:30 UTC)

`deploy/strands-bidi.patch` is applied by `deploy/prepare-strands.sh` to the pinned clone. Files:
`bidi/agent/agent.py`, `bidi/models/google.py`, `bidi/types/{__init__,agent,content,events,media}.py`,
tests `bidi/agent/test_agent.py`, `bidi/models/test_google.py`, `bidi/models/test_openai.py`,
`bidi/types/test_events.py` (former `test_media.py` merged in; no unexported source/tests).
`bidi/agent/loop.py` is **not** modified (native loop unchanged).

Root-reported results for the final export (not re-run here except as noted): clean GitHub-clone +
patch reconstruction 206 Google + types tests pass; 215 native agent-loop tests pass with 3 optional
Bedrock constructor tests skipped (deps absent); app suite 456, renderer 140 pass (counts drift —
not gates). Live smokes **ACCEPTED**: regular `gemini-3.8-live` 7.93 s; extended-thinking 58.82 s
(exactly one harmless delayed tool, speech during the tool, explicit final idle). Schema fix final:
omit `parameters_json_schema` only for a bare empty object; `additionalProperties`/`$ref`/`oneOf`
preserved (tests). Reviewer fixes **H1/H2/H3 are on disk in the clone** (verified here: 14 targeted
`test_google.py` tests pass, incl. `test_unresumable_update_keeps_last_handle_for_restart`); the
on-disk exported patch file (69,121 B, 18:23 local) predates them and is being regenerated by root.
Treat §3 of `capability-matrix.md` as the per-feature VERIFIED / SMOKE / NOT IMPLEMENTED ledger.

**Correction (2026-10-02, reviewer H3):** earlier revisions of these three derived docs asserted that
`resumable=false` must invalidate/clear the last resumption handle. That was wrong. Per the
WebSocket reference, `resumable=false` means no new resumable handle is available *at that point*
(`newHandle` empty); the official session-management sample updates the stored handle only on
`resumable and new_handle`. The SDK keeps upstream retain-last-good semantics; a refused handle is
dropped by `_try_resume` and `restart()` falls back to a fresh start. Verbatim `sources/` were never
changed.

25 tests added by the patch:
`test_send_realtime_input_streams_without_history`, `test_send_realtime_input_waits_for_send_gate`,
`test_send_realtime_input_preserves_model_value_error`, `test_live_tool_uses_json_schema_and_non_blocking_for_3_8`,
`test_send_realtime_input_streams_without_ending_turn`, `test_send_realtime_video_requires_bytes`,
`test_send_text_message_completes_turn_not_realtime`, `test_interaction_status_emitted_independently_of_response`,
`test_interaction_status_unknown_value_maps_to_unspecified`, `test_turn_complete_reason_forwarded`,
`test_turn_complete_without_status_still_closes_response`, `test_turn_complete_in_progress_defers_response_stop_until_idle`,
`test_delayed_idle_without_turn_complete_closes_deferred_response`, `test_in_progress_without_turn_complete_does_not_defer`,
`test_grounding_metadata_forwarded`, `test_cancelled_tool_results_are_not_sent`, `test_only_cancelled_results_sends_nothing`,
`test_cancelled_ids_survive_restart`, `test_unresumable_update_keeps_last_handle_for_restart` (replaces the withdrawn `…_clears_handle_and_restart_starts_fresh`),
`test_hosted_tools_extend_function_declarations`, `test_hosted_tools_params_override_replaces_whole_list`,
`test_hosted_tools_absent_without_agent_tools`, `test_send_rejects_realtime_input` (OpenAI),
`test_interaction_status_event_defaults`, `test_grounding_event_defaults_to_empty_lists`.

Implemented and verified: typed `RealtimeInput` through the send gate, NON_BLOCKING for 3.8 Live ids,
`bidi_interaction_status` (+ deferred response stop), `bidi_tool_cancel` with result suppression,
`hosted_tools` constructor argument, `bidi_grounding`, bare-empty-schema omission (`test_live_tool_without_parameters_omits_schema`, `test_live_tool_constrained_schema_is_forwarded`), reviewer fixes H1/H2 (`test_filler_transcript_survives_restart_during_deferred_completion`, `test_barge_in_closes_deferred_response_and_next_reply_is_distinct`, `test_barge_in_without_turn_complete_closes_deferred_response_on_next_boundary`). Resumption handle: upstream retain-last-good semantics (H3 correction; no invalidation).
Not implemented: `interim_input_transcription`, transcription language/diarization/SMART metadata,
typed `include_thoughts`, function-response `scheduling`, `speech_state`. TTS: documentation only.

## Derived documents (editable)

| File | Purpose |
|---|---|
| `capability-matrix.md` | §1–4: model-specific constraints for `gemini-3.8-live` vs `gemini-3.8-live-extended-thinking`, WebSocket protocol facts, native `strands.bidi` @563f57d gaps and the `deploy/strands-bidi.patch` ledger (VERIFIED / SMOKE / NOT IMPLEMENTED per row); §5: Gemini 3.8 TTS documentation-only matrix, kept separate from Live |
| `implementation-plan.md` | Agreed architecture (editable clone install, native patch, no `sys.path`, no `RonLiveModel`), implemented SDK boundary contract (offline-verified; extended live acceptance pending), ordered Ron-side work, critical tests, explicit non-promises. TTS is out of implementation scope |

## Strands references used

- Clone `agent/api/core/harness-sdk` @ `563f57d7a387931760a2c3106014cd7c0db4c9bc`
  (`strands-py/src/strands/bidi/{models/google.py,agent/loop.py,agent/agent.py,models/configs.py,models/model.py,types/events.py}`,
  `session/snapshot_session_manager.py`, `tests/strands/bidi/models/test_google.py` — 70 tests).
- Site docs in the git tree (sparse checkout omits them; read with `git show HEAD:site/src/content/docs/user-guide/sdk/bidi/...`):
  `models/google.mdx`, `agent.mdx`, `hooks.mdx`, `session-management.mdx` ("in development", #3968),
  `interrupts.mdx` ("in development", #3981).
- venv `google-genai` 2.24.0 type introspection: `LiveServerMessage`, `LiveServerContent.interaction_status`,
  `FunctionDeclaration.behavior`, `FunctionResponse.scheduling/will_continue`, `AsyncSession.send_realtime_input`
  signature (`media|audio|audio_stream_end|video|text|activity_start|activity_end`).
