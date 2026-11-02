> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Download Agent Response File

> Download the raw bytes of a file the response delivered with the `share_file` tool. The `file_id` comes from the file list endpoint and is distinct from the response `id`. The response streams raw bytes, not JSON, with a `Content-Type` matching the file and a `Content-Disposition: attachment` header carrying the original filename.



## OpenAPI

````yaml get /v1/agent/{id}/files/{file_id}/content
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
  /v1/agent/{id}/files/{file_id}/content:
    get:
      summary: Download Agent Response File
      description: >-
        Download the raw bytes of a file the response delivered with the
        `share_file` tool. The `file_id` comes from the file list endpoint and
        is distinct from the response `id`. The response streams raw bytes, not
        JSON, with a `Content-Type` matching the file and a
        `Content-Disposition: attachment` header carrying the original filename.
      operationId: downloadAgentFile
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
          description: Response id (`resp_<...>`)
        - name: file_id
          in: path
          required: true
          schema:
            type: string
          description: File id from the file list endpoint
      responses:
        '200':
          content:
            application/octet-stream:
              schema:
                type: string
                format: binary
          description: The raw file bytes.
        '404':
          content:
            application/json:
              schema:
                type: object
                properties:
                  error:
                    $ref: '#/components/schemas/ErrorInfo'
          description: >-
            Unknown response id or file id, or the response belongs to a
            different account.
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