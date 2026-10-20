> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Skills

> Give the agent on-demand domain expertise with built-in, inline, and custom skills.

Skills give the agent domain expertise on demand. The model sees each skill by name and description, and loads the full instructions only when it decides they are needed — a progressive disclosure pattern described in [Designing, Refining, and Maintaining Agent Skills](https://research.perplexity.ai/articles/designing-refining-and-maintaining-agent-skills-at-perplexity).

## Why use skills

* **Specialize.** Add document generation and domain workflows on top of base prompting.
* **Pay context only on use.** Until a skill is loaded, it costs only its name and description.
* **Compose.** Mix built-in skills with inline instructions in one request.
* **Reuse.** Upload a custom skill once and reference it by ID in any request.

## How skills work

You pass a `skills` array on the request. Each entry is a **built-in** selection from the catalog, an **inline** skill you define for the request, or a **custom** skill you created and uploaded to Perplexity.
You can combine up to **16 skills** of any type in one request.

| Stage | What the model sees |
| - | - |
| Discovery | An index of each selected skill's name and description. |
| Load | The model decides when a skill is relevant and calls `load_skill`. The full instructions enter context only then. |
| Files | On load, built-in and custom skills make supporting files available in the sandbox under a directory named for the skill, not its `skill_...` ID. Inline skills have no files. |
| Composition | The model can load any combination of the selected skills as the task requires. |

The description is the routing trigger. Write it to tell the model when to load the skill.

Loading a skill costs a step: the model spends one turn calling `load_skill` and reading the body, and only later turns acting on it.
A direct-model request that omits [`max_steps`](/docs/agent-api/building-agents/define-the-run#customize-the-loop-max-steps) runs a single step, so the model can load a skill but never act on it.
Set `max_steps` high enough for the load plus the actual work.

## Built-in skills

Select a built-in skill with one JSON object: `{ "type": "builtin", "name": "office/pdf" }`.

<Tabs>
  <Tab title="office">
    <Card title="Office">
      Generate PDF, Word, PowerPoint, and Excel documents from scratch, with structural validation and visual QA. Select a specific leaf, or select `office` to grant all four at once and let the model pick the format.
    </Card>

    | Name | Description | Selection |
    | - | - | - |
    | `office` | Umbrella that grants all four leaves below. | `{ "type": "builtin", "name": "office" }` |
    | `office/pdf` | Create PDF documents with page-by-page visual QA. | `{ "type": "builtin", "name": "office/pdf" }` |
    | `office/docx` | Create editable Word documents (OOXML). | `{ "type": "builtin", "name": "office/docx" }` |
    | `office/pptx` | Create PowerPoint presentations with slide-by-slide visual QA. | `{ "type": "builtin", "name": "office/pptx" }` |
    | `office/xlsx` | Create Excel workbooks with verified formulas, charts, and visual QA. | `{ "type": "builtin", "name": "office/xlsx" }` |

    <Note>
      Office skills create documents from scratch. They do not edit files you upload.
    </Note>
  </Tab>
</Tabs>

## Inline skills

Use inline skills for one-off or account-specific guidance the model should load on demand: style guides, playbooks, design systems, house rules.

| Field | Description |
| - | - |
| `type` | Required. Must be `"inline"`. |
| `name` | Required. 1-64 characters; lowercase ASCII letters, digits, and single hyphens. |
| `description` | Required. 1-1,024 bytes. Written as the routing trigger. |
| `instructions` | Required. 1-65,536 bytes. The skill body the model reads on load. |

```json theme={null}
{
  "type": "inline",
  "name": "design-system",
  "description": "Load when creating documents that must follow the house design system.",
  "instructions": "Model: a 1970s letterpress broadsheet financial page. Paper #EDE9DE; body ink #232220; ..."
}
```

Inline skills have no files, no dependencies, no sandbox mounts, no reusable library, and are never echoed back in the response.

### Example: one-off inline skill

Combine `office/pdf` with an inline `design-system` skill to render a house-styled one-page AI-industry stock report.
Use this form while the guidance is request-specific; when it stabilizes, upload it as a [custom skill](#custom-skills) and reference it by ID.

<CodeGroup>
  ```python Python theme={null}
  import time
  from perplexity import Perplexity

  client = Perplexity()

  design_book = """
  Model: a 1970s letterpress broadsheet financial page. One ink, gray paper.

  Colors
  - Paper #EDE9DE; tinted boxes and alternating table rows #E3DFD2.
  - Body ink #232220 — soft, never hard black (ink spread on newsprint).
  - Headlines and rules may deepen to #141311; faded ink #5C5850 for captions and secondary text.
  - No second color anywhere. Up moves: bold with a ▲. Down moves: parentheses with a ▼.

  Typography
  - Body: low-contrast newspaper serif (Georgia, PT Serif, or Times), 9-10pt, justified and hyphenated.
  - Headlines: bold condensed serif with a smaller deck beneath.
  - Kickers and table headers: condensed grotesque caps (Franklin Gothic or Oswald), letterspaced.
  - Tables: agate style — 7-8pt condensed, tabular figures.

  Layout
  - One page, ~18mm margins.
  - Nameplate in blackletter or heavy serif, with a folio line (date, edition, price) set between an Oxford rule (thick over hairline).
  - Ticker summary as a boxed agate strip below the nameplate.
  - News timeline in 3-4 narrow justified columns divided by hairline column rules; each item opens with a bold caps dateline ('LONDON, JULY 17 —').
  - Data table ruled with hairlines only.
  - Pack the page — separate blocks with cutoff rules, not white space.

  Imagery
  - Grayscale halftone only, with a hairline keyline and an italic caption.

  Avoid
  - Second colors, gradients, shadows, rounded corners, sans-serif body text, and generous white space.
  """

  response = client.responses.create(
      preset="xhigh",
      background=True,
      skills=[
          {
              "type": "inline",
              "name": "design-system",
              "description": "Load when creating documents that must follow the house design system.",
              "instructions": design_book,
          },
          {"type": "builtin", "name": "office/pdf"},
      ],
      input=(
          "Create a one-page AI-industry stock report. Include NVDA, MSFT, "
          "GOOGL, AMD, and AVGO with latest price and weekly move. Include "
          "this week's key AI news, labeled by date and tagged to the ticker "
          "it moved. Follow the design-system skill."
      ),
  )

  while response.status in ("queued", "in_progress"):
      time.sleep(2)
      response = client.responses.retrieve(response.id)

  print(response.status)
  ```

  ```typescript Typescript theme={null}
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  const designBook = `
  Model: a 1970s letterpress broadsheet financial page. One ink, gray paper.

  Colors
  - Paper #EDE9DE; tinted boxes and alternating table rows #E3DFD2.
  - Body ink #232220 — soft, never hard black (ink spread on newsprint).
  - Headlines and rules may deepen to #141311; faded ink #5C5850 for captions and secondary text.
  - No second color anywhere. Up moves: bold with a ▲. Down moves: parentheses with a ▼.

  Typography
  - Body: low-contrast newspaper serif (Georgia, PT Serif, or Times), 9-10pt, justified and hyphenated.
  - Headlines: bold condensed serif with a smaller deck beneath.
  - Kickers and table headers: condensed grotesque caps (Franklin Gothic or Oswald), letterspaced.
  - Tables: agate style — 7-8pt condensed, tabular figures.

  Layout
  - One page, ~18mm margins.
  - Nameplate in blackletter or heavy serif, with a folio line (date, edition, price) set between an Oxford rule (thick over hairline).
  - Ticker summary as a boxed agate strip below the nameplate.
  - News timeline in 3-4 narrow justified columns divided by hairline column rules; each item opens with a bold caps dateline ('LONDON, JULY 17 —').
  - Data table ruled with hairlines only.
  - Pack the page — separate blocks with cutoff rules, not white space.

  Imagery
  - Grayscale halftone only, with a hairline keyline and an italic caption.

  Avoid
  - Second colors, gradients, shadows, rounded corners, sans-serif body text, and generous white space.
  `;

  let response = await client.responses.create({
    preset: 'xhigh',
    background: true,
    skills: [
      {
        type: 'inline',
        name: 'design-system',
        description: 'Load when creating documents that must follow the house design system.',
        instructions: designBook,
      },
      { type: 'builtin', name: 'office/pdf' },
    ],
    input:
      'Create a one-page AI-industry stock report. Include NVDA, MSFT, ' +
      'GOOGL, AMD, and AVGO with latest price and weekly move. Include ' +
      'this week\'s key AI news, labeled by date and tagged to the ticker ' +
      'it moved. Follow the design-system skill.',
  });

  while (response.status === 'queued' || response.status === 'in_progress') {
    await new Promise((r) => setTimeout(r, 2000));
    response = await client.responses.retrieve(response.id);
  }

  console.log(response.status);
  ```

  ```bash cURL theme={null}
  curl https://api.perplexity.ai/v1/agent \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "preset": "xhigh",
      "background": true,
      "skills": [
        {
          "type": "inline",
          "name": "design-system",
          "description": "Load when creating documents that must follow the house design system.",
          "instructions": "Model: a 1970s letterpress broadsheet financial page. One ink, gray paper.\nColors: paper #EDE9DE (tinted boxes and alternating table rows #E3DFD2); body ink #232220 (soft, never hard black); headlines and rules may deepen to #141311; faded ink #5C5850 for captions. No second color. Up moves: bold + ▲; down moves: parentheses + ▼.\nTypography: body low-contrast newspaper serif (Georgia, PT Serif, or Times), 9-10pt, justified and hyphenated; headlines bold condensed serif with a smaller deck; kickers and table headers condensed grotesque caps (Franklin Gothic or Oswald), letterspaced; tables agate 7-8pt condensed with tabular figures.\nLayout: one page, ~18mm margins; blackletter or heavy-serif nameplate with a folio line (date, edition, price) between an Oxford rule (thick over hairline); boxed agate ticker strip below; news timeline in 3-4 narrow justified columns with hairline column rules, items opening with bold caps datelines ('LONDON, JULY 17 —'); data table ruled with hairlines only. Pack the page — cutoff rules, not padding.\nImagery: grayscale halftone with hairline keyline and italic caption.\nAvoid: second colors, gradients, shadows, rounded corners, sans body text, generous white space."
        },
        { "type": "builtin", "name": "office/pdf" }
      ],
      "input": "Create a one-page AI-industry stock report. Include NVDA, MSFT, GOOGL, AMD, and AVGO with latest price and weekly move. Include this week'\''s key AI news, labeled by date and tagged to the ticker it moved. Follow the design-system skill."
    }' | jq
  ```
</CodeGroup>

Retrieve file bytes through the files endpoints in [Working with files](/docs/agent-api/working-with-files).

## Custom skills

A custom skill is a skill you create and upload to Perplexity: a versioned bundle of instructions and supporting files, managed in the [API Portal](https://console.perplexity.ai/project/skills) and referenced by ID from any request.
Custom skills use the open [Agent Skills format](https://agentskills.io/specification).

Each custom skill is bound to a single [Project](/docs/getting-started/projects#what-is-a-project) and lives inside it.
The Project owns the skill: any API key in that Project can reference it, and keys from other Projects cannot.
They are built for running the Agent API inside your own harness: the skill carries the procedure and output contract your pipeline expects, versioned independently of your code.

A bundle ships more than text. Alongside the instructions you can include `.py` and `.sh` scripts, and the model runs them in the [Sandbox](/docs/agent-api/tools/sandbox) — so a skill can carry not just *how* to do the work, but the exact code that does it, plus any reference files the model reads on demand.

### Parameters

| Field | Type | Required | Description |
| - | - | - | - |
| `type` | string | Yes | Must be `"custom"`. |
| `id` | string | Yes | The skill ID copied from the API Portal, in the form `skill_...`. |
| `version` | string | No | The version to load, or `"latest"`. Omitted means `"latest"`. |

The skill's name and description come from the stored bundle.

### Create a custom skill bundle

A skill bundle is a ZIP archive with exactly one `SKILL.md`.
For a multi-file bundle, put all files under one shared top-level folder:

```text theme={null}
fact-check/
├── SKILL.md
├── scripts/
│   └── check_factcheck.py
└── references/
    └── verification-rubric.md
```

<Card title="Download the example bundle" icon="download" horizontal="True" href="/docs/assets/skills/fact-check.zip">
  `fact-check.zip` — this exact bundle, ready to upload in the API Portal.
</Card>

`SKILL.md` starts with [YAML frontmatter](https://agentskills.io/specification#frontmatter) that defines how the model discovers the skill, followed by the skill body:

<Accordion title="Example SKILL.md">
  ```markdown theme={null}
  ---
  name: fact-check
  description: Load before answering a question whose answer contains factual claims — dates, numbers, names, prices, or events — to verify them before responding. Do not load for opinions, code, or creative writing.
  ---

  You are the verification gate of an answer pipeline. Verify your own draft
  before it reaches the user.

  Use the `web_search` tool for every lookup. Do not run searches or fetch
  pages from inside the sandbox; reserve the sandbox for writing and validating
  `fact_check.json`.

  1. Draft the answer, then extract every factual claim from it: dates,
     numbers, names, prices, events.
  2. Verify each claim with the `web_search` tool, following
     `references/verification-rubric.md` from this skill's folder.
  3. Correct the draft wherever a claim fails verification.
  4. Write the audit trail to `fact_check.json` with exactly these fields:
     `claims` (list of objects with `claim`, `verdict`, `source_url`) and
     `corrections` (integer).
  5. Run `python scripts/check_factcheck.py fact_check.json` from this
     skill's folder and fix every violation it reports until it passes.
  6. Once the check passes, give the corrected answer.
  ```
</Accordion>

The description doubles as a guard: it also tells the model when **not** to load the skill, which protects the request's step budget.

| Field | Rules |
| - | - |
| `name` | Required. 1-64 characters; lowercase letters, digits, and single hyphens. |
| `description` | Required. 1-1,024 bytes. The routing trigger — write it to tell the model when to load the skill. |

Other [frontmatter](https://agentskills.io/specification#frontmatter) keys are ignored.
Everything after the frontmatter is the skill body, returned to the model when it loads the skill.

A bundle can include any file type: reference documents the model reads on demand, and `.py` or `.sh` scripts it runs in the [Sandbox](/docs/agent-api/tools/sandbox), which has network access and installs packages with `pip`.
Supporting files cost no tokens until the model reads them.
Reference them from the body with relative paths, as in the example above.

### Manage custom skills with the API

Use the `/v1/skills` endpoints to manage custom skills with a Perplexity API key.
The API key determines the [Project](/docs/getting-started/projects), so you can access only skills in that Project.

<Note>
  To manage custom skills without calling the API, use the [Skills page in the API Portal](https://console.perplexity.ai/project/skills) to create, update, download, or delete them.
</Note>

#### Create a skill

Upload the complete bundle as a ZIP archive.
The archive must contain exactly one `SKILL.md`.
For a multi-file bundle, put all files under one shared top-level folder.

```bash theme={null}
curl https://api.perplexity.ai/v1/skills \
  -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
  -F "file=@YOUR_SKILL.zip;type=application/zip" | jq
```

Save the returned skill ID to reference the skill from Agent API requests.

See [Create a skill](/api-reference/skills-create-post) for the complete request and response schema.

#### List skills

List the custom skills in your Project.
Results are ordered from newest to oldest.

```bash theme={null}
curl "https://api.perplexity.ai/v1/skills?limit=50" \
  -H "Authorization: Bearer $PERPLEXITY_API_KEY" | jq
```

See [List skills](/api-reference/skills-list-get) for pagination details.

#### Get a skill

Get the active revision of a skill.

```bash theme={null}
curl "https://api.perplexity.ai/v1/skills/$SKILL_ID" \
  -H "Authorization: Bearer $PERPLEXITY_API_KEY" | jq
```

Add `?revision=$REVISION` to retrieve a specific revision.

See [Get a skill](/api-reference/skills-get) for the complete response schema.

#### Update a skill

Upload the complete new bundle to create a revision.
Set `expected_revision` to the current revision so the update cannot overwrite a concurrent change.

```bash theme={null}
curl -X PUT \
  "https://api.perplexity.ai/v1/skills/$SKILL_ID?expected_revision=$REVISION" \
  -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
  -F "file=@fact-check.zip;type=application/zip" | jq
```

See [Update a skill](/api-reference/skills-update-put) for error responses and limits.

#### List skill revisions

List revisions of a skill.
Results are ordered from newest to oldest.

```bash theme={null}
curl "https://api.perplexity.ai/v1/skills/$SKILL_ID/revisions?limit=50" \
  -H "Authorization: Bearer $PERPLEXITY_API_KEY" | jq
```

See [List skill revisions](/api-reference/skills-revisions-get) for pagination details.

#### Download a skill

Request a short-lived URL for the active bundle.

```bash theme={null}
curl "https://api.perplexity.ai/v1/skills/$SKILL_ID/download" \
  -H "Authorization: Bearer $PERPLEXITY_API_KEY" | jq
```

Add `?revision=$REVISION` to download a specific revision.
See [Download a skill](/api-reference/skills-download-get) for the complete response schema.

#### Delete a skill

Delete a skill and all of its revisions.
Set `expected_revision` to the current revision so the delete cannot race a concurrent update.

```bash theme={null}
curl -X DELETE \
  "https://api.perplexity.ai/v1/skills/$SKILL_ID?expected_revision=$REVISION" \
  -H "Authorization: Bearer $PERPLEXITY_API_KEY"
```

See [Delete a skill](/api-reference/skills-delete) for error responses.

### Use a custom skill

Custom skills are built for running the Agent API inside your own pipeline: the skill carries a procedure the model must follow and a self-check it must pass, versioned independently of your prompts.
The following request asks a factual question and tells the model to verify its own answer with the `fact-check` skill from the bundle above.
Replace `YOUR_SKILL_ID` with the ID you copied from the API Portal.

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()

  response = client.responses.create(
      model="openai/gpt-5.6-terra",
      max_steps=10,
      tools=[{"type": "web_search"}],
      skills=[{"type": "custom", "id": "YOUR_SKILL_ID"}],
      input=(
          "What were NVIDIA's total revenue and data center revenue in its "
          "latest reported quarter? Use the fact-check skill to verify your "
          "answer before responding."
      ),
  )

  print(response.output_text)
  ```

  ```typescript Typescript theme={null}
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  const response = await client.responses.create({
    model: 'openai/gpt-5.6-terra',
    max_steps: 10,
    tools: [{ type: 'web_search' }],
    skills: [{ type: 'custom', id: 'YOUR_SKILL_ID' }],
    input:
      "What were NVIDIA's total revenue and data center revenue in its " +
      'latest reported quarter? Use the fact-check skill to verify your ' +
      'answer before responding.',
  });

  console.log(response.output_text);
  ```

  ```bash cURL theme={null}
  curl https://api.perplexity.ai/v1/agent \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/gpt-5.6-terra",
      "max_steps": 10,
      "tools": [ { "type": "web_search" } ],
      "skills": [
        { "type": "custom", "id": "YOUR_SKILL_ID" }
      ],
      "input": "What were NVIDIAs total revenue and data center revenue in its latest reported quarter? Use the fact-check skill to verify your answer before responding."
    }' | jq
  ```
</CodeGroup>

The model drafts the answer, verifies each claim with web search, corrects what fails, then writes `fact_check.json` and runs the bundled validator in the sandbox — passing that self-check before it answers.

The response `output` array records the loaded skill as a `skill_loaded` item, followed by the sandbox steps the run took — reading the skill's reference file, writing `fact_check.json`, and running the validator — and ends with the assistant `message`:

<Accordion title="Response output (truncated)">
  ```json theme={null}
  [
    { "type": "skill_loaded", "name": "fact-check" },
    {
      "type": "sandbox_read_file",
      "call_id": "call_...",
      "file_path": "/home/user/workspace/skills/fact-check/references/verification-rubric.md",
      "start_line": 1,
      "total_lines": 22,
      "content": "# Verification rubric\n..."
    },
    {
      "type": "sandbox_write_file",
      "call_id": "call_...",
      "file_path": "/home/user/workspace/fact_check.json",
      "size_bytes": 939
    },
    {
      "type": "sandbox_results",
      "call_id": "call_...",
      "container_id": "01a0...",
      "language": "python",
      "code": "python scripts/check_factcheck.py fact_check.json",
      "status": "completed",
      "results": [
        { "status": "completed", "exit_code": 0, "duration_ms": 1023, "stdout": "OK: fact_check.json satisfies the contract.\n", "stderr": "" }
      ]
    },
    {
      "type": "message",
      "id": "msg_...",
      "role": "assistant",
      "status": "completed",
      "content": [
        { "type": "output_text", "text": "NVIDIA's latest reported quarter was Q2 fiscal 2027, ended July 26, 2026 ...", "annotations": [] }
      ]
    }
  ]
  ```
</Accordion>

When streaming, each skill load also emits a `response.skill.loaded` event.
The `skills` array you passed on the request is not echoed back on the response object.

### Versioning

Every custom skill upload creates a new version.
Each version is an immutable, complete snapshot of the bundle — not a delta.

Omitting `version` (or passing `"latest"`) selects the newest version, resolved once when the request is accepted — an upload made mid-run does not change what a running response loads.

Pin production traffic to a specific version:

```json theme={null}
{ "type": "custom", "id": "YOUR_SKILL_ID", "version": "2" }
```

A pinned `version` always loads the same immutable bundle and never changes; only `"latest"` moves — a version uploaded by any Admin immediately changes what your `"latest"` requests run.
View version history and download any version in the [API Portal](https://console.perplexity.ai/project/skills).

### Error handling

Custom skill references are validated when you submit the request.
A bad reference fails the whole request with HTTP 400 before the run starts:

| Message | Meaning | Suggested handling |
| - | - | - |
| `A requested skill does not exist or is not accessible.` | The ID does not match a skill in your project — a typo, a deleted skill, or a key from a different project. | Copy the ID from the API Portal and confirm the key belongs to the same project. |
| `A requested skill is invalid.` | The ID or `version` is malformed. `version` must be a version number string such as `"2"`, or `"latest"`. | Fix the reference. |
| `A requested skill conflicts with a built-in skill.` | The skill's name (from `SKILL.md`) matches a built-in skill name. | Rename the skill in a new version. |
| `Two requested skills resolve to the same name.` | Two entries in `skills` share one name — for example a custom skill and an inline skill with the same name. | Remove or rename one of them. |

Failures after the run has started are handled in-band instead: if a skill cannot be loaded mid-run, the error is returned to the model, which continues without the skill, and the response still completes.

<Note>
  A `skill_loaded` output item records the load attempt and appears even when loading failed; the error text goes to the model, not into the response.
</Note>

### Limits

The bundle must stay within these limits, checked on upload:

* **32 MiB** total — enforced on both the uploaded ZIP and its decompressed contents.
* **100 files** maximum.
* Exactly **one top-level folder** and **one `SKILL.md`**.
* No file or folder name longer than **255 characters**.
* Up to **500 custom skills per project**.

## Next steps

<CardGroup cols={2}>
  <Card title="Agent skills cookbook" icon="book-open" href="/docs/cookbook/articles/agent-skills/README">
    Full walkthrough of the daily AI stock news PDF, including file download and the complete design book.
  </Card>

  <Card title="Working with files" icon="file" href="/docs/agent-api/working-with-files" />

  <Card title="Background mode" icon="clock" href="/docs/agent-api/background-mode" />

  <Card title="Agent API reference" icon="code" href="/api-reference/agent-post" />
</CardGroup>
