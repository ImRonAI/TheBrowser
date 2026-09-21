> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Quickstart

> Get started with Pro Search for Sonar Pro - enhanced search with automated tools, multi-step reasoning, and real-time thought streaming

## Overview

Pro Search enhances [Sonar Pro](/getting-started/models/models/sonar-pro) with automated tool usage, enabling multi-step reasoning through intelligent tool orchestration including web search and URL content fetching.

<Warning>
  Pro Search only works when streaming is enabled. Non-streaming requests will fall back to standard Sonar Pro behavior.
</Warning>

<div className="grid grid-cols-1 md:grid-cols-2 gap-8">
  <div>
    <h3 className="font-semibold text-foreground mb-4">Standard Sonar Pro</h3>

    <ul className="space-y-2 text-muted-foreground">
      <li>Single web search execution</li>
      <li>Fast response synthesis</li>
      <li>Fixed search strategy</li>
      <li>Static result processing</li>
    </ul>
  </div>

  <div>
    <h3 className="font-semibold text-foreground mb-4">Pro Search for Sonar Pro</h3>

    <ul className="space-y-2 text-muted-foreground">
      <li>Multi-step reasoning with automated tools</li>
      <li>Dynamic tool execution</li>
      <li>Real-time thought streaming</li>
      <li>Adaptive research strategies</li>
    </ul>
  </div>
</div>

## Basic Usage

Enabling Pro Search requires setting `stream` to `true` and specifying `"search_type": "pro"` in your API request. The default search type is `"fast"` for regular Sonar Pro.

Here is an example of how to enable Pro Search with streaming:

<CodeGroup>
  ```python Python SDK theme={null}
  from perplexity import Perplexity

  client = Perplexity(api_key="YOUR_API_KEY")

  messages = [
      {
          "role": "user", 
          "content": "Analyze the latest developments in quantum computing and their potential impact on cryptography. Include recent research findings and expert opinions."
      }
  ]

  response = client.chat.completions.create(
      model="sonar-pro",
      messages=messages,
      stream=True,
      web_search_options={
          "search_type": "pro"
      }
  )

  for chunk in response:
      if chunk.choices[0].delta.content:
          print(chunk.choices[0].delta.content, end="")
  ```

  ```typescript TypeScript SDK theme={null}
  import { Perplexity } from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity({
    apiKey: 'YOUR_API_KEY'
  });

  const response = await client.chat.completions.create({
    model: 'sonar-pro',
    messages: [
      {
        role: 'user',
        content: 'Analyze the latest developments in quantum computing and their potential impact on cryptography. Include recent research findings and expert opinions.'
      }
    ],
    stream: true,
    web_search_options: {
      search_type: 'pro'
    }
  });

  for await (const chunk of response) {
    if (chunk.choices[0]?.delta?.content) {
      process.stdout.write(chunk.choices[0].delta.content);
    }
  }
  ```

  ```bash cURL theme={null}
  curl --request POST \
    --url https://api.perplexity.ai/chat/completions \
    --header "Authorization: Bearer YOUR_API_KEY" \
    --header "Content-Type: application/json" \
    --data '{
      "model": "sonar-pro",
      "messages": [
        {
          "role": "user",
          "content": "Analyze the latest developments in quantum computing and their potential impact on cryptography. Include recent research findings and expert opinions."
        }
      ],
      "stream": true,
      "web_search_options": {
        "search_type": "pro"
      }
    }' --no-buffer
  ```
</CodeGroup>

<Accordion title="Response">
  ```json  theme={null}
  {
    "id": "2f16f4a0-e1d7-48c7-832f-8757b96ec221",
    "model": "sonar-pro", 
    "created": 1759957470,
    "usage": {
      "prompt_tokens": 15,
      "completion_tokens": 98,
      "total_tokens": 113,
      "search_context_size": "low",
      "cost": {
        "input_tokens_cost": 0.0,
        "output_tokens_cost": 0.001,
        "request_cost": 0.014,
        "total_cost": 0.015
      }
    },
    "search_results": [
      {
        "title": "Quantum Computing Breakthrough 2024",
        "url": "https://example.com/quantum-breakthrough",
        "date": "2024-03-15",
        "snippet": "Researchers at MIT have developed a new quantum error correction method...",
        "source": "web"
      }
    ],
    "reasoning_steps": [
      {
        "thought": "I need to search for recent quantum computing developments first.",
        "type": "web_search",
        "web_search": {
          "search_keywords": [
            "quantum computing developments 2024 cryptography impact",
            "post-quantum cryptography"
          ],
          "search_results": [
            {
              "title": "Quantum Computing Breakthrough 2024",
              "url": "https://example.com/quantum-breakthrough",
              "date": "2024-03-15",
              "last_updated": "2024-03-20",
              "snippet": "Researchers at MIT have developed a new quantum error correction method...",
              "source": "web"
            }
          ]
        }
      },
      {
        "thought": "Let me fetch detailed content from this research paper.",
        "type": "fetch_url_content", 
        "fetch_url_content": {
          "contents": [
            {
              "title": "Quantum Error Correction Paper",
              "url": "https://arxiv.org/abs/2024.quantum",
              "date": null,
              "last_updated": null,
              "snippet": "Abstract: This paper presents a novel approach to quantum error correction...",
              "source": "web"
            }
          ]
        }
      }
    ],
    "object": "chat.completion.chunk",
    "choices": [
      {
        "index": 0,
        "delta": {
          "role": "assistant",
          "content": "## Latest Quantum Computing Developments\n\nBased on my research and analysis..."
        }
      }
    ]
  }
  ```
</Accordion>

## Enabling Automatic Classification

Sonar Pro can be configured to automatically classify queries into Pro Search or Fast Search based on complexity. This is the recommended approach for most applications.

Set `search_type: "auto"` to let the system intelligently route queries based on complexity.

<CodeGroup>
  ```python Python SDK theme={null}
  from perplexity import Perplexity

  client = Perplexity(api_key="YOUR_API_KEY")

  response = client.chat.completions.create(
      model="sonar-pro",
      messages=[
          {
              "role": "user",
              "content": "Compare the energy efficiency of Tesla Model 3, Chevrolet Bolt, and Nissan Leaf"
          }
      ],
      stream=True,
      web_search_options={
          "search_type": "auto"  # Automatic classification
      }
  )

  for chunk in response:
      if chunk.choices[0].delta.content:
          print(chunk.choices[0].delta.content, end="")
  ```

  ```typescript TypeScript SDK theme={null}
  import { Perplexity } from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity({
    apiKey: 'YOUR_API_KEY'
  });

  const response = await client.chat.completions.create({
    model: 'sonar-pro',
    messages: [
      {
        role: 'user',
        content: 'Compare the energy efficiency of Tesla Model 3, Chevrolet Bolt, and Nissan Leaf'
      }
    ],
    stream: true,
    web_search_options: {
      search_type: 'auto'  // Automatic classification
    }
  });

  for await (const chunk of response) {
    if (chunk.choices[0]?.delta?.content) {
      process.stdout.write(chunk.choices[0].delta.content);
    }
  }
  ```

  ```bash cURL theme={null}
  curl --request POST \
    --url https://api.perplexity.ai/chat/completions \
    --header "Authorization: Bearer YOUR_API_KEY" \
    --header "Content-Type: application/json" \
    --data '{
      "model": "sonar-pro",
      "messages": [
        {
          "role": "user",
          "content": "Compare the energy efficiency of Tesla Model 3, Chevrolet Bolt, and Nissan Leaf"
        }
      ],
      "stream": true,
      "web_search_options": {
        "search_type": "auto"
      }
    }' --no-buffer
  ```
</CodeGroup>

#### How Classification Works

The classifier analyzes your query and automatically routes it to:

* **Pro Search** for complex queries requiring:
  * Multi-step reasoning or analysis
  * Comparative analysis across multiple sources
  * Deep research workflows

* **Fast Search** for straightforward queries like:
  * Simple fact lookups
  * Direct information retrieval
  * Basic question answering

#### Billing with Auto Classification

**You are billed based on which search type your query triggers:**

* If classified as **Pro Search**: \$14–\$22 per 1,000 requests (based on context size)
* If classified as **Fast Search**: \$6–\$14 per 1,000 requests (based on context size - same as standard Sonar Pro)

To see the full pricing details, see the <a href="/guides/pro-search-quickstart#pricing" className="underline">Pricing</a> section.

<Tip>
  Automatic classification is recommended for most applications as it balances cost optimization with query performance. You get Pro Search capabilities when needed without overpaying for simple queries.
</Tip>

### Manually Specifying the Search Type

If needed, you can manually specify the search type. This is useful for specific use cases where you know the query requires Pro Search capabilities.

* **`"search_type": "pro"`** — Manually specify Pro Search for complex queries when you know multi-step tool usage is needed
* **`"search_type": "fast"`** — Manually specify Fast Search for simple queries to optimize speed and cost (this is also the default when `search_type` is omitted)

## Built-in Tool Capabilities

Pro Search provides access to two powerful built-in tools that the model can use automatically:

<CardGroup cols={1}>
  <Card title="web_search" icon="magnifying-glass" href="/guides/pro-search-tools#web-search">
    Conduct targeted web searches with custom queries, filters, and search strategies based on the evolving research context.
  </Card>

  <Card title="fetch_url_content" icon="globe" href="/guides/pro-search-tools#fetch-url-content">
    Retrieve and analyze content from specific URLs to gather detailed information beyond search result snippets.
  </Card>
</CardGroup>

<Info>
  The model automatically decides which tools to use and when, creating dynamic research workflows tailored to each specific query. These are built-in tools that the system calls for you—you cannot register custom tools. Learn more in the [Built-in Tool Capabilities](/guides/pro-search-agentic-tools) guide.
</Info>

## Additional Capabilities

Pro Search also provides access to advanced Sonar Pro features that enhance your development experience:

* **[Stream Mode Guide](/guides/pro-search-stream-mode-guide)**: Control streaming response formats with concise or full mode for optimized bandwidth usage and enhanced reasoning visibility.

## Pricing

Pro Search pricing consists of token usage plus request fees that vary by search type and context size.

<div className="space-y-8 my-8">
  <div>
    <h3 className="text-lg font-semibold text-foreground mb-4">Token Usage (Same for All Search Types)</h3>

    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <span className="text-sm text-muted-foreground">Input Tokens</span>
        <span className="text-lg font-mono text-foreground">\$3 per 1M</span>
      </div>

      <div className="flex justify-between items-center">
        <span className="text-sm text-muted-foreground">Output Tokens</span>
        <span className="text-lg font-mono text-foreground">\$15 per 1M</span>
      </div>
    </div>
  </div>

  <div>
    <h3 className="text-lg font-semibold text-foreground mb-4">Request Fees (per 1,000 requests)</h3>

    <div className="mb-6">
      <h4 className="text-md font-medium text-foreground mb-3">Pro Search (Complex Queries)</h4>

      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">High Context</span>
          <span className="text-lg font-mono text-foreground">\$22</span>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">Medium Context</span>
          <span className="text-lg font-mono text-foreground">\$18</span>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">Low Context</span>
          <span className="text-lg font-mono text-foreground">\$14</span>
        </div>
      </div>
    </div>

    <div>
      <h4 className="text-md font-medium text-foreground mb-3">Fast Search (Simple Queries)</h4>

      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">High Context</span>
          <span className="text-lg font-mono text-foreground">\$14</span>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">Medium Context</span>
          <span className="text-lg font-mono text-foreground">\$10</span>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">Low Context</span>
          <span className="text-lg font-mono text-foreground">\$6</span>
        </div>
      </div>
    </div>
  </div>
</div>

<Info>
  When using `search_type: "auto"`, you're billed at the Pro Search rate if your query is classified as complex, or the Fast Search rate if classified as simple. See the full pricing details <a href="/getting-started/pricing" className="underline">here</a>.
</Info>

## Next Steps

<CardGroup cols={2}>
  <Card title="Chat Completions Guide" icon="comments" href="/guides/chat-completions-guide">
    Comprehensive guide to the chat completions API
  </Card>

  <Card title="API Reference" icon="book" href="/api-reference/chat-completions-post">
    Complete API documentation and parameter reference
  </Card>
</CardGroup>
