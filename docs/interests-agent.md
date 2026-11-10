# Interests agent (the bottom-right orb)

Status: **implemented as the Context Agent** (see AGENTS.md, "Context Agent + the Context widget").
The orb (`src/components/interests/InterestsWidget.tsx`, mounted once in `src/layouts/BrowserLayout.tsx`)
shows the Ron logo and opens the Context panel (Interests, Context, Agents, Ask). The agent runs on
`POST /chat` with `destination="context"` (`agent/api/core/context_agent.py`): it revises the interest
graph from browsing and saved context (`update_interest_graph`), recommends specialists
(`recommend_agent`) and, on approval, builds them with `create_harness`. Context items live in the
user's `context` memory store (`/context/*`) and can be sent to an issue's Context tab
(`issues.context`, migration 020; files in the `issue-attachments` bucket, migration 019). The rest of
this document is the original spec; where it differs, the code and AGENTS.md win.

## Purpose

The orb is the part of Ron Browser that exists to **grow the user's interests**. Everything
else in the browser serves a task the user already has; the orb notices what the user is
becoming interested in, asks when it is close to something valuable, and turns the answers
into action.

## Inputs (what the agent sees)

| Source | Where it lives today | Notes |
|---|---|---|
| Onboarding answers | `useOnboardingStore.answers` → `getDiscoverProfile()` | Read by id via `answerFor`; seed weights from `interestSeeds()` |
| Discover content + interactions | `POST /discover/feed` results; `interestsStore.recordInteraction` | Clicks, dwell, "read in Ron", dismissals |
| Search + browsing history | Electron `persist:default` session (`electron/main.ts` tabs) | Needs a history IPC/HTTP surface; none exists yet. Must stay behind the same `validateIpcSender` guard |
| Open tasks + projects/issues | `agent/api/endpoints/projects.py` (Supabase RLS / guest SQLite) | Agent may update issues and add context to them |
| Agent memory | `panel_storage.py` memory config | Reuse the panel runtime's memory store; do not build a second one |
| Email | not integrated | Later. Needs explicit user consent and its own scope in `config.py` |

## Behaviour

1. **Watch** the inputs and maintain an interest graph (extends `interestsStore` nodes:
   `source: 'onboarding' | 'browsing'` today; add `'discover' | 'agent'`).
2. **Ask at the right moment.** When confidence that something is valuable crosses a
   threshold, queue a short question. Questions surface **on sign-in** (and on orb open),
   one at a time, dismissable, never modal. Reuse the interview shape
   (`InterviewQuestion{id, question, placeholder}`) so answers persist the same way.
3. **Act on answers.** Outputs, in rough priority:
   - create specialised sub-agents / agent tools (Strands `tool_catalog` publishes them at
     the `AfterTools` boundary — see `panel_tools.py`);
   - update project issues and add context to them (`projects.py` routes; respect RLS);
   - recommend articles (Discover `news`/`web` sections) and searches (`/discover/assist/*`);
   - draft emails (once email is wired);
   - find events and opportunities near the user (`/local/place_search`, `/local/pois`
     with `location` from the profile) or in areas the user cares about.

## Boundaries

- The agent runs in the **backend** (`agent/api/core/`), as a `PanelRuntimeManager`-owned
  session with its own `node_path`, streaming the same versioned SSE envelopes. The
  renderer never calls providers directly.
- `BRAVE_SEARCH_API_KEY` and any email/history credentials remain backend-only.
- History and email are high-sensitivity: gate each behind an explicit setting in
  `discoverProfileStore.overrides` (or a sibling store) and default **off**.
- Questions must be answerable in one line; anything longer belongs in the Agent Panel.

## Implementation order

1. `interestsStore` graph extensions + `recordInteraction` from Discover cards.
2. Backend `POST /interests/observe` (batched interaction events) and
   `GET /interests/questions` (pending questions) endpoints; question queue persisted in
   the panel storage backend.
3. Sign-in prompt surface in the orb; answers → `onboardingStore.setAnswer`.
4. Actions: issue context first (lowest risk), then recommendations, then tool creation.
5. History surface (Electron IPC → backend), then email.
