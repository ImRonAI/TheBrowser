# Stream Mode: Concise vs Full

> Learn how to use stream_mode to control streaming response formats and optimize your integration

## Overview

The `stream_mode` parameter gives you control over how streaming responses are formatted. Choose between two modes:

* **`full`** (default) - Traditional streaming format with complete message objects in each chunk
* **`concise`** - Optimized streaming format with reduced redundancy and enhanced reasoning visibility

<Info>
  The `concise` mode is designed to minimize bandwidth usage and provide better visibility into the model's reasoning process.
</Info>

## Quick Comparison

| Feature                 | Full Mode                                | Concise Mode                        |
| ----------------------- | ---------------------------------------- | ----------------------------------- |
| **Message aggregation** | Server-side (includes `choices.message`) | Client-side (delta only)            |
| **Chunk types**         | Single type (`chat.completion.chunk`)    | Multiple types for different stages |
| **Search results**      | Multiple times during stream             | Only in `done` chunks               |
| **Bandwidth**           | Higher (includes redundant data)         | Lower (optimized for efficiency)    |

## Using Concise Mode

Set `stream_mode: "concise"` when creating streaming completions:

<Tabs>
  <Tab title="Python SDK">
    ```python  theme={null}
    from perplexity import Perplexity

    client = Perplexity()

    stream = client.chat.completions.create(
        model="sonar-pro",
        messages=[{"role": "user", "content": "What's the weather in Seattle?"}],
        stream=True,
        stream_mode="concise"
    )

    for chunk in stream:
        print(f"Chunk type: {chunk.object}")
        if chunk.choices[0].delta.content:
            print(chunk.choices[0].delta.content, end="")
    ```
  </Tab>

  <Tab title="TypeScript SDK">
    ```typescript  theme={null}
    import Perplexity from '@perplexity-ai/perplexity_ai';

    const client = new Perplexity();

    const stream = await client.chat.completions.create({
      model: "sonar-pro",
      messages: [{ role: "user", content: "What's the weather in Seattle?" }],
      stream: true,
      stream_mode: "concise"
    });

    for await (const chunk of stream) {
      console.log(`Chunk type: ${chunk.object}`);
      if (chunk.choices[0]?.delta?.content) {
        process.stdout.write(chunk.choices[0].delta.content);
      }
    }
    ```
  </Tab>

  <Tab title="cURL">
    ```bash  theme={null}
    curl -X POST "https://api.perplexity.ai/chat/completions" \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "sonar-pro",
        "messages": [{"role": "user", "content": "What is the weather in Seattle?"}],
        "stream": true,
        "stream_mode": "concise"
      }'
    ```
  </Tab>
</Tabs>

## Understanding Chunk Types

In concise mode, you'll receive four different types of chunks during the stream:

### 1. `chat.reasoning`

Streamed during the reasoning stage, containing real-time reasoning steps and search operations.

<Tabs>
  <Tab title="Structure">
    ```json  theme={null}
    {
      "id": "cfa38f9d-fdbc-4ac6-a5d2-a3010b6a33a6",
      "model": "sonar-pro",
      "created": 1759441590,
      "object": "chat.reasoning",
      "choices": [{
        "index": 0,
        "finish_reason": null,
        "message": {
          "role": "assistant",
          "content": ""
        },
        "delta": {
          "role": "assistant",
          "content": "",
          "reasoning_steps": [{
            "thought": "Searching the web for Seattle's current weather...",
            "type": "web_search",
            "web_search": {
              "search_results": [...],
              "search_keywords": ["Seattle current weather"]
            }
          }]
        }
      }],
      "type": "message"
    }
    ```
  </Tab>

  <Tab title="Python Handler">
    ```python  theme={null}
    def handle_reasoning_chunk(chunk):
        """Process reasoning stage updates"""
        if chunk.object == "chat.reasoning":
            delta = chunk.choices[0].delta

            if hasattr(delta, 'reasoning_steps'):
                for step in delta.reasoning_steps:
                    print(f"\n[Reasoning] {step.thought}")

                    if step.type == "web_search":
                        keywords = step.web_search.search_keywords
                        print(f"[Search] Keywords: {', '.join(keywords)}")
    ```
  </Tab>

  <Tab title="TypeScript Handler">
    ```typescript  theme={null}
    function handleReasoningChunk(chunk: any) {
      if (chunk.object === "chat.reasoning") {
        const delta = chunk.choices[0].delta;

        if (delta.reasoning_steps) {
          for (const step of delta.reasoning_steps) {
            console.log(`\n[Reasoning] ${step.thought}`);

            if (step.type === "web_search") {
              const keywords = step.web_search.search_keywords;
              console.log(`[Search] Keywords: ${keywords.join(', ')}`);
            }
          }
        }
      }
    }
    ```
  </Tab>
</Tabs>

### 2. `chat.reasoning.done`

Marks the end of the reasoning stage and includes all search results (web, images, videos) and reasoning steps.

<Tabs>
  <Tab title="Structure">
    ```json  theme={null}
    {
      "id": "3dd9d463-0fef-47e3-af70-92f9fcc4db1f",
      "model": "sonar-pro",
      "created": 1759459505,
      "object": "chat.reasoning.done",
      "usage": {
        "prompt_tokens": 6,
        "completion_tokens": 0,
        "total_tokens": 6,
        "search_context_size": "low"
      },
      "search_results": [...],
      "images": [...],
      "choices": [{
        "index": 0,
        "finish_reason": null,
        "message": {
          "role": "assistant",
          "content": "",
          "reasoning_steps": [...]
        },
        "delta": {
          "role": "assistant",
          "content": ""
        }
      }]
    }
    ```
  </Tab>

  <Tab title="Python Handler">
    ```python  theme={null}
    def handle_reasoning_done(chunk):
        """Process end of reasoning stage"""
        if chunk.object == "chat.reasoning.done":
            print("\n[Reasoning Complete]")

            # Access all search results
            if hasattr(chunk, 'search_results'):
                print(f"Found {len(chunk.search_results)} sources")
                for result in chunk.search_results[:3]:
                    print(f"  • {result['title']}")

            # Access image results
            if hasattr(chunk, 'images'):
                print(f"Found {len(chunk.images)} images")

            # Partial usage stats available
            if hasattr(chunk, 'usage'):
                print(f"Tokens used so far: {chunk.usage.total_tokens}")
    ```
  </Tab>

  <Tab title="TypeScript Handler">
    ```typescript  theme={null}
    function handleReasoningDone(chunk: any) {
      if (chunk.object === "chat.reasoning.done") {
        console.log("\n[Reasoning Complete]");

        // Access all search results
        if (chunk.search_results) {
          console.log(`Found ${chunk.search_results.length} sources`);
          chunk.search_results.slice(0, 3).forEach((result: any) => {
            console.log(`  • ${result.title}`);
          });
        }

        // Access image results
        if (chunk.images) {
          console.log(`Found ${chunk.images.length} images`);
        }

        // Partial usage stats available
        if (chunk.usage) {
          console.log(`Tokens used so far: ${chunk.usage.total_tokens}`);
        }
      }
    }
    ```
  </Tab>
</Tabs>

### 3. `chat.completion.chunk`

Streamed during the response generation stage, containing the actual content being generated.

<Tabs>
  <Tab title="Structure">
    ```json  theme={null}
    {
      "id": "cfa38f9d-fdbc-4ac6-a5d2-a3010b6a33a6",
      "model": "sonar-pro",
      "created": 1759441592,
      "object": "chat.completion.chunk",
      "choices": [{
        "index": 0,
        "finish_reason": null,
        "message": {
          "role": "assistant",
          "content": ""
        },
        "delta": {
          "role": "assistant",
          "content": " tonight"
        }
      }]
    }
    ```
  </Tab>

  <Tab title="Python Handler">
    ```python  theme={null}
    def handle_completion_chunk(chunk):
        """Process content generation updates"""
        if chunk.object == "chat.completion.chunk":
            delta = chunk.choices[0].delta

            if hasattr(delta, 'content') and delta.content:
                # Stream content to user
                print(delta.content, end='', flush=True)
                return delta.content

        return ""
    ```
  </Tab>

  <Tab title="TypeScript Handler">
    ```typescript  theme={null}
    function handleCompletionChunk(chunk: any): string {
      if (chunk.object === "chat.completion.chunk") {
        const delta = chunk.choices[0]?.delta;

        if (delta?.content) {
          // Stream content to user
          process.stdout.write(delta.content);
          return delta.content;
        }
      }

      return "";
    }
    ```
  </Tab>
</Tabs>

### 4. `chat.completion.done`

Final chunk indicating the stream is complete, including final search results, usage statistics, and cost information.

<Tabs>
  <Tab title="Structure">
    ```json  theme={null}
    {
      "id": "cfa38f9d-fdbc-4ac6-a5d2-a3010b6a33a6",
      "model": "sonar-pro",
      "created": 1759441595,
      "object": "chat.completion.done",
      "usage": {
        "prompt_tokens": 6,
        "completion_tokens": 238,
        "total_tokens": 244,
        "search_context_size": "low",
        "cost": {
          "input_tokens_cost": 0.0,
          "output_tokens_cost": 0.004,
          "request_cost": 0.006,
          "total_cost": 0.01
        }
      },
      "search_results": [...],
      "images": [...],
      "choices": [{
        "index": 0,
        "finish_reason": "stop",
        "message": {
          "role": "assistant",
          "content": "## Seattle Weather Forecast\n\nSeattle is experiencing...",
          "reasoning_steps": [...]
        },
        "delta": {
          "role": "assistant",
          "content": ""
        }
      }]
    }
    ```
  </Tab>

  <Tab title="Python Handler">
    ```python  theme={null}
    def handle_completion_done(chunk):
        """Process stream completion"""
        if chunk.object == "chat.completion.done":
            print("\n\n[Stream Complete]")

            # Final aggregated message
            full_message = chunk.choices[0].message.content

            # Final search results
            if hasattr(chunk, 'search_results'):
                print(f"\nFinal sources: {len(chunk.search_results)}")

            # Complete usage and cost information
            if hasattr(chunk, 'usage'):
                usage = chunk.usage
                print(f"\nTokens: {usage.total_tokens}")

                if hasattr(usage, 'cost'):
                    print(f"Cost: ${usage.cost.total_cost:.4f}")

            return {
                'content': full_message,
                'search_results': getattr(chunk, 'search_results', []),
                'images': getattr(chunk, 'images', []),
                'usage': getattr(chunk, 'usage', None)
            }
    ```
  </Tab>

  <Tab title="TypeScript Handler">
    ```typescript  theme={null}
    function handleCompletionDone(chunk: any) {
      if (chunk.object === "chat.completion.done") {
        console.log("\n\n[Stream Complete]");

        // Final aggregated message
        const fullMessage = chunk.choices[0].message.content;

        // Final search results
        if (chunk.search_results) {
          console.log(`\nFinal sources: ${chunk.search_results.length}`);
        }

        // Complete usage and cost information
        if (chunk.usage) {
          console.log(`\nTokens: ${chunk.usage.total_tokens}`);

          if (chunk.usage.cost) {
            console.log(`Cost: $${chunk.usage.cost.total_cost.toFixed(4)}`);
          }
        }

        return {
          content: fullMessage,
          search_results: chunk.search_results || [],
          images: chunk.images || [],
          usage: chunk.usage || null
        };
      }
    }
    ```
  </Tab>
</Tabs>

## Complete Implementation Examples

### Full Concise Mode Handler

<Tabs>
  <Tab title="Python SDK">
    ```python  theme={null}
    from perplexity import Perplexity

    class ConciseStreamHandler:
        def __init__(self):
            self.content = ""
            self.reasoning_steps = []
            self.search_results = []
            self.images = []
            self.usage = None

        def stream_query(self, query: str, model: str = "sonar-pro"):
            """Handle a complete concise streaming request"""
            client = Perplexity()

            stream = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": query}],
                stream=True,
                stream_mode="concise"
            )

            for chunk in stream:
                self.process_chunk(chunk)

            return self.get_result()

        def process_chunk(self, chunk):
            """Route chunk to appropriate handler"""
            chunk_type = chunk.object

            if chunk_type == "chat.reasoning":
                self.handle_reasoning(chunk)
            elif chunk_type == "chat.reasoning.done":
                self.handle_reasoning_done(chunk)
            elif chunk_type == "chat.completion.chunk":
                self.handle_content(chunk)
            elif chunk_type == "chat.completion.done":
                self.handle_done(chunk)

        def handle_reasoning(self, chunk):
            """Process reasoning updates"""
            delta = chunk.choices[0].delta

            if hasattr(delta, 'reasoning_steps'):
                for step in delta.reasoning_steps:
                    self.reasoning_steps.append(step)
                    print(f"💭 {step.thought}")

        def handle_reasoning_done(self, chunk):
            """Process end of reasoning"""
            if hasattr(chunk, 'search_results'):
                self.search_results = chunk.search_results
                print(f"\n🔍 Found {len(self.search_results)} sources")

            if hasattr(chunk, 'images'):
                self.images = chunk.images
                print(f"🖼️  Found {len(self.images)} images")

            print("\n📝 Generating response...\n")

        def handle_content(self, chunk):
            """Process content chunks"""
            delta = chunk.choices[0].delta

            if hasattr(delta, 'content') and delta.content:
                self.content += delta.content
                print(delta.content, end='', flush=True)

        def handle_done(self, chunk):
            """Process completion"""
            if hasattr(chunk, 'usage'):
                self.usage = chunk.usage
                print(f"\n\n✅ Complete | Tokens: {self.usage.total_tokens}")

                if hasattr(self.usage, 'cost'):
                    print(f"💰 Cost: ${self.usage.cost.total_cost:.4f}")

        def get_result(self):
            """Return complete result"""
            return {
                'content': self.content,
                'reasoning_steps': self.reasoning_steps,
                'search_results': self.search_results,
                'images': self.images,
                'usage': self.usage
            }

    # Usage
    handler = ConciseStreamHandler()
    result = handler.stream_query("What's the latest news in AI?")

    print(f"\n\nFinal content length: {len(result['content'])} characters")
    print(f"Sources used: {len(result['search_results'])}")
    ```
  </Tab>

  <Tab title="TypeScript SDK">
    ```typescript  theme={null}
    import Perplexity from '@perplexity-ai/perplexity_ai';

    interface StreamResult {
      content: string;
      reasoning_steps: any[];
      search_results: any[];
      images: any[];
      usage: any;
    }

    class ConciseStreamHandler {
      private content: string = "";
      private reasoning_steps: any[] = [];
      private search_results: any[] = [];
      private images: any[] = [];
      private usage: any = null;

      async streamQuery(query: string, model: string = "sonar-pro"): Promise<StreamResult> {
        const client = new Perplexity();

        const stream = await client.chat.completions.create({
          model,
          messages: [{ role: "user", content: query }],
          stream: true,
          stream_mode: "concise"
        });

        for await (const chunk of stream) {
          this.processChunk(chunk);
        }

        return this.getResult();
      }

      private processChunk(chunk: any) {
        const chunkType = chunk.object;

        switch (chunkType) {
          case "chat.reasoning":
            this.handleReasoning(chunk);
            break;
          case "chat.reasoning.done":
            this.handleReasoningDone(chunk);
            break;
          case "chat.completion.chunk":
            this.handleContent(chunk);
            break;
          case "chat.completion.done":
            this.handleDone(chunk);
            break;
        }
      }

      private handleReasoning(chunk: any) {
        const delta = chunk.choices[0].delta;

        if (delta.reasoning_steps) {
          for (const step of delta.reasoning_steps) {
            this.reasoning_steps.push(step);
            console.log(`💭 ${step.thought}`);
          }
        }
      }

      private handleReasoningDone(chunk: any) {
        if (chunk.search_results) {
          this.search_results = chunk.search_results;
          console.log(`\n🔍 Found ${this.search_results.length} sources`);
        }

        if (chunk.images) {
          this.images = chunk.images;
          console.log(`🖼️  Found ${this.images.length} images`);
        }

        console.log("\n📝 Generating response...\n");
      }

      private handleContent(chunk: any) {
        const delta = chunk.choices[0]?.delta;

        if (delta?.content) {
          this.content += delta.content;
          process.stdout.write(delta.content);
        }
      }

      private handleDone(chunk: any) {
        if (chunk.usage) {
          this.usage = chunk.usage;
          console.log(`\n\n✅ Complete | Tokens: ${this.usage.total_tokens}`);

          if (this.usage.cost) {
            console.log(`💰 Cost: $${this.usage.cost.total_cost.toFixed(4)}`);
          }
        }
      }

      private getResult(): StreamResult {
        return {
          content: this.content,
          reasoning_steps: this.reasoning_steps,
          search_results: this.search_results,
          images: this.images,
          usage: this.usage
        };
      }
    }

    // Usage
    const handler = new ConciseStreamHandler();
    const result = await handler.streamQuery("What's the latest news in AI?");

    console.log(`\n\nFinal content length: ${result.content.length} characters`);
    console.log(`Sources used: ${result.search_results.length}`);
    ```
  </Tab>

  <Tab title="Raw HTTP">
    ```python  theme={null}
    import requests
    import json

    def stream_concise_mode(query: str):
        """Handle concise streaming with raw HTTP"""
        url = "https://api.perplexity.ai/chat/completions"
        headers = {
            "Authorization": "Bearer YOUR_API_KEY",
            "Content-Type": "application/json"
        }
        payload = {
            "model": "sonar-pro",
            "messages": [{"role": "user", "content": query}],
            "stream": True,
            "stream_mode": "concise"
        }

        response = requests.post(url, headers=headers, json=payload, stream=True)

        content = ""
        search_results = []
        usage = None

        for line in response.iter_lines():
            if line:
                line = line.decode('utf-8')
                if line.startswith('data: '):
                    data_str = line[6:]
                    if data_str == '[DONE]':
                        break

                    try:
                        chunk = json.loads(data_str)
                        chunk_type = chunk.get('object')

                        if chunk_type == 'chat.reasoning':
                            # Handle reasoning
                            delta = chunk['choices'][0]['delta']
                            if 'reasoning_steps' in delta:
                                for step in delta['reasoning_steps']:
                                    print(f"💭 {step['thought']}")

                        elif chunk_type == 'chat.reasoning.done':
                            # Handle reasoning completion
                            if 'search_results' in chunk:
                                search_results = chunk['search_results']
                                print(f"\n🔍 Found {len(search_results)} sources\n")

                        elif chunk_type == 'chat.completion.chunk':
                            # Handle content
                            delta = chunk['choices'][0]['delta']
                            if 'content' in delta and delta['content']:
                                content += delta['content']
                                print(delta['content'], end='', flush=True)

                        elif chunk_type == 'chat.completion.done':
                            # Handle completion
                            if 'usage' in chunk:
                                usage = chunk['usage']
                                print(f"\n\n✅ Tokens: {usage['total_tokens']}")

                    except json.JSONDecodeError:
                        continue

        return {
            'content': content,
            'search_results': search_results,
            'usage': usage
        }

    # Usage
    result = stream_concise_mode("What's the latest news in AI?")
    ```
  </Tab>
</Tabs>

## Best Practices

<Steps>
  <Step title="Aggregate content on the client side">
    In concise mode, `choices.message` is not incrementally updated. You must aggregate chunks yourself.

    ```python  theme={null}
    # Track content yourself
    content = ""
    for chunk in stream:
        if chunk.object == "chat.completion.chunk":
            if chunk.choices[0].delta.content:
                content += chunk.choices[0].delta.content
    ```
  </Step>

  <Step title="Use reasoning steps for transparency">
    Display reasoning steps to users for better transparency and trust.

    ```python  theme={null}
    def display_reasoning(step):
        """Show reasoning to users"""
        print(f"🔍 Searching for: {step.web_search.search_keywords}")
        print(f"💭 {step.thought}")
    ```
  </Step>

  <Step title="Handle search results from done chunks only">
    Search results and usage information only appear in `chat.reasoning.done` and `chat.completion.done` chunks.

    ```python  theme={null}
    # Don't check for search_results in other chunk types
    if chunk.object in ["chat.reasoning.done", "chat.completion.done"]:
        if hasattr(chunk, 'search_results'):
            process_search_results(chunk.search_results)
    ```
  </Step>

  <Step title="Implement proper type checking">
    Use the `object` field to route chunks to appropriate handlers.

    ```python  theme={null}
    chunk_handlers = {
        "chat.reasoning": handle_reasoning,
        "chat.reasoning.done": handle_reasoning_done,
        "chat.completion.chunk": handle_content,
        "chat.completion.done": handle_done
    }

    handler = chunk_handlers.get(chunk.object)
    if handler:
        handler(chunk)
    ```
  </Step>

  <Step title="Track cost from the final chunk">
    Cost information is only available in the `chat.completion.done` chunk.

    ```python  theme={null}
    if chunk.object == "chat.completion.done":
        if hasattr(chunk.usage, 'cost'):
            total_cost = chunk.usage.cost.total_cost
            print(f"Request cost: ${total_cost:.4f}")
    ```
  </Step>
</Steps>

## Migration from Full Mode

If you're migrating from full mode to concise mode, here are the key changes:

<Tabs>
  <Tab title="Before (Full Mode)">
    ```python  theme={null}
    from perplexity import Perplexity

    client = Perplexity()

    stream = client.chat.completions.create(
        model="sonar-pro",
        messages=[{"role": "user", "content": "What's the weather?"}],
        stream=True
        # stream_mode defaults to "full"
    )

    for chunk in stream:
        # All chunks are chat.completion.chunk
        if chunk.choices[0].delta.content:
            print(chunk.choices[0].delta.content, end="")

        # Search results may appear in multiple chunks
        if hasattr(chunk, 'search_results'):
            print(f"Sources: {len(chunk.search_results)}")
    ```
  </Tab>

  <Tab title="After (Concise Mode)">
    ```python  theme={null}
    from perplexity import Perplexity

    client = Perplexity()

    stream = client.chat.completions.create(
        model="sonar-pro",
        messages=[{"role": "user", "content": "What's the weather?"}],
        stream=True,
        stream_mode="concise"  # Enable concise mode
    )

    for chunk in stream:
        # Multiple chunk types - route appropriately
        if chunk.object == "chat.reasoning":
            # New: Handle reasoning steps
            if chunk.choices[0].delta.reasoning_steps:
                print("Reasoning in progress...")

        elif chunk.object == "chat.reasoning.done":
            # New: Reasoning complete, search results available
            if hasattr(chunk, 'search_results'):
                print(f"Sources: {len(chunk.search_results)}")

        elif chunk.object == "chat.completion.chunk":
            # Content chunks (similar to full mode)
            if chunk.choices[0].delta.content:
                print(chunk.choices[0].delta.content, end="")

        elif chunk.object == "chat.completion.done":
            # Final chunk with complete metadata
            print(f"\nTotal tokens: {chunk.usage.total_tokens}")
    ```
  </Tab>
</Tabs>

## When to Use Each Mode

<CardGroup cols={2}>
  <Card title="Use Full Mode" icon="list">
    * Simple integrations where you want the SDK to handle aggregation
    * Backward compatibility with existing implementations
    * When you don't need reasoning visibility
  </Card>

  <Card title="Use Concise Mode" icon="bolt">
    * Production applications optimizing for bandwidth
    * Applications that need reasoning transparency
    * Real-time chat interfaces with reasoning display
    * Cost-sensitive applications
  </Card>
</CardGroup>

## Resources

* [Streaming Responses Guide](/guides/streaming-responses) - General streaming documentation
* [Chat Completions SDK](/guides/chat-completions-sdk) - Complete SDK guide
* [API Reference - Chat Completions](/api-reference/chat-completions-post) - API documentation


---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.perplexity.ai/llms.txt