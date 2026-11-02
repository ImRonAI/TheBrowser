> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Sandbox

> Execute code in isolated containers from inside an Agent API request.

## Overview

The `sandbox` tool lets the model run code during an Agent API request. The agent can execute code in an isolated container, inspect the output, and use the result in its final answer.

You don't supply the code. You enable the tool, and the model writes and runs the code itself based on your prompt and instructions - then reads its own `stdout`/`stderr` back and uses it in the answer. The exact code the model ran is returned to you in the response (see [Response shape](#response-shape)), so you can verify what executed.

Enable the tool by adding it to the `tools` array. The model decides when to call it based on your prompt and instructions.

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()


  def get_output_text(response) -> str:
      return "".join(
          content.text
          for item in response.output or []
          if getattr(item, "type", None) == "message"
          for content in getattr(item, "content", None) or []
          if getattr(content, "type", None) == "output_text"
      )


  response = client.responses.create(
      model="openai/gpt-5.6-sol",
      input="For 230+ qualifying high-severity CVEs (CVE-YYYY-NNNNN published 2023–2025, CVSS ≥ 7.0), find the canonical vendor security advisory URL per CVE and name the affected product and the advisory's stated fix version.",
      tools=[{"type": "sandbox"}, {"type": "web_search"}],
      instructions="Use the sandbox and web search to gather and verify the advisories before answering.",
  )

  print(get_output_text(response))
  ```

  ```typescript Typescript theme={null}
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  const response = await client.responses.create({
    model: 'openai/gpt-5.6-sol',
    input: "For 230+ qualifying high-severity CVEs (CVE-YYYY-NNNNN published 2023–2025, CVSS ≥ 7.0), find the canonical vendor security advisory URL per CVE and name the affected product and the advisory's stated fix version.",
    tools: [{ type: 'sandbox' as const }, { type: 'web_search' as const }],
    instructions: 'Use the sandbox and web search to gather and verify the advisories before answering.',
  });

  console.log(response.output_text);
  ```

  ```bash cURL theme={null}
  curl https://api.perplexity.ai/v1/agent \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/gpt-5.6-sol",
      "input": "For 230+ qualifying high-severity CVEs (CVE-YYYY-NNNNN published 2023–2025, CVSS ≥ 7.0), find the canonical vendor security advisory URL per CVE and name the affected product and the advisory'\''s stated fix version.",
      "tools": [
        {
          "type": "sandbox"
        },
        {
          "type": "web_search"
        }
      ],
      "instructions": "Use the sandbox and web search to gather and verify the advisories before answering."
    }' | jq
  ```
</CodeGroup>

## Use cases

* Web search
* Numeric calculations and statistical analysis
* Data cleaning, parsing, and transformation
* Code execution to check logic or reproduce an error
* Structured artifact generation, such as CSV, JSON, or reports
* Multi-step workflows that need intermediate files or computed state

## How the container works

The sandbox is an isolated Linux container. Knowing what it can and can't do helps you predict when the model will reach for it and what to expect back.

| Property | Behavior |
| - | - |
| **Languages** | The model runs **Python** for computation and **bash** for shell commands. Each execution reports its `language` in the response. |
| **Internet access** | The container has network access, so the model's code can install packages it needs at runtime and reach external endpoints. |
| **State within a response** | Multiple executions in a single response share the same container: files written and packages installed by an earlier step are still there for a later one. This is what makes multi-step workflows and intermediate files work. |
| **Output capture** | `stdout` and `stderr` are captured per execution. Very large output is truncated (on the order of \~1 MiB per stream), so have the model write big results to a file and return it (see [Retrieving generated files](#retrieving-generated-files)) rather than printing them. |
| **Runtime limit** | Each execution has a runtime cap. If it's exceeded, that execution's `status` is `timed_out` (see [Error handling](#error-handling)). For long jobs, use [background mode](#running-in-the-background). |

### Calling other tools from inside the sandbox

The container ships with a preinstalled Perplexity SDK, so code the model runs inside the sandbox can call [Web Search](/docs/agent-api/tools/web-search), [Fetch URL Content](/docs/agent-api/tools/fetch-url-content), and [People Search](/docs/agent-api/tools/people-search) directly - without you adding those tools to the request - then compute on what they return. Each such call is billed at its standard per-invocation rate (see [Pricing](#pricing)).

## Use connectors in the sandbox

Some connectors make their credentials available to sandbox commands.

<Note>
  **Preview:** Connectors are in preview. Supported services and behavior may change.
</Note>

### GitHub connector

The [GitHub connector](/docs/agent-api/tools/connectors#use-connectors-in-the-sandbox) lets the model use your connected GitHub credentials in sandbox commands.
Enable both `sandbox` and the GitHub connector in the request.
The model can then use `git` and `gh` to clone private repositories, change code, commit changes, and create or update pull requests.
It can access only repositories and perform only actions that your connected GitHub account permits.

For the request shape and a GitHub example, see [Connectors](/docs/agent-api/tools/connectors).

## Running in the background

For long-running sandbox calls, submit the request with `background: true` and poll the response by ID until it completes.

<CodeGroup>
  ```python Python theme={null}
  import time
  from perplexity import Perplexity

  client = Perplexity()


  def get_output_text(response) -> str:
      return "".join(
          content.text
          for item in response.output or []
          if getattr(item, "type", None) == "message"
          for content in getattr(item, "content", None) or []
          if getattr(content, "type", None) == "output_text"
      )


  response = client.responses.create(
      model="openai/gpt-5.6-sol",
      input="Create a CSV with the first 10 Fibonacci numbers and their squares.",
      tools=[{"type": "sandbox"}],
      background=True,
  )

  while response.status in ("queued", "in_progress"):
      time.sleep(2)
      response = client.responses.retrieve(response.id)

  print(get_output_text(response))
  ```

  ```typescript Typescript theme={null}
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  let response = await client.responses.create({
    model: 'openai/gpt-5.6-sol',
    input: 'Create a CSV with the first 10 Fibonacci numbers and their squares.',
    tools: [{ type: 'sandbox' as const }],
    background: true,
  });

  while (response.status === 'queued' || response.status === 'in_progress') {
    await new Promise((r) => setTimeout(r, 2000));
    response = await client.responses.retrieve(response.id);
  }

  console.log(response.output_text);
  ```

  ```bash cURL theme={null}
  # 1. Submit with background: true
  curl https://api.perplexity.ai/v1/agent \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/gpt-5.6-sol",
      "input": "Create a CSV with the first 10 Fibonacci numbers and their squares.",
      "tools": [{ "type": "sandbox" }],
      "background": true
    }'

  # 2. Poll the response by ID until status is completed, failed, cancelled, or incomplete
  curl https://api.perplexity.ai/v1/agent/$RESPONSE_ID \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY"
  ```
</CodeGroup>

## Error handling

Sandbox errors are returned through the normal Agent API response.

| Case | What you see |
| - | - |
| **Timeout** | The `status` on the affected entry in `results[]` (and on the enclosing `sandbox_results` item) is `timed_out`. If the request cannot complete, the top-level response status is `failed` with an `error` object. |
| **Runtime error** | The matching entry in `results[]` includes a non-zero `exit_code` and error output in `stderr`. The Agent API response may still complete if the container ran successfully. |
| **Quota or limit** | The response fails with an `error` object describing the limit. Agent API rate limits still apply. |

## Limits and quotas

Sandbox runs inside Agent API requests and is subject to Agent API rate limits. See [Rate Limits & Usage Tiers](/docs/admin/rate-limits-usage-tiers#agent-api-rate-limits) for tier-based request limits.

## Response shape

When the model calls the sandbox tool, the Agent API response includes a `sandbox_results` item in its `output` array alongside any `message` items. A single response can contain multiple `sandbox_results` items if the model makes more than one sandbox call.

Each `sandbox_results` item describes one sandbox invocation and nests the per-execution output inside a `results` array.

| Field | Type | Description |
| - | - | - |
| `type` | `string` | Always `sandbox_results`. |
| `call_id` | `string` | Identifier for this sandbox tool call. |
| `container_id` | `string` | Identifier of the isolated container that executed the code. |
| `language` | `string` | Language the sandbox ran the code in (for example, `python`). |
| `code` | `string` | The code that was executed inside the sandbox. |
| `status` | `string` | Overall status of the sandbox call. One of `completed`, `timed_out`, `failed`. |
| `results` | `array` | One entry per execution inside the container. See fields below. |

Each entry in `results` has the following fields:

| Field | Type | Description |
| - | - | - |
| `stdout` | `string` | Standard output captured from the execution. |
| `stderr` | `string` | Standard error captured from the execution. |
| `exit_code` | `integer` | Process exit code. Non-zero indicates a runtime error. |
| `duration_ms` | `integer` | Wall-clock duration of the execution, in milliseconds. |
| `status` | `string` | Per-execution status. One of `completed`, `timed_out`, `failed`. |

Example:

```json theme={null}
{
  "type": "sandbox_results",
  "call_id": "call_Y1Lo4H6cGFgNVsn4mwC0oSgc",
  "code": "vals = [(i, i*i) for i in range(1, 11)]\nprint('\\n'.join(f'{a},{b}' for a, b in vals))",
  "container_id": "i6dr97ven2qfm0sdtvfzc",
  "language": "python",
  "results": [
    {
      "duration_ms": 9011,
      "exit_code": 0,
      "status": "completed",
      "stderr": "",
      "stdout": "1,1\n2,4\n3,9\n4,16\n5,25\n6,36\n7,49\n8,64\n9,81\n10,100\n"
    }
  ],
  "status": "completed"
}
```

For the full request and response schema, see the [Agent API reference](/api-reference/agent-post).

## Retrieving generated files

When code in the sandbox writes a file and delivers it with the `share_file` tool, the response `output` array includes a `share_file` item. The file content is not returned inline — retrieve it with the response files endpoints, using the response `id`.

List the files a response produced:

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()

  files = client.responses.files.list("resp_abc123")

  for file in files.data:
      print(file.id, file.filename, file.bytes)
  ```

  ```bash cURL theme={null}
  curl https://api.perplexity.ai/v1/agent/$RESPONSE_ID/files \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" | jq
  ```
</CodeGroup>

```json theme={null}
{
  "data": [
    {
      "bytes": 8002,
      "created_at": 1780923289,
      "filename": "anthropic_news.csv",
      "id": "9198548a-490b-4119-858f-fd3676b60319",
      "object": "file"
    }
  ],
  "object": "list"
}
```

Each entry has the following fields:

| Field | Type | Description |
| - | - | - |
| `id` | `string` | File identifier, used to download the content. Distinct from the response `id`. |
| `filename` | `string` | Name the sandbox gave the file. |
| `bytes` | `integer` | File size in bytes. |
| `created_at` | `integer` | Unix timestamp of when the file was created. |
| `object` | `string` | Always `file`. |

Download a file's content by its `id`. The endpoint returns the raw file bytes (not JSON), with a `Content-Type` matching the file and a `Content-Disposition: attachment` header carrying the original filename.

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()

  content = client.responses.files.content(
      file_id="9198548a-490b-4119-858f-fd3676b60319",
      response_id="resp_abc123",
  )
  content.write_to_file("anthropic_news.csv")
  ```

  ```bash cURL theme={null}
  curl https://api.perplexity.ai/v1/agent/$RESPONSE_ID/files/$FILE_ID/content \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -o anthropic_news.csv
  ```
</CodeGroup>

## Pricing

`sandbox` is billed on three axes:

| Axis | Price | Notes |
| - | - | - |
| **Tokens** | Per model | Model token usage is billed separately according to Agent API token pricing. See [Models](/docs/agent-api/models) for per-model rates. |
| **Sandbox session** | \$0.03 per session | Billed once per sandbox container. A session is the lifecycle of a single isolated container and covers up to 20 minutes of active use for billing purposes — this is the billing window, not a runtime cap. |
| **Tools used** | Per tool | Code running inside the sandbox can call the [Web Search](/docs/agent-api/tools/web-search), [Fetch URL Content](/docs/agent-api/tools/fetch-url-content), and [People Search](/docs/agent-api/tools/people-search) tools. Each is billed at its standard per-invocation rate. |

Sandbox invocations are counted under `usage.tool_calls_details.sandbox.invocation`.

See [Pricing](/docs/getting-started/pricing#tool-pricing) for the full Agent API tool pricing table.
