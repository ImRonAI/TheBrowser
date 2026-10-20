> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Create Agent Response

> Generate a response for the provided input with optional web search and reasoning.



## OpenAPI

````yaml post /v1/agent
openapi: 3.1.0
info:
  title: Perplexity AI API
  description: Perplexity AI API
  version: 1.0.0
servers:
  - url: https://api.perplexity.ai
    description: Perplexity AI API
security: []
paths:
  /v1/agent:
    post:
      summary: Create Agent Response
      description: >-
        Generate a response for the provided input with optional web search and
        reasoning.
      operationId: createAgent
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ResponsesRequest'
        required: true
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ResponsesResponse'
            text/event-stream:
              schema:
                $ref: '#/components/schemas/ResponseStreamEvent'
          description: |
            Successful response. Content type depends on `stream` parameter:
            - `stream: false` (default): `application/json` with Response
            - `stream: true`: `text/event-stream` with SSE events
        '400':
          content:
            application/json:
              schema:
                type: object
                properties:
                  error:
                    $ref: '#/components/schemas/ErrorInfo'
          description: >-
            Invalid request. Includes an unresolvable `previous_response_id`:
            the referenced response does not exist, belongs to a different
            account, has failed, or is still running.
      security:
        - HTTPBearer: []
components:
  schemas:
    ResponsesRequest:
      properties:
        input:
          $ref: '#/components/schemas/Input'
        background:
          description: >-
            Run the response asynchronously. With `stream: false`, the request
            returns immediately with `status: "queued"`; poll `GET
            /v1/responses/{id}` until the response reaches a terminal status.
            Background runs are durable, so you can also stream them and
            reconnect after a drop.
          type: boolean
        instructions:
          description: System instructions for the model
          type: string
        language_preference:
          description: ISO 639-1 language code for response language
          type: string
        max_output_tokens:
          description: >-
            Maximum tokens to generate. This is a shared optional Agent API
            request parameter, but it is required when using anthropic/* models.
            If omitted for an Anthropic model, the API returns HTTP 400 with:
            validation failed: max_output_tokens is required when using
            Anthropic models.
          format: int32
          minimum: 1
          type: integer
        max_steps:
          description: >
            Maximum number of research loop steps.

            If provided, overrides the preset's max_steps value. For requests
            that specify model or models without a preset, the default is 1.

            Set max_steps to at least 3 when using finance_search with a direct
            model so the agent has enough steps to initialize and run the tool.

            Must be >= 1 if specified. Maximum allowed is 100.
          format: int32
          maximum: 100
          minimum: 1
          type: integer
        model:
          description: >
            Model ID in provider/model format (e.g., "openai/gpt-5.6-terra",
            "anthropic/claude-sonnet-4-6").

            If models is also provided, models takes precedence.

            Required if neither models nor preset is provided.
          type: string
        models:
          description: >
            Model fallback chain. Each model is in provider/model format.

            Models are tried in order until one succeeds.

            Max 5 models allowed. If set, takes precedence over single model
            field.

            The response.model will reflect the model that actually succeeded.
          items:
            type: string
          maxItems: 5
          minItems: 1
          type: array
        preset:
          description: >
            Preset configuration name (e.g., "fast", "low", "medium", "high",
            "xhigh").

            Pre-configured model with system prompt and search parameters.

            Required if model is not provided.
          type: string
        profile:
          allOf:
            - $ref: '#/components/schemas/ProfileReference'
          description: >-
            Saved, versioned configuration to run with. The version is resolved
            when the request is admitted. Cannot be combined with preset.
        previous_response_id:
          description: >-
            OpenAI-compatible previous response id for multi-turn response
            chains. When set, the new response continues from the completed
            prior response's saved state. The prior response must belong to the
            same account and have completed.
          type: string
        reasoning:
          $ref: '#/components/schemas/ReasoningConfig'
        response_format:
          $ref: '#/components/schemas/ResponseFormat'
        store:
          description: >-
            OpenAI-compatible storage toggle. When false, the response is hidden
            from later retrieve calls, and the echoed response reports `store:
            false`. It can still be used as a `previous_response_id`
            continuation source.
          type: boolean
        stream:
          description: If true, returns SSE stream instead of JSON
          type: boolean
        tools:
          description: Tools available to the model
          items:
            $ref: '#/components/schemas/Tool'
          type: array
        skills:
          type: array
          description: >-
            Built-in, request-scoped inline, and organization-owned custom
            skills available to the model. Skill metadata is disclosed to the
            model up front; full instructions are loaded on demand through the
            load_skill tool. Selecting any skill enables the sandbox tool for
            the request. Requests with skills run on the durable backend and
            skills are not echoed back on Response objects.
          maxItems: 16
          items:
            $ref: '#/components/schemas/Skill'
        temperature:
          description: OpenAI-compatible sampling temperature forwarded to generation.
          format: double
          maximum: 2
          minimum: 0
          type: number
        top_p:
          description: >-
            OpenAI-compatible nucleus sampling parameter forwarded to
            generation.
          format: double
          maximum: 1
          minimum: 0
          type: number
      required:
        - input
      type: object
      title: ResponsesRequest
    ResponsesResponse:
      description: Non-streaming response returned when stream is false
      properties:
        created_at:
          description: Unix timestamp when the response was created
          format: int64
          type: integer
        error:
          $ref: '#/components/schemas/ErrorInfo'
          description: Error details if the response failed
        id:
          description: Unique identifier for the response
          type: string
        model:
          description: Model used for generation
          type: string
        object:
          $ref: '#/components/schemas/ResponsesObjectType'
          description: Object type identifier
        output:
          description: Array of output items (messages, search results, tool calls)
          items:
            $ref: '#/components/schemas/OutputItem'
          type: array
        status:
          $ref: '#/components/schemas/Status'
          description: Status of the response
        usage:
          $ref: '#/components/schemas/ResponsesUsage'
          description: Token usage and cost information
      required:
        - id
        - object
        - created_at
        - status
        - model
        - output
      type: object
      title: ResponsesResponse
    ResponseStreamEvent:
      description: |
        SSE stream event. Discriminate by the `type` field:
        - `response.created`: Initial response object
        - `response.in_progress`: Response processing started
        - `response.completed`: Final response with output
        - `response.failed`: Error occurred
        - `response.output_item.added`: New output item started
        - `response.output_item.done`: Output item completed
        - `response.output_text.delta`: Streaming text delta
        - `response.output_text.done`: Final text content
        - `response.reasoning.started`: Reasoning phase started
        - `response.reasoning.search_queries`: Search queries issued
        - `response.reasoning.search_results`: Search results received
        - `response.reasoning.fetch_url_queries`: URL fetch queries issued
        - `response.reasoning.fetch_url_results`: URL fetch results received
        - `response.reasoning.stopped`: Reasoning phase complete
      discriminator:
        mapping:
          response.completed:
            $ref: '#/components/schemas/ResponseCompletedEvent'
          response.created:
            $ref: '#/components/schemas/ResponseCreatedEvent'
          response.failed:
            $ref: '#/components/schemas/ResponseFailedEvent'
          response.in_progress:
            $ref: '#/components/schemas/ResponseInProgressEvent'
          response.output_item.added:
            $ref: '#/components/schemas/OutputItemAddedEvent'
          response.output_item.done:
            $ref: '#/components/schemas/OutputItemDoneEvent'
          response.output_text.delta:
            $ref: '#/components/schemas/TextDeltaEvent'
          response.output_text.done:
            $ref: '#/components/schemas/TextDoneEvent'
          response.reasoning.fetch_url_queries:
            $ref: '#/components/schemas/FetchUrlQueriesEvent'
          response.reasoning.fetch_url_results:
            $ref: '#/components/schemas/FetchUrlResultsEvent'
          response.reasoning.search_queries:
            $ref: '#/components/schemas/SearchQueriesEvent'
          response.reasoning.search_results:
            $ref: '#/components/schemas/SearchResultsEvent'
          response.reasoning.started:
            $ref: '#/components/schemas/ReasoningStartedEvent'
          response.reasoning.stopped:
            $ref: '#/components/schemas/ReasoningStoppedEvent'
        propertyName: type
      oneOf:
        - $ref: '#/components/schemas/ResponseCreatedEvent'
        - $ref: '#/components/schemas/ResponseInProgressEvent'
        - $ref: '#/components/schemas/ResponseCompletedEvent'
        - $ref: '#/components/schemas/ResponseFailedEvent'
        - $ref: '#/components/schemas/OutputItemAddedEvent'
        - $ref: '#/components/schemas/OutputItemDoneEvent'
        - $ref: '#/components/schemas/TextDeltaEvent'
        - $ref: '#/components/schemas/TextDoneEvent'
        - $ref: '#/components/schemas/ReasoningStartedEvent'
        - $ref: '#/components/schemas/SearchQueriesEvent'
        - $ref: '#/components/schemas/SearchResultsEvent'
        - $ref: '#/components/schemas/FetchUrlQueriesEvent'
        - $ref: '#/components/schemas/FetchUrlResultsEvent'
        - $ref: '#/components/schemas/ReasoningStoppedEvent'
      title: ResponseStreamEvent
    ErrorInfo:
      description: Error information returned when a request fails
      properties:
        code:
          description: Error code
          type: string
        message:
          description: Human-readable error message
          type: string
        type:
          description: Error type category
          type: string
      required:
        - message
      type: object
      title: ErrorInfo
    Input:
      description: Input content - either a string or array of input items
      oneOf:
        - title: StringInput
          type: string
        - items:
            $ref: '#/components/schemas/InputItem'
          title: InputItemArray
          type: array
      title: Input
    ProfileReference:
      additionalProperties: false
      properties:
        id:
          maxLength: 128
          minLength: 1
          type: string
        type:
          enum:
            - custom
          type: string
        version:
          description: Version to bind to, or "latest". Omitted means "latest".
          type: string
      required:
        - type
        - id
      type: object
      title: ProfileReference
    ReasoningConfig:
      properties:
        effort:
          description: How much effort the model should spend on reasoning
          enum:
            - minimal
            - low
            - medium
            - high
            - xhigh
            - max
          type: string
      type: object
      title: ReasoningConfig
    ResponseFormat:
      description: Specifies the desired output format for the model response
      properties:
        json_schema:
          $ref: '#/components/schemas/JSONSchemaFormat'
        type:
          description: The type of response format
          enum:
            - json_schema
          type: string
      required:
        - type
      type: object
      title: ResponseFormat
    Tool:
      discriminator:
        mapping:
          fetch_url:
            $ref: '#/components/schemas/FetchUrlTool'
          finance_search:
            $ref: '#/components/schemas/FinanceSearchTool'
          function:
            $ref: '#/components/schemas/FunctionTool'
          people_search:
            $ref: '#/components/schemas/PeopleSearchTool'
          sandbox:
            $ref: '#/components/schemas/SandboxTool'
          web_search:
            $ref: '#/components/schemas/WebSearchTool'
          mcp:
            $ref: '#/components/schemas/McpTool'
          connector:
            $ref: '#/components/schemas/ConnectorTool'
        propertyName: type
      oneOf:
        - $ref: '#/components/schemas/WebSearchTool'
        - $ref: '#/components/schemas/FinanceSearchTool'
        - $ref: '#/components/schemas/PeopleSearchTool'
        - $ref: '#/components/schemas/FetchUrlTool'
        - $ref: '#/components/schemas/FunctionTool'
        - $ref: '#/components/schemas/SandboxTool'
        - $ref: '#/components/schemas/McpTool'
        - $ref: '#/components/schemas/ConnectorTool'
      title: Tool
    Skill:
      title: Skill
      oneOf:
        - $ref: '#/components/schemas/BuiltinSkill'
        - $ref: '#/components/schemas/InlineSkill'
        - $ref: '#/components/schemas/CustomSkill'
      discriminator:
        propertyName: type
        mapping:
          builtin:
            $ref: '#/components/schemas/BuiltinSkill'
          inline:
            $ref: '#/components/schemas/InlineSkill'
          custom:
            $ref: '#/components/schemas/CustomSkill'
    ResponsesObjectType:
      description: Object type in API responses
      enum:
        - response
      type: string
      title: ResponsesObjectType
    OutputItem:
      discriminator:
        mapping:
          fetch_url_results:
            $ref: '#/components/schemas/FetchUrlResultsOutputItem'
          finance_results:
            $ref: '#/components/schemas/FinanceResultsOutputItem'
          function_call:
            $ref: '#/components/schemas/FunctionCallOutputItem'
          message:
            $ref: '#/components/schemas/MessageOutputItem'
          people_search_results:
            $ref: '#/components/schemas/PeopleSearchResultsOutputItem'
          sandbox_results:
            $ref: '#/components/schemas/SandboxResultsOutputItem'
          search_results:
            $ref: '#/components/schemas/SearchResultsOutputItem'
          mcp_list_tools:
            $ref: '#/components/schemas/McpListToolsOutputItem'
          mcp_call:
            $ref: '#/components/schemas/McpCallOutputItem'
          tool_search_output:
            $ref: '#/components/schemas/ToolSearchOutputItem'
        propertyName: type
      oneOf:
        - $ref: '#/components/schemas/MessageOutputItem'
        - $ref: '#/components/schemas/SearchResultsOutputItem'
        - $ref: '#/components/schemas/FetchUrlResultsOutputItem'
        - $ref: '#/components/schemas/FinanceResultsOutputItem'
        - $ref: '#/components/schemas/PeopleSearchResultsOutputItem'
        - $ref: '#/components/schemas/FunctionCallOutputItem'
        - $ref: '#/components/schemas/SandboxResultsOutputItem'
        - $ref: '#/components/schemas/McpListToolsOutputItem'
        - $ref: '#/components/schemas/McpCallOutputItem'
        - $ref: '#/components/schemas/ToolSearchOutputItem'
      title: OutputItem
    Status:
      description: Status of a response or output item
      enum:
        - completed
        - failed
        - incomplete
        - in_progress
        - queued
        - cancelled
      type: string
      title: Status
    ResponsesUsage:
      description: Token usage and cost information for a Responses API request
      properties:
        cost:
          $ref: '#/components/schemas/ResponsesCost'
          description: Cost breakdown for the request
        input_tokens:
          description: Number of input tokens used
          format: int64
          type: integer
        input_tokens_details:
          properties:
            cache_creation_input_tokens:
              description: Tokens used for cache creation
              format: int64
              type: integer
            cache_read_input_tokens:
              description: Tokens read from cache
              format: int64
              type: integer
          type: object
        output_tokens:
          description: Number of output tokens generated
          format: int64
          type: integer
        tool_calls_details:
          description: Details about tool call invocations
          additionalProperties:
            $ref: '#/components/schemas/ToolCallDetails'
          type: object
        total_tokens:
          description: Total tokens used (input + output)
          format: int64
          type: integer
      required:
        - input_tokens
        - output_tokens
        - total_tokens
      type: object
      title: ResponsesUsage
    ResponseCompletedEvent:
      description: |
        Response event
        Contains the full or partial response object.
      properties:
        response:
          $ref: '#/components/schemas/ResponsesResponse'
        sequence_number:
          description: Monotonically increasing sequence number for event ordering
          format: int64
          type: integer
        type:
          $ref: '#/components/schemas/EventType'
      required:
        - type
        - sequence_number
      type: object
      title: ResponseCompletedEvent
    ResponseCreatedEvent:
      description: |
        Response created event (type: "response.created").
        Contains the initial response object.
      properties:
        response:
          $ref: '#/components/schemas/ResponsesResponse'
        sequence_number:
          description: Monotonically increasing sequence number for event ordering
          format: int64
          type: integer
        type:
          $ref: '#/components/schemas/EventType'
      required:
        - type
        - sequence_number
      type: object
      title: ResponseCreatedEvent
    ResponseFailedEvent:
      description: |
        Response failed event (type: "response.failed").
        Contains error details when streaming fails.
      properties:
        error:
          $ref: '#/components/schemas/ErrorInfo'
        sequence_number:
          description: Monotonically increasing sequence number for event ordering
          format: int64
          type: integer
        type:
          $ref: '#/components/schemas/EventType'
      required:
        - type
        - sequence_number
        - error
      type: object
      title: ResponseFailedEvent
    ResponseInProgressEvent:
      description: |
        Response in progress event (type: "response.in_progress").
        Emitted when response processing has started.
      properties:
        response:
          $ref: '#/components/schemas/ResponsesResponse'
        sequence_number:
          description: Monotonically increasing sequence number for event ordering
          format: int64
          type: integer
        type:
          $ref: '#/components/schemas/EventType'
      required:
        - type
        - sequence_number
      type: object
      title: ResponseInProgressEvent
    OutputItemAddedEvent:
      description: |
        Output item added event (type: "response.output_item.added").
        Emitted when a new output item (message or tool call) starts.
      properties:
        item:
          $ref: '#/components/schemas/OutputItem'
        output_index:
          format: int64
          type: integer
        sequence_number:
          description: Monotonically increasing sequence number for event ordering
          format: int64
          type: integer
        type:
          $ref: '#/components/schemas/EventType'
      required:
        - type
        - sequence_number
        - item
        - output_index
      type: object
      title: OutputItemAddedEvent
    OutputItemDoneEvent:
      description: |
        Output item done event (type: "response.output_item.done").
        Emitted when an output item (message or tool call) completes.
      properties:
        item:
          $ref: '#/components/schemas/OutputItem'
        output_index:
          format: int64
          type: integer
        sequence_number:
          description: Monotonically increasing sequence number for event ordering
          format: int64
          type: integer
        type:
          $ref: '#/components/schemas/EventType'
      required:
        - type
        - sequence_number
        - item
        - output_index
      type: object
      title: OutputItemDoneEvent
    TextDeltaEvent:
      description: |
        Text delta event (type: "response.output_text.delta").
        Contains incremental text content.
      properties:
        content_index:
          format: int64
          type: integer
        delta:
          type: string
        item_id:
          type: string
        output_index:
          format: int64
          type: integer
        sequence_number:
          description: Monotonically increasing sequence number for event ordering
          format: int64
          type: integer
        type:
          $ref: '#/components/schemas/EventType'
      required:
        - type
        - sequence_number
        - item_id
        - output_index
        - content_index
        - delta
      type: object
      title: TextDeltaEvent
    TextDoneEvent:
      description: |
        Text done event (type: "response.output_text.done").
        Contains the final text content.
      properties:
        content_index:
          format: int64
          type: integer
        item_id:
          type: string
        output_index:
          format: int64
          type: integer
        sequence_number:
          description: Monotonically increasing sequence number for event ordering
          format: int64
          type: integer
        text:
          type: string
        type:
          $ref: '#/components/schemas/EventType'
      required:
        - type
        - sequence_number
        - item_id
        - output_index
        - content_index
        - text
      type: object
      title: TextDoneEvent
    FetchUrlQueriesEvent:
      description: |
        URL fetch queries event (type: "response.reasoning.fetch_url_queries").
        Contains URLs being fetched.
      properties:
        sequence_number:
          description: Monotonically increasing sequence number for event ordering
          format: int64
          type: integer
        thought:
          type: string
        type:
          $ref: '#/components/schemas/EventType'
        urls:
          items:
            type: string
          type: array
      required:
        - type
        - sequence_number
        - urls
      type: object
      title: FetchUrlQueriesEvent
    FetchUrlResultsEvent:
      description: |
        URL fetch results event (type: "response.reasoning.fetch_url_results").
        Contains fetched URL contents.
      properties:
        contents:
          items:
            $ref: '#/components/schemas/UrlContent'
          type: array
        sequence_number:
          description: Monotonically increasing sequence number for event ordering
          format: int64
          type: integer
        thought:
          type: string
        type:
          $ref: '#/components/schemas/EventType'
      required:
        - type
        - sequence_number
        - contents
      type: object
      title: FetchUrlResultsEvent
    SearchQueriesEvent:
      description: |
        Search queries event (type: "response.reasoning.search_queries").
        Contains search queries being executed.
      properties:
        queries:
          items:
            type: string
          type: array
        sequence_number:
          description: Monotonically increasing sequence number for event ordering
          format: int64
          type: integer
        thought:
          type: string
        type:
          $ref: '#/components/schemas/EventType'
      required:
        - type
        - sequence_number
        - queries
      type: object
      title: SearchQueriesEvent
    SearchResultsEvent:
      description: |
        Search results event (type: "response.reasoning.search_results").
        Contains search results returned.
      properties:
        results:
          items:
            $ref: '#/components/schemas/SearchResult'
          type: array
        sequence_number:
          description: Monotonically increasing sequence number for event ordering
          format: int64
          type: integer
        thought:
          type: string
        type:
          $ref: '#/components/schemas/EventType'
        usage:
          $ref: '#/components/schemas/ResponsesUsage'
      required:
        - type
        - sequence_number
        - results
      type: object
      title: SearchResultsEvent
    ReasoningStartedEvent:
      description: |
        Reasoning started event (type: "response.reasoning.started").
        Signals the model has started reasoning/searching.
      properties:
        sequence_number:
          description: Monotonically increasing sequence number for event ordering
          format: int64
          type: integer
        thought:
          type: string
        type:
          $ref: '#/components/schemas/EventType'
      required:
        - type
        - sequence_number
      type: object
      title: ReasoningStartedEvent
    ReasoningStoppedEvent:
      description: |
        Reasoning stopped event (type: "response.reasoning.stopped").
        Signals the model has finished reasoning/searching.
      properties:
        sequence_number:
          description: Monotonically increasing sequence number for event ordering
          format: int64
          type: integer
        thought:
          type: string
        type:
          $ref: '#/components/schemas/EventType'
      required:
        - type
        - sequence_number
      type: object
      title: ReasoningStoppedEvent
    InputItem:
      discriminator:
        mapping:
          function_call:
            $ref: '#/components/schemas/FunctionCallInput'
          function_call_output:
            $ref: '#/components/schemas/FunctionCallOutputInput'
          message:
            $ref: '#/components/schemas/InputMessage'
        propertyName: type
      oneOf:
        - $ref: '#/components/schemas/InputMessage'
        - $ref: '#/components/schemas/FunctionCallOutputInput'
        - $ref: '#/components/schemas/FunctionCallInput'
      title: InputItem
    JSONSchemaFormat:
      description: Defines a JSON schema for structured output validation
      properties:
        description:
          description: Optional description of the schema
          type: string
        name:
          description: Name of the schema (1-64 alphanumeric chars)
          maxLength: 64
          minLength: 1
          type: string
        schema:
          additionalProperties: true
          description: The JSON schema object
          type: object
        strict:
          description: Whether to enforce strict schema validation
          type: boolean
      required:
        - name
        - schema
      type: object
      title: JSONSchemaFormat
    FetchUrlTool:
      properties:
        max_urls:
          description: Maximum number of URLs to fetch per tool call
          format: int32
          maximum: 10
          minimum: 1
          type: integer
        type:
          enum:
            - fetch_url
          type: string
      required:
        - type
      type: object
      title: FetchUrlTool
    FinanceSearchTool:
      description: Finance search tool configuration for the Agent API
      properties:
        type:
          description: Tool type identifier
          enum:
            - finance_search
          type: string
      required:
        - type
      type: object
      title: FinanceSearchTool
    FunctionTool:
      properties:
        description:
          description: A description of what the function does
          type: string
        name:
          description: The name of the function
          type: string
        parameters:
          additionalProperties: true
          description: JSON Schema defining the function's parameters
          type: object
        strict:
          description: Whether to enable strict schema validation
          type: boolean
        type:
          enum:
            - function
          type: string
      required:
        - type
        - name
      type: object
      title: FunctionTool
    PeopleSearchTool:
      description: People search tool configuration for the Agent API
      properties:
        type:
          description: Tool type identifier
          enum:
            - people_search
          type: string
      required:
        - type
      type: object
      title: PeopleSearchTool
    SandboxTool:
      description: >-
        Sandbox tool configuration for the Responses API. Executes code in an
        isolated container during an Agent API request.
      properties:
        type:
          description: Tool type identifier
          enum:
            - sandbox
          type: string
      required:
        - type
      type: object
      title: SandboxTool
    WebSearchTool:
      description: Web search tool configuration for the Responses API
      properties:
        filters:
          $ref: '#/components/schemas/WebSearchFilters'
          description: Domain and date filters for search results
        search_type:
          description: >-
            Search type for this tool. `web` uses standard web search. `fast`
            uses the lower-latency Fast Search path, billed at $1.00 per 1,000
            invocations plus model tokens. When omitted, inherits the preset's
            search type if configured; otherwise uses `web`.
          enum:
            - web
            - fast
          type: string
        search_context_size:
          description: >-
            Named search context budget. Explicit max_tokens /
            max_tokens_per_page budgets override it.
          enum:
            - low
            - medium
            - high
          type: string
        max_results:
          description: >-
            Upper bound on the number of search results collected per call. Must
            be between 1 and 50; values outside that range are rejected with a
            400 error.
          format: int32
          type: integer
          minimum: 1
          maximum: 50
        max_tokens:
          description: Maximum total tokens for search context
          format: int32
          type: integer
        max_tokens_per_page:
          description: Maximum tokens to extract per search result page
          format: int32
          type: integer
        type:
          description: Tool type identifier
          enum:
            - web_search
          type: string
        user_location:
          $ref: '#/components/schemas/ToolUserLocation'
          description: User's location for search personalization
      required:
        - type
      type: object
      title: WebSearchTool
    McpTool:
      description: >-
        Connects a user-supplied remote MCP server. Agent API discovers the
        server's tools when the request starts and calls them like native tools.
        Matches OpenAI's mcp tool. `defer_loading: true` keeps discovered
        definitions out of the initial model context and lets the model search,
        inspect, and call them as needed. `require_approval` and `connector_id`
        are ignored: every call auto-runs, and only bring-your-own `server_url`
        is honored.
      properties:
        type:
          enum:
            - mcp
          type: string
        server_label:
          description: >-
            Unique per request, ^[a-zA-Z0-9_-]{1,64}$. Namespaces the server's
            tools.
          type: string
        server_url:
          description: >-
            HTTPS URL of the remote MCP server. Must be a Streamable HTTP MCP
            endpoint; the legacy SSE transport is not supported.
          type: string
        authorization:
          description: >-
            An access token passed to the remote MCP server for authentication.
            Provide the raw token value. Never logged or echoed.
          type: string
        headers:
          additionalProperties:
            type: string
          description: Extra request headers.
          type: object
        allowed_tools:
          description: >-
            Optional allowlist of tool names. Empty exposes all discovered
            tools.
          items:
            type: string
          type: array
        defer_loading:
          description: >-
            When true, keeps discovered tool definitions out of the initial
            model context and lets the model load relevant schemas as needed.
            Defaults to false.
          type: boolean
      required:
        - type
        - server_label
        - server_url
      type: object
      title: McpTool
    ConnectorTool:
      description: >-
        A Perplexity-managed connector scoped to the authenticated API
        organization.
      properties:
        type:
          enum:
            - connector
          type: string
        id:
          description: Opaque connector identifier.
          type: string
        server_label:
          description: >-
            Unique per request, ^[a-zA-Z0-9_-]{1,64}$. Namespaces the
            connector's tools.
          type: string
        server_description:
          description: Optional model-facing namespace description.
          type: string
        allowed_tools:
          description: >-
            Optional exact-name allowlist. Omitted or empty admits every live
            tool.
          items:
            type: string
          type: array
      required:
        - type
        - id
        - server_label
      type: object
      title: ConnectorTool
    BuiltinSkill:
      title: BuiltinSkill
      type: object
      additionalProperties: false
      required:
        - type
        - name
      properties:
        type:
          type: string
          enum:
            - builtin
        name:
          type: string
          enum:
            - office
            - office/docx
            - office/pdf
            - office/pptx
            - office/xlsx
          description: >-
            Built-in skill to make available to the model. office is the full
            Office bundle (enables all four leaves). office/docx, office/pdf,
            office/pptx, office/xlsx each create polished documents of that type
            from scratch, with structural validation and visual QA.
    InlineSkill:
      title: InlineSkill
      type: object
      additionalProperties: false
      required:
        - type
        - name
        - description
        - instructions
      properties:
        type:
          type: string
          enum:
            - inline
        name:
          type: string
          minLength: 1
          maxLength: 64
          pattern: ^[a-z0-9]+(?:-[a-z0-9]+)*$
          description: Request-scoped lowercase ASCII name separated by single hyphens.
        description:
          type: string
          minLength: 1
          maxLength: 1024
          description: Short discovery description, limited to 1,024 UTF-8 bytes.
        instructions:
          type: string
          minLength: 1
          maxLength: 65536
          description: >-
            Instructions returned by load_skill, limited to 65,536 UTF-8 bytes
            per skill and 262,144 bytes across the request.
    CustomSkill:
      title: CustomSkill
      type: object
      additionalProperties: false
      required:
        - type
        - id
      properties:
        type:
          enum:
            - custom
          type: string
        id:
          type: string
          minLength: 1
          maxLength: 128
          description: >-
            Identifier of an organization-owned skill stored in Perplexity, in
            the form skill_<id>.
        version:
          type: string
          description: Revision to load, or "latest". Omitted means "latest".
    FetchUrlResultsOutputItem:
      properties:
        contents:
          items:
            $ref: '#/components/schemas/UrlContent'
          type: array
        type:
          enum:
            - fetch_url_results
          type: string
      required:
        - type
        - contents
      type: object
      title: FetchUrlResultsOutputItem
    FinanceResultsOutputItem:
      description: >-
        Intermediate output item emitted when the finance_search tool runs. One
        item is emitted per tool invocation; the requested categories and
        tickers are echoed at the envelope level alongside the per-result
        entries.
      properties:
        categories:
          description: >-
            Finance categories the tool was asked to retrieve for this
            invocation (for example, "quote").
          items:
            type: string
          type: array
        results:
          description: Structured finance results returned for the invocation.
          items:
            $ref: '#/components/schemas/FinanceResult'
          type: array
        tickers:
          description: Ticker symbols the tool was asked to retrieve for this invocation.
          items:
            type: string
          type: array
        type:
          enum:
            - finance_results
          type: string
      required:
        - type
        - results
      type: object
      title: FinanceResultsOutputItem
    FunctionCallOutputItem:
      properties:
        arguments:
          description: JSON string of arguments
          type: string
        call_id:
          description: Correlates with function_call_output input
          type: string
        id:
          type: string
        name:
          type: string
        status:
          $ref: '#/components/schemas/Status'
        thought_signature:
          description: Base64-encoded opaque signature for thinking models
          type: string
        type:
          enum:
            - function_call
          type: string
      required:
        - type
        - id
        - status
        - name
        - call_id
        - arguments
      type: object
      title: FunctionCallOutputItem
    MessageOutputItem:
      properties:
        content:
          items:
            $ref: '#/components/schemas/ContentPart'
          type: array
        id:
          type: string
        role:
          $ref: '#/components/schemas/RoleType'
        status:
          $ref: '#/components/schemas/Status'
        type:
          enum:
            - message
          type: string
      required:
        - type
        - id
        - status
        - role
        - content
      type: object
      title: MessageOutputItem
    PeopleSearchResultsOutputItem:
      description: >-
        Intermediate output item emitted when the people_search tool runs.
        Mirrors the shape of search_results: the agent's generated queries plus
        a list of per-person result entries.
      properties:
        queries:
          description: >-
            Search queries the agent generated for this people_search
            invocation.
          items:
            type: string
          type: array
        results:
          description: >-
            Per-person result entries. Shape matches SearchResult (id, url,
            title, snippet, source, last_updated).
          items:
            $ref: '#/components/schemas/SearchResult'
          type: array
        type:
          enum:
            - people_search_results
          type: string
      required:
        - type
        - results
      type: object
      title: PeopleSearchResultsOutputItem
    SandboxResultsOutputItem:
      description: >-
        Result of a sandbox tool invocation. Contains the executed code and its
        output.
      properties:
        type:
          enum:
            - sandbox_results
          type: string
        code:
          description: The code that was executed inside the sandbox.
          type: string
        stdout:
          description: Standard output captured from the sandbox execution.
          type: string
        stderr:
          description: Standard error captured from the sandbox execution.
          type: string
        exit_code:
          description: Process exit code. Non-zero indicates a runtime error.
          format: int32
          type: integer
        duration_ms:
          description: Wall-clock duration of the sandbox execution, in milliseconds.
          format: int64
          type: integer
        status:
          description: Execution status. One of `completed`, `timed_out`, `failed`.
          enum:
            - completed
            - timed_out
            - failed
          type: string
      required:
        - type
        - status
      type: object
      title: SandboxResultsOutputItem
    SearchResultsOutputItem:
      properties:
        queries:
          items:
            type: string
          type: array
        results:
          items:
            $ref: '#/components/schemas/SearchResult'
          type: array
        type:
          enum:
            - search_results
          type: string
      required:
        - type
        - results
      type: object
      title: SearchResultsOutputItem
    McpListToolsOutputItem:
      description: >-
        Tools discovered on one external MCP server when the request starts.
        Matches OpenAI's mcp_list_tools item.
      properties:
        type:
          enum:
            - mcp_list_tools
          type: string
        id:
          type: string
        server_label:
          type: string
        connector_id:
          description: Present only when the item originated from a managed connector.
          type: string
        tools:
          items:
            $ref: '#/components/schemas/McpToolDef'
          type: array
        error:
          description: >-
            Present only when the server's tools could not be listed. Absent on
            success.
          type: string
      required:
        - type
        - id
        - server_label
        - tools
      type: object
      title: McpListToolsOutputItem
    McpCallOutputItem:
      description: >-
        One tool call executed against an external MCP server, modeled on
        OpenAI's mcp_call item.
      properties:
        type:
          enum:
            - mcp_call
          type: string
        id:
          type: string
        server_label:
          type: string
        connector_id:
          description: Present only when the item originated from a managed connector.
          type: string
        name:
          type: string
        arguments:
          description: JSON-encoded arguments the model passed.
          type: string
        output:
          description: Tool output text; empty when the call failed.
          type: string
        error:
          description: >-
            The failure string when the call failed (also returned to the model
            in-band); null on success, matching OpenAI's mcp_call.
          type:
            - string
            - 'null'
      required:
        - type
        - id
        - server_label
        - name
        - arguments
      type: object
      title: McpCallOutputItem
    ToolSearchOutputItem:
      description: Complete public definitions matched by one hosted external-tool search.
      properties:
        type:
          enum:
            - tool_search_output
          type: string
        id:
          type: string
        call_id:
          description: Always null for hosted search.
          type:
            - string
            - 'null'
        execution:
          description: >-
            Execution location. Currently `server`. Clients must tolerate
            unknown values.
          type: string
        arguments:
          description: Exact argument text authored by the model for hosted search.
          type: string
        tools:
          items:
            $ref: '#/components/schemas/NamespaceTool'
          type: array
        status:
          description: >-
            Current execution status. Known values are `in_progress`,
            `completed`, and `incomplete`. Clients must tolerate unknown values.
          type: string
      required:
        - type
        - id
        - call_id
        - execution
        - tools
        - status
      type: object
      title: ToolSearchOutputItem
    ResponsesCost:
      description: Cost breakdown for a Responses API request
      properties:
        cache_creation_cost:
          description: Cost for cache creation in USD
          format: double
          type: number
        cache_read_cost:
          description: Cost for cache reads in USD
          format: double
          type: number
        currency:
          $ref: '#/components/schemas/Currency'
          description: Currency of the cost values
        input_cost:
          description: Cost for input tokens in USD
          format: double
          type: number
        output_cost:
          description: Cost for output tokens in USD
          format: double
          type: number
        tool_calls_cost:
          description: Cost for tool call invocations in USD
          format: double
          type: number
        total_cost:
          description: Total cost for the request in USD
          format: double
          type: number
      required:
        - currency
        - input_cost
        - output_cost
        - total_cost
      type: object
      title: ResponsesCost
    ToolCallDetails:
      description: Details about a tool call invocation
      properties:
        invocation:
          description: Number of times this tool was invoked
          format: int64
          type: integer
      type: object
      title: ToolCallDetails
    EventType:
      description: SSE event type discriminator
      enum:
        - response.created
        - response.in_progress
        - response.completed
        - response.failed
        - response.output_item.added
        - response.output_item.done
        - response.output_text.delta
        - response.output_text.done
        - response.reasoning.started
        - response.reasoning.search_queries
        - response.reasoning.search_results
        - response.reasoning.fetch_url_queries
        - response.reasoning.fetch_url_results
        - response.reasoning.stopped
      type: string
      title: EventType
    UrlContent:
      description: Content fetched from a URL
      properties:
        snippet:
          description: The fetched content snippet
          type: string
        title:
          description: The title of the page
          type: string
        url:
          description: The URL from which content was fetched
          type: string
      required:
        - url
        - title
        - snippet
      type: object
      title: UrlContent
    SearchResult:
      description: A single search result used in LLM responses
      properties:
        date:
          description: Publication date of the result
          type: string
        id:
          description: Unique numeric identifier for the result
          format: int64
          type: integer
        last_updated:
          description: Date the result was last updated
          type: string
        snippet:
          description: Text snippet from the search result
          type: string
        source:
          $ref: '#/components/schemas/SearchSource'
          description: Source type of the result
        title:
          description: Title of the search result page
          type: string
        url:
          description: URL of the search result page
          type: string
      required:
        - id
        - url
        - title
        - snippet
      type: object
      title: SearchResult
    FunctionCallInput:
      properties:
        arguments:
          description: Function arguments (JSON string)
          type: string
        call_id:
          description: The call_id that correlates with function_call_output
          type: string
        name:
          description: The function name
          type: string
        thought_signature:
          description: Base64-encoded signature for thinking models
          type: string
        type:
          enum:
            - function_call
          type: string
      required:
        - type
        - call_id
        - name
        - arguments
      type: object
      title: FunctionCallInput
    FunctionCallOutputInput:
      additionalProperties: false
      properties:
        id:
          description: Replay metadata populated when this item was returned by the API.
          nullable: true
          type: string
        call_id:
          description: The call_id from function_call output
          type: string
        name:
          description: Function name (required by some providers)
          type: string
        output:
          description: >-
            Function result as a JSON string or an array of input_text and
            input_image content parts.
          oneOf:
            - title: StringOutput
              type: string
            - items:
                discriminator:
                  mapping:
                    input_image:
                      $ref: '#/components/schemas/FunctionCallOutputImagePart'
                    input_text:
                      $ref: '#/components/schemas/FunctionCallOutputTextPart'
                  propertyName: type
                oneOf:
                  - $ref: '#/components/schemas/FunctionCallOutputTextPart'
                  - $ref: '#/components/schemas/FunctionCallOutputImagePart'
              title: OutputPartArray
              type: array
        status:
          description: Replay metadata populated when this item was returned by the API.
          enum:
            - in_progress
            - completed
            - incomplete
          nullable: true
          type: string
        thought_signature:
          description: Base64-encoded signature from function_call
          type: string
        type:
          enum:
            - function_call_output
          type: string
      required:
        - type
        - call_id
        - output
      type: object
      title: FunctionCallOutputInput
    InputMessage:
      properties:
        content:
          $ref: '#/components/schemas/InputContent'
        role:
          enum:
            - user
            - assistant
            - system
            - developer
          type: string
        type:
          enum:
            - message
          type: string
      required:
        - type
        - role
        - content
      type: object
      title: InputMessage
    WebSearchFilters:
      allOf:
        - $ref: '#/components/schemas/SearchDomainFilter'
        - $ref: '#/components/schemas/DateFilters'
      title: WebSearchFilters
    ToolUserLocation:
      description: User's geographic location for search personalization
      properties:
        city:
          description: City name
          type: string
        country:
          description: ISO 3166-1 alpha-2 country code
          type: string
        latitude:
          description: Latitude coordinate
          format: double
          type: number
        longitude:
          description: Longitude coordinate
          format: double
          type: number
        region:
          description: State or region name
          type: string
      type: object
      title: ToolUserLocation
    FinanceResult:
      description: A single structured finance result returned by the finance_search tool.
      properties:
        category:
          description: Finance category this result belongs to (for example, "quote").
          type: string
        content:
          description: >-
            Structured content for the result, typically a markdown-formatted
            table or snippet.
          type: string
        sources:
          description: Source URLs backing the structured content.
          items:
            type: string
          type: array
        tickers:
          description: Ticker symbols this result pertains to.
          items:
            type: string
          type: array
      required:
        - category
        - content
      type: object
      title: FinanceResult
    ContentPart:
      properties:
        annotations:
          items:
            $ref: '#/components/schemas/Annotation'
          type: array
        text:
          type: string
        type:
          $ref: '#/components/schemas/ContentPartType'
      required:
        - type
        - text
      type: object
      title: ContentPart
    RoleType:
      description: Role in a message
      enum:
        - assistant
      type: string
      title: RoleType
    McpToolDef:
      description: One tool discovered on a remote MCP server.
      properties:
        name:
          type: string
        description:
          type: string
        input_schema:
          additionalProperties: true
          description: The server's JSON Schema for the tool, passed through unmodified.
          type: object
      required:
        - name
        - input_schema
      type: object
      title: McpToolDef
    NamespaceTool:
      description: A response-only namespace containing complete external tool definitions.
      properties:
        type:
          enum:
            - namespace
          type: string
        name:
          type: string
        description:
          type: string
        tools:
          items:
            $ref: '#/components/schemas/NamespaceToolDef'
          type: array
      required:
        - type
        - name
        - description
        - tools
      type: object
      title: NamespaceTool
    Currency:
      description: Currency code for cost values
      enum:
        - USD
      type: string
    SearchSource:
      description: Source of search results
      enum:
        - web
      type: string
      title: SearchSource
    FunctionCallOutputImagePart:
      additionalProperties: false
      properties:
        detail:
          description: >-
            Accepted for OpenAI replay compatibility; native tool-result
            forwarding ignores this hint.
          enum:
            - low
            - high
            - auto
          nullable: true
          type: string
        image_url:
          description: A fully qualified HTTP(S) URL or base64 image data URI.
          type: string
        type:
          enum:
            - input_image
          type: string
      required:
        - type
        - image_url
      type: object
      title: FunctionCallOutputImagePart
    FunctionCallOutputTextPart:
      additionalProperties: false
      properties:
        text:
          type: string
        type:
          enum:
            - input_text
          type: string
      required:
        - type
        - text
      type: object
      title: FunctionCallOutputTextPart
    InputContent:
      description: Message content - either a string or array of content parts
      oneOf:
        - title: StringContent
          type: string
        - items:
            $ref: '#/components/schemas/InputContentPart'
          title: ContentPartArray
          type: array
      title: InputContent
    SearchDomainFilter:
      properties:
        search_domain_filter:
          description: Limit search results to specific domains (max 20)
          items:
            maxLength: 253
            type: string
          maxItems: 20
          type: array
      type: object
      title: SearchDomainFilter
    DateFilters:
      properties:
        last_updated_after_filter:
          $ref: '#/components/schemas/Date'
          description: Return results updated after this date (MM/DD/YYYY)
        last_updated_before_filter:
          $ref: '#/components/schemas/Date'
          description: Return results updated before this date (MM/DD/YYYY)
        search_after_date_filter:
          $ref: '#/components/schemas/Date'
          description: Return results published after this date (MM/DD/YYYY)
        search_before_date_filter:
          $ref: '#/components/schemas/Date'
          description: Return results published before this date (MM/DD/YYYY)
        search_recency_filter:
          $ref: '#/components/schemas/SearchRecencyFilter'
          description: Filter by publication recency (hour/day/week/month/year)
      type: object
      title: DateFilters
    Annotation:
      description: Text annotation (URL citation)
      properties:
        end_index:
          description: End character index of the annotated text
          format: int32
          type: integer
        start_index:
          description: Start character index of the annotated text
          format: int32
          type: integer
        title:
          description: Title of the cited source
          type: string
        type:
          description: Annotation type (url_citation)
          type: string
        url:
          description: URL of the cited source
          type: string
      type: object
      title: Annotation
    ContentPartType:
      description: Type of a content part
      enum:
        - output_text
      type: string
      title: ContentPartType
    NamespaceToolDef:
      description: One function definition discovered by hosted external-tool search.
      properties:
        type:
          enum:
            - function
          type: string
        name:
          type: string
        description:
          type: string
        parameters:
          additionalProperties: true
          description: The server's JSON Schema for the tool, passed through unmodified.
          type: object
      required:
        - type
        - name
      type: object
      title: NamespaceToolDef
    InputContentPart:
      properties:
        image_url:
          maxLength: 2048
          type: string
        text:
          type: string
        type:
          enum:
            - input_text
            - input_image
          type: string
      required:
        - type
      type: object
      title: InputContentPart
    Date:
      description: 'Input: MM/DD/YYYY, Output: YYYY-MM-DD'
      type: string
      title: Date
    SearchRecencyFilter:
      description: Time-based recency filter for search results
      enum:
        - hour
        - day
        - week
        - month
        - year
      type: string
      title: SearchRecencyFilter
  securitySchemes:
    HTTPBearer:
      type: http
      scheme: bearer

````