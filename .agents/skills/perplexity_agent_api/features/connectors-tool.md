> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Connectors

> Connect services or bring your own MCP server to your Project, then use them by connector ID in Agent API requests.

## Overview

Connectors are integrations that you configure once on your [Project connectors page](https://console.perplexity.ai/project/connectors).
Choose a managed connector from the catalog, or add a custom connector for your own remote Model Context Protocol (MCP) server.
Perplexity stores the connection settings and credentials for your Project.
Your application references the connector by ID, so it does not need to store or send the MCP server's token with each request.
You still use your Perplexity API key to authenticate Agent API requests.
Any API key in the same Project can use the connector.
Some managed connectors also make their credentials available to [Sandbox](/docs/agent-api/tools/sandbox) commands.
This lets an agent combine service access with code changes and other local work in one run.

## Managed connectors

The current set of connectors includes:

| Service | Connector ID |
| - | - |
| GitHub | `connector_github` |
| Slack | `connector_slack` |
| Google Drive | `connector_googledrive` |
| Datadog | `connector_datadog` |
| Linear | `connector_linear` |
| Notion | `connector_notion` |

<Note>
  Don't see the connector you need? Email [api@perplexity.ai](mailto:api@perplexity.ai) to request it.
  You can also [add a custom connector](#add-a-custom-connector) for your own remote MCP server.
</Note>

### Add a managed connector

You must be a Project administrator to connect a service.

1. Open your [Project connectors page](https://console.perplexity.ai/project/connectors).
2. Select a service and complete its connection setup.
3. Copy the connector ID from the service card.
4. [Use the connector in an Agent API request](#use-a-connector).

## Add a custom connector

Register your remote MCP server once and let Perplexity store its API key.
Your application only needs the connector ID to use the saved connection, with no separate MCP credential to manage in your application.
Custom connectors are available to all Projects and require a Project administrator to set up.

Open your [Project connectors page](https://console.perplexity.ai/project/connectors) and select **Add custom connector**.
Add your server's name, MCP URL, authentication (**API Key** or **None**), and transport (**Streamable HTTP** or **SSE**), then copy its connector ID.

Use that ID with `type: "connector"` in requests authenticated with an API key from the same Project.
The saved connection supplies the server URL and authentication.

## Use a connector

Managed and custom connectors use the same request fields.
Add a `connector` entry to the `tools` array.

<Note>
  Connector tools use deferred discovery by default.
  Set [`max_steps`](/docs/agent-api/building-agents/define-the-run#customize-the-loop-max-steps) high enough to discover and use them.
</Note>

The following request uses a connected Slack workspace to summarize recent messages about AI.
Use the connector ID copied from the API Console.

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()

  response = client.responses.create(
      model="openai/gpt-5.6-terra",
      input="Find and summarize recent messages about AI in my Slack workspace.",
      max_steps=6,
      tools=[
          {
              "type": "connector",
              "id": "connector_slack",
              "server_label": "slack",
          }
      ],
  )

  print(response.output_text)
  ```

  ```typescript Typescript theme={null}
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  const response = await client.responses.create({
    model: 'openai/gpt-5.6-terra',
    input: 'Find and summarize recent messages about AI in my Slack workspace.',
    max_steps: 6,
    tools: [
      {
        type: 'connector',
        id: 'connector_slack',
        server_label: 'slack',
      },
    ],
  });

  console.log(response.output_text);
  ```

  ```bash cURL theme={null}
  curl https://api.perplexity.ai/v1/agent \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/gpt-5.6-terra",
      "input": "Find and summarize recent messages about AI in my Slack workspace.",
      "max_steps": 6,
      "tools": [
        {
          "type": "connector",
          "id": "connector_slack",
          "server_label": "slack"
        }
      ]
    }' | jq
  ```
</CodeGroup>

The response `output` array lists the connector's tools, the model's search of that catalog, each tool call, and the final message.
Connectors are deferred by default, so the model searches the catalog (`tool_search_output`) before it calls a tool.

<Accordion title="Response output (truncated)">
  ```json theme={null}
  [
    {
      "type": "mcp_list_tools",
      "id": "mcpl_4826e99b-cae4-4c44-a613-d205823c2bc0",
      "connector_id": "connector_slack",
      "server_label": "slack",
      "tools": [
        {
          "name": "slack_search_public",
          "description": "Searches for messages, files in public Slack channels ...",
          "input_schema": {
            "type": "object",
            "properties": { "query": { "type": "string" } },
            "required": ["query"]
          }
        },
        {
          "name": "slack_send_message",
          "description": "Sends a message to a Slack channel or user ...",
          "input_schema": {
            "type": "object",
            "properties": {
              "channel_id": { "type": "string" },
              "message": { "type": "string" },
              "thread_ts": { "type": "string" }
            },
            "required": ["channel_id", "message"]
          }
        }
      ]
    },
    {
      "type": "tool_search_output",
      "id": "tso_call_opbSkWX14DwhfWlPdAE9wfH0",
      "call_id": null,
      "status": "completed",
      "execution": "server",
      "arguments": "{\"paths\":[\"slack\"],\"queries\":[\"search\",\"messages\"]}",
      "tools": [
        {
          "type": "namespace",
          "name": "slack",
          "tools": [
            { "type": "function", "name": "slack_search_public", "description": "..." }
          ]
        }
      ]
    },
    {
      "type": "mcp_call",
      "id": "call_DUjlg6jMJoU92GMfrmD8SVcS",
      "connector_id": "connector_slack",
      "server_label": "slack",
      "name": "slack_search_public",
      "arguments": "{\"query\":\"AI\",\"content_types\":\"messages\",\"sort\":\"timestamp\", ...}",
      "output": "{\"results\": ...}",
      "error": null
    },
    {
      "type": "message",
      "id": "msg_...",
      "role": "assistant",
      "status": "completed",
      "content": [
        { "type": "output_text", "text": "Here is a summary of recent messages about AI ...", "annotations": [] }
      ]
    }
  ]
  ```
</Accordion>

## Deferred tool discovery

A connector can expose many tools, and loading every schema up front would waste tokens.
Connector tools are discovered lazily instead: the model receives the connector namespace, searches it, loads only the schemas it needs, and calls them — all automatically.
You only add the connector to `tools`.

The `mcp_list_tools` item still records the full catalog; deferred discovery controls what enters the model's context, not what the response reports.

## Connector parameters

| Field | Type | Required | Description |
| - | - | - | - |
| `type` | string | Yes | Must be `"connector"`. |
| `id` | string | Yes | The managed or custom connector ID copied from the API Console. |
| `server_label` | string | Yes | A request-local label for the connector. |
| `server_description` | string | No | A model-facing description of the connector namespace. |
| `allowed_tools` | array | No | An exact-name allowlist. Omit or leave empty to expose every available tool. |

## Use connectors in the sandbox

Some connectors make their credentials available to sandbox commands.
GitHub is a key example.

### GitHub connector

The GitHub connector lets the model use the GitHub tools that belong to your connected GitHub account.
You can use it in two ways.

#### Connector only

Without the sandbox, GitHub works like any other connector: the model discovers tools from the GitHub catalog and calls them as `mcp_call` items.
The catalog covers repositories, files, commits, issues, and pull requests.
For example, `get_file_contents` reads the current contents of a file by `owner`, `repo`, and `path`, or lists a directory when `path` points to a folder.
Pass `ref` to read from a specific branch, tag, or commit; without it, the tool reads the default branch.

Use this mode for targeted lookups, such as reading a file, checking a commit, or listing pull requests, when you want each call recorded in the response.
To see the full tool set, send a request with only the connector and read the `mcp_list_tools` item in the output.

#### Connector with the sandbox

Pair the connector with [Sandbox](/docs/agent-api/tools/sandbox) when the task needs the `git` or `gh` CLI.
With both tools enabled, the agent can clone private repositories, read and search files, diff branches, change code, commit, push a branch, and create or update a pull request.
It uses the `git` and `gh` CLIs in the sandbox with the GitHub credentials from the connector.
The agent can access only repositories and perform only actions that your connected GitHub account permits.

With the sandbox enabled and no `allowed_tools`, GitHub runs through the CLIs: the response has `sandbox_results` items instead of `mcp_list_tools` or `mcp_call` items, and failures appear as `git` or `gh` output.
Set `allowed_tools` or omit the sandbox to use GitHub as a regular connector with `mcp_call` items.

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()

  stream = client.responses.create(
      model="openai/gpt-5.6-terra",
      input="Clone the GitHub repository perplexityai/perplexity-py. Review README.md and make one small, factual documentation improvement. Do not modify any other files. Report the changed file. Create a pull request with a clear title and return its URL.",
      max_steps=12,
      stream=True,
      tools=[
          {"type": "sandbox"},
          {
              "type": "connector",
              "id": "connector_github",
              "server_label": "github",
          },
      ],
  )

  for event in stream:
      print(event)
  ```

  ```typescript Typescript theme={null}
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  const stream = await client.responses.create({
    model: 'openai/gpt-5.6-terra',
    input: 'Clone the GitHub repository perplexityai/perplexity-py. Review README.md and make one small, factual documentation improvement. Do not modify any other files. Report the changed file. Create a pull request with a clear title and return its URL.',
    max_steps: 12,
    stream: true,
    tools: [
      { type: 'sandbox' },
      {
        type: 'connector',
        id: 'connector_github',
        server_label: 'github',
      },
    ],
  });

  for await (const event of stream) {
    console.log(event);
  }
  ```

  ```bash cURL theme={null}
  curl -N --no-buffer --fail-with-body https://api.perplexity.ai/v1/agent \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -H "Accept: text/event-stream" \
    -d '{
      "model": "openai/gpt-5.6-terra",
      "input": "Clone the GitHub repository perplexityai/perplexity-py. Review README.md and make one small, factual documentation improvement. Do not modify any other files. Report the changed file. Create a pull request with a clear title and return its URL.",
      "max_steps": 12,
      "stream": true,
      "tools": [
        { "type": "sandbox" },
        {
          "type": "connector",
          "id": "connector_github",
          "server_label": "github"
        }
      ]
    }' \
    | awk '/^data: / { sub(/^data: /, ""); sub(/\r$/, ""); if ($0 != "[DONE]") print }' \
    | jq --unbuffered .
  ```
</CodeGroup>

#### What to expect

The sandbox is a general-purpose execution environment, not a dedicated coding agent.
It is a good fit for scoped repository tasks that complete in one run: read or review a set of files, explain a diff, make a focused change, or open a pull request.
Repository-wide code review and multi-stage development work that depends on a persistent development environment, project-specific test setup, or long iteration loops are outside what a single sandbox run is designed for.
For that kind of work, split it into scoped requests and give each one a clear, verifiable outcome.

## Connectors and MCP

Both connectors and MCP servers let the Agent API call external tools.
Use a managed or custom connector to reuse a connection configured for your Project.
Use [MCP](/docs/agent-api/tools/mcp) to provide a remote server's URL and authentication in each request.

| | Connector | MCP server |
| - | - | - |
| Setup | Connect a catalog service or add your own server once in the API Console. Reference it with `type: "connector"` and `id`. | Use `type: "mcp"` and provide a remote `server_url` in each request. |
| Credentials | Perplexity stores the server credential for your Project. Your application sends the connector ID. | Your application supplies the server credential in each request. |
| Custom server transport | Streamable HTTP or SSE. | Streamable HTTP only. |
| Sandbox integration | Some managed connectors make their credentials available to Sandbox commands. For example, use the GitHub connector with `git` and `gh`. | MCP server credentials are not available to Sandbox commands. |
| Best for | Reusing managed integrations or your own MCP server across Project requests. | Choosing a server and credentials separately for each request. |

## Error handling

A connector tool call can fail as an `mcp_call` item with an `error` field.
This does not fail the request: the run continues and the error is passed to the model in-band, so the model still answers — it just cannot use that connector.

The main case to handle is `AUTH_REQUIRED`: the connector's authorization went stale or an administrator revoked it.
Your requests keep working — the connector is just unavailable to the model until it is reconnected, which you can do later.

For example:

```json theme={null}
{
  "type": "mcp_call",
  "id": "call_h2rK8I109IvZC038Wcuudzhc",
  "connector_id": "connector_slack",
  "server_label": "slack",
  "name": "slack_search_public",
  "arguments": "{\"query\":\"AI\",\"content_types\":\"messages\", ...}",
  "error": "AUTH_REQUIRED"
}
```

Because the request still succeeds, this is easy to miss.
Detect it in your harness and send it to your logging or alerting so an operator can reconnect the connector on the [Project connectors page](https://console.perplexity.ai/project/connectors).

Your harness can branch on the `error` value:

| Value | Meaning | Suggested handling |
| - | - | - |
| `AUTH_REQUIRED` | The connector's authorization has lapsed or been revoked. | Ask a Project administrator to reconnect it in the API Console. |
| `INVALID_ARGUMENTS` | The model called the tool with arguments it rejected. | Recoverable. The error is returned to the model, which can retry with corrected arguments. |
| `POLICY_DENIED` | A policy blocked the tool call. | Do not retry. The call is not allowed. |
| `CONNECTOR_UNAVAILABLE` | The connector service could not be reached. | Transient. Retry later. |
| `CONNECTOR_INTERNAL_ERROR` | The connector returned a response that could not be used. | Transient. Retry later. |
| `TOOL_ERROR` | The tool failed for another reason. | Treat as a tool failure. |

The `error` field is a free-form string, so treat any other value as a tool failure.
A connector that is not connected lists no tools (`"tools": []`) and produces no error, so also watch for an empty tool list.

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()

  CONNECTORS_URL = "https://console.perplexity.ai/group/connectors"

  response = client.responses.create(
      model="openai/gpt-5.6-terra",
      input="Find and summarize recent messages about AI in my Slack workspace.",
      max_steps=6,
      tools=[
          {
              "type": "connector",
              "id": "connector_slack",
              "server_label": "slack",
          }
      ],
  )

  for item in response.output:
      if getattr(item, "type", None) != "mcp_call" or not getattr(item, "error", None):
          continue
      if item.error == "AUTH_REQUIRED":
          print(f"Ask an administrator to reconnect the {item.server_label} connector at {CONNECTORS_URL}")
      else:
          raise RuntimeError(f"Connector tool {item.name} failed: {item.error}")
  ```

  ```typescript Typescript theme={null}
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  const CONNECTORS_URL = 'https://console.perplexity.ai/group/connectors';

  const response = await client.responses.create({
    model: 'openai/gpt-5.6-terra',
    input: 'Find and summarize recent messages about AI in my Slack workspace.',
    max_steps: 6,
    tools: [
      {
        type: 'connector',
        id: 'connector_slack',
        server_label: 'slack',
      },
    ],
  });

  for (const item of response.output) {
    if (item.type !== 'mcp_call' || !item.error) continue;
    if (item.error === 'AUTH_REQUIRED') {
      console.log(`Ask an administrator to reconnect the ${item.server_label} connector at ${CONNECTORS_URL}`);
    } else {
      throw new Error(`Connector tool ${item.name} failed: ${item.error}`);
    }
  }
  ```

  ```bash cURL theme={null}
  curl https://api.perplexity.ai/v1/agent \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/gpt-5.6-terra",
      "input": "Find and summarize recent messages about AI in my Slack workspace.",
      "max_steps": 6,
      "tools": [
        { "type": "connector", "id": "connector_slack", "server_label": "slack" }
      ]
    }' \
    | jq '.output[] | select(.type == "mcp_call" and .error != null) | {connector_id, server_label, name, error}'
  ```
</CodeGroup>

## Next steps

<CardGroup cols={2}>
  <Card title="MCP" icon="plug" href="/docs/agent-api/tools/mcp">
    Connect a remote MCP server that you manage.
  </Card>

  <Card title="Sandbox" icon="box" href="/docs/agent-api/tools/sandbox">
    Run code and use the GitHub connector with `git` and `gh`.
  </Card>
</CardGroup>
