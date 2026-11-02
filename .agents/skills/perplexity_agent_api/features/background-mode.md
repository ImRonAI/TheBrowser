> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Background Mode

> Run long agentic tasks asynchronously — submit with background, poll by response id, stream, reconnect, and cancel.

## Overview

Long agentic runs, such as deep research or heavy sandbox work, can take several minutes. Background mode runs these tasks asynchronously so your application can avoid timeouts and dropped connections: submit the run, store its response id, then poll for the result. The run continues server-side even if your client disconnects.

## Submit a background request

Set `background=true` when you create the response. The submit endpoint is `POST https://api.perplexity.ai/v1/agent`. The create call returns a Response object immediately; store its `id` and check its initial `status`.

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()

  response = client.responses.create(
      model="openai/gpt-5.6-sol",
      input="Research the current EV charging market and summarize the main segments.",
      tools=[{"type": "web_search"}, {"type": "sandbox"}],
      background=True,
  )

  print(f"Response ID: {response.id}")
  print(f"Status: {response.status}")
  ```

  ```typescript Typescript theme={null}
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  const response = await client.responses.create({
    model: 'openai/gpt-5.6-sol',
    input: 'Research the current EV charging market and summarize the main segments.',
    tools: [{ type: 'web_search' }, { type: 'sandbox' }],
    background: true,
  });

  console.log(`Response ID: ${response.id}`);
  console.log(`Status: ${response.status}`);
  ```

  ```bash cURL theme={null}
  curl https://api.perplexity.ai/v1/agent \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/gpt-5.6-sol",
      "input": "Research the current EV charging market and summarize the main segments.",
      "tools": [{ "type": "web_search" }, { "type": "sandbox" }],
      "background": true
    }' | jq '{id, status}'
  ```
</CodeGroup>

## Poll for the result

Poll a background response with `GET https://api.perplexity.ai/v1/agent/{id}`. A background response is non-terminal while its status is `queued` or `in_progress`. It is terminal when its status is `completed`, `failed`, `cancelled`, or `incomplete` (`incomplete` marks a run that stopped before finishing, for example on truncation).

Poll until the response reaches any terminal status, then branch based on the final state.

<CodeGroup>
  ```python Python theme={null}
  import time
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
      input="Write a sourced brief on grid-scale battery storage trends.",
      tools=[{"type": "web_search"}, {"type": "sandbox"}],
      background=True,
  )

  while response.status not in ("completed", "failed", "cancelled", "incomplete"):
      time.sleep(2)
      response = client.responses.retrieve(response.id)

  print(f"Final status: {response.status}")

  if response.status == "completed":
      print(get_output_text(response))
  elif response.status == "failed":
      print(response.error)
  elif response.status == "cancelled":
      print("The response was cancelled.")
  elif response.status == "incomplete":
      print("The response stopped before finishing.")
  ```

  ```typescript Typescript theme={null}
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  let response = await client.responses.create({
    model: 'openai/gpt-5.6-sol',
    input: 'Write a sourced brief on grid-scale battery storage trends.',
    tools: [{ type: 'web_search' }, { type: 'sandbox' }],
    background: true,
  });

  while (!['completed', 'failed', 'cancelled', 'incomplete'].includes(response.status)) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    response = await client.responses.retrieve(response.id);
  }

  console.log(`Final status: ${response.status}`);

  if (response.status === 'completed') {
    console.log(response.output_text);
  } else if (response.status === 'failed') {
    console.log(response.error);
  } else if (response.status === 'cancelled') {
    console.log('The response was cancelled.');
  } else if (response.status === 'incomplete') {
    console.log('The response stopped before finishing.');
  }
  ```

  ```bash cURL theme={null}
  # 1. Submit the background run and save its id.
  RESPONSE_ID=$(curl -s https://api.perplexity.ai/v1/agent \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/gpt-5.6-sol",
      "input": "Write a sourced brief on grid-scale battery storage trends.",
      "tools": [{ "type": "web_search" }, { "type": "sandbox" }],
      "background": true
    }' | jq -r '.id')

  # 2. Poll until the status is completed, failed, cancelled, or incomplete.
  while true; do
    RESPONSE=$(curl -s "https://api.perplexity.ai/v1/agent/$RESPONSE_ID" \
      -H "Authorization: Bearer $PERPLEXITY_API_KEY")

    STATUS=$(echo "$RESPONSE" | jq -r '.status')
    echo "Status: $STATUS"

    if [[ "$STATUS" == "completed" || "$STATUS" == "failed" || "$STATUS" == "cancelled" || "$STATUS" == "incomplete" ]]; then
      echo "$RESPONSE"
      break
    fi

    sleep 2
  done
  ```
</CodeGroup>

After the loop, handle each terminal status explicitly. For `completed`, read the output; for `failed`, inspect the `error` object; for `cancelled`, treat the run as intentionally stopped; for `incomplete`, treat the run as stopped before finishing (for example on truncation).

## Stream and reconnect

You can stream a long-running background response by creating it with both `background=true` and `stream=true`. Save the response id, and keep a cursor from the `sequence_number` on each streamed event. If the connection drops, reconnect with `GET /v1/agent/{id}?stream=true&starting_after=N` to resume after sequence number `N`.

<Info>
  Reconnect is only valid within the response's reconnect window. If that window expires, the reconnect request returns `400`; fall back to a plain `GET /v1/agent/{id}` to retrieve the final snapshot.
</Info>

<CodeGroup>
  ```python Python theme={null}
  import json
  import os
  import requests
  from perplexity import Perplexity

  client = Perplexity()

  response_id = None
  cursor = None

  stream = client.responses.create(
      model="openai/gpt-5.6-sol",
      input="Create a detailed research memo on satellite internet providers.",
      tools=[{"type": "web_search"}],
      background=True,
      stream=True,
  )

  for event in stream:
      cursor = getattr(event, "sequence_number", cursor)

      # Capture the response id from the first event that includes it.
      response = getattr(event, "response", None)
      if response_id is None and response is not None:
          response_id = getattr(response, "id", None)

      print(event)

  # If the stream disconnects after cursor N, resume from the next event.
  if response_id and cursor is not None:
      reconnect = requests.get(
          f"https://api.perplexity.ai/v1/agent/{response_id}",
          headers={"Authorization": f"Bearer {os.environ['PERPLEXITY_API_KEY']}"},
          params={"stream": "true", "starting_after": cursor},
          stream=True,
          timeout=60,
      )

      if reconnect.status_code == 400:
          final = client.responses.retrieve(response_id)
          print(final.status)
      else:
          reconnect.raise_for_status()
          for line in reconnect.iter_lines(decode_unicode=True):
              if not line or not line.startswith("data: "):
                  continue
              data = line.removeprefix("data: ")
              if data == "[DONE]":
                  break
              event = json.loads(data)
              cursor = event.get("sequence_number", cursor)
              print(event)
  ```

  ```typescript Typescript theme={null}
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  let responseId: string | undefined;
  let cursor: number | undefined;

  const stream = await client.responses.create({
    model: 'openai/gpt-5.6-sol',
    input: 'Create a detailed research memo on satellite internet providers.',
    tools: [{ type: 'web_search' }],
    background: true,
    stream: true,
  });

  for await (const event of stream) {
    cursor = event.sequence_number;

    // Capture the response id from the first event that includes it.
    if (!responseId && 'response' in event && event.response) {
      responseId = event.response.id;
    }

    console.log(event);
  }

  // If the stream disconnects after cursor N, resume from the next event.
  if (responseId && cursor !== undefined) {
    const reconnect = await fetch(
      `https://api.perplexity.ai/v1/agent/${responseId}?stream=true&starting_after=${cursor}`,
      { headers: { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}` } },
    );

    if (reconnect.status === 400) {
      // Reconnect window expired: fall back to the final snapshot.
      const final = await client.responses.retrieve(responseId);
      console.log(final.status);
    } else {
      // Parse the resumed SSE stream the same way, continuing from `cursor`.
      console.log(await reconnect.text());
    }
  }
  ```

  ```bash cURL theme={null}
  # 1. Start a background stream.
  curl -N https://api.perplexity.ai/v1/agent \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/gpt-5.6-sol",
      "input": "Create a detailed research memo on satellite internet providers.",
      "tools": [{ "type": "web_search" }],
      "background": true,
      "stream": true
    }'

  # 2. If the connection drops, resume after the last sequence_number you received.
  curl -N "https://api.perplexity.ai/v1/agent/$RESPONSE_ID?stream=true&starting_after=$SEQUENCE_NUMBER" \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY"

  # 3. If reconnect returns 400, fetch the latest final snapshot instead.
  curl "https://api.perplexity.ai/v1/agent/$RESPONSE_ID" \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY"
  ```
</CodeGroup>

## Cancel a run

Cancel an in-flight background response with `POST https://api.perplexity.ai/v1/agent/{id}/cancel` when the result is no longer needed.
Cancellation is asynchronous: a `200` returns `status: "cancelling"` and the run stops shortly after, so poll `GET /v1/agent/{id}` for the terminal `cancelled` status.
Cancelling an already-terminal response returns `400`; an unknown id, or a response owned by a different account, returns `404`.

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()

  response = client.responses.create(
      model="openai/gpt-5.6-sol",
      input="Run an extended literature review on heat pump adoption.",
      tools=[{"type": "web_search"}],
      background=True,
  )

  # Cancel it by id, then poll GET until the status is the terminal "cancelled".
  cancelled = client.responses.cancel(response.id)
  print(cancelled.response_id, cancelled.status)  # resp_... cancelling
  ```

  ```typescript Typescript theme={null}
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  const response = await client.responses.create({
    model: 'openai/gpt-5.6-sol',
    input: 'Run an extended literature review on heat pump adoption.',
    tools: [{ type: 'web_search' }],
    background: true,
  });

  // Cancel it by id, then poll GET until the status is the terminal 'cancelled'.
  const cancelled = await client.responses.cancel(response.id);
  console.log(cancelled.response_id, cancelled.status); // resp_... cancelling
  ```

  ```bash cURL theme={null}
  curl -X POST "https://api.perplexity.ai/v1/agent/$RESPONSE_ID/cancel" \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY"
  ```
</CodeGroup>

## Next Steps

<CardGroup cols={2}>
  <Card title="Working with files" icon="file" href="/docs/agent-api/working-with-files" />

  <Card title="Sandbox" icon="layer-group" href="/docs/agent-api/tools/sandbox" />

  <Card title="Streaming/output control" icon="clock" href="/docs/agent-api/output-control" />
</CardGroup>
