# Projects database

## Account-free use (corrected)

Sign-in is **not required** for Projects or issue Ron. The app opens directly
without an account. Optional sign-in is available at `#signin` and retains the
existing Supabase/RLS workspace; it does not merge guest records into an account.

Signed-out browsers generate and retain a random 256-bit workspace capability
in local storage (`ron-project-workspace-v1`). Requests send it only in the
`X-Ron-Workspace` header. The backend stores only its SHA-256 digest and isolates
every row by that digest. A missing/invalid credential fails closed; invalid
account JWTs never fall back to guest access. No shared guest account, public
database policy, service-role key, or Supabase anonymous-sign-in setting is used.

Guest projects, issues, activity, native Strands snapshots, A2A tasks and run
history persist in the API host's SQLite database, defaulting to
`.sessions/projects.sqlite3` (`PROJECTS_GUEST_DB` overrides the path).
Use persistent storage and one API writer. With the SSH-tunneled backend this
file lives on the VPS, not the Mac. Deploy the updated backend as well as the
renderer; an older backend will reject guest requests.

The capability is a secret: do not log or share it. Clearing browser storage
loses access to that guest workspace; there is no account recovery or automatic
cross-device synchronization. Logging into an existing account switches to a
separate workspace, and logging out returns to the retained guest workspace.
Back up the SQLite database and browser profile as appropriate. Keep the API
behind the existing loopback/SSH boundary; guest provisioning is not a public,
rate-limited internet service. Guest conversations use the same native runtime,
scoped tools, version checks, cancellation and no-replay recovery as accounts.

## Development target

### Local API and VPS tunnel must not share a port

The September 22 creation failure was a split backend: the local API held
`0.0.0.0:8765` while SSH held loopback `8765`. The page's selected project existed
in the Mac SQLite database, but writes reached the VPS database. Neither database
should be reset or merged to resolve this.

`npm run electron:dev` starts one local API and sets `VITE_API_BASE_URL` so Projects,
issue Ron, chat, and live all use the same origin (8765 when free, 8766 when the
SSH tunnel holds 8765). Clear a stale `ron-project-api-url-v1` pin if it no longer
matches that origin. The local API is a development process, not a launchd-managed service.

### Issue Ron editing and deliverables

Description Ask Ron and the Ron pane use the same persisted issue-agent identity,
native snapshot, A2A runtime and run journal. Description output is progressively
read from the durable journal (200ms polling), escaped into an editable draft and
saved only after review. Switching tabs keeps both panes mounted. Concurrent
saved edits still require version-conflict review; no uncertain write is replayed.

New Perplexity issue agents use `xai/grok-4.6` (verified in the live catalogue),
overridable with `ISSUE_AGENT_MODEL`. Existing agents retain their pinned model.
Provider-supported hosted tools are enabled. Scoped native tools include
`edit_issue`, `read_issue_context`, `create_child`, `link_issue` and
`save_work_product`; native tool activity persists in issue-agent blob storage.
Deliverable text and source/image references persist in `work_products`; external
image bytes are not mirrored, and expiring image URLs are not durable binary storage.

`/goal <criteria>` installs the SDK GoalLoop with a separate judge model and
persists its final verdict and revision attempts. There is no attempt/time cutoff;
use Stop to cancel. The description editor's `/goal` command focuses the same
issue-scoped composer, not the legacy global chat endpoint.

- Supabase project: **RonBrowser** (`goyzjhwgstvmgaykmnwi`)
- Organization: **ImRonAI's Org**
- Region: `us-east-2`
- URL: `https://goyzjhwgstvmgaykmnwi.supabase.co`
- Dashboard: https://supabase.com/dashboard/project/goyzjhwgstvmgaykmnwi
- Created September 21, 2026; provisioning quote: $0/month.

All remote database management must use Supabase MCP. Migrations 001–010
were applied through MCP. The inactive older project was not modified.

The ignored root `.env` supplies `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY` (a modern publishable key), and `SUPABASE_URL`.
The Projects backend falls back to `VITE_SUPABASE_ANON_KEY` when
`SUPABASE_ANON_KEY` is unset. No service-role credential is required.
Restart the backend and Electron/Vite processes to load changed settings.

This is a fresh database: previous accounts, sessions, and data were not
imported. For optional account-backed access, sign up against the new project; existing project sessions do not
authenticate here. OAuth providers and production email delivery still need
separate configuration if required.

## Verified foundation

The live MCP transaction smoke test exercised owner/member/outsider RLS,
project creation with RETURNING, sequential issue numbering, issue version
conflicts, trigger-generated audit records, audit forgery rejection, direct
counter-tampering rejection, orphan-subtask rejection, and rejection of
cross-project links without access to both endpoints. All fixtures were
rolled back. This is not a concurrency or end-to-end UI test.

Migration 008 fixes INSERT RETURNING visibility and removes anonymous
execution grants inherited from Supabase default privileges. Authenticated
execution of `can_access_project`, `owns_project`, `lock_project_configuration`,
and `next_project_issue_number` is intentional. The deployed definitions were
reviewed on September 21: access helpers bind checks to `auth.uid()`, the lock
and counter functions require project access, and the enabled project trigger
rejects direct counter changes outside nested trigger execution. Their search
path is pinned to `public`; neither `authenticated` nor `anon` can create in
that schema. These grants remain advisor warnings, not a clean security audit.

## Authenticated frontend persistence

Account-backed Projects routes load through the authenticated FastAPI API. Renderer state is
memory-only; the previous shared `projects-storage` cache is removed, not
imported. Account changes clear rows immediately and invalidate pending
responses. Collection reads use pagination and rely on the caller's RLS,
not an owner-only frontend filter. Project navigation uses UUIDs to avoid
collisions between owner-scoped project keys.

Mutations are serialized, awaited, and retain server-returned IDs, issue
numbers, and versions. No write is automatically retried. Failed saves leave
confirmed state unchanged and show an error; creation/reparent dialogs stay
open. Reload before retrying ambiguous connection failures or conflicts.
Activity is the latest 200 server audit records, refreshed on reload; the
frontend no longer manufactures audit entries. Assignees are limited, on purpose, to the signed-in user and Ron (the agent,
fixed id `004d28ef-3a52-540d-96ea-ff0627040b8e`); the API rejects anyone else
with 422. Guest workspaces can assign only Ron. A member directory comes later.

Reproducible offline checks (from the repository root):

```bash
node --experimental-strip-types --test src/stores/projects-state.test.ts
./venv/bin/python -m pytest agent/tests/test_projects_api.py -q
```

These cover transport/session isolation, failed writes, version conflicts,
pagination, field whitelisting and API contracts. They do not establish live
RLS, concurrent database behavior, or Electron UI acceptance.

## Canonical issue workspace

Projects use the rich task modal with canonical issue panes and metadata.
Drafts retain their editing-base version across tab changes and failed saves.
A successful server refresh is required before explicit draft rebase; rebase
preserves remote-only changes. Child creation retains the parent/project
binding. Relationships, configurable hierarchy/custom fields, and an issue
calendar are implemented. Boolean fields distinguish unset from `false`.
Legacy tasks are not imported, matched by title, or written alongside issues.

## Persistent task Ron

The canonical issue's Ron tab uses workspace-scoped Projects endpoints, never
the unrestricted legacy Ron pane or the unauthenticated general `/chat` API:

- `GET /projects/issues/{issue_id}/agent?offset=0`: private conversation, newest
  50 runs, provider availability; older pages can be loaded from the pane.
- `POST /projects/issues/{issue_id}/agent/messages`: starts a server-owned run
  and returns HTTP 202 after the database claim succeeds.
- `POST /projects/issues/{issue_id}/agent/cancel`: requests native cancellation.

Migration 009 adds `issue_agents`, `issue_agent_runs`, and `issue_agent_blobs`.
RLS requires both the conversation owner and current access to the canonical
issue. Project membership alone does not reveal another member's conversation.
Migration 010 prevents rebinding a conversation's issue, account, or model.
One durable agent identity exists per user/issue pair, pinned to the provider
and model selected on its first run. A partial unique index prevents overlapping
active runs. No user JWT or provider credential is stored in conversation rows.

`IssueAgentRuntime` composes native `config_to_agent`, `SnapshotSessionManager`,
`A2AServer`, `StrandsA2AExecutor`, and the native A2A request handler. The inner
A2A server is not exposed over HTTP: only the verified Projects gateway can
choose the context or issue. Native snapshots and native A2A Task objects use
the database byte-storage adapter; SDK execution and snapshot serialization are
not reimplemented. Between turns, live agent resources are released and the next
invocation restores the native snapshot. This storage is durable regardless of
the general panel's `PANEL_STORAGE` setting.

The task capability policy is deliberately narrow and enforced in code:

- Read this issue; edit its content with optimistic version checks; save work
  products; create backlog children bound to this issue/project.
- No status changes or autonomous completion, assignee/hierarchy mutation,
  cross-task reads, shell, browser, HTTP/MCP, dynamic tool catalogue, delegation,
  shared panel memory, or provider-hosted tools. These are not prompt-only rules.
- Account database operations use the initiating user's JWT and RLS, never a
  service-role key. Authenticated polling refreshes the active run's credentials.
  Without a refreshed JWT, token expiration fails closed.

The pane polls saved application run records (one second while active, five
seconds while idle); it does not mix native A2A events into panel SSE. Closing
or switching tabs does not cancel work. Draft text and failed-send retry gates
survive tab changes. An explicit successful refresh is required after an
ambiguous send; no write is automatically retried. Unsaved issue edits block new
runs; the reload-issue action preserves existing local drafts/version conflicts.

**Run one API writer process**, as with the panel runtime. Orphaned `running`
records are marked `interrupted` on the next authorized access, not replayed:
tools may already have produced side effects. Review issue state before a new
run. Snapshot and journal persistence failures never report successful execution.
The manager caps concurrent task runs at eight. Shared conversations, delegated
agents, external A2A federation, communications, and attachment storage are not
enabled by this implementation.

## Validation — September 21, 2026

Fresh visible results during the account-free correction:

- Workspace, store, issue utility/draft, and panel-stream tests: **56 passed**.
- Final full backend suite: **347 passed**, including seven guest-workspace tests.
- Typecheck, production build, and whitespace checks passed.
- Real SQLite + ASGI tests verified no-login creation, disk persistence across
  app instances, workspace isolation, stale-write rejection, private file mode,
  native A2A completion and native snapshot restoration after runtime restart.
  The model is an offline test model, not a paid live provider.
- Guest cancellation, overlapping-run rejection and interrupted-run recovery
  passed against the real SQLite adapter with the native runtime.
- A fresh browser profile opened the production renderer directly to Home,
  with a persisted workspace capability and no password prompt or browser errors.
  This was a browser preview, not a deployed Electron/VPS end-to-end test.
- The synthetic browser regression passed start/stop, remount, task/account
  isolation, retained drafts, failed-refresh gating, pending composer protection,
  unsaved-edit protection and mobile overflow checks.

Earlier live-provider, Electron, and complete remote security-audit claims were
not reverified during this correction and are not acceptance evidence for it.
The existing SSH listener on port 8765 was left untouched. These checks do not
claim that the updated backend has been deployed to the VPS.

`IssueRonPane` and its synthetic harness (`tests/issue-ron/fixture.tsx`,
`check.sh`) were removed on 2026-11-07: the issue workspace's Ron tab is now
`IssueRonChat`, a panel-runtime chat on `destination="issue"` (see AGENTS.md,
*Issue chat destination*), verified in the running app. The remaining synthetic
harness covers the description's Ask Ron with fake auth and in-memory HTTP
responses. Run in separate terminals from the root:

```bash
node tests/issue-ron/server.mjs
bash tests/issue-ron/description-check.sh
```

It requires the `agent-browser` CLI and Chromium, uses loopback port 5188, and
closes its browser session on exit. Stop the harness server after the check.

Supabase security advisors were not rerun during the no-login correction.
See [SECURITY DEFINER grant guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

Run the application from `/Users/tims-stuff/RonBrowserRebuild` with
`npm run dev:vite` when the SSH tunnel already owns port 8765. For an entirely
local backend, use `npm run electron:dev` only when that tunnel is down.
Open Projects without signing in, create an issue, and select **Ron**.
Provider credentials must be configured on the backend; no extra task-agent
feature flag is required.