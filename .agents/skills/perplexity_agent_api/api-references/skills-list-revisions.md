> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# List skill revisions

> Lists the revisions of a skill, newest first.



## OpenAPI

````yaml get /v1/skills/{skill_id}/revisions
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
  /v1/skills/{skill_id}/revisions:
    get:
      tags:
        - Skills
      summary: List skill revisions
      description: Lists the revisions of a skill, newest first.
      operationId: listSkillRevisions
      parameters:
        - $ref: '#/components/parameters/SkillId'
        - $ref: '#/components/parameters/Limit'
        - $ref: '#/components/parameters/PageToken'
      responses:
        '200':
          description: The skill revisions
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SkillRevisionList'
        '400':
          description: Invalid request
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ApiError'
        '404':
          description: Skill not found
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ApiError'
        '429':
          description: Rate limit exceeded
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ApiError'
        '502':
          description: Skill service unavailable
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ApiError'
      security:
        - HTTPBearer: []
components:
  parameters:
    SkillId:
      name: skill_id
      in: path
      required: true
      description: Skill identifier returned by create or `GET /v1/skills`
      schema:
        type: string
    Limit:
      name: limit
      in: query
      required: false
      description: Maximum items to return, 1 to 200; defaults to 50
      schema:
        type: integer
        minimum: 1
        maximum: 200
    PageToken:
      name: page_token
      in: query
      required: false
      description: Opaque token from a previous response's `next_page_token`
      schema:
        type: string
  schemas:
    SkillRevisionList:
      type: object
      required:
        - revisions
      properties:
        revisions:
          type: array
          items:
            $ref: '#/components/schemas/SkillRevision'
        next_page_token:
          type: string
          description: Opaque token for the next page; omitted on the last page
    ApiError:
      type: object
      properties:
        error:
          type: object
          required:
            - message
            - type
            - code
          properties:
            message:
              description: Human-readable error message
              type: string
            type:
              type: string
              description: Error type identifier
            code:
              type: integer
              description: HTTP status code
            param:
              type: string
              description: Parameter that caused the error
              nullable: true
    SkillRevision:
      type: object
      required:
        - revision
      properties:
        revision:
          type: string
          description: Opaque revision token
        name:
          type: string
          description: Skill name at this revision
        created_at:
          type: string
          format: date-time
  securitySchemes:
    HTTPBearer:
      type: http
      scheme: bearer

````