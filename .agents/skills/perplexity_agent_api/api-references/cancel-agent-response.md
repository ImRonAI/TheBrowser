> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Cancel Agent Response

> Requests cancellation of response `{id}`. Acts on durable state, so it works for background runs that outlive the client connection. Cancellation is asynchronous: a `200` acknowledges the request (`status: cancelling`) and the run stops shortly after - poll `GET /v1/agent/{id}` for its terminal status. Cancelling a run that is already terminal returns `400`. Ownership is enforced server side; a cross-tenant or unknown id surfaces as `404`.



## OpenAPI

````yaml post /v1/agent/{id}/cancel
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
  /v1/agent/{id}/cancel:
    post:
      summary: Cancel Agent Response
      description: >-
        Requests cancellation of response `{id}`. Acts on durable state, so it
        works for background runs that outlive the client connection.
        Cancellation is asynchronous: a `200` acknowledges the request (`status:
        cancelling`) and the run stops shortly after - poll `GET /v1/agent/{id}`
        for its terminal status. Cancelling a run that is already terminal
        returns `400`. Ownership is enforced server side; a cross-tenant or
        unknown id surfaces as `404`.
      operationId: cancelAgentResponse
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
                type: object
                required:
                  - response_id
                  - status
                properties:
                  response_id:
                    type: string
                    description: The response id (`resp_<...>`).
                  status:
                    type: string
                    enum:
                      - cancelling
                    description: >-
                      Always `cancelling` - the cancel was accepted and the run
                      stops asynchronously. An already-terminal run returns
                      `400` instead, so no terminal status appears here.
          description: The cancel request was accepted; the run is being cancelled.
        '400':
          content:
            application/json:
              schema:
                type: object
                properties:
                  error:
                    $ref: '#/components/schemas/ErrorInfo'
          description: The response is already terminal, or the request is invalid.
        '404':
          content:
            application/json:
              schema:
                type: object
                properties:
                  error:
                    $ref: '#/components/schemas/ErrorInfo'
          description: Unknown id, or the response belongs to a different account.
      security:
        - HTTPBearer: []
components:
  schemas:
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
  securitySchemes:
    HTTPBearer:
      type: http
      scheme: bearer

````