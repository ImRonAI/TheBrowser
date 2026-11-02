> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Define the run

> Configure the agent run: start from a preset, then customize the system prompt, the loop bound, and the model.

Every agent run begins with one Agent API request. Before prompts, tools, or output format, you decide what runs and how far it can go. The fastest way to start is a `preset` — a tuned bundle of model, system prompt, search config, and tools — which you then customize with individual settings as needed. This page sets up the call the rest of this section builds on.

## Start from a preset

A `preset` gives you a working agent in one field.

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()

  response = client.responses.create(
      preset="low",
      input="Give me a thorough overview of the current state of solid-state battery commercialization.",
  )

  print(response.output_text)
  ```

  ```typescript TypeScript theme={null}
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  const response = await client.responses.create({
    preset: 'low',
    input: 'Give me a thorough overview of the current state of solid-state battery commercialization.',
  });

  console.log(response.output_text);
  ```

  ```bash cURL theme={null}
  curl https://api.perplexity.ai/v1/agent \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "preset": "low",
      "input": "Give me a thorough overview of the current state of solid-state battery commercialization."
    }' | jq
  ```
</CodeGroup>

Other presets trade depth against latency and cost. See [Presets](/docs/agent-api/presets) for what each one bundles and how preset updates are managed.

## Customize the system prompt: `instructions`

A `preset` ships its own tuned system prompt. The `instructions` field **is** the agent's system prompt — the standing rules that hold for every turn of the loop: role, tone, citation, and grounding rules. They apply regardless of what the user asks on a given turn.

```python theme={null}
instructions="You are a research assistant. Cite every claim by source domain, and never speculate beyond the retrieved evidence."
```

Setting `instructions` **replaces** the preset's system prompt rather than appending to it. Omit `instructions` to keep the preset's prompt.

<Note>
  Keep the system prompt lean. Every token here is re-processed on each step of the loop, so it adds up across tool calls. For machine-readable output or retrieval constraints, prefer request parameters (see [Structure the output](/docs/agent-api/building-agents/shape-output) and [Give it tools](/docs/agent-api/building-agents/give-it-tools)) over prose rules.
</Note>

## Customize the loop: `max_steps`

An agent run is a loop: the model reasons, optionally calls tools, reads the results, and repeats until it answers. One step is one pass through that cycle — a single model turn that may call tools. `max_steps` caps how many steps a run may take. Use it to bound runaway loops and to trade latency against depth. When a run reaches the cap, the agent doesn't error — it makes one final pass to answer from what it has gathered so far.

A low `max_steps` limits how many times the agent can act on tool results. At `max_steps: 1`, direct tools may still run, but the agent cannot loop back to reason over their results. Tools that need a setup turn, including `finance_search`, may not run at all.

When you specify `model` or `models` without a preset, omitting `max_steps` defaults the run to 1 step. Set it explicitly whenever your tools need multiple turns. For direct-model requests that enable `finance_search`, use `max_steps: 3` or higher so the agent has enough room to initialize and run the tool. Presets provide their own step budget unless you override it.

```python theme={null}
response = client.responses.create(
    preset="low",
    input="Give me a thorough overview of the current state of solid-state battery commercialization.",
    max_steps=20,
)
```

If you pass `max_steps` alongside a `preset`, it overrides the preset's value, up to the preset's own ceiling for chat-style presets.

## Customize the model: `model` or `models`

A preset picks a model for you. When you need full control over which model answers, set one explicitly instead of (or alongside) a preset:

| Field | What it is |
| - | - |
| `model` | A single model in `provider/model` format, for example `openai/gpt-5.6-sol`. |
| `models` | A fallback chain of up to 5 models, tried in order until one succeeds. |

If you set `models`, it takes precedence over `model`. See [Models](/docs/agent-api/models) for the catalog and pricing, and [Model fallback](/docs/agent-api/model-fallback) for how the chain resolves.

<Tip>
  Start from a `preset`, then move to an explicit `model` (or `models` chain) when you need to pin the exact engine.
</Tip>

## Next steps

<CardGroup cols={2}>
  <Card title="Prompt the agent" icon="message" href="/docs/agent-api/building-agents/prompt-the-agent">
    Split the system prompt from the question, and ground the run.
  </Card>

  <Card title="Presets" icon="stack-2" href="/docs/agent-api/presets">
    See the tuned presets you can start from.
  </Card>
</CardGroup>
