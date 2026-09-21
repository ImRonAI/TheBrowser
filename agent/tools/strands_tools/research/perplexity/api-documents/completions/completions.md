# Chat Completions

> Generates a model's response for the given chat conversation.



## OpenAPI

````yaml post /chat/completions
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
  /chat/completions:
    post:
      summary: Chat Completions
      description: Generates a model's response for the given chat conversation.
      operationId: post_chat_completions
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ChatCompletionsRequest'
        required: true
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ChatCompletionsResponseJson'
            text/event-stream:
              schema:
                $ref: '#/components/schemas/ChatCompletionsResponseEventStream'
      security:
        - HTTPBearer: []
components:
  schemas:
    ChatCompletionsRequest:
      title: ChatCompletionsRequest
      required:
        - model
        - messages
      type: object
      properties:
        model:
          title: Model
          type: string
          enum:
            - sonar
            - sonar-pro
            - sonar-deep-research
            - sonar-reasoning-pro
          description: >-
            The name of the model that will complete your prompt. Choose from
            our available Sonar models: sonar (lightweight search), sonar-pro
            (advanced search), sonar-deep-research (exhaustive research), or
            sonar-reasoning-pro (premier reasoning).
          example: sonar-deep-research
          x-openai-compatible: true
        messages:
          title: Messages
          type: array
          description: A list of messages comprising the conversation so far.
          x-openai-compatible: true
          items:
            $ref: '#/components/schemas/ChatCompletionsMessage'
          example:
            - role: system
              content: Be precise and concise.
            - role: user
              content: How many stars are there in our galaxy?
        search_mode:
          title: Search Mode
          type: string
          enum:
            - academic
            - sec
            - web
          default: web
          description: >-
            Controls search mode: 'academic' prioritizes scholarly sources,
            'sec' prioritizes SEC filings, 'web' uses general web search. See
            [academic
            guide](https://docs.perplexity.ai/guides/academic-filter-guide) and
            [SEC guide](https://docs.perplexity.ai/guides/sec-guide).
          x-openai-compatible: false
        reasoning_effort:
          title: Reasoning Effort
          type: string
          enum:
            - low
            - medium
            - high
          description: >-
            **Perplexity-Specific**: Controls how much computational effort the
            AI dedicates to each query for deep research models. 'low' provides
            faster, simpler answers with reduced token usage, 'medium' offers a
            balanced approach, and 'high' delivers deeper, more thorough
            responses with increased token usage. This parameter directly
            impacts the amount of reasoning tokens consumed. **WARNING: This
            parameter is ONLY applicable for sonar-deep-research.** Defaults to
            'medium' when used with sonar-deep-research.
        max_tokens:
          title: Max Tokens
          type: integer
          description: >-
            **OpenAI Compatible**: The maximum number of completion tokens
            returned by the API. Controls the length of the model's response. If
            the response would exceed this limit, it will be truncated. Higher
            values allow for longer responses but may increase processing time
            and costs.
        temperature:
          title: Temperature
          type: number
          default: 0.2
          description: >-
            The amount of randomness in the response, valued between 0 and 2.
            Lower values (e.g., 0.1) make the output more focused,
            deterministic, and less creative. Higher values (e.g., 1.5) make the
            output more random and creative. Use lower values for
            factual/information retrieval tasks and higher values for creative
            applications.
          minimum: 0
          maximum: 2
          exclusiveMaximum: true
          x-openai-compatible: true
        top_p:
          title: Top P
          type: number
          default: 0.9
          description: >-
            **OpenAI Compatible**: The nucleus sampling threshold, valued
            between 0 and 1. Controls the diversity of generated text by
            considering only the tokens whose cumulative probability exceeds the
            top_p value. Lower values (e.g., 0.5) make the output more focused
            and deterministic, while higher values (e.g., 0.95) allow for more
            diverse outputs. Often used as an alternative to temperature.
        language_preference:
          title: Language Preference
          type: string
          description: >-
            **Perplexity-Specific**: Specifies the preferred language for the
            chat completion response (i.e., English, Korean, Spanish, etc.) of
            the response content. This parameter is supported only by the
            `sonar` and `sonar-pro` models. Using it with other models is on a
            best-effort basis and may not produce consistent results.
        search_domain_filter:
          title: Search Domain Filter
          type: array
          description: >-
            A list of domains to limit search results to. Currently limited to
            20 domains for Allowlisting and Denylisting. For Denylisting, add a
            `-` at the beginning of the domain string. More information about
            this
            [here](https://docs.perplexity.ai/guides/search-domain-filters).
          x-openai-compatible: false
        return_images:
          title: Return Images
          type: boolean
          default: false
          description: >-
            **Perplexity-Specific**: Determines whether search results should
            include images.
        return_related_questions:
          title: Return Related Questions
          type: boolean
          default: false
          description: >-
            **Perplexity-Specific**: Determines whether related questions should
            be returned.
        search_recency_filter:
          title: Recency Filter
          type: string
          description: >-
            **Perplexity-Specific**: Filters search results based on time (e.g.,
            'week', 'day').
        search_after_date_filter:
          title: Search After Date Filter
          type: string
          description: >-
            **Perplexity-Specific**: Filters search results to only include
            content published after this date. Format should be %m/%d/%Y (e.g.
            3/1/2025)
        search_before_date_filter:
          title: Search Before Date Filter
          type: string
          description: >-
            **Perplexity-Specific**: Filters search results to only include
            content published before this date. Format should be %m/%d/%Y (e.g.
            3/1/2025)
        last_updated_after_filter:
          title: Last Updated After Filter
          type: string
          description: >-
            **Perplexity-Specific**: Filters search results to only include
            content last updated after this date. Format should be %m/%d/%Y
            (e.g. 3/1/2025)
        last_updated_before_filter:
          title: Last Updated Before Filter
          type: string
          description: >-
            **Perplexity-Specific**: Filters search results to only include
            content last updated before this date. Format should be %m/%d/%Y
            (e.g. 3/1/2025)
        top_k:
          title: Top K
          type: number
          default: 0
          description: >-
            **OpenAI Compatible**: The number of tokens to keep for top-k
            filtering. Limits the model to consider only the k most likely next
            tokens at each step. Lower values (e.g., 20) make the output more
            focused and deterministic, while higher values allow for more
            diverse outputs. A value of 0 disables this filter. Often used in
            conjunction with top_p to control output randomness.
        stream:
          title: Streaming
          type: boolean
          default: false
          description: >-
            **OpenAI Compatible**: Determines whether to stream the response
            incrementally.
        presence_penalty:
          title: Presence Penalty
          type: number
          default: 0
          description: >-
            **OpenAI Compatible**: Positive values increase the likelihood of
            discussing new topics. Applies a penalty to tokens that have already
            appeared in the text, encouraging the model to talk about new
            concepts. Values typically range from 0 (no penalty) to 2.0 (strong
            penalty). Higher values reduce repetition but may lead to more
            off-topic text.
        frequency_penalty:
          title: Frequency Penalty
          type: number
          default: 0
          description: >-
            **OpenAI Compatible**: Decreases likelihood of repetition based on
            prior frequency. Applies a penalty to tokens based on how frequently
            they've appeared in the text so far. Values typically range from 0
            (no penalty) to 2.0 (strong penalty). Higher values (e.g., 1.5)
            reduce repetition of the same words and phrases. Useful for
            preventing the model from getting stuck in loops.
        response_format:
          title: Response Format
          type: object
          description: Enables structured JSON output formatting.
          x-openai-compatible: true
        disable_search:
          title: Disable Search
          type: boolean
          default: false
          description: >-
            **Perplexity-Specific**: When set to true, disables web search
            completely and the model will only use its training data to respond.
            This is useful when you want deterministic responses without
            external information. More information about this
            [here](https://docs.perplexity.ai/guides/search-control-guide#disabling-search-completely).
          x-openai-compatible: false
        enable_search_classifier:
          title: Enable Search Classifier
          type: boolean
          default: false
          description: >-
            **Perplexity-Specific**: Enables a classifier that decides if web
            search is needed based on your query. See more
            [here](https://docs.perplexity.ai/guides/search-control-guide#search-classifier).
          x-openai-compatible: false
        web_search_options:
          title: Web Search Options
          type: object
          description: >-
            **Perplexity-Specific**: Configuration for using web search in model
            responses.
          properties:
            search_context_size:
              title: Search Context Size
              type: string
              default: low
              enum:
                - low
                - medium
                - high
              description: >-
                Determines how much search context is retrieved for the model.
                Options are: `low` (minimizes context for cost savings but less
                comprehensive answers), `medium` (balanced approach suitable for
                most queries), and `high` (maximizes context for comprehensive
                answers but at higher cost).
            user_location:
              title: Location of the user.
              type: object
              description: >-
                To refine search results based on geography, you can specify an
                approximate user location. For best accuracy, we recommend
                providing as many fields as possible including city and region.
              properties:
                latitude:
                  title: Latitude
                  type: number
                  description: The latitude of the user's location.
                longitude:
                  title: Longitude
                  type: number
                  description: The longitude of the user's location.
                country:
                  title: Country
                  type: string
                  description: The two letter ISO country code of the user's location.
                region:
                  title: Region
                  type: string
                  description: >-
                    The region/state/province of the user's location (e.g.,
                    'California', 'Ontario', 'Île-de-France').
                city:
                  title: City
                  type: string
                  description: >-
                    The city name of the user's location (e.g., 'San Francisco',
                    'New York City', 'Paris').
            image_search_relevance_enhanced:
              title: Image Search Relevance Enhanced
              type: boolean
              default: false
              description: >-
                When enabled, improves the relevance of image search results to
                the user query. Enhanced images will be streamed in later chunks
                of the response.
          example:
            search_context_size: high
        media_response:
          title: Media Response
          type: object
          description: >-
            **Perplexity-Specific**: Configuration for controlling media content
            in responses, such as videos and images. Use the overrides property
            to enable specific media types.
          x-openai-compatible: false
          properties:
            overrides:
              $ref: '#/components/schemas/MediaResponseOverrides'
          example:
            overrides:
              return_videos: true
              return_images: true
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
    ChatCompletionsResponseEventStream:
      title: ChatCompletionsResponseEventStream
      type: object
      properties:
        id:
          title: ID
          type: string
          description: A unique identifier for the chat completion chunk.
        model:
          title: Model
          type: string
          description: The model that generated the response.
        created:
          title: Created Timestamp
          type: integer
          description: >-
            The Unix timestamp (in seconds) of when the chat completion chunk
            was created.
        object:
          title: Object Type
          type: string
          default: chat.completion.chunk
          description: The type of object, which is always `chat.completion.chunk`.
        choices:
          title: Choices
          type: array
          items:
            $ref: '#/components/schemas/ChatCompletionsChunkChoice'
          description: >-
            A list of chat completion choices. Can be more than one if `n` is
            greater than 1.
      required:
        - id
        - model
        - created
        - object
        - choices
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
    MediaResponseOverrides:
      title: MediaResponseOverrides
      type: object
      description: >-
        Configuration overrides for controlling specific types of media content
        in API responses.
      properties:
        return_videos:
          title: Return Videos
          type: boolean
          default: false
          description: >-
            When set to true, enables video content to be returned in the
            response. Videos will be included as part of the response structure
            with URL and metadata.
        return_images:
          title: Return Images (Override)
          type: boolean
          default: false
          description: >-
            When set to true, enables image content to be returned in the
            response. This overrides the top-level return_images parameter when
            used within media_response.overrides.
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
    ChatCompletionsChunkChoice:
      title: ChatCompletionsChunkChoice
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
        delta:
          $ref: '#/components/schemas/ChatCompletionsMessage'
      required:
        - index
        - delta
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