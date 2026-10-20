> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# List Models

> List the models available for the Agent API. Returns model identifiers that can be used with the `POST /v1/agent` endpoint. The response follows the OpenAI List Models format for compatibility with third-party tools.



## OpenAPI

````yaml get /v1/models
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
  /v1/models:
    get:
      summary: List Models
      description: >-
        List the models available for the Agent API. Returns model identifiers
        that can be used with the `POST /v1/agent` endpoint. The response
        follows the OpenAI List Models format for compatibility with third-party
        tools.
      operationId: listModels
      responses:
        '200':
          description: Successful response with the list of available models.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ListModelsResponse'
              example:
                object: list
                data:
                  - id: anthropic/claude-opus-5
                    object: model
                    created: 0
                    owned_by: anthropic
                  - id: anthropic/claude-opus-5-5
                    object: model
                    created: 0
                    owned_by: anthropic
                  - id: anthropic/claude-opus-4-8
                    object: model
                    created: 0
                    owned_by: anthropic
                  - id: anthropic/claude-sonnet-5
                    object: model
                    created: 0
                    owned_by: anthropic
                  - id: anthropic/claude-fable-5
                    object: model
                    created: 0
                    owned_by: anthropic
                  - id: anthropic/claude-sonnet-4-6
                    object: model
                    created: 0
                    owned_by: anthropic
                  - id: openai/gpt-6-sol
                    object: model
                    created: 0
                    owned_by: openai
                  - id: openai/gpt-6-luna
                    object: model
                    created: 0
                    owned_by: openai
                  - id: openai/gpt-5.6-sol
                    object: model
                    created: 0
                    owned_by: openai
                  - id: openai/gpt-5.6-terra
                    object: model
                    created: 0
                    owned_by: openai
                  - id: openai/gpt-5.6-luna
                    object: model
                    created: 0
                    owned_by: openai
                  - id: openai/gpt-5.5
                    object: model
                    created: 0
                    owned_by: openai
                  - id: google/gemini-3.1-flash-lite
                    object: model
                    created: 0
                    owned_by: google
                  - id: google/gemini-3.5-flash
                    object: model
                    created: 0
                    owned_by: google
                  - id: google/gemini-3.5-flash-lite
                    object: model
                    created: 0
                    owned_by: google
                  - id: google/gemini-3.6-flash
                    object: model
                    created: 0
                    owned_by: google
                  - id: google/gemini-3.7-flash
                    object: model
                    created: 0
                    owned_by: google
                  - id: google/gemini-3.8-flash
                    object: model
                    created: 0
                    owned_by: google
                  - id: xai/grok-4.7
                    object: model
                    created: 0
                    owned_by: xai
                  - id: xai/grok-4.6
                    object: model
                    created: 0
                    owned_by: xai
                  - id: xai/grok-4.5
                    object: model
                    created: 0
                    owned_by: xai
                  - id: xai/grok-4.3
                    object: model
                    created: 0
                    owned_by: xai
                  - id: xai/grok-4.20-reasoning
                    object: model
                    created: 0
                    owned_by: xai
                  - id: xai/grok-4.20-non-reasoning
                    object: model
                    created: 0
                    owned_by: xai
                  - id: xai/grok-4.20-multi-agent
                    object: model
                    created: 0
                    owned_by: xai
                  - id: perplexity/glm-5.3
                    object: model
                    created: 0
                    owned_by: perplexity
                  - id: perplexity/glm-5.3-flash
                    object: model
                    created: 0
                    owned_by: perplexity
                  - id: perplexity/kimi-k3
                    object: model
                    created: 0
                    owned_by: moonshotai
                  - id: perplexity/sonar
                    object: model
                    created: 0
                    owned_by: perplexity
      security: []
components:
  schemas:
    ListModelsResponse:
      type: object
      description: >-
        Response from the List Models endpoint. Contains a list of available
        models.
      properties:
        object:
          type: string
          description: The object type, which is always `list`.
          enum:
            - list
          example: list
        data:
          type: array
          description: A list of model objects.
          items:
            $ref: '#/components/schemas/Model'
      required:
        - object
        - data
    Model:
      type: object
      description: Represents a model available through the Agent API.
      properties:
        id:
          type: string
          description: >-
            The model identifier in `provider/model-name` format. Use this value
            as the `model` parameter in Agent API requests.
          example: openai/gpt-5.5
        object:
          type: string
          description: The object type, which is always `model`.
          enum:
            - model
          example: model
        created:
          type: integer
          description: The Unix timestamp (in seconds) when the model was created.
          example: 0
        owned_by:
          type: string
          description: >-
            The provider that owns the model (e.g. `openai`, `anthropic`,
            `google`, `perplexity`, `xai`, `z-ai`, `moonshotai`, `nvidia`).
          example: openai
      required:
        - id
        - object
        - created
        - owned_by

````