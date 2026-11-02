---
name: perplexity-agent-api
description: Comprehensive reference and execution guide for Perplexity's Agent API and Agent Skills API, including OpenAPI 3.1 specifications, request/response models, background execution, tool calling, and skill lifecycle endpoints.
---

# Perplexity Agent API & Skills Reference

This skill provides full contextual documentation, OpenAPI specifications, request/response schemas, tool definitions, and executable Python scripts for Perplexity's **Agent API** and **Agent Skills API**.

## Layout Architecture

All documents, tools, and scripts are organized at the root of the skill in three peer subdirectories:

```
.agents/skills/perplexity_agent_api/
├── SKILL.md                         # Main instructions and reference guide
├── api-references/                  # OpenAPI 3.1 specs & endpoint documentation
├── features/                        # Tool specs, model fallbacks, sandboxes, presets, guides
└── scripts/                         # Ready-to-use Python client, CLI runners, and tooling
```

---

## 1. Quick Implementation Scripts (`scripts/`)

The [`scripts/`](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/scripts) directory contains a modular, zero-dependency Python implementation designed for immediate use:

| Script | Purpose | Example Usage |
| :--- | :--- | :--- |
| [`perplexity_client.py`](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/scripts/perplexity_client.py) | **Core Python Client SDK**: Programmatic API for Agent runs, model fallbacks, tool configuration, background polling, file downloading, and skills lifecycle. | `from perplexity_client import PerplexityAgentClient` |
| [`run_agent.py`](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/scripts/run_agent.py) | **Agent CLI Runner**: Execute agent runs with preset overrides, multi-model fallback, step overrides, background polling, and auto-downloading sandbox files. | `python3 scripts/run_agent.py -p "Research topic" --preset medium --steps 5 --model anthropic/claude-3-7-sonnet --fallback-models openai/gpt-4o --tools web_search sandbox --skills office --wait --download-files ./output` |
| [`list_models.py`](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/scripts/list_models.py) | **Models Catalog Inspector**: Lists all models available to the Agent API with provider, context, and status. | `python3 scripts/list_models.py` |
| [`manage_skills.py`](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/scripts/manage_skills.py) | **Skills Lifecycle Manager**: Create skills from folders (containing `SKILL.md`) or ZIPs, list, get, update revisions, download, and delete. | `python3 scripts/manage_skills.py list`<br>`python3 scripts/manage_skills.py create --dir ./my_skill`<br>`python3 scripts/manage_skills.py update skill_123 --dir ./my_skill --expected-revision 1` |
| [`manage_files.py`](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/scripts/manage_files.py) | **File Inspector & Downloader**: Inspect and download files produced in the sandbox during agent responses. | `python3 scripts/manage_files.py list <response_id>`<br>`python3 scripts/manage_files.py download <response_id> --out ./downloads/` |

---

## 2. API Endpoints (`api-references/`)

The [`api-references/`](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/api-references) directory contains complete OpenAPI 3.1 YAML specifications and endpoint documents:

- **OpenAPI Schema**: [openapi.json](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/api-references/openapi.json)

### Agent Endpoints
- `POST /v1/agent`: [create-agent-response.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/api-references/create-agent-response.md) — Create agent response (with presets, model fallbacks, tools, skills, background mode).
- `GET /v1/agent/{id}`: [retrieve-agent-response.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/api-references/retrieve-agent-response.md) — Retrieve agent response status and output.
- `GET /v1/agent/{id}/files`: [list-agent-response-files.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/api-references/list-agent-response-files.md) — List sandbox generated files.
- `GET /v1/agent/{id}/files/{file_id}/content`: [download-agent-response-file.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/api-references/download-agent-response-file.md) — Download generated file bytes.
- `POST /v1/agent/{id}/cancel`: [cancel-agent-response.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/api-references/cancel-agent-response.md) — Cancel ongoing response.
- `GET /v1/models`: [list-models.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/api-references/list-models.md) — List models available to the Agent API.
- [Agent API Quickstart](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/api-references/agent-api-quickstart.md)

### Agent Skills Endpoints
- `POST /v1/skills`: [skills-create.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/api-references/skills-create.md) — Create skill from zip bundle containing `SKILL.md`.
- `GET /v1/skills`: [skills-list.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/api-references/skills-list.md) — List project skills.
- `GET /v1/skills/{skill_id}`: [skills-get.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/api-references/skills-get.md) — Retrieve skill metadata.
- `PUT /v1/skills/{skill_id}`: [skills-add-revision.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/api-references/skills-add-revision.md) — Add skill revision (`expected_revision` required).
- `GET /v1/skills/{skill_id}/revisions`: [skills-list-revisions.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/api-references/skills-list-revisions.md) — List revisions of a skill.
- `GET /v1/skills/{skill_id}/download`: [skills-download.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/api-references/skills-download.md) — Get skill download URL.
- `DELETE /v1/skills/{skill_id}`: [skills-delete.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/api-references/skills-delete.md) — Delete skill (`expected_revision` required).
- [Agent Skills Architecture Guide](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/api-references/agent-skills-guide.md)

---

## 3. Features & Tools (`features/`)

The [`features/`](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/features) directory contains the documentation and schemas for all agent features, tools, and configurations:

### Tools
- **Overview**: [tools-overview.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/features/tools-overview.md)
- **Web Search**: [web-search-tool.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/features/web-search-tool.md) — Configurable search types (`web`, `fast`), domain allow/deny filters, context budgets.
- **Sandbox**: [sandbox-tool.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/features/sandbox-tool.md) — Isolated execution container, running Python/code, generating downloadable files with `share_file`.
- **Fetch URL Content**: [fetch-url-content-tool.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/features/fetch-url-content-tool.md) — Extract text from arbitrary URLs.
- **Finance Search**: [finance-search-tool.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/features/finance-search-tool.md) — Real-time and historical financial market data.
- **People Search**: [people-search-tool.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/features/people-search-tool.md) — Professional profiles and talent search.
- **Remote MCP**: [mcp-tool.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/features/mcp-tool.md) — Connect remote Model Context Protocol servers over HTTP.
- **Connectors**: [connectors-tool.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/features/connectors-tool.md) — Pre-configured enterprise connectors (GitHub, Slack, etc.).
- **Custom Functions**: [custom-functions-tool.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/features/custom-functions-tool.md) — Define client-side tool schemas.

### Runtime Features & Configurations
- **Model Fallbacks**: [model-fallback.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/features/model-fallback.md) — Multi-model priority chains (e.g. `["anthropic/claude-3-7-sonnet", "openai/gpt-4o"]`).
- **Presets & Overrides**: [presets.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/features/presets.md) — Standard presets (`fast`, `low`, `medium`, `high`, `xhigh`) and overriding `max_steps` or `model`.
- **Background Mode**: [background-mode.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/features/background-mode.md) — Asynchronous durable execution and polling.
- **Working with Files**: [working-with-files.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/features/working-with-files.md) — Generating and delivering files from sandboxes.
- **Output Control**: [output-control.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/features/output-control.md) — Streaming and structured JSON schemas.
- **Models Catalog**: [models-catalog.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/features/models-catalog.md) — Pricing, rate limits, and capabilities across providers.
- **Agent Building Guides**:
  - [define-the-run.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/features/define-the-run.md)
  - [prompt-the-agent.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/features/prompt-the-agent.md)
  - [give-it-tools.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/features/give-it-tools.md)
  - [run-code.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/features/run-code.md)
  - [shape-output.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/features/shape-output.md)
  - [keep-context.md](file:///Users/tims-stuff/antigravity/Branding-App/.agents/skills/perplexity_agent_api/features/keep-context.md)
