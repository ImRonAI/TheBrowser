> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# List skills

> Lists the skills in your Project, newest first.



## OpenAPI

````yaml get /v1/skills
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
  /v1/skills:
    get:
      tags:
        - Skills
      summary: List skills
      description: Lists the skills in your Project, newest first.
      operationId: listSkills
      parameters:
        - $ref: '#/components/parameters/Limit'
        - $ref: '#/components/parameters/PageToken'
      responses:
        '200':
          description: Available skills
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SkillList'
        '400':
          description: Invalid request
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
    SkillList:
      type: object
      required:
        - skills
      properties:
        skills:
          type: array
          items:
            $ref: '#/components/schemas/SkillSummary'
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
    SkillSummary:
      type: object
      required:
        - skill_id
      properties:
        skill_id:
          type: string
          description: Skill identifier
        name:
          type: string
          description: Skill name, read from the bundle's `SKILL.md`
        revision:
          type: string
          description: >-
            Opaque revision token of the skill; pass as expected_revision to
            update or delete
        created_at:
          type: string
          format: date-time
        updated_at:
          type: string
          format: date-time
  securitySchemes:
    HTTPBearer:
      type: http
      scheme: bearer

````