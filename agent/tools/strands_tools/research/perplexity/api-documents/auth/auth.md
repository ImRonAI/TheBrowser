# Generate Auth Token

> Generates a new authentication token for API access.



## OpenAPI

````yaml post /generate_auth_token
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
  /generate_auth_token:
    post:
      summary: Generate Auth Token
      description: Generates a new authentication token for API access.
      operationId: generate_auth_token
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/GenerateAuthTokenRequest'
        required: false
      responses:
        '200':
          description: Successfully generated authentication token.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/GenerateAuthTokenResponse'
      security:
        - HTTPBearer: []
components:
  schemas:
    GenerateAuthTokenRequest:
      title: GenerateAuthTokenRequest
      type: object
      properties:
        token_name:
          title: Token Name
          type: string
          description: >-
            Optional name for the authentication token to help identify its
            purpose.
          example: Production API Key
    GenerateAuthTokenResponse:
      title: GenerateAuthTokenResponse
      type: object
      properties:
        auth_token:
          title: Auth Token
          type: string
          description: >-
            The newly generated authentication token. Store this securely as it
            cannot be retrieved again.
          example: pplx-1234567890abcdef
        created_at_epoch_seconds:
          title: Created At Epoch Seconds
          type: number
          description: Unix timestamp (in seconds) of when the token was created.
          example: 1735689600
        token_name:
          title: Token Name
          type: string
          description: The name associated with this token, if provided.
          example: Production API Key
      required:
        - auth_token
        - created_at_epoch_seconds
  securitySchemes:
    HTTPBearer:
      type: http
      scheme: bearer

````

---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.perplexity.ai/llms.txt