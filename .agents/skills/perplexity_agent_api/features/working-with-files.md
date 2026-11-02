> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Working with Files

> List and download files an Agent API response produced in the sandbox.

## Overview

Agent runs can produce files such as CSV, JSON, JSONL, and reports in the sandbox. When code the model runs in the `sandbox` tool writes a file and delivers it with the `share_file` tool, the response `output` array includes a `share_file` item. The file content is not returned inline — retrieve it separately with the response files endpoints, using the response `id`.

## Produce a file

Give the agent the `sandbox` tool and ask it to write a file. Here it generates a CSV of the latest AI news. Keep the resulting `response.id` — you use it to list and download the file.

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()

  response = client.responses.create(
      preset="xhigh",
      tools=[{"type": "sandbox"}],
      input=(
          "Find the 10 latest AI news stories and write them to ai_news.csv "
          "with columns: title, source, url, published_date. Deliver the file."
      ),
  )

  print(response.id, response.status)
  ```

  ```typescript Typescript theme={null}
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  const response = await client.responses.create({
    preset: 'xhigh',
    tools: [{ type: 'sandbox' }],
    input:
      'Find the 10 latest AI news stories and write them to ai_news.csv ' +
      'with columns: title, source, url, published_date. Deliver the file.',
  });

  console.log(response.id, response.status);
  ```

  ```bash cURL theme={null}
  curl https://api.perplexity.ai/v1/agent \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "preset": "xhigh",
      "tools": [{ "type": "sandbox" }],
      "input": "Find the 10 latest AI news stories and write them to ai_news.csv with columns: title, source, url, published_date. Deliver the file."
    }'
  ```
</CodeGroup>

<Note>
  For runs that take a while, submit with `background=true` and poll before listing files. See [Background mode](/docs/agent-api/background-mode).
</Note>

## List a response's files

`GET /v1/agent/{id}/files`

Use the response `id` from the run above to list the files it produced.

<CodeGroup>
  ```python Python theme={null}
  files = client.responses.files.list(response.id)

  for file in files.data:
      print(file.id, file.filename, file.bytes)
  ```

  ```typescript Typescript theme={null}
  const files = await client.responses.files.list(response.id);

  for (const file of files.data) {
    console.log(file.id, file.filename, file.bytes);
  }
  ```

  ```bash cURL theme={null}
  curl https://api.perplexity.ai/v1/agent/$RESPONSE_ID/files \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY"
  ```
</CodeGroup>

```json theme={null}
{
  "data": [
    {
      "bytes": 8002,
      "created_at": 1780923289,
      "filename": "ai_news.csv",
      "id": "9198548a-490b-4119-858f-fd3676b60319",
      "object": "file"
    }
  ],
  "object": "list"
}
```

| Field | Type | Description |
| - | - | - |
| `id` | `string` | File identifier, used to download; distinct from response id. |
| `filename` | `string` | Name the sandbox gave the file. |
| `bytes` | `integer` | File size in bytes. |
| `created_at` | `integer` | Unix timestamp when created. |
| `object` | `string` | Always `file`. |

## Download a file

`GET /v1/agent/{id}/files/{file_id}/content`

Use the file `id` to download its content. The file `id` is distinct from the response `id`.

<Note>
  This endpoint returns raw file bytes, not JSON. The response includes a `Content-Type` matching the file and a `Content-Disposition: attachment` header carrying the original filename.
</Note>

<CodeGroup>
  ```python Python theme={null}
  file = files.data[0]

  content = client.responses.files.content(
      file_id=file.id,
      response_id=response.id,
  )
  content.write_to_file(file.filename)
  ```

  ```typescript Typescript theme={null}
  import { writeFile } from 'node:fs/promises';

  const file = files.data[0];

  const content = await client.responses.files.content(file.id, {
    response_id: response.id,
  });
  await writeFile(file.filename, Buffer.from(await content.arrayBuffer()));
  ```

  ```bash cURL theme={null}
  curl https://api.perplexity.ai/v1/agent/$RESPONSE_ID/files/$FILE_ID/content \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -o ai_news.csv
  ```
</CodeGroup>

## Full example

Create a run that writes a file, then list and download everything it produced.

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()

  response = client.responses.create(
      preset="xhigh",
      tools=[{"type": "sandbox"}],
      input=(
          "Find the 10 latest AI news stories and write them to ai_news.csv "
          "with columns: title, source, url, published_date. Deliver the file."
      ),
  )

  for file in client.responses.files.list(response.id).data:
      content = client.responses.files.content(
          file_id=file.id,
          response_id=response.id,
      )
      content.write_to_file(file.filename)
      print(f"Downloaded {file.filename} ({file.bytes} bytes)")
  ```

  ```typescript Typescript theme={null}
  import { writeFile } from 'node:fs/promises';
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  const response = await client.responses.create({
    preset: 'xhigh',
    tools: [{ type: 'sandbox' }],
    input:
      'Find the 10 latest AI news stories and write them to ai_news.csv ' +
      'with columns: title, source, url, published_date. Deliver the file.',
  });

  const files = await client.responses.files.list(response.id);

  for (const file of files.data) {
    const content = await client.responses.files.content(file.id, {
      response_id: response.id,
    });
    await writeFile(file.filename, Buffer.from(await content.arrayBuffer()));
    console.log(`Downloaded ${file.filename} (${file.bytes} bytes)`);
  }
  ```
</CodeGroup>

## Next Steps

<CardGroup cols={2}>
  <Card title="Sandbox" icon="box" href="/docs/agent-api/tools/sandbox" />

  <Card title="Background mode" icon="clock" href="/docs/agent-api/background-mode" />
</CardGroup>
