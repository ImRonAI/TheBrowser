> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Custom Functions

> Define a custom function, execute model-requested calls in your code, and return each result to the Agent API.

Custom functions let an agent use code you control, such as a database query, an internal API, or business logic. You describe the function in the request, but the Agent API never executes it for you. Your application handles the call and returns the result.

## Run a complete example

This example defines an order-status function and completes the entire tool loop. Replace the in-memory lookup with your own database or API call.

<Steps>
  <Step title="Install the SDK">
    ```bash theme={null}
    pip install perplexityai
    ```
  </Step>

  <Step title="Set your API key">
    ```bash theme={null}
    export PERPLEXITY_API_KEY="your_api_key_here"
    ```
  </Step>

  <Step title="Save and run the example">
    Save one example as `custom_function.py` or `custom-function.ts`, then run it.

    <CodeGroup>
      ```python Python theme={null}
      import json

      from perplexity import Perplexity

      MODEL = "openai/gpt-5.6-sol"
      QUESTION = "What's the status of order ORD-10042?"

      client = Perplexity()

      tools = [
          {
              "type": "function",
              "name": "get_order_status",
              "description": "Look up the current status of an order by its order ID.",
              "parameters": {
                  "type": "object",
                  "properties": {"order_id": {"type": "string"}},
                  "required": ["order_id"],
                  "additionalProperties": False,
              },
              "strict": True,
          }
      ]


      def get_order_status(order_id: str) -> dict[str, str]:
          """Replace this sample data with a database or API call."""
          orders = {
              "ORD-10042": {
                  "status": "in_transit",
                  "carrier": "DHL",
                  "estimated_delivery": "2026-08-08",
              }
          }
          return orders.get(order_id, {"error": "Order not found."})


      # 1. Send the question and available tools to the model.
      response = client.responses.create(
          model=MODEL,
          input=QUESTION,
          tools=tools,
      )

      # 2. Add the model's output items to the conversation.
      next_input = [
          {"type": "message", "role": "user", "content": QUESTION},
          *[item.model_dump(exclude_none=True) for item in response.output],
      ]

      # 3. Run every function the model requested, then append its result.
      for item in response.output:
          if item.type != "function_call":
              continue
          if item.name != "get_order_status":
              raise ValueError(f"Unknown function: {item.name}")

          arguments = json.loads(item.arguments)
          result = get_order_status(**arguments)
          next_input.append(
              {
                  "type": "function_call_output",
                  "call_id": item.call_id,
                  "output": json.dumps(result),
              }
          )

      # 4. Send the updated conversation back so the model can answer.
      final_response = client.responses.create(
          model=MODEL,
          input=next_input,
          tools=tools,
      )

      print(final_response.output_text)
      ```

      ```typescript Typescript theme={null}
      import Perplexity from '@perplexity-ai/perplexity_ai';
      import type { InputItem } from '@perplexity-ai/perplexity_ai/resources/responses/responses';

      const MODEL = 'openai/gpt-5.6-sol';
      const QUESTION = "What's the status of order ORD-10042?";

      const client = new Perplexity();

      const tools = [
        {
          type: 'function' as const,
          name: 'get_order_status',
          description: 'Look up the current status of an order by its order ID.',
          parameters: {
            type: 'object',
            properties: { order_id: { type: 'string' } },
            required: ['order_id'],
            additionalProperties: false,
          },
          strict: true,
        },
      ];

      function getOrderStatus(orderId: string): Record<string, string> {
        // Replace this sample data with a database or API call.
        const orders: Record<string, Record<string, string>> = {
          'ORD-10042': {
            status: 'in_transit',
            carrier: 'DHL',
            estimated_delivery: '2026-08-08',
          },
        };
        return orders[orderId] ?? { error: 'Order not found.' };
      }

      // 1. Send the question and available tools to the model.
      const response = await client.responses.create({
        model: MODEL,
        input: QUESTION,
        tools,
      });

      // 2. Start the continuation with the original question.
      const nextInput: InputItem[] = [
        { type: 'message', role: 'user', content: QUESTION },
      ];

      // 3. Replay each function call, run it locally, and append its result.
      for (const item of response.output) {
        if (item.type !== 'function_call') continue;
        nextInput.push({
          type: 'function_call',
          call_id: item.call_id,
          name: item.name,
          arguments: item.arguments,
          ...(item.thought_signature
            ? { thought_signature: item.thought_signature }
            : {}),
        });

        if (item.name !== 'get_order_status') {
          throw new Error(`Unknown function: ${item.name}`);
        }
        const args = JSON.parse(item.arguments) as { order_id: string };
        const result = getOrderStatus(args.order_id);
        nextInput.push({
          type: 'function_call_output',
          call_id: item.call_id,
          output: JSON.stringify(result),
        });
      }

      // 4. Send the updated conversation back so the model can answer.
      const finalResponse = await client.responses.create({
        model: MODEL,
        input: nextInput,
        tools,
      });

      console.log(finalResponse.output_text);
      ```
    </CodeGroup>

    Run it:

    <CodeGroup>
      ```bash Python theme={null}
      python custom_function.py
      ```

      ```bash Typescript theme={null}
      npm install @perplexity-ai/perplexity_ai tsx
      npx tsx custom-function.ts
      ```
    </CodeGroup>

    Example terminal output:

    ```text theme={null}
    Order ORD-10042 is in transit with DHL. Estimated delivery is Saturday, August 8, 2026.
    ```
  </Step>
</Steps>

## How the loop works

The two Agent API requests wrap one local function execution:

1. **Declare and call.** Your first request includes the user's question and the function schema in `tools`.
2. **Read `function_call`.** The model returns a `function_call` item in `response.output`. Its `arguments` field is a JSON string, so parse it before calling your code.
3. **Execute locally.** Your application calls `get_order_status` with those arguments. This code does not run in the Agent API.
4. **Return `function_call_output`.** Append the model's output items and a `function_call_output` containing the local result, then make another request. Copy the original `call_id` so the model can match the result to its call.
5. **Read the answer.** After it receives the function result, the model returns a normal assistant `message`. If it requests another function instead, repeat the same loop.

## Inspect the response arrays

Here is the complete `output` array from the first request. `arguments` is JSON encoded as a string, and IDs vary between requests.

```json theme={null}
[
  {
    "id": "fc_a181bc3f-7a54-40b6-a85e-a50a0a6fac92",
    "arguments": "{\"order_id\":\"ORD-10042\"}",
    "call_id": "call_Ku9yfMSIZWrJBGm2wqCaFF0G",
    "name": "get_order_status",
    "status": "completed",
    "type": "function_call"
  }
]
```

The application executes `get_order_status` and sends this continuation `input` array. The `function_call` and `function_call_output` carry the same `call_id`:

```json theme={null}
[
  {
    "type": "message",
    "role": "user",
    "content": "What's the status of order ORD-10042?"
  },
  {
    "id": "fc_a181bc3f-7a54-40b6-a85e-a50a0a6fac92",
    "arguments": "{\"order_id\":\"ORD-10042\"}",
    "call_id": "call_Ku9yfMSIZWrJBGm2wqCaFF0G",
    "name": "get_order_status",
    "status": "completed",
    "type": "function_call"
  },
  {
    "type": "function_call_output",
    "call_id": "call_Ku9yfMSIZWrJBGm2wqCaFF0G",
    "output": "{\"status\": \"in_transit\", \"carrier\": \"DHL\", \"estimated_delivery\": \"2026-08-08\"}"
  }
]
```

The second request then returns this complete `output` array:

```json theme={null}
[
  {
    "id": "msg_b95a5d0d-bb02-4f09-bde4-22a781265e61",
    "content": [
      {
        "text": "Order **ORD-10042** is **in transit** with **DHL**. Estimated delivery is **Saturday, August 8, 2026**.",
        "type": "output_text",
        "annotations": []
      }
    ],
    "role": "assistant",
    "status": "completed",
    "type": "message"
  }
]
```

<Note>
  Some models include a `thought_signature` on `function_call` items. Preserve it when you replay the item. The Python example does this by serializing the complete SDK object; the TypeScript example copies it when present.
</Note>

## Next steps

<CardGroup cols={2}>
  <Card title="Function calling cookbook" icon="book" href="/docs/cookbook/articles/function-calling-e2e/README">
    Handle multiple functions, parallel calls, and failures in production workflows.
  </Card>

  <Card title="Tools overview" icon="list" href="/docs/agent-api/tools/overview">
    Compare custom functions with built-in tools and MCP servers.
  </Card>
</CardGroup>
