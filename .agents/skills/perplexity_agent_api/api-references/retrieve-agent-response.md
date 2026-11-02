> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Retrieve Agent Response

> Retrieve a response created earlier. Returns a JSON snapshot of the response. Only responses created with `store` omitted or `true` can be retrieved; `store: false` responses return a 404.



## OpenAPI

````yaml get /v1/agent/{id}
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
  /v1/agent/{id}:
    get:
      summary: Retrieve Agent Response
      description: >-
        Retrieve a response created earlier. Returns a JSON snapshot of the
        response. Only responses created with `store` omitted or `true` can be
        retrieved; `store: false` responses return a 404.
      operationId: retrieveAgent
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
          description: Response id (`resp_<...>`)
      responses:
        '200':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ResponsesResponse'
          description: JSON snapshot of the response.
        '404':
          content:
            application/json:
              schema:
                type: object
                properties:
                  error:
                    $ref: '#/components/schemas/ErrorInfo'
          description: >-
            Unknown id, or the response belongs to a different account, or the
            response was created with `store: false`.
      security:
        - HTTPBearer: []
components:
  schemas:
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
    SearchSource:
      description: Source of search results
      enum:
        - web
      type: string
      title: SearchSource
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
  securitySchemes:
    HTTPBearer:
      type: http
      scheme: bearer

````