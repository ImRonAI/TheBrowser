> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# MCP

> Connect a remote Model Context Protocol (MCP) server to an Agent API request so the model can call your server's tools.

## Overview

Beyond the `function` tools you define yourself, you can give a model new capabilities by connecting it to a remote [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server. The model calls that server's tools to reach and control external services when it needs them to answer a prompt.

The `mcp` tool connects a user-supplied remote MCP server to an Agent API request. Agent API discovers the server's tools when the request starts and calls them like native tools during the run, so you don't have to write a custom `function` tool for each one.

You can connect your own MCP server in two ways:

* Use `type: "mcp"` to provide the server URL and authentication in each request.
  This requires Streamable HTTP.
* [Add a custom connector](/docs/agent-api/tools/connectors#add-a-custom-connector) to save the server URL and authentication once in the API Console.
  Perplexity stores the MCP server's token, so your application does not need to store or send it with each request.
  Any API key in that Project can then use it with `type: "connector"` and its connector ID.
  Custom connectors support Streamable HTTP and SSE.

Some managed connectors, such as GitHub, also provide credentials for [Sandbox commands](/docs/agent-api/tools/connectors#use-connectors-in-the-sandbox).
Custom connectors and the `mcp` tool do not provide this Sandbox integration.

The example below connects to the public [DeepWiki](https://deepwiki.com) MCP server, which needs no authentication, and asks the model to answer a question about a GitHub repository using the server's tools.

<Tip>
  For a fuller, runnable example that combines an MCP server with the model's own web search, see the [Model Picker](/docs/cookbook/examples/model-picker/README) cookbook recipe.
</Tip>

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()

  response = client.responses.create(
      model="openai/gpt-5.6-sol",
      input="Ask DeepWiki which Python versions the perplexityai/perplexity-py repository supports.",
      tools=[
          {
              "type": "mcp",
              "server_label": "deepwiki",
              "server_url": "https://mcp.deepwiki.com/mcp",
          }
      ],
  )

  print(response.output_text)
  ```

  ```typescript Typescript theme={null}
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  const response = await client.responses.create({
    model: 'openai/gpt-5.6-sol',
    input: 'Ask DeepWiki which Python versions the perplexityai/perplexity-py repository supports.',
    tools: [
      {
        type: 'mcp',
        server_label: 'deepwiki',
        server_url: 'https://mcp.deepwiki.com/mcp',
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
      "model": "openai/gpt-5.6-sol",
      "input": "Ask DeepWiki which Python versions the perplexityai/perplexity-py repository supports.",
      "tools": [
        {
          "type": "mcp",
          "server_label": "deepwiki",
          "server_url": "https://mcp.deepwiki.com/mcp"
        }
      ]
    }' | jq
  ```
</CodeGroup>

The sample below shows only the response's `output` array, with long MCP tool outputs truncated.

<Accordion title="Response">
  ```json theme={null}
  [
    {
      "type": "mcp_list_tools",
      "id": "mcpl_b6875670-9dd5-46e0-9616-2f15e35bc0d1",
      "server_label": "deepwiki",
      "tools": [
        {
          "name": "ask_question",
          "description": "Ask any question about a GitHub repository and get an AI-powered, context-grounded response.",
          "input_schema": {
            "type": "object",
            "properties": {
              "repoName": {
                "description": "GitHub repository or list of repositories (max 10) in owner/repo format.",
                "anyOf": [
                  { "type": "string" },
                  { "type": "array", "items": { "type": "string" } }
                ]
              },
              "question": {
                "type": "string",
                "description": "The question to ask about the repository."
              }
            },
            "required": ["repoName", "question"]
          }
        },
        {
          "name": "read_wiki_contents",
          "description": "View documentation about a GitHub repository.",
          "input_schema": {
            "type": "object",
            "properties": {
              "repoName": {
                "type": "string",
                "description": "GitHub repository in owner/repo format (e.g. \"facebook/react\")."
              }
            },
            "required": ["repoName"]
          }
        },
        {
          "name": "read_wiki_structure",
          "description": "Get a list of documentation topics for a GitHub repository.",
          "input_schema": {
            "type": "object",
            "properties": {
              "repoName": {
                "type": "string",
                "description": "GitHub repository in owner/repo format (e.g. \"facebook/react\")."
              }
            },
            "required": ["repoName"]
          }
        }
      ]
    },
    {
      "type": "mcp_call",
      "id": "call_Ev48gan4OR0rrPQYb8xuSq3r",
      "server_label": "deepwiki",
      "name": "ask_question",
      "arguments": "{\"question\":\"Which Python versions does this repository support? Please cite the repository files or documentation that specify the supported versions, and distinguish package metadata requirements from tested CI versions if applicable.\",\"repoName\":\"perplexityai/perplexity-py\"}",
      "output": "The `perplexity-py` repository supports Python versions 3.9 and higher. This is specified in the `pyproject.toml` file, which indicates a `requires-python` constraint of `>= 3.9`.\n\nThe project metadata also lists classifiers for Python versions 3.9 through 3.14, indicating that these versions are considered compatible... [truncated]",
      "error": null
    },
    {
      "type": "message",
      "id": "msg_b80c49c9-1215-4c0a-94f0-188ecc2b1e22",
      "role": "assistant",
      "status": "completed",
      "content": [
        {
          "type": "output_text",
          "text": "The `perplexityai/perplexity-py` repository supports **Python 3.9 and newer** (`requires-python = \">=3.9\"` in `pyproject.toml`).\n\nIts package classifiers list compatibility with **Python 3.9 through 3.14**. Python 3.8 support was previously dropped. Note that Ruff's `py38` target concerns source-code syntax and does not change the runtime requirement.",
          "annotations": []
        }
      ]
    }
  ]
  ```
</Accordion>

## Defer tool definitions

By default, every MCP tool definition the request exposes enters the model's initial context. Set `defer_loading` to `true` when a server has many tools or large schemas, or when you connect several servers at once. The model can then search the catalog and load only the schemas it needs. The field is per server, so set it on each one you want deferred. Omitting the field, or setting it to `false`, keeps the default eager behavior.

Deferred loading spends extra model turns before the first tool call. Set [`max_steps`](/docs/agent-api/building-agents/define-the-run#customize-the-loop-max-steps) high enough that the model can search the catalog and still call the tools it finds. Otherwise a run can end right after the search and answer without ever calling a tool.

In the example below, none of DeepWiki's three tool definitions start in the model's context. The model searches the catalog, loads only what the search matches, and calls the tool it found.

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()

  response = client.responses.create(
      model="openai/gpt-5.6-sol",
      input="Ask DeepWiki this exact question: which license does fastapi/fastapi use?",
      max_steps=6,
      tools=[
          {
              "type": "mcp",
              "server_label": "deepwiki",
              "server_url": "https://mcp.deepwiki.com/mcp",
              "defer_loading": True,
          }
      ],
  )

  print(response.output_text)
  ```

  ```typescript Typescript theme={null}
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  const response = await client.responses.create({
    model: 'openai/gpt-5.6-sol',
    input: 'Ask DeepWiki this exact question: which license does fastapi/fastapi use?',
    max_steps: 6,
    tools: [
      {
        type: 'mcp',
        server_label: 'deepwiki',
        server_url: 'https://mcp.deepwiki.com/mcp',
        defer_loading: true,
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
      "model": "openai/gpt-5.6-sol",
      "input": "Ask DeepWiki this exact question: which license does fastapi/fastapi use?",
      "max_steps": 6,
      "tools": [
        {
          "type": "mcp",
          "server_label": "deepwiki",
          "server_url": "https://mcp.deepwiki.com/mcp",
          "defer_loading": true
        }
      ]
    }' | jq
  ```
</CodeGroup>

The sample below shows only the response's `output` array, with long MCP tool outputs truncated.

<Accordion title="Response">
  ```json theme={null}
  [
    {
      "type": "mcp_list_tools",
      "id": "mcpl_737d73ac-416a-4cde-a296-479de85a65d1",
      "server_label": "deepwiki",
      "tools": [
        {
          "name": "ask_question",
          "description": "Ask any question about a GitHub repository and get an AI-powered, context-grounded response.",
          "input_schema": {
            "properties": {
              "question": {
                "description": "The question to ask about the repository.",
                "type": "string"
              },
              "repoName": {
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "items": {
                      "type": "string"
                    },
                    "type": "array"
                  }
                ],
                "description": "GitHub repository or list of repositories (max 10) in owner/repo format."
              }
            },
            "required": [
              "repoName",
              "question"
            ],
            "type": "object"
          }
        },
        {
          "name": "read_wiki_contents",
          "description": "View documentation about a GitHub repository.",
          "input_schema": {
            "properties": {
              "repoName": {
                "description": "GitHub repository in owner/repo format (e.g. \"facebook/react\").",
                "type": "string"
              }
            },
            "required": [
              "repoName"
            ],
            "type": "object"
          }
        },
        {
          "name": "read_wiki_structure",
          "description": "Get a list of documentation topics for a GitHub repository.",
          "input_schema": {
            "properties": {
              "repoName": {
                "description": "GitHub repository in owner/repo format (e.g. \"facebook/react\").",
                "type": "string"
              }
            },
            "required": [
              "repoName"
            ],
            "type": "object"
          }
        }
      ]
    },
    {
      "type": "tool_search_output",
      "id": "tso_call_4ZM8bZTRYO2Cq6ZvY5WBJPvK",
      "call_id": null,
      "status": "completed",
      "execution": "server",
      "arguments": "{\"paths\":[\"deepwiki\"],\"queries\":[\"ask\",\"question\"]}",
      "tools": [
        {
          "type": "namespace",
          "name": "deepwiki",
          "description": "",
          "tools": [
            {
              "type": "function",
              "name": "ask_question",
              "description": "Ask any question about a GitHub repository and get an AI-powered, context-grounded response.",
              "parameters": {
                "properties": {
                  "question": {
                    "description": "The question to ask about the repository.",
                    "type": "string"
                  },
                  "repoName": {
                    "anyOf": [
                      {
                        "type": "string"
                      },
                      {
                        "items": {
                          "type": "string"
                        },
                        "type": "array"
                      }
                    ],
                    "description": "GitHub repository or list of repositories (max 10) in owner/repo format."
                  }
                },
                "required": [
                  "repoName",
                  "question"
                ],
                "type": "object"
              }
            }
          ]
        }
      ]
    },
    {
      "type": "mcp_call",
      "id": "call_EDUuJFdKLABQvPUuDl0WeRwK",
      "server_label": "deepwiki",
      "name": "ask_question",
      "arguments": "{\"question\":\"which license does fastapi/fastapi use?\",\"repoName\":\"fastapi/fastapi\"}",
      "output": "The `fastapi/fastapi` project is licensed under the MIT License... [truncated]",
      "error": null
    },
    {
      "type": "message",
      "id": "msg_dc0c8b47-fe82-40db-a6ec-e84ac99d7710",
      "role": "assistant",
      "status": "completed",
      "content": [
        {
          "type": "output_text",
          "text": "DeepWiki says **fastapi/fastapi uses the MIT License**.",
          "annotations": []
        }
      ]
    }
  ]
  ```
</Accordion>

<Tip>
  If an MCP-heavy request approaches or exceeds the model's context window, enable `defer_loading` before shortening the prompt or removing useful tools. This avoids placing every eligible MCP schema in the initial context while keeping those tools available to the model.
</Tip>

Each `tool_search_output` item is one search of the deferred catalog. The search can cover every deferred server or narrow to one, and it returns only the tools it matches — one of DeepWiki's three above. A search can also return no match, and the model can then search again, so a run may hold several of these items. Calls still appear as `mcp_call`. Agent API still discovers each server's tools when the request starts, so deferred loading does not eliminate discovery time or change [discovery failure behavior](#error-handling).

Three small tools is a modest catalog, so the extra search step buys little here. Deferred loading pays off as the catalog grows: more servers, more tools, larger schemas, or a context window you would otherwise exceed.

## Authentication

Unlike the DeepWiki server above, most MCP servers require authentication. The most common scheme is an OAuth access token, which you pass in the `authorization` field of the `mcp` tool:

<CodeGroup>
  ```python Python theme={null}
  import os
  from perplexity import Perplexity

  client = Perplexity()

  response = client.responses.create(
      model="openai/gpt-5.6-sol",
      input="Use GitHub to find open issues about authentication in perplexityai/perplexity-py.",
      tools=[
          {
              "type": "mcp",
              "server_label": "github",
              "server_url": "https://api.githubcopilot.com/mcp/",
              "authorization": os.environ["GITHUB_MCP_TOKEN"],
              "allowed_tools": ["search_repositories", "list_issues", "issue_read"],
          }
      ],
  )

  print(response.output_text)
  ```

  ```typescript Typescript theme={null}
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  const response = await client.responses.create({
    model: 'openai/gpt-5.6-sol',
    input: 'Use GitHub to find open issues about authentication in perplexityai/perplexity-py.',
    tools: [
      {
        type: 'mcp',
        server_label: 'github',
        server_url: 'https://api.githubcopilot.com/mcp/',
        authorization: process.env.GITHUB_MCP_TOKEN,
        allowed_tools: ['search_repositories', 'list_issues', 'issue_read'],
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
      "model": "openai/gpt-5.6-sol",
      "input": "Use GitHub to find open issues about authentication in perplexityai/perplexity-py.",
      "tools": [
        {
          "type": "mcp",
          "server_label": "github",
          "server_url": "https://api.githubcopilot.com/mcp/",
          "authorization": "'"$GITHUB_MCP_TOKEN"'",
          "allowed_tools": ["search_repositories", "list_issues", "issue_read"]
        }
      ]
    }' | jq
  ```
</CodeGroup>

<Info>
  This example uses the [GitHub MCP Server](https://github.com/github/github-mcp-server). Create a [GitHub personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) with access to the repositories you want the model to inspect, and export it as `GITHUB_MCP_TOKEN`.
</Info>

## Parameters

| Parameter | Type | Required | Description |
| - | - | - | - |
| `type` | string | Yes | Must be `"mcp"`. |
| `server_label` | string | Yes | Unique per request, matching `^[a-zA-Z0-9_-]{1,64}$`. Namespaces the server's tools. |
| `server_url` | string | Yes | HTTPS URL of the remote MCP server. Must be a Streamable HTTP MCP endpoint; the legacy SSE transport is not supported. |
| `authorization` | string | No | An access token passed to the remote MCP server for authentication. Provide the raw token value. Never logged or echoed. |
| `headers` | object | No | Extra request headers (string values) sent to the MCP server. |
| `allowed_tools` | array | No | Allowlist of tool names to expose to the model. Omit or leave empty to expose all discovered tools. |
| `defer_loading` | boolean | No | When `true`, keeps discovered tool definitions out of the initial model context and lets the model load relevant schemas as needed. Defaults to `false`. |

## Response shape

When an `mcp` tool is used, the response `output` array can include two MCP-specific item types alongside the final `message` item:

* `mcp_list_tools` — emitted once per server, listing the tools discovered when the request starts.
* `mcp_call` — emitted for each tool the model invokes on the server.

With `defer_loading: true`, the array can also include `tool_search_output` items when the model searches the deferred catalog. Tool invocations still appear as `mcp_call` items.

### `mcp_list_tools`

| Field | Type | Description |
| - | - | - |
| `type` | string | Always `mcp_list_tools`. |
| `id` | string | Identifier for this output item. |
| `server_label` | string | The `server_label` you supplied for this server. |
| `tools` | array | The tools discovered on the server. |
| `error` | string | Absent when the server's tools were listed successfully. |

Each entry in `tools` has the following fields:

| Field | Type | Description |
| - | - | - |
| `name` | string | Tool name as exposed by the server. |
| `description` | string | Tool description from the server. |
| `input_schema` | object | The server's JSON Schema for the tool's input, passed through unmodified. |

### `mcp_call`

| Field | Type | Description |
| - | - | - |
| `type` | string | Always `mcp_call`. |
| `id` | string | Identifier for this output item. |
| `server_label` | string | The `server_label` of the server that ran the tool. |
| `name` | string | Name of the tool that was called. |
| `arguments` | string | JSON-encoded arguments the model passed. |
| `output` | string | Tool output text. Empty when the call fails. |
| `error` | string \| null | `null` on success. When the call fails, holds the failure string, which is also returned to the model in-band. |

### `tool_search_output`

Emitted only with `defer_loading: true`, once per search the model runs against the deferred catalog.

| Field | Type | Description |
| - | - | - |
| `type` | string | Always `tool_search_output`. |
| `id` | string | Identifier for this output item. |
| `call_id` | string \| null | Always `null` for hosted catalog searches. |
| `execution` | string | Where the search ran. Currently always `server` — tolerate other values. |
| `status` | string | Search status, for example `completed`. |
| `arguments` | string | Opaque search text the model authored, and may be absent. Treat it as unstructured and do not parse it — its shape is not part of the contract. |
| `tools` | array | Matching tools, grouped per server. Empty when the search finds nothing. |

Each entry in `tools` is a namespace for one server:

| Field | Type | Description |
| - | - | - |
| `type` | string | Always `namespace`. |
| `name` | string | The `server_label` of the server the tools belong to. |
| `description` | string | Namespace description. Empty for MCP servers. |
| `tools` | array | Matching tools, each with `type` (`function`), `name`, `description`, and `parameters` (the server's JSON Schema). |

Example response `output` array:

```json theme={null}
[
  {
    "type": "mcp_list_tools",
    "id": "mcpl_01bcb639-715a-4d5e-be5e-712ac7120bb2",
    "server_label": "github",
    "tools": [
      {
        "name": "issue_read",
        "description": "Get information about a specific issue in a GitHub repository.",
        "input_schema": {
          "type": "object",
          "properties": {
            "method": { "type": "string" },
            "owner": { "type": "string" },
            "repo": { "type": "string" },
            "issue_number": { "type": "number" }
          },
          "required": ["method", "owner", "repo", "issue_number"]
        }
      },
      {
        "name": "list_issues",
        "description": "List issues in a GitHub repository.",
        "input_schema": {
          "type": "object",
          "properties": {
            "owner": { "type": "string" },
            "repo": { "type": "string" },
            "state": { "type": "string" }
          },
          "required": ["owner", "repo"]
        }
      },
      {
        "name": "search_repositories",
        "description": "Find GitHub repositories by name, description, readme, topics, or other metadata.",
        "input_schema": {
          "type": "object",
          "properties": { "query": { "type": "string" } },
          "required": ["query"]
        }
      }
    ]
  },
  {
    "type": "mcp_call",
    "id": "call_dQzJLduEASo7JlHfwN0w09xL",
    "server_label": "github",
    "name": "list_issues",
    "arguments": "{\"owner\":\"perplexityai\",\"repo\":\"perplexity-py\",\"state\":\"OPEN\",\"orderBy\":\"CREATED_AT\",\"direction\":\"DESC\"}",
    "output": "{\"issues\":[{\"number\":60,\"title\":\"Feature Bundle Request: Explicit Prompt Caching, Multi-Model Fusion, and Granular API Key Controls\"}, ...]}",
    "error": null
  },
  {
    "type": "message",
    "role": "assistant",
    "content": [
      {
        "type": "output_text",
        "text": "I found one open issue in `perplexityai/perplexity-py` relevant to authentication / access control: #60 — \"Feature Bundle Request: Explicit Prompt Caching, Multi-Model Fusion, and Granular API Key Controls\" — which requests enterprise-grade API key controls (per-key spending limits, model whitelisting, workspace segregation)."
      }
    ]
  }
]
```

## Error handling

| Case | What you see |
| - | - |
| **Discovery failure** | The request fails with `external_connector_error` (HTTP `424 Failed Dependency`) — the server's tools could not be listed, so the run never starts and no `output` array is returned. The error body's `message` names the server, for example `MCP server "github" could not be initialized`. |
| **Tool-call failure** | The matching `mcp_call` item has its `output` empty and an `error` string set. The failure is also returned to the model in-band, so it can recover or explain in its final answer. |

A discovery failure happens when a server cannot be reached or returns an unusable response as its tools are listed at the start of the run. Because discovery runs before the model, the whole request fails with `external_connector_error` and returns no `output` array.

Tool-call failures during the run do not fail the request. The error is returned to the model in-band on the `mcp_call` item (as above), so the model can recover or explain it in its final answer.

## Risks and safety

The `mcp` tool lets you connect models to external services — a powerful capability that carries risk. Remote MCP servers are third-party services that have not been verified by Perplexity. They can let a model read, send, and receive data, and take actions in the connected service, and each server is subject to its own terms and conditions. Connect only servers you trust.

<Warning>
  Agent API does not support MCP approvals **yet**. Every MCP tool call auto-runs, so only connect MCP servers and expose tools that you trust to run without an approval step.
</Warning>

Use `allowed_tools` to limit which server tools the model can call. For servers with write or admin actions, prefer read-only server modes, read-only tokens, or a small allowlist of read-only tools.

## Limitations

The `mcp` tool is backward-compatible with OpenAI's Responses MCP API. The following OpenAI MCP features are temporarily not supported:

| Feature or field | Behavior |
| - | - |
| `require_approval` | Ignored. Every MCP tool call auto-runs. |
| `mcp_approval_request` / `mcp_approval_response` | Not emitted or accepted. Approval pause/continue flows are not available yet. |
| `connector_id` and hosted connector catalogs | Ignored. Only bring-your-own `server_url` is honored. |
| Connector OAuth flows | Not supported. Pass credentials to your own remote server with `authorization`. |
| MCP resources, prompts, and sampling | Not supported yet; tools are the only supported MCP capability. |
| `approval_request_id` and `status` on MCP output items | Not present in the MCP output item shapes. |

## Pricing

MCP tool calls are free — Agent API does not charge a per-invocation fee for calling a remote MCP server. Model token usage is still billed separately according to Agent API token pricing (see [Models](/docs/agent-api/models) for per-model rates), and you operate the remote MCP server, so any cost it incurs is outside Agent API billing.
