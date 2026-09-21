# Get Async Chat Completion Response

> Retrieves the status and result of a specific asynchronous chat completion job.



## OpenAPI

````yaml get /async/chat/completions/{request_id}
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
  /async/chat/completions/{request_id}:
    get:
      summary: Get Async Chat Completion Response
      description: >-
        Retrieves the status and result of a specific asynchronous chat
        completion job.
      operationId: get_async_chat_completion_response
      parameters:
        - name: request_id
          in: path
          description: The ID of the asynchronous chat completion request.
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Successfully retrieved async chat completion response.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AsyncApiChatCompletionsResponse'
        '404':
          description: Async chat completion response not found.
      security:
        - HTTPBearer: []
components:
  schemas:
    AsyncApiChatCompletionsResponse:
      title: AsyncApiChatCompletionsResponse
      type: object
      properties:
        id:
          title: ID
          type: string
          description: Unique identifier for the asynchronous job.
        model:
          title: Model
          type: string
          description: The model used for the request.
        created_at:
          title: Created At
          type: integer
          format: int64
          description: Unix timestamp of when the job was created.
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
        response:
          $ref: '#/components/schemas/ChatCompletionsResponseJson'
          nullable: true
          description: >-
            The actual chat completion response, available when status is
            COMPLETED.
        failed_at:
          title: Failed At
          type: integer
          format: int64
          nullable: true
          description: Unix timestamp of when processing failed.
        error_message:
          title: Error Message
          type: string
          nullable: true
          description: Error message if the job failed.
        status:
          $ref: '#/components/schemas/AsyncProcessingStatus'
      required:
        - id
        - model
        - created_at
        - status
    ChatCompletionsResponseJson:
      title: ChatCompletionsResponseJson
      type: object
      properties:
        id:
          title: ID
          type: string
          description: A unique identifier for the chat completion.
        model:
          title: Model
          type: string
          description: The model that generated the response.
        created:
          title: Created Timestamp
          type: integer
          description: >-
            The Unix timestamp (in seconds) of when the chat completion was
            created.
        usage:
          $ref: '#/components/schemas/UsageInfo'
        object:
          title: Object Type
          type: string
          default: chat.completion
          description: The type of object, which is always `chat.completion`.
        choices:
          title: Choices
          type: array
          items:
            $ref: '#/components/schemas/ChatCompletionsChoice'
          description: >-
            A list of chat completion choices. Can be more than one if `n` is
            greater than 1.
        search_results:
          title: Search Results
          type: array
          items:
            $ref: '#/components/schemas/ApiPublicSearchResult'
          nullable: true
          description: A list of search results related to the response.
        videos:
          title: Videos
          type: array
          items:
            $ref: '#/components/schemas/VideoResult'
          nullable: true
          description: >-
            A list of video results when media_response.overrides.return_videos
            is enabled. Contains video URLs and metadata.
      required:
        - id
        - model
        - created
        - usage
        - object
        - choices
    AsyncProcessingStatus:
      title: AsyncProcessingStatus
      type: string
      enum:
        - CREATED
        - IN_PROGRESS
        - COMPLETED
        - FAILED
      description: The status of an asynchronous processing job.
    UsageInfo:
      title: UsageInfo
      type: object
      properties:
        prompt_tokens:
          title: Prompt Tokens
          type: integer
        completion_tokens:
          title: Completion Tokens
          type: integer
        total_tokens:
          title: Total Tokens
          type: integer
        search_context_size:
          title: Search Context Size
          type: string
          nullable: true
        citation_tokens:
          title: Citation Tokens
          type: integer
          nullable: true
        num_search_queries:
          title: Number of Search Queries
          type: integer
          nullable: true
        reasoning_tokens:
          title: Reasoning Tokens
          type: integer
          nullable: true
      required:
        - prompt_tokens
        - completion_tokens
        - total_tokens
    ChatCompletionsChoice:
      title: ChatCompletionsChoice
      type: object
      properties:
        index:
          title: Index
          type: integer
        finish_reason:
          title: Finish Reason
          type: string
          enum:
            - stop
            - length
          nullable: true
        message:
          $ref: '#/components/schemas/ChatCompletionsMessage'
      required:
        - index
        - message
    ApiPublicSearchResult:
      title: ApiPublicSearchResult
      type: object
      properties:
        title:
          title: Title
          type: string
        url:
          title: URL
          type: string
          format: uri
        date:
          title: Date
          type: string
          format: date
          nullable: true
      required:
        - title
        - url
    VideoResult:
      title: VideoResult
      type: object
      description: Represents a video result returned when video content is enabled.
      properties:
        url:
          title: Video URL
          type: string
          format: uri
          description: The URL of the video.
        thumbnail_url:
          title: Thumbnail URL
          type: string
          format: uri
          nullable: true
          description: The URL of the video thumbnail image.
        thumbnail_width:
          title: Thumbnail Width
          type: integer
          nullable: true
          description: The width of the thumbnail image in pixels.
        thumbnail_height:
          title: Thumbnail Height
          type: integer
          nullable: true
          description: The height of the thumbnail image in pixels.
        duration:
          title: Duration
          type: integer
          nullable: true
          description: The duration of the video in seconds.
      required:
        - url
    ChatCompletionsMessage:
      title: Message
      type: object
      required:
        - content
        - role
      properties:
        content:
          title: Message Content
          oneOf:
            - type: string
              description: The text contents of the message.
            - type: array
              items:
                $ref: '#/components/schemas/ChatCompletionsMessageContentChunk'
              description: An array of content parts for multimodal messages.
          description: >-
            The contents of the message in this turn of conversation. Can be a
            string or an array of content parts.
        role:
          title: Role
          type: string
          enum:
            - system
            - user
            - assistant
          description: The role of the speaker in this conversation.
    ChatCompletionsMessageContentChunk:
      title: ChatCompletionsMessageContentChunk
      type: object
      properties:
        type:
          title: Content Part Type
          type: string
          enum:
            - text
            - image_url
          description: The type of the content part.
        text:
          title: Text Content
          type: string
          description: The text content of the part.
        image_url:
          title: Image URL Content
          type: object
          properties:
            url:
              title: Image URL
              type: string
              format: uri
              description: Either a URL of the image or the base64 encoded image data.
          required:
            - url
          description: An object containing the image URL or base64 encoded image data.
        file_url:
          title: File URL Content
          type: object
          properties:
            url:
              title: File URL
              type: string
              format: uri
              description: URL for the file (base64 encoded data URI or HTTPS).
          required:
            - url
          description: An object containing the URL of the file.
        file_name:
          title: File Name
          type: string
          description: The name of the file being referenced.
          example: document.pdf
      required:
        - type
      description: Represents a part of a multimodal message content.
  securitySchemes:
    HTTPBearer:
      type: http
      scheme: bearer

````

---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.perplexity.ai/llms.txt