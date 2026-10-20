# Repairing a Broken Tool

## Overview

Repair one tool that keeps failing for one user, producing a user-scoped, sandbox-verified revision that the user can activate. Use this SOP when Ron's panel has proposed a repair after repeated identical failures of a tool and the user has accepted. The shared tool library, Ron's wrapper code and installed packages are never edited; the repair is a revision stored for this user only, and the user decides whether it is activated.

## Parameters

- **tool_name** (required): The registered name of the failing tool.
- **target_kind** (required): Where the tool lives. One of `library` (a vendored file under `/sources/tools`), `mcp` (a browser/MCP server tool), `core` (an installed host tool under `/sources/strands_tools`), `other` (a plugin or agent tool without a source file).
- **outcome** (required): The redacted recorded failure: tool name, argument keys and types, exception class and message, status, duration, provenance (`implementation`, `wrapped`, `source`).
- **failing_request** (required): The exact recorded tool input that failed. It belongs to this user and MUST stay inside this run.
- **context_examples** (required): Up to four other inputs of the same tool from this user's session, most recent first. Fewer than four means the remainder MUST be synthesized from `tool_spec`.
- **tool_spec** (required): The tool's registered name and input schema.
- **sandbox** (required): `docker` when your `shell`, `read`, `write` and `edit` run in an isolated container, or `local` when they run on the API host (then use the absolute paths given in the location line and write only inside the workspace).
- **error_text** (optional): The exception text or tool error content as the originating agent saw it.
- **user_request_at_failure** (optional): What the user had asked for when the tool failed; it tells you which behaviour matters.
- **browser_target_at_failure** (optional): `user` or `cloud`. The container cannot reach either; a live-browser demonstration is a dry run.
- **source_path** (optional): The file under repair, relative to `/sources/tools` (library) or `/sources/strands_tools` (core).
- **base_sha256** (optional): The sha256 of that file when the repair started; activation refuses a revision whose base file has changed.
- **diagnosis** (optional): The strands_evals `DiagnosisResult` (failures, root causes, `fix_type`) when observation spans were retained.

**Constraints for parameter acquisition:**
- You MUST read every parameter from the user input block before acting because the values define the exact failure you are repairing.
- You MUST NOT ask the user questions because this SOP runs unattended; when a value is genuinely missing you MUST record the gap in `summary` and continue with the best evidence available.

## Steps

### 1. Confirm reproduction

Read the source under repair and the recorded outcome, then reproduce the recorded exception with the exact `failing_request` input against the unmodified source.

**Constraints:**
- You MUST read `/sources/tools/<source_path>` (or the equivalent under `/sources/strands_tools` or `/sources/mcp`) with `read` before any other action.
- You MUST reproduce the failure by running the tool function with the exact `failing_request` input using `shell` (install missing dependencies with `pip install` first) because a fix for a failure you have not observed is a guess.
- If the recorded exception does NOT reproduce, you MUST call `submit_repair` with `status="not_reproducible"` and stop, because editing code that is not demonstrably broken risks introducing a regression.
- You MUST NOT execute side-effecting calls (shell on the host, editor, environment, mcp_client, non-GET http_request, browser tools) for real because they change the outside world; construct the call and assert its payload instead.

### 2. Wrapper audit

Determine whether the defect is in the tool or in one of Ron's wrapper layers around it.

**Constraints:**
- You MUST reproduce the failure twice: once calling the tool function directly, and once through the recorded `implementation` / `wrapped` chain (`_AdaptedTool` in `/sources/core/tool_repair.py` is the only tool wrapper; `_MCPToolView`, `_OwnedPanelCatalog` in `/sources/core/panel_agent.py`; the hooks `MCPConnectionGuard`, `ThinkToolsGuard`, `BrowserAvailabilityHook`, `ToolObservation`).
- If ONLY the wrapped call fails, you MUST set `fix_type="WRAPPER_FIX"`; when the wrapper is Ron's core code you MUST submit `status="needs_maintainer"` with the patch as `diff` and a test under `/workspace/tests/`, because `/sources/core` is shared code that no per-user revision can replace.
- You MUST NOT re-wrap the tool to hide a wrapper defect because that would stack a second layer on a broken one and make the next failure harder to diagnose.
- You MUST record `wrapper_audit` as `{direct_call, wrapped_call, conclusion}`.

### 3. Reflection checklist

Answer each question explicitly; the answers are stored as `reflection`, keyed `"1"` through `"7"`.

1. Is the failure in the tool, a Ron wrapper, the provider's argument shape (see `/sources/core/perplexity_model.py` argument recovery), or the environment (missing dependency, credential, network)?
2. Does the recorded exception reproduce with the exact recorded input?
3. Is the fix a code change (`OTHERS`), a `TOOL_DESCRIPTION_FIX` (schema or docstring so the model stops mis-calling the tool), or a `SYSTEM_PROMPT_FIX` (provider prompt, maintainer-only)?
4. Does the change alter any external side effect?
5. Does the repaired tool still satisfy its original signature and `TOOL_SPEC` (same name, no new required parameters)?
6. What is the smallest diff?
7. Would a user without this failure be affected?

**Constraints:**
- You MUST answer all seven questions before editing anything because the answers select the repair kind and the verification rules.
- The answer to question 7 MUST be "no" because the revision is scoped to this user; if it cannot be "no" you MUST submit `status="needs_maintainer"`.
- If question 4 is "yes", every demonstration in step 6 MUST be a dry run.

### 4. Choose the repair kind and apply the smallest diff

Select `repair_kind` from `target_kind` and make the change only in `/workspace`.

- `library` → `file`: edit the copy at `/workspace/files/<source_path>`.
- `mcp` → `server` (edit the copied server package at `/workspace/server/electron_playwright_mcp/`, which this user's browser server process will run) or `adapter` when the defect is at the call boundary.
- `core` and `other` → `adapter`: write `/workspace/adapter/<tool_name>.py` defining `transform_input(input) -> dict` and/or `transform_result(result, input) -> dict`.

**Constraints:**
- You MUST write only under `/workspace` because `/sources/*` are read-only snapshots of shared code.
- You MUST use `edit` for a file change so the diff stays minimal, and `write` only for new files.
- You MUST NOT change the tool's name, remove parameters, add required parameters, or import packages the file does not already use, because the registered schema and the installed environment are fixed.
- An adapter module MUST be a plain module with no network, filesystem or subprocess access because it runs inside the user's live agent process.
- You MUST record the unified diff as `diff`.

### 5. Tests

Write and run a pytest file covering the failing request and the four context examples against the repaired code.

**Constraints:**
- You MUST write `/workspace/tests/test_<tool_name>.py` and run it with `shell` (`cd /workspace && python -m pytest -q tests`), because a green claim without a run is not evidence.
- You MUST include the pytest output in your reasoning before continuing.
- If pytest fails you MUST fix the revision and re-run; you MUST NOT submit `verified` with a failing test.

### 6. Five demonstrations in the sandbox

Execute the exact failing request plus four context examples on the repaired revision and record each one.

**Constraints:**
- You MUST run exactly five demonstrations: one `kind="failing"` and four `kind="context"`.
- When fewer than four context examples came from the session you MUST synthesize the remainder from `tool_spec` and label them `source="synthetic"`.
- Side-effecting demonstrations MUST be `dry_run=true` and assert the constructed call or payload instead of executing it.
- For MCP tools you MUST NOT contact the browser or any MCP server from the sandbox because the sandbox has no browser; unit-test the adapter or server logic directly and record live-server demonstrations as dry runs.
- You MUST call `record_demonstration` once per demonstration with `kind`, the exact `input`, `expected`, `actual`, `status`, `dry_run` and `source`.
- If `sandbox` is `local`, you MUST submit `status="unverified"` because no isolation was available to verify safely.

### 7. Submit

Call `submit_repair` exactly once with the complete result.

**Constraints:**
- You MUST pass `status`, `fix_type`, `repair_kind`, a one-paragraph `summary` the user will read, `reflection`, `wrapper_audit`, `diff` and `test_file`.
- `verified` MUST only be used when the failing demonstration and all four context demonstrations passed, pytest is green and `sandbox` is `docker`.
- You MUST state uncertainty plainly in `summary`.
- You MUST NOT activate anything because activation is the user's decision in Ron's panel.
- You MUST NOT touch another user's data, memories or sessions because repairs are tenant-scoped.

## Examples

### Example user input

```
tool_name: calculator
target_kind: library
source_path: multimodal/calculator.py
outcome: {"tool_name": "calculator", "exception": "ValueError: Evaluation error: 'scale'", "arg_types": {"expression": "str"}}
failing_request: {"expression": "2 + 2"}
context_examples: [{"input": {"expression": "sqrt(16)"}, "source": "session"}]
sandbox: docker
```

### Example submit_repair call

```
submit_repair(
  status="verified", fix_type="OTHERS", repair_kind="file",
  summary="evaluate_expression indexed `variables['scale']` unconditionally; variables is None for plain expressions. Guarded the lookup. Reproduced with the exact input, five demonstrations pass, pytest green in Docker.",
  reflection={"1": "tool", "2": "yes", "3": "OTHERS", "4": "no", "5": "yes", "6": "one-line guard", "7": "no"},
  wrapper_audit={"direct_call": "ValueError", "wrapped_call": "ValueError", "conclusion": "tool defect"},
  diff="-        _ = variables[\"scale\"]\n+        _ = (variables or {}).get(\"scale\")",
  test_file="tests/test_calculator.py")
```

## Troubleshooting

### The tool imports fail in the sandbox
If `python -c "import ..."` fails, install the missing packages with `pip install` inside the sandbox and set `PYTHONPATH=/sources/tools` (the vendored library uses relative imports under its own package layout; importing the file via `importlib` with the same parent package is acceptable).

### The exception reproduces only through the wrapper
Follow step 2: this is a `WRAPPER_FIX`; do not edit the tool.

### pytest keeps failing
Return to step 4 and reduce the diff; never widen the change to make a test pass.
