> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Prompt the agent

> Split the standing rules (the system prompt) from the question (input), and ground the run so the agent searches and answers on the right thing.

An agent has two prompt surfaces, and keeping them distinct matters. `instructions` is the agent's **system prompt** — the rules that hold on every turn. `input` is the specific thing to do this turn. When retrieval tools are enabled, `input` is also what the model uses to decide whether and what to search. This page draws the line between the two and shows how to ground the run on retrieved evidence.

## `instructions` vs `input`

| Field | What goes here |
| - | - |
| `instructions` | The system prompt: role, tone, output language, citation and formatting rules, and hard do/don'ts. Applied on every turn of the loop, independent of the question. |
| `input` | The question or task for this turn. It guides tool selection, and when retrieval is enabled, it is what the model searches on, so a more specific `input` produces more targeted retrieval. |

A useful principle: if a rule should still apply when the user asks something completely different, it belongs in `instructions` (the system prompt). If it is about this request, it belongs in `input`.

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()

  response = client.responses.create(
      model="openai/gpt-5.6-sol",
      instructions=(
          "You are a financial analyst. Always cite sources by domain, "
          "and never speculate beyond retrieved evidence."
      ),
      input="Which operating segments did Apple report in its most recent annual 10-K, and how did each contribute to revenue?",
      tools=[{"type": "web_search"}],
  )

  print(response.output_text)
  ```

  ```typescript TypeScript theme={null}
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  const response = await client.responses.create({
    model: 'openai/gpt-5.6-sol',
    instructions:
      'You are a financial analyst. Always cite sources by domain, and never speculate beyond retrieved evidence.',
    input: 'Which operating segments did Apple report in its most recent annual 10-K, and how did each contribute to revenue?',
    tools: [{ type: 'web_search' as const }],
  });

  console.log(response.output_text);
  ```

  ```bash cURL theme={null}
  curl https://api.perplexity.ai/v1/agent \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/gpt-5.6-sol",
      "instructions": "You are a financial analyst. Always cite sources by domain, and never speculate beyond retrieved evidence.",
      "input": "Which operating segments did Apple report in its most recent annual 10-K, and how did each contribute to revenue?",
      "tools": [{ "type": "web_search" }]
    }' | jq
  ```
</CodeGroup>

<Note>
  With a `preset`, `instructions` replaces the preset's tuned system prompt instead of appending to it. Omit `instructions` to keep the preset prompt. See [Define the run](/docs/agent-api/building-agents/define-the-run#customize-the-system-prompt-instructions).
</Note>

## Ground the run

Grounding keeps the agent answering from retrieved evidence rather than from the model's own priors. Two levers do most of the work:

* Specific `input`. When retrieval tools are enabled, the model searches based on `input`. "Apple FY2025 10-K revenue by operating segment" retrieves more targeted results than "how is Apple doing." Name entities, time ranges, and the unit of the answer.
* Retrieval tools. Enable `web_search` and related tools so the agent pulls live evidence. See [Give it tools](/docs/agent-api/building-agents/give-it-tools).

For hard constraints — allowed domains, date ranges, region — prefer request parameters over prose. They are enforced rather than merely requested:

```python theme={null}
tools=[{
    "type": "web_search",
    "filters": {
        "search_domain_filter": ["sec.gov"],
        "search_after_date_filter": "01/01/2026",
    },
}]
```

<Tip>
  Built-in tools like `web_search` and `fetch_url` generally work without much prompt-side coaching. Reach for `web_search` filters and `response_format` before adding more instruction prose — parameters are enforced directly and don't re-process on every loop step the way system-prompt tokens do.
</Tip>

## Read the sources back

A grounded answer comes with its evidence. Retrieval tools attach their results to the response `output` array (for example `search_results` items alongside the `message`), so you can surface citations or verify claims. See the per-tool reference pages — starting with [Web Search → Response shape](/docs/agent-api/tools/web-search#response-shape) — for exact response shapes.

## Next steps

<CardGroup cols={2}>
  <Card title="Give it tools" icon="tool" href="/docs/agent-api/building-agents/give-it-tools">
    Enable built-in tools and your own custom tools, then read their results.
  </Card>

  <Card title="Prompt Guide" icon="bulb" href="/docs/agent-api/prompt-guide">
    Full prompting patterns and best practices.
  </Card>
</CardGroup>
