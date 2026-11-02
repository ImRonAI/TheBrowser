> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Run code

> Give the agent a sandbox so it computes exact answers instead of estimating them, runs real code, and returns generated files.

Language models approximate exact arithmetic and data manipulation rather than computing them. The `sandbox` tool gives the agent an isolated Linux container to run real code and use the output in its answer — for results that must be exact, like a computed number, a transformed dataset, or a generated report. From inside the container the agent can also call Perplexity's [Web Search](/docs/agent-api/tools/web-search), [Fetch URL Content](/docs/agent-api/tools/fetch-url-content), and [People Search](/docs/agent-api/tools/people-search) without adding them to the request, then compute on what they return — each billed at its standard rate. The [Sandbox tool reference](/docs/agent-api/tools/sandbox) has the full settings, response shape, and pricing.

## Enable the sandbox

Add `{"type": "sandbox"}` to the `tools` array. The model decides when to run code based on your prompt.

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
      input="Compute the compound annual growth rate from 4.2M in 2019 to 11.8M in 2025.",
      tools=[{"type": "sandbox"}],
      instructions="Use the sandbox to compute the exact figure before answering.",
  )

  print(get_output_text(response))
  ```

  ```typescript TypeScript theme={null}
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  const response = await client.responses.create({
    model: 'openai/gpt-5.6-sol',
    input: 'Compute the compound annual growth rate from 4.2M in 2019 to 11.8M in 2025.',
    tools: [{ type: 'sandbox' as const }],
    instructions: 'Use the sandbox to compute the exact figure before answering.',
  });

  console.log(response.output_text);
  ```

  ```bash cURL theme={null}
  curl https://api.perplexity.ai/v1/agent \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/gpt-5.6-sol",
      "input": "Compute the compound annual growth rate from 4.2M in 2019 to 11.8M in 2025.",
      "tools": [{ "type": "sandbox" }],
      "instructions": "Use the sandbox to compute the exact figure before answering."
    }' | jq
  ```
</CodeGroup>

## When to reach for it

* Numeric calculations and statistical analysis where an estimate won't do
* Data cleaning, parsing, and transformation
* Executing code to check logic or reproduce an error
* Generating files and artifacts — CSV, JSON, HTML, reports, or any other file the code writes
* Multi-step workflows that need intermediate files or computed state

<Tip>
  Combine `sandbox` with `web_search` and the agent can gather evidence, then compute on it inside the container. See the [Sandbox reference](/docs/agent-api/tools/sandbox) for how the sandbox interacts with other tools.
</Tip>

## Read the computed result

When the agent runs code, the response `output` array includes one or more `sandbox_results` items alongside the `message`. Each carries the executed `code`, the `language`, and a `results` array with `stdout`, `stderr`, `exit_code`, and `status`. That's how you verify the agent computed the answer rather than guessing it. See the [response shape reference](/docs/agent-api/tools/sandbox#response-shape) for every field.

Read that item off the response (`response` here is from the [Enable the sandbox](#enable-the-sandbox) example above):

```python Python theme={null}
for item in response.output:
    if item.type == "sandbox_results":
        print(item.code)
        print(item.results[0].stdout)
```

For that request, the agent wrote and ran this Python in the sandbox, then used the printed value in its answer:

<Accordion title="Response">
  <Tabs>
    <Tab title="Formatted code">
      ```python theme={null}
      from decimal import Decimal, getcontext

      getcontext().prec = 50
      start = Decimal('4.2')
      end = Decimal('11.8')
      years = Decimal(2025 - 2019)
      log_growth = (end / start).ln() / years
      cagr = log_growth.exp() - Decimal(1)
      print(cagr)
      print(cagr * 100)
      ```

      ```text Output theme={null}
      0.1878787669330553776746033271110368937629924939521
      18.787876693305537767460332711103689376299249395210
      ```
    </Tab>

    <Tab title="Raw response">
      ```json theme={null}
      {
        "id": "resp_482ba96d-c94a-4b0b-8032-e29062a71cdc",
        "created_at": 1781869590,
        "model": "openai/gpt-5.6-sol",
        "object": "response",
        "output": [
          {
            "id": null,
            "content": null,
            "role": null,
            "status": "completed",
            "type": "sandbox_results",
            "call_id": "call_7br1ycfTNZ2jFa4HG6otVC76",
            "code": "from decimal import Decimal, getcontext\ngetcontext().prec=50\nstart=Decimal('4.2')\nend=Decimal('11.8')\nyears=Decimal(2025-2019)\n# Decimal fractional power via exp ln? Decimal has ln exp\ncagr=(end/start).ln()/years\nrate=cagr.exp()-Decimal(1)\nprint(rate)\nprint(rate*100)",
            "container_id": "iuptasr65kixvn1p7s3r6",
            "language": "python",
            "results": [
              {
                "duration_ms": 274,
                "exit_code": 0,
                "status": "completed",
                "stderr": "",
                "stdout": "0.1878787669330553776746033271110368937629924939521\n18.787876693305537767460332711103689376299249395210\n"
              }
            ]
          },
          {
            "id": "msg_8349d00e-ca88-4074-a7bd-e3dea9fe77cf",
            "content": [
              {
                "text": "The compound annual growth rate (CAGR) from **4.2M in 2019** to **11.8M in 2025** is:\n\n\\[\n\\text{CAGR} = \\left(\\frac{11.8}{4.2}\\right)^{1/6} - 1\n\\]\n\n\\[\n\\text{CAGR} \\approx 18.79\\%\n\\]\n\n**Answer: 18.8% per year**.",
                "type": "output_text",
                "annotations": []
              }
            ],
            "role": "assistant",
            "status": "completed",
            "type": "message"
          }
        ],
        "status": "completed",
        "background": false,
        "error": null,
        "usage": {
          "input_tokens": 3262,
          "output_tokens": 294,
          "total_tokens": 3556,
          "cost": {
            "currency": "USD",
            "input_cost": 0.01305,
            "output_cost": 0.00588,
            "total_cost": 0.01893,
            "cache_creation_cost": null,
            "cache_read_cost": null,
            "tool_calls_cost": 0.0,
            "tool_calls_cost_details": {
              "sandbox": 0
            }
          },
          "input_tokens_details": {
            "cache_creation_input_tokens": null,
            "cache_read_input_tokens": null,
            "cached_tokens": 0
          },
          "tool_calls_details": {
            "sandbox": {
              "invocation": 1,
              "duration_ms": 274
            }
          },
          "output_tokens_details": {
            "reasoning_tokens": 56
          }
        },
        "completed_at": 1781869590,
        "frequency_penalty": 0,
        "incomplete_details": null,
        "instructions": "Use the sandbox to compute the exact figure before answering.",
        "max_output_tokens": null,
        "max_tool_calls": null,
        "metadata": {},
        "parallel_tool_calls": true,
        "presence_penalty": 0,
        "previous_response_id": null,
        "prompt_cache_key": null,
        "reasoning": null,
        "safety_identifier": null,
        "service_tier": "default",
        "store": true,
        "temperature": 1,
        "text": {
          "format": {
            "type": "text"
          }
        },
        "tool_choice": "auto",
        "tools": [
          {
            "type": "sandbox"
          }
        ],
        "top_logprobs": 0,
        "top_p": 1,
        "truncation": "",
        "user": null
      }
      ```
    </Tab>
  </Tabs>
</Accordion>

## Return files

When code in the sandbox writes a file and shares it, the response `output` includes a `share_file` item. The bytes aren't inline — list and download them with the response files endpoints, keyed by the response `id`:

<CodeGroup>
  ```python Python theme={null}
  files = client.responses.files.list(response.id)
  for f in files.data:
      print(f.id, f.filename, f.bytes)

  content = client.responses.files.content(
      file_id=files.data[0].id,
      response_id=response.id,
  )
  content.write_to_file(files.data[0].filename)
  ```

  ```bash cURL theme={null}
  # List files the response produced
  curl https://api.perplexity.ai/v1/agent/$RESPONSE_ID/files \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" | jq

  # Download one by its file id
  curl https://api.perplexity.ai/v1/agent/$RESPONSE_ID/files/$FILE_ID/content \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -o output.csv
  ```
</CodeGroup>

<Note>
  Long-running sandbox work pairs well with background runs: submit with `background: true` and poll by ID. See [Output Control](/docs/agent-api/output-control) and the [Sandbox reference](/docs/agent-api/tools/sandbox#running-in-the-background).
</Note>

## Next steps

<CardGroup cols={2}>
  <Card title="Structure the output" icon="list-details" href="/docs/agent-api/building-agents/shape-output">
    Enforce structured JSON your code can parse.
  </Card>

  <Card title="Sandbox reference" icon="box" href="/docs/agent-api/tools/sandbox">
    Full sandbox settings, response shape, file retrieval, and pricing.
  </Card>
</CardGroup>
