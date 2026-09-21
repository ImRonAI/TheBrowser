> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Create Response

> Generate a response for the provided input with optional web search and reasoning.



## OpenAPI

````yaml post /v1/responses
openapi: 3.1.0
info:
  title: Perplexity AI API
  description: Perplexity AI API
  version: 0.1.0
servers: []
security: []
paths:
  /v1/responses:
    post:
      summary: Create Response
      description: >-
        Generate a response for the provided input with optional web search and
        reasoning.
      operationId: createResponse
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
      security:
        - HTTPBearer: []
components:
  schemas:
    ResponsesRequest:
      properties:
        input:
          $ref: '#/components/schemas/Input'
        instructions:
          description: System instructions for the model
          type: string
        language_preference:
          description: ISO 639-1 language code for response language
          type: string
        max_output_tokens:
          description: Maximum tokens to generate
          format: int32
          minimum: 1
          type: integer
        max_steps:
          description: |
            Maximum number of research loop steps.
            If provided, overrides the preset's max_steps value.
            Must be >= 1 if specified. Maximum allowed is 10.
          format: int32
          maximum: 10
          minimum: 1
          type: integer
        model:
          description: >
            Model ID in provider/model format (e.g., "xai/grok-4-1",
            "openai/gpt-4o").

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
            Preset configuration name (e.g., "fast-search", "pro-search",
            "deep-research").

            Pre-configured model with system prompt and search parameters.

            Required if model is not provided.
          type: string
        reasoning:
          $ref: '#/components/schemas/ReasoningConfig'
        response_format:
          $ref: '#/components/schemas/ResponseFormat'
        stream:
          description: If true, returns SSE stream instead of JSON
          type: boolean
        tools:
          description: Tools available to the model
          items:
            $ref: '#/components/schemas/Tool'
          type: array
      required:
        - input
      type: object
      title: ResponsesRequest
    ResponsesResponse:
      description: Non-streaming response returned when stream is false
      properties:
        created_at:
          format: int64
          type: integer
        error:
          $ref: '#/components/schemas/ErrorInfo'
        id:
          type: string
        model:
          type: string
        object:
          $ref: '#/components/schemas/ResponsesObjectType'
        output:
          items:
            $ref: '#/components/schemas/OutputItem'
          type: array
        status:
          $ref: '#/components/schemas/Status'
        usage:
          $ref: '#/components/schemas/ResponsesUsage'
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
          response.completed: '#/components/schemas/ResponseCompletedEvent'
          response.created: '#/components/schemas/ResponseCreatedEvent'
          response.failed: '#/components/schemas/ResponseFailedEvent'
          response.in_progress: '#/components/schemas/ResponseInProgressEvent'
          response.output_item.added: '#/components/schemas/OutputItemAddedEvent'
          response.output_item.done: '#/components/schemas/OutputItemDoneEvent'
          response.output_text.delta: '#/components/schemas/TextDeltaEvent'
          response.output_text.done: '#/components/schemas/TextDoneEvent'
          response.reasoning.fetch_url_queries: '#/components/schemas/FetchUrlQueriesEvent'
          response.reasoning.fetch_url_results: '#/components/schemas/FetchUrlResultsEvent'
          response.reasoning.search_queries: '#/components/schemas/SearchQueriesEvent'
          response.reasoning.search_results: '#/components/schemas/SearchResultsEvent'
          response.reasoning.started: '#/components/schemas/ReasoningStartedEvent'
          response.reasoning.stopped: '#/components/schemas/ReasoningStoppedEvent'
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
    ReasoningConfig:
      properties:
        effort:
          description: How much effort the model should spend on reasoning
          enum:
            - low
            - medium
            - high
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
          fetch_url: '#/components/schemas/FetchUrlTool'
          function: '#/components/schemas/FunctionTool'
          web_search: '#/components/schemas/WebSearchTool'
        propertyName: type
      oneOf:
        - $ref: '#/components/schemas/WebSearchTool'
        - $ref: '#/components/schemas/FetchUrlTool'
        - $ref: '#/components/schemas/FunctionTool'
      title: Tool
    ErrorInfo:
      properties:
        code:
          type: string
        message:
          type: string
        type:
          type: string
      required:
        - message
      type: object
      title: ErrorInfo
    ResponsesObjectType:
      description: Object type in API responses
      enum:
        - response
      type: string
      title: ResponsesObjectType
    OutputItem:
      discriminator:
        mapping:
          fetch_url_results: '#/components/schemas/FetchUrlResultsOutputItem'
          function_call: '#/components/schemas/FunctionCallOutputItem'
          message: '#/components/schemas/MessageOutputItem'
          search_results: '#/components/schemas/SearchResultsOutputItem'
        propertyName: type
      oneOf:
        - $ref: '#/components/schemas/MessageOutputItem'
        - $ref: '#/components/schemas/SearchResultsOutputItem'
        - $ref: '#/components/schemas/FetchUrlResultsOutputItem'
        - $ref: '#/components/schemas/FunctionCallOutputItem'
      title: OutputItem
    Status:
      description: Status of a response or output item
      enum:
        - completed
        - failed
        - in_progress
        - requires_action
      type: string
      title: Status
    ResponsesUsage:
      properties:
        cost:
          $ref: '#/components/schemas/ResponsesCost'
        input_tokens:
          format: int64
          type: integer
        input_tokens_details:
          properties:
            cache_creation_input_tokens:
              format: int64
              type: integer
            cache_read_input_tokens:
              format: int64
              type: integer
          type: object
        output_tokens:
          format: int64
          type: integer
        tool_calls_details:
          additionalProperties:
            $ref: '#/components/schemas/ToolCallDetails'
          type: object
        total_tokens:
          format: int64
          type: integer
      required:
        - input_tokens
        - output_tokens
        - total_tokens
      type: object
      title: ResponsesUsage
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
          function_call: '#/components/schemas/FunctionCallInput'
          function_call_output: '#/components/schemas/FunctionCallOutputInput'
          message: '#/components/schemas/InputMessage'
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
    WebSearchTool:
      properties:
        filters:
          $ref: '#/components/schemas/WebSearchFilters'
        max_tokens:
          format: int32
          type: integer
        max_tokens_per_page:
          format: int32
          type: integer
        type:
          enum:
            - web_search
          type: string
        user_location:
          $ref: '#/components/schemas/ToolUserLocation'
      required:
        - type
      type: object
      title: WebSearchTool
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
    ResponsesCost:
      properties:
        cache_creation_cost:
          format: double
          type: number
        cache_read_cost:
          format: double
          type: number
        currency:
          $ref: '#/components/schemas/Currency'
        input_cost:
          format: double
          type: number
        output_cost:
          format: double
          type: number
        tool_calls_cost:
          format: double
          type: number
        total_cost:
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
    SearchResult:
      description: A single search result used in LLM responses
      properties:
        date:
          type: string
        id:
          format: int64
          type: integer
        last_updated:
          type: string
        snippet:
          type: string
        source:
          $ref: '#/components/schemas/SearchSource'
        title:
          type: string
        url:
          type: string
      required:
        - id
        - url
        - title
        - snippet
      type: object
      title: SearchResult
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
    FunctionCallOutputInput:
      properties:
        call_id:
          description: The call_id from function_call output
          type: string
        name:
          description: Function name (required by some providers)
          type: string
        output:
          description: Function result (JSON string)
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
    WebSearchFilters:
      allOf:
        - $ref: '#/components/schemas/SearchDomainFilter'
        - $ref: '#/components/schemas/DateFilters'
      title: WebSearchFilters
    ToolUserLocation:
      description: User's geographic location for search personalization
      properties:
        city:
          type: string
        country:
          description: ISO 3166-1 alpha-2 country code
          type: string
        latitude:
          format: double
          type: number
        longitude:
          format: double
          type: number
        region:
          type: string
      type: object
      title: ToolUserLocation
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
        last_updated_before_filter:
          $ref: '#/components/schemas/Date'
        search_after_date_filter:
          $ref: '#/components/schemas/Date'
        search_before_date_filter:
          $ref: '#/components/schemas/Date'
        search_recency_filter:
          $ref: '#/components/schemas/SearchRecencyFilter'
      type: object
      title: DateFilters
    Annotation:
      description: Text annotation (e.g., URL citation)
      properties:
        end_index:
          format: int32
          type: integer
        start_index:
          format: int32
          type: integer
        title:
          type: string
        type:
          type: string
        url:
          type: string
      type: object
      title: Annotation
    ContentPartType:
      description: Type of a content part
      enum:
        - output_text
      type: string
      title: ContentPartType
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

Search API 

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Search the Web

> Search the web and retrieve relevant web page contents.



## OpenAPI

````yaml post /search
openapi: 3.1.0
info:
  title: Perplexity AI API
  description: Perplexity AI API
  version: 0.1.0
servers: []
security: []
paths:
  /search:
    post:
      summary: Search the Web
      description: Search the web and retrieve relevant web page contents.
      operationId: search_search_post
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ApiSearchRequest'
      responses:
        '200':
          description: Successful Response
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ApiSearchResponse'
        '422':
          description: Validation Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/HTTPValidationError'
      security:
        - HTTPBearer: []
components:
  schemas:
    ApiSearchRequest:
      properties:
        query:
          anyOf:
            - type: string
            - items:
                type: string
              type: array
          title: Query
        max_tokens:
          type: integer
          title: Max Tokens
          default: 10000
        max_tokens_per_page:
          type: integer
          title: Max Tokens Per Page
          default: 4096
        max_results:
          type: integer
          title: Max Results
          default: 10
        search_domain_filter:
          anyOf:
            - items:
                type: string
              type: array
            - type: 'null'
          title: Search Domain Filter
        search_language_filter:
          anyOf:
            - items:
                type: string
              type: array
            - type: 'null'
          title: Search Language Filter
        search_recency_filter:
          anyOf:
            - type: string
              enum:
                - hour
                - day
                - week
                - month
                - year
            - type: 'null'
          title: Search Recency Filter
        search_after_date_filter:
          anyOf:
            - type: string
            - type: 'null'
          title: Search After Date Filter
        search_before_date_filter:
          anyOf:
            - type: string
            - type: 'null'
          title: Search Before Date Filter
        last_updated_before_filter:
          anyOf:
            - type: string
            - type: 'null'
          title: Last Updated Before Filter
        last_updated_after_filter:
          anyOf:
            - type: string
            - type: 'null'
          title: Last Updated After Filter
        search_mode:
          anyOf:
            - type: string
              enum:
                - web
                - academic
                - sec
            - type: 'null'
          title: Search Mode
        country:
          anyOf:
            - type: string
            - type: 'null'
          title: Country
        display_server_time:
          type: boolean
          title: Display Server Time
          default: false
      type: object
      required:
        - query
      title: ApiSearchRequest
    ApiSearchResponse:
      properties:
        results:
          items:
            $ref: '#/components/schemas/ApiSearchPage'
          type: array
          title: Results
        id:
          type: string
          title: Id
        server_time:
          anyOf:
            - type: string
            - type: 'null'
          title: Server Time
      type: object
      required:
        - results
        - id
      title: ApiSearchResponse
    HTTPValidationError:
      properties:
        detail:
          items:
            $ref: '#/components/schemas/ValidationError'
          type: array
          title: Detail
      type: object
      title: HTTPValidationError
    ApiSearchPage:
      properties:
        title:
          type: string
          title: Title
        url:
          type: string
          title: Url
        snippet:
          type: string
          title: Snippet
        date:
          anyOf:
            - type: string
            - type: 'null'
          title: Date
        last_updated:
          anyOf:
            - type: string
            - type: 'null'
          title: Last Updated
      type: object
      required:
        - title
        - url
        - snippet
      title: ApiSearchPage
    ValidationError:
      properties:
        loc:
          items:
            anyOf:
              - type: string
              - type: integer
          type: array
          title: Location
        msg:
          type: string
          title: Message
        type:
          type: string
          title: Error Type
      type: object
      required:
        - loc
        - msg
        - type
      title: ValidationError
  securitySchemes:
    HTTPBearer:
      type: http
      scheme: bearer

````
Create Chat Completion

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Create Chat Completion

> Generate a chat completion response for the given conversation.



## OpenAPI

````yaml post /chat/completions
openapi: 3.1.0
info:
  title: Perplexity AI API
  description: Perplexity AI API
  version: 0.1.0
servers: []
security: []
paths:
  /chat/completions:
    post:
      summary: Create Chat Completion
      description: Generate a chat completion response for the given conversation.
      operationId: chat_completions_chat_completions_post
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ApiChatCompletionsRequest'
      responses:
        '200':
          description: Successful Response
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CompletionResponse'
        '422':
          description: Validation Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/HTTPValidationError'
      security:
        - HTTPBearer: []
components:
  schemas:
    ApiChatCompletionsRequest:
      properties:
        max_tokens:
          anyOf:
            - type: integer
              maximum: 128000
              exclusiveMinimum: 0
            - type: 'null'
          title: Max Tokens
        'n':
          anyOf:
            - type: integer
              maximum: 10
              minimum: 1
            - type: 'null'
          title: 'N'
        model:
          type: string
          title: Model
        stream:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Stream
          default: false
        stop:
          anyOf:
            - type: string
            - items:
                type: string
              type: array
            - type: 'null'
          title: Stop
        cum_logprobs:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Cum Logprobs
        logprobs:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Logprobs
        top_logprobs:
          anyOf:
            - type: integer
            - type: 'null'
          title: Top Logprobs
        best_of:
          anyOf:
            - type: integer
            - type: 'null'
          title: Best Of
        response_metadata:
          anyOf:
            - additionalProperties: true
              type: object
            - type: 'null'
          title: Response Metadata
        response_format:
          anyOf:
            - $ref: '#/components/schemas/ResponseFormatText'
            - $ref: '#/components/schemas/ResponseFormatJSONSchema'
            - $ref: '#/components/schemas/ResponseFormatRegex'
            - type: 'null'
          title: Response Format
        diverse_first_token:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Diverse First Token
        _inputs:
          anyOf:
            - items:
                type: integer
              type: array
            - type: 'null'
          title: Inputs
        _prompt_token_length:
          anyOf:
            - type: integer
            - type: 'null'
          title: Prompt Token Length
        messages:
          items:
            $ref: '#/components/schemas/ChatMessage-Input'
          type: array
          title: Messages
        tools:
          anyOf:
            - items:
                $ref: '#/components/schemas/ToolSpec'
              type: array
            - type: 'null'
          title: Tools
        tool_choice:
          anyOf:
            - type: string
              enum:
                - none
                - auto
                - required
            - type: 'null'
          title: Tool Choice
        parallel_tool_calls:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Parallel Tool Calls
        web_search_options:
          $ref: '#/components/schemas/WebSearchOptions'
        search_mode:
          anyOf:
            - type: string
              enum:
                - web
                - academic
                - sec
            - type: 'null'
          title: Search Mode
        return_images:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Return Images
        return_related_questions:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Return Related Questions
        num_search_results:
          type: integer
          title: Num Search Results
          default: 10
        num_images:
          type: integer
          title: Num Images
          default: 5
        enable_search_classifier:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Enable Search Classifier
        disable_search:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Disable Search
        search_domain_filter:
          anyOf:
            - items:
                type: string
              type: array
            - type: 'null'
          title: Search Domain Filter
        search_language_filter:
          anyOf:
            - items:
                type: string
              type: array
            - type: 'null'
          title: Search Language Filter
        search_tenant:
          anyOf:
            - type: string
            - type: 'null'
          title: Search Tenant
        ranking_model:
          anyOf:
            - type: string
            - type: 'null'
          title: Ranking Model
        latitude:
          anyOf:
            - type: number
            - type: 'null'
          title: Latitude
        longitude:
          anyOf:
            - type: number
            - type: 'null'
          title: Longitude
        country:
          anyOf:
            - type: string
            - type: 'null'
          title: Country
        search_recency_filter:
          anyOf:
            - type: string
              enum:
                - hour
                - day
                - week
                - month
                - year
            - type: 'null'
          title: Search Recency Filter
        search_after_date_filter:
          anyOf:
            - type: string
            - type: 'null'
          title: Search After Date Filter
        search_before_date_filter:
          anyOf:
            - type: string
            - type: 'null'
          title: Search Before Date Filter
        last_updated_before_filter:
          anyOf:
            - type: string
            - type: 'null'
          title: Last Updated Before Filter
        last_updated_after_filter:
          anyOf:
            - type: string
            - type: 'null'
          title: Last Updated After Filter
        image_format_filter:
          anyOf:
            - items:
                type: string
              type: array
            - type: 'null'
          title: Image Format Filter
        image_domain_filter:
          anyOf:
            - items:
                type: string
              type: array
            - type: 'null'
          title: Image Domain Filter
        safe_search:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Safe Search
          default: true
        file_workspace_id:
          anyOf:
            - type: string
            - type: 'null'
          title: File Workspace Id
        updated_before_timestamp:
          anyOf:
            - type: integer
            - type: 'null'
          title: Updated Before Timestamp
        updated_after_timestamp:
          anyOf:
            - type: integer
            - type: 'null'
          title: Updated After Timestamp
        search_internal_properties:
          anyOf:
            - additionalProperties: true
              type: object
            - type: 'null'
          title: Search Internal Properties
        use_threads:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Use Threads
        thread_id:
          anyOf:
            - type: string
            - type: 'null'
          title: Thread Id
        stream_mode:
          type: string
          enum:
            - full
            - concise
          title: Stream Mode
          default: full
        _debug_pro_search:
          type: boolean
          title: Debug Pro Search
          default: false
        has_image_url:
          type: boolean
          title: Has Image Url
          default: false
        reasoning_effort:
          anyOf:
            - type: string
              enum:
                - minimal
                - low
                - medium
                - high
            - type: 'null'
          title: Reasoning Effort
        language_preference:
          anyOf:
            - type: string
            - type: 'null'
          title: Language Preference
        user_original_query:
          anyOf:
            - type: string
            - type: 'null'
          title: User Original Query
        _force_new_agent:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Force New Agent
      type: object
      required:
        - model
        - messages
      title: ApiChatCompletionsRequest
    CompletionResponse:
      properties:
        id:
          type: string
          title: Id
        model:
          type: string
          title: Model
        created:
          type: integer
          title: Created
        usage:
          anyOf:
            - $ref: '#/components/schemas/UsageInfo'
            - type: 'null'
        object:
          type: string
          title: Object
          default: chat.completion
        choices:
          items:
            $ref: '#/components/schemas/Choice'
          type: array
          title: Choices
        citations:
          anyOf:
            - items:
                type: string
              type: array
            - type: 'null'
          title: Citations
        search_results:
          anyOf:
            - items:
                $ref: '#/components/schemas/ApiPublicSearchResult'
              type: array
            - type: 'null'
          title: Search Results
        type:
          anyOf:
            - $ref: '#/components/schemas/CompletionResponseType'
            - type: 'null'
        status:
          anyOf:
            - $ref: '#/components/schemas/CompletionResponseStatus'
            - type: 'null'
      type: object
      required:
        - id
        - model
        - created
        - choices
      title: CompletionResponse
    HTTPValidationError:
      properties:
        detail:
          items:
            $ref: '#/components/schemas/ValidationError'
          type: array
          title: Detail
      type: object
      title: HTTPValidationError
    ResponseFormatText:
      properties:
        type:
          type: string
          const: text
          title: Type
      type: object
      required:
        - type
      title: ResponseFormatText
    ResponseFormatJSONSchema:
      properties:
        type:
          type: string
          const: json_schema
          title: Type
        json_schema:
          $ref: '#/components/schemas/JSONSchema'
      type: object
      required:
        - type
        - json_schema
      title: ResponseFormatJSONSchema
    ResponseFormatRegex:
      properties:
        type:
          type: string
          const: regex
          title: Type
        regex:
          $ref: '#/components/schemas/RegexSchema'
      type: object
      required:
        - type
        - regex
      title: ResponseFormatRegex
    ChatMessage-Input:
      properties:
        role:
          $ref: '#/components/schemas/ChatMessageRole'
        content:
          anyOf:
            - type: string
            - items:
                anyOf:
                  - $ref: '#/components/schemas/ChatMessageContentTextChunk'
                  - $ref: '#/components/schemas/ChatMessageContentImageChunk'
                  - $ref: '#/components/schemas/ChatMessageContentFileChunk'
                  - $ref: '#/components/schemas/ChatMessageContentPDFChunk'
                  - $ref: '#/components/schemas/ChatMessageContentVideoChunk'
              type: array
              title: Structured Content
            - type: 'null'
          title: Content
        reasoning_steps:
          anyOf:
            - items:
                $ref: '#/components/schemas/ReasoningStep-Input'
              type: array
            - type: 'null'
          title: Reasoning Steps
        tool_calls:
          anyOf:
            - items:
                $ref: '#/components/schemas/ToolCall'
              type: array
            - type: 'null'
          title: Tool Calls
        tool_call_id:
          anyOf:
            - type: string
            - type: 'null'
          title: Tool Call Id
      type: object
      required:
        - role
        - content
      title: ChatMessage
    ToolSpec:
      properties:
        type:
          type: string
          const: function
          title: Type
        function:
          $ref: '#/components/schemas/FunctionSpec'
      type: object
      required:
        - type
        - function
      title: ToolSpec
    WebSearchOptions:
      properties:
        search_context_size:
          type: string
          enum:
            - low
            - medium
            - high
          title: Search Context Size
          default: low
        search_type:
          anyOf:
            - type: string
              enum:
                - fast
                - pro
                - auto
            - type: 'null'
          title: Search Type
        user_location:
          anyOf:
            - $ref: '#/components/schemas/UserLocation'
            - type: 'null'
        image_results_enhanced_relevance:
          type: boolean
          title: Image Results Enhanced Relevance
          default: false
      type: object
      title: WebSearchOptions
    UsageInfo:
      properties:
        prompt_tokens:
          type: integer
          title: Prompt Tokens
        completion_tokens:
          type: integer
          title: Completion Tokens
        total_tokens:
          type: integer
          title: Total Tokens
        search_context_size:
          anyOf:
            - type: string
            - type: 'null'
          title: Search Context Size
        citation_tokens:
          anyOf:
            - type: integer
            - type: 'null'
          title: Citation Tokens
        num_search_queries:
          anyOf:
            - type: integer
            - type: 'null'
          title: Num Search Queries
        reasoning_tokens:
          anyOf:
            - type: integer
            - type: 'null'
          title: Reasoning Tokens
        cost:
          $ref: '#/components/schemas/Cost'
      type: object
      required:
        - prompt_tokens
        - completion_tokens
        - total_tokens
        - cost
      title: UsageInfo
    Choice:
      properties:
        index:
          type: integer
          title: Index
        finish_reason:
          anyOf:
            - type: string
              enum:
                - stop
                - length
            - type: 'null'
          title: Finish Reason
        message:
          $ref: '#/components/schemas/ChatMessage-Output'
        delta:
          $ref: '#/components/schemas/ChatMessage-Output'
      type: object
      required:
        - index
        - message
        - delta
      title: Choice
    ApiPublicSearchResult:
      properties:
        title:
          type: string
          title: Title
        url:
          type: string
          title: Url
        date:
          anyOf:
            - type: string
            - type: 'null'
          title: Date
        last_updated:
          anyOf:
            - type: string
            - type: 'null'
          title: Last Updated
        snippet:
          type: string
          title: Snippet
          default: ''
        source:
          type: string
          enum:
            - web
            - attachment
          title: Source
          default: web
      type: object
      required:
        - title
        - url
      title: ApiPublicSearchResult
    CompletionResponseType:
      type: string
      enum:
        - message
        - info
        - end_of_stream
      title: CompletionResponseType
    CompletionResponseStatus:
      type: string
      enum:
        - PENDING
        - COMPLETED
      title: CompletionResponseStatus
    ValidationError:
      properties:
        loc:
          items:
            anyOf:
              - type: string
              - type: integer
          type: array
          title: Location
        msg:
          type: string
          title: Message
        type:
          type: string
          title: Error Type
      type: object
      required:
        - loc
        - msg
        - type
      title: ValidationError
    JSONSchema:
      properties:
        schema:
          additionalProperties: true
          type: object
          title: Schema
        name:
          anyOf:
            - type: string
            - type: 'null'
          title: Name
          default: schema
        description:
          anyOf:
            - type: string
            - type: 'null'
          title: Description
        strict:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Strict
          default: true
      type: object
      required:
        - schema
      title: JSONSchema
    RegexSchema:
      properties:
        regex:
          type: string
          title: Regex
        name:
          anyOf:
            - type: string
            - type: 'null'
          title: Name
        description:
          anyOf:
            - type: string
            - type: 'null'
          title: Description
        strict:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Strict
      type: object
      required:
        - regex
      title: RegexSchema
    ChatMessageRole:
      type: string
      enum:
        - system
        - user
        - assistant
        - tool
      title: ChatMessageRole
      description: Chat roles enum
    ChatMessageContentTextChunk:
      properties:
        type:
          type: string
          const: text
          title: Type
        text:
          type: string
          title: Text
      type: object
      required:
        - type
        - text
      title: ChatMessageContentTextChunk
    ChatMessageContentImageChunk:
      properties:
        type:
          type: string
          const: image_url
          title: Type
        image_url:
          anyOf:
            - $ref: '#/components/schemas/URL'
            - type: string
          title: Image Url
      type: object
      required:
        - type
        - image_url
      title: ChatMessageContentImageChunk
    ChatMessageContentFileChunk:
      properties:
        type:
          type: string
          const: file_url
          title: Type
        file_url:
          anyOf:
            - $ref: '#/components/schemas/URL'
            - type: string
          title: File Url
        file_name:
          anyOf:
            - type: string
            - type: 'null'
          title: File Name
      type: object
      required:
        - type
        - file_url
      title: ChatMessageContentFileChunk
    ChatMessageContentPDFChunk:
      properties:
        type:
          type: string
          const: pdf_url
          title: Type
        pdf_url:
          anyOf:
            - $ref: '#/components/schemas/URL'
            - type: string
          title: Pdf Url
      type: object
      required:
        - type
        - pdf_url
      title: ChatMessageContentPDFChunk
    ChatMessageContentVideoChunk:
      properties:
        type:
          type: string
          const: video_url
          title: Type
        video_url:
          anyOf:
            - $ref: '#/components/schemas/VideoURL'
            - type: string
          title: Video Url
      type: object
      required:
        - type
        - video_url
      title: ChatMessageContentVideoChunk
    ReasoningStep-Input:
      properties:
        thought:
          type: string
          title: Thought
        type:
          anyOf:
            - type: string
            - type: 'null'
          title: Type
        web_search:
          anyOf:
            - $ref: '#/components/schemas/WebSearchStepDetails'
            - type: 'null'
        fetch_url_content:
          anyOf:
            - $ref: '#/components/schemas/FetchUrlContentStepDetails'
            - type: 'null'
        execute_python:
          anyOf:
            - $ref: '#/components/schemas/ExecutePythonStepDetails'
            - type: 'null'
      type: object
      required:
        - thought
      title: ReasoningStep
      description: Reasoning step wrapper class
    ToolCall:
      properties:
        id:
          anyOf:
            - type: string
            - type: 'null'
          title: Id
        type:
          anyOf:
            - type: string
              const: function
            - type: 'null'
          title: Type
        function:
          anyOf:
            - $ref: '#/components/schemas/ToolCallFunction'
            - type: 'null'
      type: object
      title: ToolCall
    FunctionSpec:
      properties:
        name:
          type: string
          title: Name
        description:
          type: string
          title: Description
        parameters:
          $ref: '#/components/schemas/ParameterSpec'
        strict:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Strict
      type: object
      required:
        - name
        - description
        - parameters
      title: FunctionSpec
    UserLocation:
      properties:
        latitude:
          anyOf:
            - type: number
            - type: 'null'
          title: Latitude
        longitude:
          anyOf:
            - type: number
            - type: 'null'
          title: Longitude
        country:
          anyOf:
            - type: string
            - type: 'null'
          title: Country
        city:
          anyOf:
            - type: string
            - type: 'null'
          title: City
        region:
          anyOf:
            - type: string
            - type: 'null'
          title: Region
      type: object
      title: UserLocation
    Cost:
      properties:
        input_tokens_cost:
          type: number
          title: Input Tokens Cost
        output_tokens_cost:
          type: number
          title: Output Tokens Cost
        reasoning_tokens_cost:
          anyOf:
            - type: number
            - type: 'null'
          title: Reasoning Tokens Cost
        request_cost:
          anyOf:
            - type: number
            - type: 'null'
          title: Request Cost
        citation_tokens_cost:
          anyOf:
            - type: number
            - type: 'null'
          title: Citation Tokens Cost
        search_queries_cost:
          anyOf:
            - type: number
            - type: 'null'
          title: Search Queries Cost
        total_cost:
          type: number
          title: Total Cost
      type: object
      required:
        - input_tokens_cost
        - output_tokens_cost
        - total_cost
      title: Cost
    ChatMessage-Output:
      properties:
        role:
          $ref: '#/components/schemas/ChatMessageRole'
        content:
          anyOf:
            - type: string
            - items:
                anyOf:
                  - $ref: '#/components/schemas/ChatMessageContentTextChunk'
                  - $ref: '#/components/schemas/ChatMessageContentImageChunk'
                  - $ref: '#/components/schemas/ChatMessageContentFileChunk'
                  - $ref: '#/components/schemas/ChatMessageContentPDFChunk'
                  - $ref: '#/components/schemas/ChatMessageContentVideoChunk'
              type: array
              title: Structured Content
            - type: 'null'
          title: Content
        reasoning_steps:
          anyOf:
            - items:
                $ref: '#/components/schemas/ReasoningStep-Output'
              type: array
            - type: 'null'
          title: Reasoning Steps
        tool_calls:
          anyOf:
            - items:
                $ref: '#/components/schemas/ToolCall'
              type: array
            - type: 'null'
          title: Tool Calls
        tool_call_id:
          anyOf:
            - type: string
            - type: 'null'
          title: Tool Call Id
      type: object
      required:
        - role
        - content
      title: ChatMessage
    URL:
      properties:
        url:
          type: string
          title: Url
      type: object
      required:
        - url
      title: URL
    VideoURL:
      properties:
        url:
          type: string
          title: Url
        frame_interval:
          anyOf:
            - type: string
            - type: integer
          title: Frame Interval
          default: 25
      type: object
      required:
        - url
      title: VideoURL
    WebSearchStepDetails:
      properties:
        search_results:
          items:
            $ref: '#/components/schemas/ApiPublicSearchResult'
          type: array
          title: Search Results
        search_keywords:
          items:
            type: string
          type: array
          title: Search Keywords
      type: object
      required:
        - search_results
        - search_keywords
      title: WebSearchStepDetails
      description: Web search step details wrapper class
    FetchUrlContentStepDetails:
      properties:
        contents:
          items:
            $ref: '#/components/schemas/ApiPublicSearchResult'
          type: array
          title: Contents
      type: object
      required:
        - contents
      title: FetchUrlContentStepDetails
      description: Fetch url content step details wrapper class
    ExecutePythonStepDetails:
      properties:
        code:
          type: string
          title: Code
        result:
          type: string
          title: Result
      type: object
      required:
        - code
        - result
      title: ExecutePythonStepDetails
      description: Code generation step details wrapper class
    ToolCallFunction:
      properties:
        name:
          anyOf:
            - type: string
            - type: 'null'
          title: Name
        arguments:
          anyOf:
            - type: string
            - type: 'null'
          title: Arguments
      type: object
      title: ToolCallFunction
    ParameterSpec:
      properties:
        type:
          type: string
          title: Type
        properties:
          additionalProperties: true
          type: object
          title: Properties
        required:
          anyOf:
            - items:
                type: string
              type: array
            - type: 'null'
          title: Required
        additional_properties:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Additional Properties
      type: object
      required:
        - type
        - properties
      title: ParameterSpec
    ReasoningStep-Output:
      properties:
        thought:
          type: string
          title: Thought
        type:
          anyOf:
            - type: string
            - type: 'null'
          title: Type
        web_search:
          anyOf:
            - $ref: '#/components/schemas/WebSearchStepDetails'
            - type: 'null'
        fetch_url_content:
          anyOf:
            - $ref: '#/components/schemas/FetchUrlContentStepDetails'
            - type: 'null'
        execute_python:
          anyOf:
            - $ref: '#/components/schemas/ExecutePythonStepDetails'
            - type: 'null'
      type: object
      required:
        - thought
      title: ReasoningStep
      description: Reasoning step wrapper class
  securitySchemes:
    HTTPBearer:
      type: http
      scheme: bearer

````
Create Async Chat Completion

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Create Async Chat Completion

> Submit an asynchronous chat completion request.



## OpenAPI

````yaml post /async/chat/completions
openapi: 3.1.0
info:
  title: Perplexity AI API
  description: Perplexity AI API
  version: 0.1.0
servers: []
security: []
paths:
  /async/chat/completions:
    post:
      summary: Create Async Chat Completion
      description: Submit an asynchronous chat completion request.
      operationId: create_async_chat_completions_async_chat_completions_post
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/AsyncApiChatCompletionsRequest'
      responses:
        '200':
          description: Successful Response
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AsyncApiChatCompletionsResponse'
        '422':
          description: Validation Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/HTTPValidationError'
      security:
        - HTTPBearer: []
components:
  schemas:
    AsyncApiChatCompletionsRequest:
      properties:
        request:
          $ref: '#/components/schemas/ApiChatCompletionsRequest'
        idempotency_key:
          anyOf:
            - type: string
            - type: 'null'
          title: Idempotency Key
      type: object
      required:
        - request
      title: AsyncApiChatCompletionsRequest
    AsyncApiChatCompletionsResponse:
      properties:
        id:
          type: string
          title: Id
        model:
          type: string
          title: Model
        created_at:
          type: integer
          title: Created At
        started_at:
          anyOf:
            - type: integer
            - type: 'null'
          title: Started At
        completed_at:
          anyOf:
            - type: integer
            - type: 'null'
          title: Completed At
        response:
          anyOf:
            - $ref: '#/components/schemas/CompletionResponse'
            - type: 'null'
        failed_at:
          anyOf:
            - type: integer
            - type: 'null'
          title: Failed At
        error_message:
          anyOf:
            - type: string
            - type: 'null'
          title: Error Message
        status:
          $ref: '#/components/schemas/AsyncProcessingStatus'
      type: object
      required:
        - id
        - model
        - created_at
        - status
      title: AsyncApiChatCompletionsResponse
    HTTPValidationError:
      properties:
        detail:
          items:
            $ref: '#/components/schemas/ValidationError'
          type: array
          title: Detail
      type: object
      title: HTTPValidationError
    ApiChatCompletionsRequest:
      properties:
        max_tokens:
          anyOf:
            - type: integer
              maximum: 128000
              exclusiveMinimum: 0
            - type: 'null'
          title: Max Tokens
        'n':
          anyOf:
            - type: integer
              maximum: 10
              minimum: 1
            - type: 'null'
          title: 'N'
        model:
          type: string
          title: Model
        stream:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Stream
          default: false
        stop:
          anyOf:
            - type: string
            - items:
                type: string
              type: array
            - type: 'null'
          title: Stop
        cum_logprobs:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Cum Logprobs
        logprobs:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Logprobs
        top_logprobs:
          anyOf:
            - type: integer
            - type: 'null'
          title: Top Logprobs
        best_of:
          anyOf:
            - type: integer
            - type: 'null'
          title: Best Of
        response_metadata:
          anyOf:
            - additionalProperties: true
              type: object
            - type: 'null'
          title: Response Metadata
        response_format:
          anyOf:
            - $ref: '#/components/schemas/ResponseFormatText'
            - $ref: '#/components/schemas/ResponseFormatJSONSchema'
            - $ref: '#/components/schemas/ResponseFormatRegex'
            - type: 'null'
          title: Response Format
        diverse_first_token:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Diverse First Token
        _inputs:
          anyOf:
            - items:
                type: integer
              type: array
            - type: 'null'
          title: Inputs
        _prompt_token_length:
          anyOf:
            - type: integer
            - type: 'null'
          title: Prompt Token Length
        messages:
          items:
            $ref: '#/components/schemas/ChatMessage-Input'
          type: array
          title: Messages
        tools:
          anyOf:
            - items:
                $ref: '#/components/schemas/ToolSpec'
              type: array
            - type: 'null'
          title: Tools
        tool_choice:
          anyOf:
            - type: string
              enum:
                - none
                - auto
                - required
            - type: 'null'
          title: Tool Choice
        parallel_tool_calls:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Parallel Tool Calls
        web_search_options:
          $ref: '#/components/schemas/WebSearchOptions'
        search_mode:
          anyOf:
            - type: string
              enum:
                - web
                - academic
                - sec
            - type: 'null'
          title: Search Mode
        return_images:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Return Images
        return_related_questions:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Return Related Questions
        num_search_results:
          type: integer
          title: Num Search Results
          default: 10
        num_images:
          type: integer
          title: Num Images
          default: 5
        enable_search_classifier:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Enable Search Classifier
        disable_search:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Disable Search
        search_domain_filter:
          anyOf:
            - items:
                type: string
              type: array
            - type: 'null'
          title: Search Domain Filter
        search_language_filter:
          anyOf:
            - items:
                type: string
              type: array
            - type: 'null'
          title: Search Language Filter
        search_tenant:
          anyOf:
            - type: string
            - type: 'null'
          title: Search Tenant
        ranking_model:
          anyOf:
            - type: string
            - type: 'null'
          title: Ranking Model
        latitude:
          anyOf:
            - type: number
            - type: 'null'
          title: Latitude
        longitude:
          anyOf:
            - type: number
            - type: 'null'
          title: Longitude
        country:
          anyOf:
            - type: string
            - type: 'null'
          title: Country
        search_recency_filter:
          anyOf:
            - type: string
              enum:
                - hour
                - day
                - week
                - month
                - year
            - type: 'null'
          title: Search Recency Filter
        search_after_date_filter:
          anyOf:
            - type: string
            - type: 'null'
          title: Search After Date Filter
        search_before_date_filter:
          anyOf:
            - type: string
            - type: 'null'
          title: Search Before Date Filter
        last_updated_before_filter:
          anyOf:
            - type: string
            - type: 'null'
          title: Last Updated Before Filter
        last_updated_after_filter:
          anyOf:
            - type: string
            - type: 'null'
          title: Last Updated After Filter
        image_format_filter:
          anyOf:
            - items:
                type: string
              type: array
            - type: 'null'
          title: Image Format Filter
        image_domain_filter:
          anyOf:
            - items:
                type: string
              type: array
            - type: 'null'
          title: Image Domain Filter
        safe_search:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Safe Search
          default: true
        file_workspace_id:
          anyOf:
            - type: string
            - type: 'null'
          title: File Workspace Id
        updated_before_timestamp:
          anyOf:
            - type: integer
            - type: 'null'
          title: Updated Before Timestamp
        updated_after_timestamp:
          anyOf:
            - type: integer
            - type: 'null'
          title: Updated After Timestamp
        search_internal_properties:
          anyOf:
            - additionalProperties: true
              type: object
            - type: 'null'
          title: Search Internal Properties
        use_threads:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Use Threads
        thread_id:
          anyOf:
            - type: string
            - type: 'null'
          title: Thread Id
        stream_mode:
          type: string
          enum:
            - full
            - concise
          title: Stream Mode
          default: full
        _debug_pro_search:
          type: boolean
          title: Debug Pro Search
          default: false
        has_image_url:
          type: boolean
          title: Has Image Url
          default: false
        reasoning_effort:
          anyOf:
            - type: string
              enum:
                - minimal
                - low
                - medium
                - high
            - type: 'null'
          title: Reasoning Effort
        language_preference:
          anyOf:
            - type: string
            - type: 'null'
          title: Language Preference
        user_original_query:
          anyOf:
            - type: string
            - type: 'null'
          title: User Original Query
        _force_new_agent:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Force New Agent
      type: object
      required:
        - model
        - messages
      title: ApiChatCompletionsRequest
    CompletionResponse:
      properties:
        id:
          type: string
          title: Id
        model:
          type: string
          title: Model
        created:
          type: integer
          title: Created
        usage:
          anyOf:
            - $ref: '#/components/schemas/UsageInfo'
            - type: 'null'
        object:
          type: string
          title: Object
          default: chat.completion
        choices:
          items:
            $ref: '#/components/schemas/Choice'
          type: array
          title: Choices
        citations:
          anyOf:
            - items:
                type: string
              type: array
            - type: 'null'
          title: Citations
        search_results:
          anyOf:
            - items:
                $ref: '#/components/schemas/ApiPublicSearchResult'
              type: array
            - type: 'null'
          title: Search Results
        type:
          anyOf:
            - $ref: '#/components/schemas/CompletionResponseType'
            - type: 'null'
        status:
          anyOf:
            - $ref: '#/components/schemas/CompletionResponseStatus'
            - type: 'null'
      type: object
      required:
        - id
        - model
        - created
        - choices
      title: CompletionResponse
    AsyncProcessingStatus:
      type: string
      enum:
        - CREATED
        - IN_PROGRESS
        - COMPLETED
        - FAILED
      title: AsyncProcessingStatus
      description: Status enum for async processing.
    ValidationError:
      properties:
        loc:
          items:
            anyOf:
              - type: string
              - type: integer
          type: array
          title: Location
        msg:
          type: string
          title: Message
        type:
          type: string
          title: Error Type
      type: object
      required:
        - loc
        - msg
        - type
      title: ValidationError
    ResponseFormatText:
      properties:
        type:
          type: string
          const: text
          title: Type
      type: object
      required:
        - type
      title: ResponseFormatText
    ResponseFormatJSONSchema:
      properties:
        type:
          type: string
          const: json_schema
          title: Type
        json_schema:
          $ref: '#/components/schemas/JSONSchema'
      type: object
      required:
        - type
        - json_schema
      title: ResponseFormatJSONSchema
    ResponseFormatRegex:
      properties:
        type:
          type: string
          const: regex
          title: Type
        regex:
          $ref: '#/components/schemas/RegexSchema'
      type: object
      required:
        - type
        - regex
      title: ResponseFormatRegex
    ChatMessage-Input:
      properties:
        role:
          $ref: '#/components/schemas/ChatMessageRole'
        content:
          anyOf:
            - type: string
            - items:
                anyOf:
                  - $ref: '#/components/schemas/ChatMessageContentTextChunk'
                  - $ref: '#/components/schemas/ChatMessageContentImageChunk'
                  - $ref: '#/components/schemas/ChatMessageContentFileChunk'
                  - $ref: '#/components/schemas/ChatMessageContentPDFChunk'
                  - $ref: '#/components/schemas/ChatMessageContentVideoChunk'
              type: array
              title: Structured Content
            - type: 'null'
          title: Content
        reasoning_steps:
          anyOf:
            - items:
                $ref: '#/components/schemas/ReasoningStep-Input'
              type: array
            - type: 'null'
          title: Reasoning Steps
        tool_calls:
          anyOf:
            - items:
                $ref: '#/components/schemas/ToolCall'
              type: array
            - type: 'null'
          title: Tool Calls
        tool_call_id:
          anyOf:
            - type: string
            - type: 'null'
          title: Tool Call Id
      type: object
      required:
        - role
        - content
      title: ChatMessage
    ToolSpec:
      properties:
        type:
          type: string
          const: function
          title: Type
        function:
          $ref: '#/components/schemas/FunctionSpec'
      type: object
      required:
        - type
        - function
      title: ToolSpec
    WebSearchOptions:
      properties:
        search_context_size:
          type: string
          enum:
            - low
            - medium
            - high
          title: Search Context Size
          default: low
        search_type:
          anyOf:
            - type: string
              enum:
                - fast
                - pro
                - auto
            - type: 'null'
          title: Search Type
        user_location:
          anyOf:
            - $ref: '#/components/schemas/UserLocation'
            - type: 'null'
        image_results_enhanced_relevance:
          type: boolean
          title: Image Results Enhanced Relevance
          default: false
      type: object
      title: WebSearchOptions
    UsageInfo:
      properties:
        prompt_tokens:
          type: integer
          title: Prompt Tokens
        completion_tokens:
          type: integer
          title: Completion Tokens
        total_tokens:
          type: integer
          title: Total Tokens
        search_context_size:
          anyOf:
            - type: string
            - type: 'null'
          title: Search Context Size
        citation_tokens:
          anyOf:
            - type: integer
            - type: 'null'
          title: Citation Tokens
        num_search_queries:
          anyOf:
            - type: integer
            - type: 'null'
          title: Num Search Queries
        reasoning_tokens:
          anyOf:
            - type: integer
            - type: 'null'
          title: Reasoning Tokens
        cost:
          $ref: '#/components/schemas/Cost'
      type: object
      required:
        - prompt_tokens
        - completion_tokens
        - total_tokens
        - cost
      title: UsageInfo
    Choice:
      properties:
        index:
          type: integer
          title: Index
        finish_reason:
          anyOf:
            - type: string
              enum:
                - stop
                - length
            - type: 'null'
          title: Finish Reason
        message:
          $ref: '#/components/schemas/ChatMessage-Output'
        delta:
          $ref: '#/components/schemas/ChatMessage-Output'
      type: object
      required:
        - index
        - message
        - delta
      title: Choice
    ApiPublicSearchResult:
      properties:
        title:
          type: string
          title: Title
        url:
          type: string
          title: Url
        date:
          anyOf:
            - type: string
            - type: 'null'
          title: Date
        last_updated:
          anyOf:
            - type: string
            - type: 'null'
          title: Last Updated
        snippet:
          type: string
          title: Snippet
          default: ''
        source:
          type: string
          enum:
            - web
            - attachment
          title: Source
          default: web
      type: object
      required:
        - title
        - url
      title: ApiPublicSearchResult
    CompletionResponseType:
      type: string
      enum:
        - message
        - info
        - end_of_stream
      title: CompletionResponseType
    CompletionResponseStatus:
      type: string
      enum:
        - PENDING
        - COMPLETED
      title: CompletionResponseStatus
    JSONSchema:
      properties:
        schema:
          additionalProperties: true
          type: object
          title: Schema
        name:
          anyOf:
            - type: string
            - type: 'null'
          title: Name
          default: schema
        description:
          anyOf:
            - type: string
            - type: 'null'
          title: Description
        strict:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Strict
          default: true
      type: object
      required:
        - schema
      title: JSONSchema
    RegexSchema:
      properties:
        regex:
          type: string
          title: Regex
        name:
          anyOf:
            - type: string
            - type: 'null'
          title: Name
        description:
          anyOf:
            - type: string
            - type: 'null'
          title: Description
        strict:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Strict
      type: object
      required:
        - regex
      title: RegexSchema
    ChatMessageRole:
      type: string
      enum:
        - system
        - user
        - assistant
        - tool
      title: ChatMessageRole
      description: Chat roles enum
    ChatMessageContentTextChunk:
      properties:
        type:
          type: string
          const: text
          title: Type
        text:
          type: string
          title: Text
      type: object
      required:
        - type
        - text
      title: ChatMessageContentTextChunk
    ChatMessageContentImageChunk:
      properties:
        type:
          type: string
          const: image_url
          title: Type
        image_url:
          anyOf:
            - $ref: '#/components/schemas/URL'
            - type: string
          title: Image Url
      type: object
      required:
        - type
        - image_url
      title: ChatMessageContentImageChunk
    ChatMessageContentFileChunk:
      properties:
        type:
          type: string
          const: file_url
          title: Type
        file_url:
          anyOf:
            - $ref: '#/components/schemas/URL'
            - type: string
          title: File Url
        file_name:
          anyOf:
            - type: string
            - type: 'null'
          title: File Name
      type: object
      required:
        - type
        - file_url
      title: ChatMessageContentFileChunk
    ChatMessageContentPDFChunk:
      properties:
        type:
          type: string
          const: pdf_url
          title: Type
        pdf_url:
          anyOf:
            - $ref: '#/components/schemas/URL'
            - type: string
          title: Pdf Url
      type: object
      required:
        - type
        - pdf_url
      title: ChatMessageContentPDFChunk
    ChatMessageContentVideoChunk:
      properties:
        type:
          type: string
          const: video_url
          title: Type
        video_url:
          anyOf:
            - $ref: '#/components/schemas/VideoURL'
            - type: string
          title: Video Url
      type: object
      required:
        - type
        - video_url
      title: ChatMessageContentVideoChunk
    ReasoningStep-Input:
      properties:
        thought:
          type: string
          title: Thought
        type:
          anyOf:
            - type: string
            - type: 'null'
          title: Type
        web_search:
          anyOf:
            - $ref: '#/components/schemas/WebSearchStepDetails'
            - type: 'null'
        fetch_url_content:
          anyOf:
            - $ref: '#/components/schemas/FetchUrlContentStepDetails'
            - type: 'null'
        execute_python:
          anyOf:
            - $ref: '#/components/schemas/ExecutePythonStepDetails'
            - type: 'null'
      type: object
      required:
        - thought
      title: ReasoningStep
      description: Reasoning step wrapper class
    ToolCall:
      properties:
        id:
          anyOf:
            - type: string
            - type: 'null'
          title: Id
        type:
          anyOf:
            - type: string
              const: function
            - type: 'null'
          title: Type
        function:
          anyOf:
            - $ref: '#/components/schemas/ToolCallFunction'
            - type: 'null'
      type: object
      title: ToolCall
    FunctionSpec:
      properties:
        name:
          type: string
          title: Name
        description:
          type: string
          title: Description
        parameters:
          $ref: '#/components/schemas/ParameterSpec'
        strict:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Strict
      type: object
      required:
        - name
        - description
        - parameters
      title: FunctionSpec
    UserLocation:
      properties:
        latitude:
          anyOf:
            - type: number
            - type: 'null'
          title: Latitude
        longitude:
          anyOf:
            - type: number
            - type: 'null'
          title: Longitude
        country:
          anyOf:
            - type: string
            - type: 'null'
          title: Country
        city:
          anyOf:
            - type: string
            - type: 'null'
          title: City
        region:
          anyOf:
            - type: string
            - type: 'null'
          title: Region
      type: object
      title: UserLocation
    Cost:
      properties:
        input_tokens_cost:
          type: number
          title: Input Tokens Cost
        output_tokens_cost:
          type: number
          title: Output Tokens Cost
        reasoning_tokens_cost:
          anyOf:
            - type: number
            - type: 'null'
          title: Reasoning Tokens Cost
        request_cost:
          anyOf:
            - type: number
            - type: 'null'
          title: Request Cost
        citation_tokens_cost:
          anyOf:
            - type: number
            - type: 'null'
          title: Citation Tokens Cost
        search_queries_cost:
          anyOf:
            - type: number
            - type: 'null'
          title: Search Queries Cost
        total_cost:
          type: number
          title: Total Cost
      type: object
      required:
        - input_tokens_cost
        - output_tokens_cost
        - total_cost
      title: Cost
    ChatMessage-Output:
      properties:
        role:
          $ref: '#/components/schemas/ChatMessageRole'
        content:
          anyOf:
            - type: string
            - items:
                anyOf:
                  - $ref: '#/components/schemas/ChatMessageContentTextChunk'
                  - $ref: '#/components/schemas/ChatMessageContentImageChunk'
                  - $ref: '#/components/schemas/ChatMessageContentFileChunk'
                  - $ref: '#/components/schemas/ChatMessageContentPDFChunk'
                  - $ref: '#/components/schemas/ChatMessageContentVideoChunk'
              type: array
              title: Structured Content
            - type: 'null'
          title: Content
        reasoning_steps:
          anyOf:
            - items:
                $ref: '#/components/schemas/ReasoningStep-Output'
              type: array
            - type: 'null'
          title: Reasoning Steps
        tool_calls:
          anyOf:
            - items:
                $ref: '#/components/schemas/ToolCall'
              type: array
            - type: 'null'
          title: Tool Calls
        tool_call_id:
          anyOf:
            - type: string
            - type: 'null'
          title: Tool Call Id
      type: object
      required:
        - role
        - content
      title: ChatMessage
    URL:
      properties:
        url:
          type: string
          title: Url
      type: object
      required:
        - url
      title: URL
    VideoURL:
      properties:
        url:
          type: string
          title: Url
        frame_interval:
          anyOf:
            - type: string
            - type: integer
          title: Frame Interval
          default: 25
      type: object
      required:
        - url
      title: VideoURL
    WebSearchStepDetails:
      properties:
        search_results:
          items:
            $ref: '#/components/schemas/ApiPublicSearchResult'
          type: array
          title: Search Results
        search_keywords:
          items:
            type: string
          type: array
          title: Search Keywords
      type: object
      required:
        - search_results
        - search_keywords
      title: WebSearchStepDetails
      description: Web search step details wrapper class
    FetchUrlContentStepDetails:
      properties:
        contents:
          items:
            $ref: '#/components/schemas/ApiPublicSearchResult'
          type: array
          title: Contents
      type: object
      required:
        - contents
      title: FetchUrlContentStepDetails
      description: Fetch url content step details wrapper class
    ExecutePythonStepDetails:
      properties:
        code:
          type: string
          title: Code
        result:
          type: string
          title: Result
      type: object
      required:
        - code
        - result
      title: ExecutePythonStepDetails
      description: Code generation step details wrapper class
    ToolCallFunction:
      properties:
        name:
          anyOf:
            - type: string
            - type: 'null'
          title: Name
        arguments:
          anyOf:
            - type: string
            - type: 'null'
          title: Arguments
      type: object
      title: ToolCallFunction
    ParameterSpec:
      properties:
        type:
          type: string
          title: Type
        properties:
          additionalProperties: true
          type: object
          title: Properties
        required:
          anyOf:
            - items:
                type: string
              type: array
            - type: 'null'
          title: Required
        additional_properties:
          anyOf:
            - type: boolean
            - type: 'null'
          title: Additional Properties
      type: object
      required:
        - type
        - properties
      title: ParameterSpec
    ReasoningStep-Output:
      properties:
        thought:
          type: string
          title: Thought
        type:
          anyOf:
            - type: string
            - type: 'null'
          title: Type
        web_search:
          anyOf:
            - $ref: '#/components/schemas/WebSearchStepDetails'
            - type: 'null'
        fetch_url_content:
          anyOf:
            - $ref: '#/components/schemas/FetchUrlContentStepDetails'
            - type: 'null'
        execute_python:
          anyOf:
            - $ref: '#/components/schemas/ExecutePythonStepDetails'
            - type: 'null'
      type: object
      required:
        - thought
      title: ReasoningStep
      description: Reasoning step wrapper class
  securitySchemes:
    HTTPBearer:
      type: http
      scheme: bearer

````
List Async Chat Completions

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# List Async Chat Completions

> Retrieve a list of all asynchronous chat completion requests for a given user.



## OpenAPI

````yaml get /async/chat/completions
openapi: 3.1.0
info:
  title: Perplexity AI API
  description: Perplexity AI API
  version: 0.1.0
servers: []
security: []
paths:
  /async/chat/completions:
    get:
      summary: List Async Chat Completions
      description: >-
        Retrieve a list of all asynchronous chat completion requests for a given
        user.
      operationId: list_async_chat_completions_async_chat_completions_get
      responses:
        '200':
          description: Successful Response
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ListAsyncApiChatCompletionsResponse'
        '422':
          description: Validation Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/HTTPValidationError'
      security:
        - HTTPBearer: []
components:
  schemas:
    ListAsyncApiChatCompletionsResponse:
      properties:
        next_token:
          anyOf:
            - type: string
            - type: 'null'
          title: Next Token
        requests:
          items:
            $ref: '#/components/schemas/AsyncApiChatCompletionsResponseSummary'
          type: array
          title: Requests
      type: object
      required:
        - requests
      title: ListAsyncApiChatCompletionsResponse
    HTTPValidationError:
      properties:
        detail:
          items:
            $ref: '#/components/schemas/ValidationError'
          type: array
          title: Detail
      type: object
      title: HTTPValidationError
    AsyncApiChatCompletionsResponseSummary:
      properties:
        id:
          type: string
          title: Id
        created_at:
          type: integer
          title: Created At
        started_at:
          anyOf:
            - type: integer
            - type: 'null'
          title: Started At
        completed_at:
          anyOf:
            - type: integer
            - type: 'null'
          title: Completed At
        failed_at:
          anyOf:
            - type: integer
            - type: 'null'
          title: Failed At
        model:
          type: string
          title: Model
        status:
          $ref: '#/components/schemas/AsyncProcessingStatus'
      type: object
      required:
        - id
        - created_at
        - model
        - status
      title: AsyncApiChatCompletionsResponseSummary
    ValidationError:
      properties:
        loc:
          items:
            anyOf:
              - type: string
              - type: integer
          type: array
          title: Location
        msg:
          type: string
          title: Message
        type:
          type: string
          title: Error Type
      type: object
      required:
        - loc
        - msg
        - type
      title: ValidationError
    AsyncProcessingStatus:
      type: string
      enum:
        - CREATED
        - IN_PROGRESS
        - COMPLETED
        - FAILED
      title: AsyncProcessingStatus
      description: Status enum for async processing.
  securitySchemes:
    HTTPBearer:
      type: http
      scheme: bearer

````
Get Async Completions

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Get Async Chat Completion

> Retrieve the response for a given asynchronous chat completion request.



## OpenAPI

````yaml get /async/chat/completions/{api_request}
openapi: 3.1.0
info:
  title: Perplexity AI API
  description: Perplexity AI API
  version: 0.1.0
servers: []
security: []
paths:
  /async/chat/completions/{api_request}:
    get:
      summary: Get Async Chat Completion
      description: Retrieve the response for a given asynchronous chat completion request.
      operationId: >-
        get_async_chat_completion_response_async_chat_completions__api_request__get
      parameters:
        - name: api_request
          in: path
          required: true
          schema:
            type: string
            title: Api Request
        - name: local_mode
          in: query
          required: false
          schema:
            type: boolean
            default: false
            title: Local Mode
        - name: x-client-name
          in: header
          required: false
          schema:
            title: X-Client-Name
            type: string
        - name: x-client-env
          in: header
          required: false
          schema:
            title: X-Client-Env
            type: string
        - name: x-user-id
          in: header
          required: false
          schema:
            title: X-User-Id
            type: string
        - name: x-usage-tier
          in: header
          required: false
          schema:
            title: X-Usage-Tier
            type: string
        - name: x-request-time
          in: header
          required: false
          schema:
            title: X-Request-Time
            type: string
        - name: x-created-at-epoch-seconds
          in: header
          required: false
          schema:
            title: X-Created-At-Epoch-Seconds
            type: string
      responses:
        '200':
          description: Successful Response
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AsyncApiChatCompletionsResponse'
        '422':
          description: Validation Error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/HTTPValidationError'
      security:
        - HTTPBearer: []
components:
  schemas:
    AsyncApiChatCompletionsResponse:
      properties:
        id:
          type: string
          title: Id
        model:
          type: string
          title: Model
        created_at:
          type: integer
          title: Created At
        started_at:
          anyOf:
            - type: integer
            - type: 'null'
          title: Started At
        completed_at:
          anyOf:
            - type: integer
            - type: 'null'
          title: Completed At
        response:
          anyOf:
            - $ref: '#/components/schemas/CompletionResponse'
            - type: 'null'
        failed_at:
          anyOf:
            - type: integer
            - type: 'null'
          title: Failed At
        error_message:
          anyOf:
            - type: string
            - type: 'null'
          title: Error Message
        status:
          $ref: '#/components/schemas/AsyncProcessingStatus'
      type: object
      required:
        - id
        - model
        - created_at
        - status
      title: AsyncApiChatCompletionsResponse
    HTTPValidationError:
      properties:
        detail:
          items:
            $ref: '#/components/schemas/ValidationError'
          type: array
          title: Detail
      type: object
      title: HTTPValidationError
    CompletionResponse:
      properties:
        id:
          type: string
          title: Id
        model:
          type: string
          title: Model
        created:
          type: integer
          title: Created
        usage:
          anyOf:
            - $ref: '#/components/schemas/UsageInfo'
            - type: 'null'
        object:
          type: string
          title: Object
          default: chat.completion
        choices:
          items:
            $ref: '#/components/schemas/Choice'
          type: array
          title: Choices
        citations:
          anyOf:
            - items:
                type: string
              type: array
            - type: 'null'
          title: Citations
        search_results:
          anyOf:
            - items:
                $ref: '#/components/schemas/ApiPublicSearchResult'
              type: array
            - type: 'null'
          title: Search Results
        type:
          anyOf:
            - $ref: '#/components/schemas/CompletionResponseType'
            - type: 'null'
        status:
          anyOf:
            - $ref: '#/components/schemas/CompletionResponseStatus'
            - type: 'null'
      type: object
      required:
        - id
        - model
        - created
        - choices
      title: CompletionResponse
    AsyncProcessingStatus:
      type: string
      enum:
        - CREATED
        - IN_PROGRESS
        - COMPLETED
        - FAILED
      title: AsyncProcessingStatus
      description: Status enum for async processing.
    ValidationError:
      properties:
        loc:
          items:
            anyOf:
              - type: string
              - type: integer
          type: array
          title: Location
        msg:
          type: string
          title: Message
        type:
          type: string
          title: Error Type
      type: object
      required:
        - loc
        - msg
        - type
      title: ValidationError
    UsageInfo:
      properties:
        prompt_tokens:
          type: integer
          title: Prompt Tokens
        completion_tokens:
          type: integer
          title: Completion Tokens
        total_tokens:
          type: integer
          title: Total Tokens
        search_context_size:
          anyOf:
            - type: string
            - type: 'null'
          title: Search Context Size
        citation_tokens:
          anyOf:
            - type: integer
            - type: 'null'
          title: Citation Tokens
        num_search_queries:
          anyOf:
            - type: integer
            - type: 'null'
          title: Num Search Queries
        reasoning_tokens:
          anyOf:
            - type: integer
            - type: 'null'
          title: Reasoning Tokens
        cost:
          $ref: '#/components/schemas/Cost'
      type: object
      required:
        - prompt_tokens
        - completion_tokens
        - total_tokens
        - cost
      title: UsageInfo
    Choice:
      properties:
        index:
          type: integer
          title: Index
        finish_reason:
          anyOf:
            - type: string
              enum:
                - stop
                - length
            - type: 'null'
          title: Finish Reason
        message:
          $ref: '#/components/schemas/ChatMessage-Output'
        delta:
          $ref: '#/components/schemas/ChatMessage-Output'
      type: object
      required:
        - index
        - message
        - delta
      title: Choice
    ApiPublicSearchResult:
      properties:
        title:
          type: string
          title: Title
        url:
          type: string
          title: Url
        date:
          anyOf:
            - type: string
            - type: 'null'
          title: Date
        last_updated:
          anyOf:
            - type: string
            - type: 'null'
          title: Last Updated
        snippet:
          type: string
          title: Snippet
          default: ''
        source:
          type: string
          enum:
            - web
            - attachment
          title: Source
          default: web
      type: object
      required:
        - title
        - url
      title: ApiPublicSearchResult
    CompletionResponseType:
      type: string
      enum:
        - message
        - info
        - end_of_stream
      title: CompletionResponseType
    CompletionResponseStatus:
      type: string
      enum:
        - PENDING
        - COMPLETED
      title: CompletionResponseStatus
    Cost:
      properties:
        input_tokens_cost:
          type: number
          title: Input Tokens Cost
        output_tokens_cost:
          type: number
          title: Output Tokens Cost
        reasoning_tokens_cost:
          anyOf:
            - type: number
            - type: 'null'
          title: Reasoning Tokens Cost
        request_cost:
          anyOf:
            - type: number
            - type: 'null'
          title: Request Cost
        citation_tokens_cost:
          anyOf:
            - type: number
            - type: 'null'
          title: Citation Tokens Cost
        search_queries_cost:
          anyOf:
            - type: number
            - type: 'null'
          title: Search Queries Cost
        total_cost:
          type: number
          title: Total Cost
      type: object
      required:
        - input_tokens_cost
        - output_tokens_cost
        - total_cost
      title: Cost
    ChatMessage-Output:
      properties:
        role:
          $ref: '#/components/schemas/ChatMessageRole'
        content:
          anyOf:
            - type: string
            - items:
                anyOf:
                  - $ref: '#/components/schemas/ChatMessageContentTextChunk'
                  - $ref: '#/components/schemas/ChatMessageContentImageChunk'
                  - $ref: '#/components/schemas/ChatMessageContentFileChunk'
                  - $ref: '#/components/schemas/ChatMessageContentPDFChunk'
                  - $ref: '#/components/schemas/ChatMessageContentVideoChunk'
              type: array
              title: Structured Content
            - type: 'null'
          title: Content
        reasoning_steps:
          anyOf:
            - items:
                $ref: '#/components/schemas/ReasoningStep-Output'
              type: array
            - type: 'null'
          title: Reasoning Steps
        tool_calls:
          anyOf:
            - items:
                $ref: '#/components/schemas/ToolCall'
              type: array
            - type: 'null'
          title: Tool Calls
        tool_call_id:
          anyOf:
            - type: string
            - type: 'null'
          title: Tool Call Id
      type: object
      required:
        - role
        - content
      title: ChatMessage
    ChatMessageRole:
      type: string
      enum:
        - system
        - user
        - assistant
        - tool
      title: ChatMessageRole
      description: Chat roles enum
    ChatMessageContentTextChunk:
      properties:
        type:
          type: string
          const: text
          title: Type
        text:
          type: string
          title: Text
      type: object
      required:
        - type
        - text
      title: ChatMessageContentTextChunk
    ChatMessageContentImageChunk:
      properties:
        type:
          type: string
          const: image_url
          title: Type
        image_url:
          anyOf:
            - $ref: '#/components/schemas/URL'
            - type: string
          title: Image Url
      type: object
      required:
        - type
        - image_url
      title: ChatMessageContentImageChunk
    ChatMessageContentFileChunk:
      properties:
        type:
          type: string
          const: file_url
          title: Type
        file_url:
          anyOf:
            - $ref: '#/components/schemas/URL'
            - type: string
          title: File Url
        file_name:
          anyOf:
            - type: string
            - type: 'null'
          title: File Name
      type: object
      required:
        - type
        - file_url
      title: ChatMessageContentFileChunk
    ChatMessageContentPDFChunk:
      properties:
        type:
          type: string
          const: pdf_url
          title: Type
        pdf_url:
          anyOf:
            - $ref: '#/components/schemas/URL'
            - type: string
          title: Pdf Url
      type: object
      required:
        - type
        - pdf_url
      title: ChatMessageContentPDFChunk
    ChatMessageContentVideoChunk:
      properties:
        type:
          type: string
          const: video_url
          title: Type
        video_url:
          anyOf:
            - $ref: '#/components/schemas/VideoURL'
            - type: string
          title: Video Url
      type: object
      required:
        - type
        - video_url
      title: ChatMessageContentVideoChunk
    ReasoningStep-Output:
      properties:
        thought:
          type: string
          title: Thought
        type:
          anyOf:
            - type: string
            - type: 'null'
          title: Type
        web_search:
          anyOf:
            - $ref: '#/components/schemas/WebSearchStepDetails'
            - type: 'null'
        fetch_url_content:
          anyOf:
            - $ref: '#/components/schemas/FetchUrlContentStepDetails'
            - type: 'null'
        execute_python:
          anyOf:
            - $ref: '#/components/schemas/ExecutePythonStepDetails'
            - type: 'null'
      type: object
      required:
        - thought
      title: ReasoningStep
      description: Reasoning step wrapper class
    ToolCall:
      properties:
        id:
          anyOf:
            - type: string
            - type: 'null'
          title: Id
        type:
          anyOf:
            - type: string
              const: function
            - type: 'null'
          title: Type
        function:
          anyOf:
            - $ref: '#/components/schemas/ToolCallFunction'
            - type: 'null'
      type: object
      title: ToolCall
    URL:
      properties:
        url:
          type: string
          title: Url
      type: object
      required:
        - url
      title: URL
    VideoURL:
      properties:
        url:
          type: string
          title: Url
        frame_interval:
          anyOf:
            - type: string
            - type: integer
          title: Frame Interval
          default: 25
      type: object
      required:
        - url
      title: VideoURL
    WebSearchStepDetails:
      properties:
        search_results:
          items:
            $ref: '#/components/schemas/ApiPublicSearchResult'
          type: array
          title: Search Results
        search_keywords:
          items:
            type: string
          type: array
          title: Search Keywords
      type: object
      required:
        - search_results
        - search_keywords
      title: WebSearchStepDetails
      description: Web search step details wrapper class
    FetchUrlContentStepDetails:
      properties:
        contents:
          items:
            $ref: '#/components/schemas/ApiPublicSearchResult'
          type: array
          title: Contents
      type: object
      required:
        - contents
      title: FetchUrlContentStepDetails
      description: Fetch url content step details wrapper class
    ExecutePythonStepDetails:
      properties:
        code:
          type: string
          title: Code
        result:
          type: string
          title: Result
      type: object
      required:
        - code
        - result
      title: ExecutePythonStepDetails
      description: Code generation step details wrapper class
    ToolCallFunction:
      properties:
        name:
          anyOf:
            - type: string
            - type: 'null'
          title: Name
        arguments:
          anyOf:
            - type: string
            - type: 'null'
          title: Arguments
      type: object
      title: ToolCallFunction
  securitySchemes:
    HTTPBearer:
      type: http
      scheme: bearer

````
Generate Auth Token

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Generate Auth Token

> Generates a new authentication token for API access.



## OpenAPI

````yaml post /generate_auth_token
openapi: 3.1.0
info:
  description: Perplexity AI API - Authentication Management
  title: Perplexity AI API - Authentication
  version: 1.0.0
servers:
  - url: https://api.perplexity.ai
    description: Perplexity AI API
security: []
paths:
  /generate_auth_token:
    post:
      summary: Generate Auth Token
      description: Generates a new authentication token for API access.
      operationId: generate_auth_token
      requestBody:
        required: false
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/GenerateAuthTokenRequest'
      responses:
        '200':
          description: Successfully generated authentication token.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/GenerateAuthTokenResponse'
      security:
        - BearerAuth: []
components:
  schemas:
    GenerateAuthTokenRequest:
      type: object
      properties:
        token_name:
          type: string
          description: >-
            Optional name for the authentication token to help identify its
            purpose.
          example: Production API Key
    GenerateAuthTokenResponse:
      type: object
      required:
        - auth_token
        - created_at_epoch_seconds
      properties:
        auth_token:
          type: string
          description: >-
            The newly generated authentication token. Store this securely as it
            cannot be retrieved again.
          example: pplx-1234567890abcdef
        created_at_epoch_seconds:
          type: number
          description: Unix timestamp (in seconds) of when the token was created.
          example: 1735689600
        token_name:
          type: string
          description: The name associated with this token, if provided.
          example: Production API Key
  securitySchemes:
    BearerAuth:
      scheme: bearer
      type: http

````
Revoke Auth Token

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Revoke Auth Token

> Revokes an existing authentication token.



## OpenAPI

````yaml post /revoke_auth_token
openapi: 3.1.0
info:
  description: Perplexity AI API - Authentication Management
  title: Perplexity AI API - Authentication
  version: 1.0.0
servers:
  - url: https://api.perplexity.ai
    description: Perplexity AI API
security: []
paths:
  /revoke_auth_token:
    post:
      summary: Revoke Auth Token
      description: Revokes an existing authentication token.
      operationId: revoke_auth_token
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/RevokeAuthTokenRequest'
      responses:
        '200':
          description: Successfully revoked authentication token.
      security:
        - BearerAuth: []
components:
  schemas:
    RevokeAuthTokenRequest:
      type: object
      required:
        - auth_token
      properties:
        auth_token:
          type: string
          description: The authentication token to revoke.
          example: pplx-1234567890abcdef
  securitySchemes:
    BearerAuth:
      scheme: bearer
      type: http

````