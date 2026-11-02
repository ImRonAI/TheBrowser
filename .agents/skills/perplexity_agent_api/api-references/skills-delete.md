> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Delete a skill

> Deletes a skill. Pass the current revision as `expected_revision`; the
delete fails with `409` if the skill has a newer revision, so a delete
never races a concurrent update.




## OpenAPI

````yaml delete /v1/skills/{skill_id}
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
    delete:
      tags:
        - Skills
      summary: Delete a skill
      description: |
        Deletes a skill. Pass the current revision as `expected_revision`; the
        delete fails with `409` if the skill has a newer revision, so a delete
        never races a concurrent update.
      operationId: deleteSkill
      parameters:
        - $ref: '#/components/parameters/SkillId'
        - $ref: '#/components/parameters/ExpectedRevisionRequired'
      responses:
        '204':
          description: Skill deleted
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
        '409':
          description: Revision conflict; the skill moved past expected_revision
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
    ExpectedRevisionRequired:
      name: expected_revision
      in: query
      required: true
      description: |
        Opaque revision token the skill must currently be at. The write applies
        only if it matches, so it cannot race a concurrent update.
      schema:
        type: string
  schemas:
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