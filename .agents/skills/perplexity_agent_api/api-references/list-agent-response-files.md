> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# List Agent Response Files

> List the files a response produced in the sandbox and delivered with the `share_file` tool. Scoped to the authenticated account, which only ever sees its own files. File content is not returned inline; download it with the file content endpoint.



## OpenAPI

````yaml get /v1/agent/{id}/files
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
  /v1/agent/{id}/files:
    get:
      summary: List Agent Response Files
      description: >-
        List the files a response produced in the sandbox and delivered with the
        `share_file` tool. Scoped to the authenticated account, which only ever
        sees its own files. File content is not returned inline; download it
        with the file content endpoint.
      operationId: listAgentFiles
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
                $ref: '#/components/schemas/ResponseFileList'
          description: The list of files delivered from the response's sandbox.
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
    ResponseFileList:
      type: object
      required:
        - object
        - data
      properties:
        object:
          type: string
          description: Always `list`.
        data:
          type: array
          items:
            $ref: '#/components/schemas/ResponseFile'
      title: ResponseFileList
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
    ResponseFile:
      type: object
      description: One file shared from a response's sandbox via `share_file`.
      required:
        - id
        - object
        - filename
        - bytes
        - created_at
      properties:
        id:
          type: string
          description: >-
            File identifier, used to download the file; distinct from the
            response id.
        object:
          type: string
          description: Always `file`.
        filename:
          type: string
          description: Name the sandbox gave the file.
        bytes:
          type: integer
          format: int64
          description: File size in bytes.
        created_at:
          type: integer
          format: int64
          description: Unix timestamp when the file was created.
      title: ResponseFile
  securitySchemes:
    HTTPBearer:
      type: http
      scheme: bearer

````