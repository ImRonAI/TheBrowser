> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Give it tools

> Enable built-in tools and your own custom tools in the tools array, let the model decide when to call them, and read the results back from the response.

A model on its own answers only from what it already knows. Tools let an agent go beyond that — search the live web, fetch a page, run code, or call into your own systems. You enable tools by listing them in the `tools` array, and the model decides when to call each one based on your prompt. This page covers wiring tools in and reading their output. For the full settings of any single tool, follow the link to its reference page.

## Three kinds of tools

| Kind | How it works |
| - | - |
| Built-in tools | Perplexity-hosted capabilities: web search, URL fetch, people and finance search, and a code sandbox. Enable each by `type`, and Perplexity runs it and returns the results inline. |
| MCP servers | Your own remote [MCP](/docs/agent-api/tools/mcp) server. The model discovers and calls the server's tools automatically, like the built-in ones — Perplexity relays each call to your server. |
| Custom tools | Bring your own — functions you control. You declare the schema, and when the model calls one, the run pauses and hands you the arguments to execute, then continues once you return the result. |

## Enable built-in tools

Add each tool to the `tools` array by its `type`. Most built-in tools work with just the type — some accept optional settings (documented on their reference pages).

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()

  response = client.responses.create(
      model="openai/gpt-5.6-sol",
      input="What are the leading approaches to grid-scale energy storage, and how do they compare?",
      tools=[
          {"type": "web_search"},
          {"type": "fetch_url"},
      ],
      max_steps=10,
  )

  print(response.output_text)
  ```

  ```typescript TypeScript theme={null}
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  const response = await client.responses.create({
    model: 'openai/gpt-5.6-sol',
    input: 'What are the leading approaches to grid-scale energy storage, and how do they compare?',
    tools: [
      { type: 'web_search' as const },
      { type: 'fetch_url' as const },
    ],
    max_steps: 10,
  });

  console.log(response.output_text);
  ```

  ```bash cURL theme={null}
  curl https://api.perplexity.ai/v1/agent \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/gpt-5.6-sol",
      "input": "What are the leading approaches to grid-scale energy storage, and how do they compare?",
      "tools": [
        { "type": "web_search" },
        { "type": "fetch_url" }
      ],
      "max_steps": 10
    }' | jq
  ```
</CodeGroup>

The built-in tools, each with its own reference page for full settings, response shape, and pricing:

| Tool | `type` | Use it to |
| - | - | - |
| [Sandbox](/docs/agent-api/tools/sandbox) | `sandbox` | Run code in an isolated container — see [Run code](/docs/agent-api/building-agents/run-code) |
| [Web Search](/docs/agent-api/tools/web-search) | `web_search` | Search the live web, with domain/date/location filters |
| [Fetch URL Content](/docs/agent-api/tools/fetch-url-content) | `fetch_url` | Pull and extract content from specific URLs |
| [People Search](/docs/agent-api/tools/people-search) | `people_search` | Find professionals and people |
| [Finance Search](/docs/agent-api/tools/finance-search) | `finance_search` | Retrieve structured financial and market data |

<Tip>
  Let the model choose. You enable a tool, and the model decides whether and when to call it based on `input` and `instructions`.
</Tip>

## Connect an MCP server

Instead of hosting each tool yourself, connect a remote [Model Context Protocol](/docs/agent-api/tools/mcp) (MCP) server with `type: mcp`. Agent API discovers the server's tools when the request starts, and the model calls them automatically like the built-in ones — you don't handle each call yourself. The example below connects to the public [DeepWiki](https://deepwiki.com) MCP server, which needs no authentication.

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()

  response = client.responses.create(
      model="openai/gpt-5.6-sol",
      input="Use DeepWiki to explain what the perplexityai/perplexity-py repository does.",
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

  ```typescript TypeScript theme={null}
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  const response = await client.responses.create({
    model: 'openai/gpt-5.6-sol',
    input: 'Use DeepWiki to explain what the perplexityai/perplexity-py repository does.',
    tools: [
      {
        type: 'mcp',
        server_label: 'deepwiki',
        server_url: 'https://mcp.deepwiki.com/mcp',
      },
    ] as any, // The current SDK types do not yet include MCP tools.
  });

  console.log(response.output_text);
  ```

  ```bash cURL theme={null}
  curl https://api.perplexity.ai/v1/agent \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/gpt-5.6-sol",
      "input": "Use DeepWiki to explain what the perplexityai/perplexity-py repository does.",
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

For authentication, response items, and the full tool settings, see the [MCP reference](/docs/agent-api/tools/mcp).

## Add your custom tool

A custom tool (`type: function`) lets the agent call code you control — your database or an internal API. You declare it with a `name`, a `description`, and a JSON Schema for its `parameters`. The model fills in the arguments — you run the function. This is how the agent reaches data it can't know on its own — here, an order's current status in your internal system.

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()

  tools = [
      {
          "type": "function",
          "name": "get_order_status",
          "description": "Look up the current status of an internal order by its order ID.",
          "parameters": {
              "type": "object",
              "properties": {"order_id": {"type": "string"}},
              "required": ["order_id"],
          },
          "strict": True,
      }
  ]

  response = client.responses.create(
      model="openai/gpt-5.6-sol",
      input="What's the status of order ORD-10042?",
      tools=tools,
  )
  ```

  ```typescript TypeScript theme={null}
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  const tools = [
    {
      type: 'function' as const,
      name: 'get_order_status',
      description: 'Look up the current status of an internal order by its order ID.',
      parameters: {
        type: 'object',
        properties: { order_id: { type: 'string' } },
        required: ['order_id'],
      },
      strict: true,
    },
  ];

  const response = await client.responses.create({
    model: 'openai/gpt-5.6-sol',
    input: "What's the status of order ORD-10042?",
    tools,
  });
  ```

  ```bash cURL theme={null}
  curl https://api.perplexity.ai/v1/agent \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/gpt-5.6-sol",
      "input": "What is the status of order ORD-10042?",
      "tools": [
        {
          "type": "function",
          "name": "get_order_status",
          "description": "Look up the current status of an internal order by its order ID.",
          "parameters": {
            "type": "object",
            "properties": { "order_id": { "type": "string" } },
            "required": ["order_id"]
          },
          "strict": true
        }
      ]
    }' | jq
  ```
</CodeGroup>

The model never runs your function — the API can't execute your code. Instead, the run pauses and hands the call to you: the response `output` array contains a `function_call` item with the name and the arguments the model filled in.

```json theme={null}
{
  "type": "function_call",
  "id": "fc_abc123",
  "call_id": "call_xyz789",
  "name": "get_order_status",
  "arguments": "{\"order_id\":\"ORD-10042\"}"
}
```

Pull that item off the response, run the function on your side, then continue the run by sending the result back. The follow-up request replays the conversation so far — the original question, the `function_call` the model emitted, and a `function_call_output` carrying your result under the same `call_id`:

<CodeGroup>
  ```python Python theme={null}
  import json

  function_call = next(item for item in response.output if item.type == "function_call")

  def get_order_status(order_id: str) -> dict:
      orders = {"ORD-10042": {"status": "in_transit", "carrier": "DHL", "eta": "2026-06-23"}}
      return orders.get(order_id, {"error": "order not found"})

  result = get_order_status(**json.loads(function_call.arguments))

  followup = client.responses.create(
      model="openai/gpt-5.6-sol",
      input=[
          {"role": "user", "content": "What's the status of order ORD-10042?"},
          {
              "type": "function_call",
              "call_id": function_call.call_id,
              "name": function_call.name,
              "arguments": function_call.arguments,
          },
          {
              "type": "function_call_output",
              "call_id": function_call.call_id,
              "output": json.dumps(result),
          },
      ],
      tools=tools,
  )

  print(followup.output_text)
  ```

  ```typescript TypeScript theme={null}
  const functionCall = response.output.find((item) => item.type === 'function_call');
  if (functionCall?.type !== 'function_call') throw new Error('No function call returned.');

  function getOrderStatus(orderId: string) {
    const orders: Record<string, unknown> = {
      'ORD-10042': { status: 'in_transit', carrier: 'DHL', eta: '2026-06-23' },
    };
    return orders[orderId] ?? { error: 'order not found' };
  }

  const args = JSON.parse(functionCall.arguments) as { order_id: string };
  const result = getOrderStatus(args.order_id);

  const followup = await client.responses.create({
    model: 'openai/gpt-5.6-sol',
    input: [
      { type: 'message', role: 'user', content: "What's the status of order ORD-10042?" },
      {
        type: 'function_call',
        call_id: functionCall.call_id,
        name: functionCall.name,
        arguments: functionCall.arguments,
      },
      {
        type: 'function_call_output',
        call_id: functionCall.call_id,
        output: JSON.stringify(result),
      },
    ],
    tools,
  });

  console.log(followup.output_text);
  ```

  ```bash cURL theme={null}
  curl https://api.perplexity.ai/v1/agent \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/gpt-5.6-sol",
      "input": [
        { "role": "user", "content": "What is the status of order ORD-10042?" },
        {
          "type": "function_call",
          "call_id": "call_xyz789",
          "name": "get_order_status",
          "arguments": "{\"order_id\":\"ORD-10042\"}"
        },
        {
          "type": "function_call_output",
          "call_id": "call_xyz789",
          "output": "{\"status\": \"in_transit\", \"carrier\": \"DHL\", \"eta\": \"2026-06-23\"}"
        }
      ]
    }' | jq
  ```
</CodeGroup>

<Note>
  `call_id` is the correlation key: the `function_call` the model emits and the `function_call_output` you return must carry the same value. Set `strict: true` on the custom tool to enforce the parameter schema. You continue the run by replaying the prior items in the `input` array — pass the `function_call` and its `function_call_output` together so the model sees its own request and your result.
</Note>

## Read tool results

Built-in tools attach their output to the response `output` array next to the `message` item — for example `search_results`, `finance_results`, or `sandbox_results` items, depending on which tool ran. Iterate the array to surface citations, generated files, or computed values. Each tool's reference page documents its exact result shape — see, for example, [Web Search → Response shape](/docs/agent-api/tools/web-search#response-shape).

## Next steps

<CardGroup cols={2}>
  <Card title="Run code" icon="terminal" href="/docs/agent-api/building-agents/run-code">
    Give the agent a sandbox to compute exact answers and return files.
  </Card>

  <Card title="Structure the output" icon="list-details" href="/docs/agent-api/building-agents/shape-output">
    Enforce structured JSON your code can parse.
  </Card>
</CardGroup>
