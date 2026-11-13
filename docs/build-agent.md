# Build Agent workbench — contract

The Build destination (`ChatRequest.destination="build"`) is Ren's Build Agent: one strands_harness
`create_harness` agent per build session, working in one private project directory per (user, session). The IDE
workbench beside the chat shows that directory's files, a live preview and its git history through the `/build`
routes. Code: `agent/api/core/build_agent.py` (agent + model router), `agent/api/core/build_workspace.py`,
`agent/api/endpoints/build.py`, wiring in `agent/api/endpoints/chat.py` (`_create_runtime_agent` →
`_create_build_agent`).

## Workspace

| | |
|---|---|
| Root | `RON_BUILD_ROOT` (`core/config.py`; default `~/.ron/build`, `~` expanded, symlinks resolved; read per call) |
| Workspace | `<RON_BUILD_ROOT>/<workspace_id>` |
| `workspace_id` | `sha256(f"{user_id}\n{session_id}").hexdigest()[:32]` (32 lowercase hex; reveals neither value) |
| Created | owner-only (`0o700`) by `ensure_workspace` when a Build session's agent is built, or by the first `PUT /build/file`; the read routes never create it |
| Identifiers | `user_id`/`session_id` follow the panel's `Identifier` rule (`^[A-Za-z0-9][A-Za-z0-9_.-]*$`, ≤ 128) and `user_id` defaults to `default`, as on `/chat`, so a workspace is keyed by exactly what `/chat` received |

**Path confinement.** Every path from a request goes through `resolve_workspace_path(root, path)`: NUL bytes,
absolute paths and any `..` segment are rejected, then the path is resolved (`os.path.realpath`) and must stay under
the real workspace root (`os.path.commonpath`), so no symlink at any depth leads out. The tree lists a symlink only
when its target is inside the workspace (and never descends into it); one that leads out or dangles is left out.

## The agent

`chat._create_runtime_agent` routes `destination == "build"` to `_create_build_agent` (before the panel
composition and the tool-repair trigger: `shell`/`editor` here are not catalog tools, so a repaired revision could
never be activated for them). It pops the runtime's `hooks` and `plugins` out of `runtime_options`, builds the model
router and calls `build_agent.create_build_agent`, both offloaded with `asyncio.to_thread`. Every agent construction,
including a stall/overflow respawn, builds a fresh router and guard.

**Model: `ModelRouter`** (native `strands.models.routing`), from `build_model_router(provider, model_id, effort)`:

| Candidate | Model | Effort |
|---|---|---|
| 1 | the session's chosen model (default NIM `z-ai/glm-5.3-flash`) | the picked level; none picked → `max` when the model offers it |
| 2… | GLM 5.3 Flash on every other offered chat provider, in `RON_CHAT_PROVIDERS` order (NIM `z-ai/glm-5.3-flash`, Mistral `zai-glm-5-3-flash`) | the picked level when that candidate offers it, else `max` |
| last | GLM 5.3 on Mistral (`zai-glm-5-3`, `BUILD_LAST_RESORT`), when Mistral is offered | same rule |

All of them report a 1,048,576-token window (`context_windows.py`); the router requires comparable windows because
proactive compression sizes against the first candidate.

**Read bounds.** NIM and Mistral candidates are built with `build_model(..., read_timeout=…)`:
`RON_BUILD_NIM_READ_TIMEOUT` (default **20 s**) and `RON_BUILD_MISTRAL_READ_TIMEOUT` (default **60 s**; `0`
disables either). NIM's `OpenAIModel` gets `client_args.timeout = httpx.Timeout(t, connect=min(10, t))` and
`max_retries = 0` (the openai client's own two retries would repeat a silent call). Mistral's `RonMistralModel` gets
`client_args.timeout_ms` (mistralai's per-operation httpx timeout, streaming reads included; it retries nothing
without `retry_config`). A candidate that accepts the request and then sends nothing fails that call with its
client's timeout error. The agent's native `ModelRetryStrategy(max_attempts=3, initial_delay=2, max_delay=8)` claims
only throttling, so the router (`AfterModelCallEvent`, order `MODEL_ROUTING`) sees the timeout or any other provider
error and continues the same call on the next candidate; a throttled candidate (Mistral's 429
`backend_out_of_capacity`) gets two short retries first.

**Routing strategy: `RecentFailureStrategy`** (NOT NATIVE: the SDK's `RoutingStrategy` protocol,
`models/routing/strategy.py`, wrapping the native `FallbackStrategy`). After a failed call it is `FallbackStrategy`
unchanged. On a new invocation's opening ask it returns the first candidate that has not failed within
`RON_BUILD_MODEL_COOLDOWN` seconds (default **300**); when every candidate has, the one whose failure is oldest. A
candidate that answers after failing is cleared. One instance is shared by every Build router in the API process, so
the memory survives turns, sessions and runtime respawns (it is per process: each API process learns on its own).
The SDK's strategies see only the current invocation's attempts, so without it every turn and every respawn opened
on a dead provider and paid its read bound again.

**Why** (2026-11-11). NVIDIA's hosted `integrate.api.nvidia.com/v1/chat/completions` held requests open with zero
bytes (every model, while `/v1/models` answered). With no client timeout (openai's default is 600 s × 3 attempts) and
no fallback, every Build turn sat silent until the runtime's stall watchdog (`PANEL_RUN_STALL_SECONDS`, 120 s)
cancelled it, respawned twice, then failed the run: about six minutes of nothing. At the same time Mistral's GLM 5.3
Flash answered 429 `backend_out_of_capacity` at `max` and took ~20 s to its first byte, while Mistral's GLM 5.3
answered in under 2 s; hence the 60 s Mistral bound and the GLM 5.3 last resort.

The renderer (`AgentPanel.tsx` `defaultEffort`) preselects **Max** for GLM 5.3 Flash on the Build page, so the
picker shows what the agent runs.

**Agent: `create_harness`** (`build_agent.create_build_agent`), with the choices `create_issue_chat_agent` documents
for a multi-tenant host:

| Option | Value | Why |
|---|---|---|
| `tools` | installed `strands_tools` `shell` and `editor`, `http_request`, the Brave search tools | the names the workbench reads (`src/lib/build-insights.ts`); docs lookups |
| `builtin_tools` | `[]` | the harness `shell`/`read`/`write`/`edit` run in `agent.sandbox`, whose local default is the API's cwd (this repository) |
| `builtin_plugins` | `["todos"]` | `todo_write`, the Plan pane; no `environment` (it reads the API cwd's `AGENTS.md`) |
| `plugins` | the runtime's `ContextInjector`, `BuildWorkspaceGuard(root)`, a `ContextOffloader` on the user's session storage (not with `agentic`), and a `GoalLoop(preserve_context=True)` when a goal is set | |
| context (`context` option) | the panel composition's modes: `auto` = `context_manager=False` + `SummarizingConversationManager(preserve_recent_messages=4, proactive_compression=PANEL_CONTEXT_COMPRESSION_THRESHOLD)` whose summarizer is a separate `Agent` on its own `build_model_router`; `sliding` = `SlidingWindowConversationManager`; `agentic` = the native agentic `ContextManager` | a thread's snapshot stores its conversation manager's state under the class name and the SDK refuses another class ("Invalid conversation manager state."), so these keep every Build thread saved before `build_agent.py` restorable |
| `background_tasks` | off unless the `background` option is on (then `wait_for_completion=True`, `editor` never backgrounded) | |
| `session`, `skills`, `memory`, `mcp_servers`, `interventions`, `caching` | off | the runtime's `ThreadSessionManager` arrives through the agent kwargs; models are pre-built |
| agent kwargs | `agent_id`, `session_manager`, `callback_handler` from the runtime; `retry_strategy`, `tool_executor`, `checkpointing`, `trace_attributes` | |

After construction it adds `ToolObservation`, `ThreadProjection(destination="build")` (guests are never projected)
and the runtime's hooks with `agent.hooks.add_hook`. The Build Agent has no browser tools, memory, workspace
(projects/documents) tools, A2A or specialist tools: it builds software in its workspace.

**`BuildWorkspaceGuard`** (`ron:build-workspace-guard`) is a native `Plugin` registering one `BeforeToolCallEvent`
hook that rewrites the writable `tool_use["input"]` (the `ThinkToolsGuard` pattern; the executor runs
`before_event.tool_use`). It exists because the installed `strands_tools.shell` uses `os.getcwd()` when `work_dir` is
omitted and `strands_tools.editor` only `expanduser`s its `path`.

| Call | Rewrite |
|---|---|
| `shell` without `work_dir` (or `null`/blank) | `work_dir` = the workspace |
| `shell` with a relative `work_dir` | made absolute under the workspace |
| `editor` with a relative `path` | made absolute under the workspace |
| any absolute or `~` path | left as the model chose it (the user may name files outside the workspace) |
| any other tool | untouched |

It recreates the workspace directory if it was removed while the session lived. It is a default, not a sandbox:
`shell`/`editor` run on the host like every core tool.

**Prompt** (`build_agent_prompt`): "You are Ren's Build Agent", naming the absolute workspace path as the project
directory; plan multi-step work with `todo_write` first and keep it updated; inspect before editing; write files with
`editor` inside the workspace; run commands with `shell` (they run there by default); for a quick UI prefer a
self-contained static `index.html` at the root (served live in the preview pane); a dev server binds `127.0.0.1` on a
free port 4100–4999, starts in the background (`nohup … > .ren-dev.log 2>&1 &`) and its URL
`http://127.0.0.1:<port>` is printed on its own line; `git init` before the first write (with a `.gitignore`) and a
conventional commit at each milestone, under the user's own git identity (never another author; a repository-local
`Ren <ren@localhost>` only when git has none); run the project's tests/build and report failures honestly; never touch files
outside the workspace unless the user names them.

## HTTP routes

All under `/build`, all **loopback-only** (router dependency `require_loopback`: 403 unless the client host is
`127.0.0.1`, `::1`, `localhost` or `testclient`). They read and write files on the host: **never add `/build` to the
ngrok allowlist** (`RON_NGROK_ALLOW_PATHS`).

### `GET /build/workspace?user_id&session_id`

```json
{"workspace_id": "…32 hex…", "root": "/abs/path", "exists": true,
 "entries": [{"path": "src", "type": "dir", "size": 0, "modified": 1767225600000},
             {"path": "src/app.js", "type": "file", "size": 120, "modified": 1767225600000}],
 "truncated": false, "ignored": ["node_modules"], "has_index": true,
 "package": {"name": "demo", "version": "1.0.0", "description": null,
             "scripts": {"dev": "vite"}, "dependencies": {}, "devDependencies": {}},
 "env": [{"name": "API_KEY", "file": ".env"}],
 "preview_url": "/build/preview/<workspace_id>/"}
```

- `entries`: the tree in display order — each directory followed by its contents; within a directory,
  sub-directories first, then files, each by name (case-insensitive). `path` is POSIX and relative; `modified` is
  epoch milliseconds; directories report `size: 0`. At most 2000 entries (`truncated: true` when more exist).
- Never descended into (at any depth): `node_modules`, `.git`, `__pycache__`, `.venv`, `venv`, `dist`, `build`,
  `.next`, `.cache`, `.turbo`; `ignored` names the ones met. `.DS_Store` files are not listed.
- `has_index`: a root `index.html` exists. `package`: the root `package.json` (`name`, `version`, `description`,
  `scripts`, `dependencies`, `devDependencies`; non-string values dropped), `null` when absent, invalid or > 1 MiB.
- `env`: variable **names only** from the root `.env*` files (`NAME=` / `export NAME=`, comments skipped, lines of a
  quoted multi-line value never read as names), in file then line order; values never leave the server.
- A workspace that does not exist yet: `exists: false`, empty `entries`, `package: null`, `preview_url: null`.

### `GET /build/file?user_id&session_id&path`

`{path, size, modified, sha256, binary, too_large, content}` — `sha256` covers the whole file; `binary` = a NUL in
the first 8 KiB or bytes that are not UTF-8; `content` is the text only when not binary and ≤ 1 MiB
(`too_large: true` above that), else `null`. 404 when missing; 400 for a directory, a non-regular file or a bad path.

### `PUT /build/file`

Body `{user_id ("default"), session_id, path, content, base_sha256: string | null}`.

- `content` ≤ 2 MiB as UTF-8, else **413**.
- `base_sha256` null/empty = **create only**: 409 if the file exists. Otherwise it must equal the file's current
  sha256 (hex, case-insensitive), else **409** `{"detail": {"message": "…", "sha256": "<current or null>"}}`
  (`null` when the file was deleted meanwhile).
- Atomic: written to a temporary file in the same directory, `fsync`ed, then `os.replace`d; parents are created; an
  overwrite keeps the file's mode, a new file is `0644`. Creates the workspace (`0o700`) if needed.
- Returns `{path, size, modified, sha256}` of the saved file (`path` canonicalised, e.g. `./src//a.js` → `src/a.js`).
- 400 for a bad path, a directory, or a parent that is a file.

### `DELETE /build/file?user_id&session_id&path`

204. Files only (400 for a directory); 404 when missing. A symlink inside the workspace is removed itself, not its
target.

### `GET /build/git?user_id&session_id&limit=30`

`limit` 1–200 (422 outside). `{repo, branch, commits, dirty}`:

- `commits[]`: `{hash, short, author, email, date (ISO 8601, %aI), message (subject), body, files[]}`, newest first;
  `files[]`: `{path, status, additions, deletions, old_path}` — `status` is git's letter (`A`, `M`, `D`, `R`, `C`,
  `T`, …), `old_path` is set for renames/copies, binary files count 0/0; merges and empty commits have no files.
- `dirty[]`: `{path, status}` from `git status --porcelain=v1 -z` (`status` is the two-character `XY` code, e.g.
  `" M"`, `"A "`, `"R "`, `"??"`); untracked directories are collapsed (git's default).
- `branch`: the current branch, `null` when detached. An unborn branch (no commits yet) is `repo: true, commits: []`.
- Not a repository (or no workspace, or git not installed): `{"repo": false, "branch": null, "commits": [],
  "dirty": []}`. A repository *above* the workspace is never reported (`GIT_CEILING_DIRECTORIES` = the build root,
  and the top level must equal the workspace).
- 504 when a git call outlives 10 s (the process is killed).

git runs via `asyncio.create_subprocess_exec` (no shell, stdin closed) with `cwd` = the workspace, the caller's
environment minus `GIT_*` overrides, `GIT_TERMINAL_PROMPT=0` and `GIT_OPTIONAL_LOCKS=0` (a poll never contends with the
agent's own git), and `-c core.fsmonitor=false -c core.quotePath=false -c color.ui=never -c log.showSignature=false`;
`git log` also passes `--no-ext-diff --no-textconv`. History is one call,
`git log -z --format=… --raw --numstat`: `--raw`, not `--name-status`, because git drops `--numstat` output whenever
`--name-status`/`--name-only` is given (verified on git 2.54).

### `GET /build/preview/{workspace_id}/{path}`

Serves a file of that workspace with `FileResponse` (Content-Type from `mimetypes`; `.ts/.tsx/.jsx/.mts/.cts` as
`text/plain`, `.map` as `application/json`; `text/*` gets `charset=utf-8`) and these headers:

```
Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads
X-Content-Type-Options: nosniff
Cache-Control: no-store
Access-Control-Allow-Origin: *
```

- `workspace_id` must be 32 lowercase hex digits; otherwise, or for a missing workspace/file, 404.
- The empty path or a directory serves that directory's `index.html` (404 without one). A directory requested
  without its trailing slash is redirected (307) to `<name>/`, so the page's relative links resolve inside it;
  `/build/preview/<id>` itself redirects to `/build/preview/<id>/`.
- Any dot segment (`.env`, `.git/…`, `.ren-dev.log`) is 404: the preview carries `Access-Control-Allow-Origin: *` (the
  sandboxed page has an opaque origin and needs it to fetch the project's own files), so it never serves those.
- When the request carries an allowed localhost `Origin`, the app's CORS middleware echoes that origin instead of `*`.

## Shells

The installed `shell` tool runs every command in a PTY, so a pager or editor would wait for a keypress until
`SHELL_DEFAULT_TIMEOUT` (900 s). `core/config.py` therefore sets `PAGER=cat`, `GIT_PAGER=cat`, `GIT_EDITOR=true` and
`GIT_TERMINAL_PROMPT=0` for the API process (with the `BYPASS_TOOL_CONSENT` default; `RON_TOOL_CONSENT=prompt` opts
out of both). Before this a Build run sat on `git commit … && git log --oneline` for 15 minutes.

## Renderer: the Build page and its Studio

`src/components/build/index.tsx` (`BuildWorkbenchPage`) hosts the conversation through
`AgentWorkspace destination="build"`. An empty conversation is the hero (`BuildHero.tsx`: headline, composer,
`BuildStarters` chips that fill the composer). From the first message the page splits: the chat column
(`clamp(340px, 38%, 460px)`) and the Studio. Below 760px of page width (measured with `useElementWidth`, not the
window) the two take turns behind a Chat / Studio switch.

`AgentWorkspace`'s `onChat` hands the host the live chat (session, messages, status, `sendMessage`), published only
when one of those changes; `sendMessage`/`newChat` are stable functions that call the latest render's. A host that
stores the chat in state must not get a new function every render, or the two re-render each other until React
stops ("Maximum update depth exceeded", which blanked the app on the Build tab).

`BuildStudio.tsx` has six tabs. The open one is the one the user picked, else the first that has something:
Preview, then Code, Plan, Console.

| Tab | Reads | Built on |
|---|---|---|
| Preview (`studio/PreviewPane.tsx`) | the static `index.html` (`/build/preview/<id>/`) or a dev server Ren printed (`http://127.0.0.1:<4100–4999>`) | AI Elements `WebPreview`; reload, desktop/tablet/mobile widths, open in a tab |
| Code (`studio/CodePane.tsx`) | `/build/workspace` + `/build/file` | AI Elements `FileTree`, CodeMirror (`CodeEditor.tsx`, Ren light/dark themes); ⌘S saves with the file's sha256; a 409 offers Ren's version or yours |
| Console (`studio/ConsolePane.tsx`) | the conversation's `shell` calls (`lib/build-insights.ts`) | AI Elements `Terminal`, `TestResults` when a test runner's summary is in the output |
| Plan (`studio/PlanPane.tsx`) | `todo_write` and file-changing tool calls | AI Elements `Queue`; changed files open in Code |
| Git (`studio/GitPane.tsx`) | `/build/git` (loaded only while open) | AI Elements `Commit`; "Ask Ren to start one" sends a message |
| Project (`studio/ProjectPane.tsx`) | `package.json`, env file names (never values) | AI Elements `Snippet`, `PackageInfo`, `EnvironmentVariables`; Run asks Ren to run a script |

The workspace is re-read when one of Ren's tool calls finishes, every 4 s while it works, and after edits made in the
Studio. A Studio narrower than 680px shows its tabs as icons, with the open tab's name beside its icon. Tests:
`src/lib/build-api.test.ts`, `src/lib/build-insights.test.ts`.

## Tests

`agent/tests/test_build_workspace.py` (real tmp filesystem, real `git`, the real router and app, real Strands
`BeforeToolCallEvent`s and a real agent run of the installed `editor`/`shell` with a scripted model) and
`agent/tests/test_build_agent.py` (candidates and efforts, the NIM/Mistral read bounds, the `create_harness` composition and its context modes, a thread saved by the panel composition restoring into the Build Agent, and a real fail-over: the real `openai` client, `ModelRouter` and harness agent against a local chat-completions server where one model never answers).
`agent/tests/conftest.py` points `RON_BUILD_ROOT` at pytest's temp dir for every test.
