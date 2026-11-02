> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Get a skill

> Returns a skill. Without `revision`, returns the active revision.



## OpenAPI

````yaml get /v1/skills/{skill_id}
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
  /v1/skills/{skill_id}:
    get:
      tags:
        - Skills
      summary: Get a skill
      description: Returns a skill. Without `revision`, returns the active revision.
      operationId: getSkill
      parameters:
        - $ref: '#/components/parameters/SkillId'
        - $ref: '#/components/parameters/Revision'
      responses:
        '200':
          description: The skill
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ManagedSkill'
        '400':
          description: Invalid request
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ApiError'
        '404':
          description: Skill or revision not found
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
    Revision:
      name: revision
      in: query
      required: false
      description: Opaque revision token; when omitted, the active revision is used
      schema:
        type: string
  schemas:
    ManagedSkill:
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
        description:
          type: string
          description: Skill description, read from the bundle's `SKILL.md`
        revision:
          type: string
          description: >-
            Opaque token of the revision returned in this response; the latest
            revision, or the specific one requested via `revision`
        latest_revision:
          type: string
          description: >-
            Opaque token of the skill's current latest revision; pass as
            expected_revision to update or delete
        created_at:
          type: string
          format: date-time
        updated_at:
          type: string
          format: date-time
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
  securitySchemes:
    HTTPBearer:
      type: http
      scheme: bearer

````