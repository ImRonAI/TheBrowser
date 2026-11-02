> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Create a skill

> Creates a skill from a zip bundle. The bundle must contain a `SKILL.md`
that provides the skill name and description; those fields are read from
the bundle, not from the request.




## OpenAPI

````yaml post /v1/skills
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
    post:
      tags:
        - Skills
      summary: Create a skill
      description: |
        Creates a skill from a zip bundle. The bundle must contain a `SKILL.md`
        that provides the skill name and description; those fields are read from
        the bundle, not from the request.
      operationId: createSkill
      requestBody:
        $ref: '#/components/requestBodies/SkillBundle'
      responses:
        '201':
          description: The created skill
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ManagedSkill'
        '400':
          description: Invalid request or bundle
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ApiError'
        '409':
          description: >-
            Skill limit reached for this Project; delete a skill to create
            another
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ApiError'
        '413':
          description: Bundle exceeds the size limit
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ApiError'
        '429':
          description: Rate limit or upload concurrency limit exceeded
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
  requestBodies:
    SkillBundle:
      required: true
      description: The skill bundle as a zip archive
      content:
        multipart/form-data:
          schema:
            type: object
            required:
              - file
            properties:
              file:
                type: string
                format: binary
                description: The skill bundle, a zip archive containing `SKILL.md`
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