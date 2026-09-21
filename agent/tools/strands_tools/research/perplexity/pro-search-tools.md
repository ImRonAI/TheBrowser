> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Built-in Tool Capabilities

> Learn about Pro Search's built-in tools: web search and URL content fetching

## Overview

Pro Search provides two built-in tools that the model uses automatically to answer your queries. The model decides which tools to use and when—you don't need to configure anything. These tools are called automatically by the system; you cannot register custom tools.

<Info>
  All tool executions appear in the `reasoning_steps` array of streaming responses, giving you visibility into how the model researched your query.
</Info>

## web\_search

Conducts web searches to find current information, statistics, and expert opinions.

**Example in action:**

```json  theme={null}
{
  "thought": "I need current data on EV market trends",
  "type": "web_search",
  "web_search": {
    "search_keywords": [
      "EV Statistics 2023-2024",
      "electric vehicle sales data",
      "global EV market trends"
    ],
    "search_results": [
      {
        "title": "Trends in electric cars",
        "url": "https://www.iea.org/reports/global-ev-outlook-2024/trends-in-electric-cars",
        "date": "2024-03-15",
        "last_updated": null,
        "snippet": "Electric car sales neared 14 million in 2023, 95% of which were in China, Europe and the United States...",
        "source": "web"
      }
    ]
  }
}
```

## fetch\_url\_content

Retrieves full content from specific URLs to access detailed information beyond search result snippets.

**Example in action:**

```json  theme={null}
{
  "thought": "This research paper contains detailed methodology I need to review",
  "type": "fetch_url_content",
  "fetch_url_content": {
    "contents": [
      {
        "title": "Attention Is All You Need",
        "url": "https://arxiv.org/pdf/1706.03762",
        "date": null,
        "last_updated": null,
        "snippet": "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder...",
        "source": "web"
      }
    ]
  }
}
```

## Multi-Tool Workflows

The model automatically combines multiple tools when needed. For example, when asked to research solar panel options, it might:

1. Use `web_search` to find current incentives and costs
2. Use `fetch_url_content` to read detailed policy documents
3. Use `web_search` again to verify electricity rates and compare providers

## Related Resources

<CardGroup cols={2}>
  <Card title="Quickstart" icon="rocket" href="/guides/pro-search-quickstart">
    Get started with Pro Search basics
  </Card>

  <Card title="Stream Mode Guide" icon="bolt" href="/guides/stream-mode-guide">
    Learn about streaming and real-time reasoning visibility
  </Card>

  <Card title="API Reference" icon="book" href="/api-reference/chat-completions-post">
    Complete API documentation
  </Card>
</CardGroup>
