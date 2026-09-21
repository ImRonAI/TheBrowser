# Revoke Auth Token

> Revokes an existing authentication token.



## OpenAPI

````yaml post /revoke_auth_token
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
  /revoke_auth_token:
    post:
      summary: Revoke Auth Token
      description: Revokes an existing authentication token.
      operationId: revoke_auth_token
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/RevokeAuthTokenRequest'
        required: true
      responses:
        '200':
          description: Successfully revoked authentication token.
      security:
        - HTTPBearer: []
components:
  schemas:
    RevokeAuthTokenRequest:
      title: RevokeAuthTokenRequest
      type: object
      properties:
        auth_token:
          title: Auth Token
          type: string
          description: The authentication token to revoke.
          example: pplx-1234567890abcdef
      required:
        - auth_token
  securitySchemes:
    HTTPBearer:
      type: http
      scheme: bearer

````

---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.perplexity.ai/llms.txt