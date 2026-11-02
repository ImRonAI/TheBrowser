> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Structure the output

> Force the model to return JSON your code can parse instead of prose you have to scrape.

By default a run returns one block of text when it finishes. When a downstream system has to consume the result, free-form prose is hard to work with — you end up writing brittle parsers. Structured output makes the model return JSON that conforms to a schema you define, so you can deserialize it directly. For the exhaustive reference — streaming, background runs, error handling, and full schema examples — see [Output Control](/docs/agent-api/output-control).

## Structured output

Set `response_format` to a `json_schema` with a `name` and a `schema`. The response text conforms to the schema unless generation is cut short. The example below builds the schema from a Pydantic model and validates the response against it:

<CodeGroup>
  ```python Python theme={null}
  from typing import List, Optional
  from pydantic import BaseModel
  from perplexity import Perplexity

  class CompanySummary(BaseModel):
      name: str
      sector: str
      headquarters: str
      key_products: Optional[List[str]] = None

  client = Perplexity()

  response = client.responses.create(
      model="openai/gpt-5.6-sol",
      input="Summarize NVIDIA: sector, headquarters, and key products.",
      response_format={
          "type": "json_schema",
          "json_schema": {
              "name": "company_summary",
              "schema": {
                  **CompanySummary.model_json_schema(),
                  "required": list(CompanySummary.model_fields.keys()),
                  "additionalProperties": False,
              },
          },
      },
  )

  summary = CompanySummary.model_validate_json(response.output_text)
  print(summary.name, summary.sector)
  ```

  ```bash cURL theme={null}
  curl https://api.perplexity.ai/v1/agent \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/gpt-5.6-sol",
      "input": "Summarize NVIDIA: sector, headquarters, and key products.",
      "response_format": {
        "type": "json_schema",
        "json_schema": {
          "name": "company_summary",
          "schema": {
            "type": "object",
            "properties": {
              "name": { "type": "string" },
              "sector": { "type": "string" },
              "headquarters": { "type": "string" },
              "key_products": { "type": "array", "items": { "type": "string" } }
            },
            "required": ["name", "sector", "headquarters"]
          }
        }
      }
    }' | jq
  ```
</CodeGroup>

<Tip>
  Reinforce the schema in your prompt ("Return the data as a JSON object matching the schema") to improve adherence.
</Tip>

<Warning>
  Avoid asking for links inside the JSON. A model emitting URLs as part of structured output can produce malformed or fabricated links. Pull links from the `citations` or `search_results` items in the response `output` instead.
</Warning>

## Next steps

<CardGroup cols={2}>
  <Card title="Keep context" icon="link" href="/docs/agent-api/building-agents/keep-context">
    Carry state across multiple turns.
  </Card>

  <Card title="Output Control" icon="sliders" href="/docs/agent-api/output-control">
    Streaming, background runs, error handling, and full structured-output examples.
  </Card>
</CardGroup>
