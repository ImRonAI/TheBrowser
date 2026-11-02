> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Add a skill revision

> Uploads a new zip bundle as a new revision of an existing skill. Pass the
revision you expect to replace as the required `expected_revision`; the
request fails with `409` if the skill has already moved past it, so the
update cannot race a concurrent write. Name and description are re-read
from the new bundle.




## OpenAPI

````yaml put /v1/skills/{skill_id}
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
    put:
      tags:
        - Skills
      summary: Add a skill revision
      description: >
        Uploads a new zip bundle as a new revision of an existing skill. Pass
        the

        revision you expect to replace as the required `expected_revision`; the

        request fails with `409` if the skill has already moved past it, so the

        update cannot race a concurrent write. Name and description are re-read

        from the new bundle.
      operationId: updateSkill
      parameters:
        - $ref: '#/components/parameters/SkillId'
        - $ref: '#/components/parameters/ExpectedRevisionRequired'
      requestBody:
        $ref: '#/components/requestBodies/SkillBundle'
      responses:
        '200':
          description: The updated skill
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