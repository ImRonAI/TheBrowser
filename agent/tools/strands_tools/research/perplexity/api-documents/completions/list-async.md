# List Async Chat Completions

> Lists all asynchronous chat completion requests for the authenticated user.



## OpenAPI

````yaml get /async/chat/completions
openapi: 3.0.2
info:
  title: Perplexity API
  description: Perplexity API
  version: 0.1.0
  x-mintlify:
    api:
      examples:
        defaults: required
servers:
  - url: https://api.perplexity.ai
security: []
paths:
  /async/chat/completions:
    get:
      summary: List Async Chat Completions
      description: >-
        Lists all asynchronous chat completion requests for the authenticated
        user.
      operationId: list_async_chat_completions
      parameters:
        - name: limit
          in: query
          description: Maximum number of requests to return.
          required: false
          schema:
            type: integer
            default: 20
        - name: next_token
          in: query
          description: >-
            Token for fetching the next page of results. Ensure this token is
            URL-encoded when passed as a query parameter.
          required: false
          schema:
            type: string
      responses:
        '200':
          description: Successfully retrieved list of async chat completion requests.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ListAsyncApiChatCompletionsResponse'
      security:
        - HTTPBearer: []
components:
  schemas:
    ListAsyncApiChatCompletionsResponse:
      title: ListAsyncApiChatCompletionsResponse
      type: object
      properties:
        next_token:
          title: Next Token
          type: string
          nullable: true
          description: Token for fetching the next page of results.
        requests:
          title: Requests
          type: array
          items:
            $ref: '#/components/schemas/AsyncApiChatCompletionsResponseSummary'
      required:
        - requests
    AsyncApiChatCompletionsResponseSummary:
      title: AsyncApiChatCompletionsResponseSummary
      type: object
      properties:
        id:
          title: ID
          type: string
        created_at:
          title: Created At
          type: integer
          format: int64
          description: Unix timestamp of when the request was created.
        started_at:
          title: Started At
          type: integer
          format: int64
          nullable: true
          description: Unix timestamp of when processing started.
        completed_at:
          title: Completed At
          type: integer
          format: int64
          nullable: true
          description: Unix timestamp of when processing completed.
        failed_at:
          title: Failed At
          type: integer
          format: int64
          nullable: true
          description: Unix timestamp of when processing failed.
        model:
          title: Model
          type: string
        status:
          $ref: '#/components/schemas/AsyncProcessingStatus'
      required:
        - id
        - created_at
        - model
        - status
    AsyncProcessingStatus:
      title: AsyncProcessingStatus
      type: string
      enum:
        - CREATED
        - IN_PROGRESS
        - COMPLETED
        - FAILED
      description: The status of an asynchronous processing job.
  securitySchemes:
    HTTPBearer:
      type: http
      scheme: bearer

````

---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.perplexity.ai/llms.txt