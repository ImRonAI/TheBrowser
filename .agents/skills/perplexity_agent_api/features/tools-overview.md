> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Tools overview

> The tools an Agent API run can call - Perplexity-hosted built-in tools, remote MCP servers, and your own custom functions - and where to go for each.

Tools are what turn a model into an agent.
On its own a model answers only from what it already knows; tools let it search the live web, fetch a page, run code, or call into your own systems.
You enable tools by listing them in the `tools` array, and within a single request the model runs an agentic loop — it reasons, calls a tool, observes the result, and repeats until it can answer.

## Four kinds of tools

| Kind | What it is | Where the model runs it |
| - | - | - |
| Built-in tools | Perplexity-hosted capabilities, enabled by `type`. | Inside the loop; Perplexity runs it and returns results inline. |
| [Connectors](/docs/agent-api/tools/connectors) | Managed services or your own MCP server, configured once for a Project and selected with `type: connector` and `id`. | Inside the loop; the model calls its tools automatically. |
| [MCP servers](/docs/agent-api/tools/mcp) | Your own remote MCP server, connected with `type: mcp`. | Inside the loop; the model calls its tools automatically. |
| [Custom functions](/docs/agent-api/tools/custom-functions) | Functions you control, declared with a JSON Schema. | Paused back to you; you run the call and return the result. |

## Built-in tools

Enable each by its `type`. Every tool has its own reference page for full settings, response shape, and pricing.

| Tool | `type` | Use it to |
| - | - | - |
| [Web Search](/docs/agent-api/tools/web-search) | `web_search` | Search the live web, with domain/date/location filters |
| [Sandbox](/docs/agent-api/tools/sandbox) | `sandbox` | Run code in an isolated container |
| [Fetch URL Content](/docs/agent-api/tools/fetch-url-content) | `fetch_url` | Pull and extract content from specific URLs |
| [Finance Search](/docs/agent-api/tools/finance-search) | `finance_search` | Retrieve structured financial and market data |
| [People Search](/docs/agent-api/tools/people-search) | `people_search` | Find professionals and people |

## Bring your own

<CardGroup cols={2}>
  <Card title="MCP servers" icon="plug" href="/docs/agent-api/tools/mcp">
    Connect a remote MCP server with `type: mcp` and let the model call its tools automatically.
  </Card>

  <Card title="Custom functions" icon="code" href="/docs/agent-api/tools/custom-functions">
    Declare a `type: function` tool with a JSON Schema and run the call on your side.
  </Card>
</CardGroup>
