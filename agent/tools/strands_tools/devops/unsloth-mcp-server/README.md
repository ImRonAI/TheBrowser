# Unsloth MCP Server (Express)

This MCP server is built on the **MCP with Express** template to provide a robust HTTP MCP endpoint for Unsloth fine-tuning workflows. It focuses on job-based execution, notebook discovery, and model catalog access, while keeping the runtime friendly for Vercel or self-hosted GPU machines.

## Why Express

- Simple HTTP MCP endpoint at `/mcp` with Streamable HTTP transport.
- Easier to add background job execution and long-running tasks.
- Works both on Vercel and on GPU machines for real training runs.

## Features

- MCP HTTP server (`POST /mcp`) plus stdio mode for local clients.
- Job manager for SFT fine-tuning, inference, and export tasks.
- Notebook discovery from the official Unsloth notebooks repo.
- Hugging Face model discovery for the `unsloth` org.
- Framework and feature registry pointing to official docs.

## Quick Start

```bash
cd unsloth-mcp-server
npm install
npm run build
npm run start
```

Connect your MCP client to `http://localhost:3000/mcp`.

### Stdio mode (local MCP clients)

```bash
npm run build
npm run start:stdio
```

## Environment Variables

- `UNSLOTH_EXECUTION=true` to allow running jobs.
- `UNSLOTH_PYTHON=python3` to choose the Python binary.
- `UNSLOTH_DATA_DIR=./data` to store job configs and logs.
- `UNSLOTH_MAX_CONCURRENT_JOBS=1` to limit parallel jobs.
- `UNSLOTH_ALLOW_ABSOLUTE_PATHS=true` to allow absolute output paths.
- `HUGGINGFACE_TOKEN=...` for gated models.
- `GITHUB_TOKEN=...` to avoid GitHub API rate limits.

## MCP Tools

- `server_info` - runtime configuration snapshot.
- `check_installation` - verifies Python dependencies for Unsloth workflows.
- `list_frameworks` - supported frameworks and guides.
- `list_features` - Unsloth feature registry with doc links.
- `list_notebooks` - list notebooks from `unslothai/notebooks`.
- `get_notebook` - fetch a notebook entry by filename.
- `list_models` - list Unsloth models from Hugging Face.
- `create_sft_job` - create a supervised fine-tuning job.
- `create_generate_job` - create a text generation job.
- `create_export_job` - create a model export job (Hugging Face format).
- `run_job`, `job_status`, `job_logs`, `cancel_job` - manage jobs.

## Example: create an SFT job

```json
{
  "model_name": "unsloth/Llama-3.2-1B",
  "dataset": { "type": "huggingface", "name": "tatsu-lab/alpaca" },
  "output_dir": "runs/llama32-alpaca",
  "run": true
}
```

## Notes on RL / Vision / TTS / Embeddings

Use `list_notebooks` and `list_features` to pull the official notebooks and guides for RL (DPO/ORPO/KTO/GRPO/GSPO), vision, TTS, and embedding fine-tuning. The job runner is optimized for SFT workflows, while notebooks cover the advanced pipelines.

## Vercel Notes

Vercel is great for metadata tools and orchestration, but long-running GPU training should run on a GPU host with `UNSLOTH_EXECUTION=true`. You can still deploy the MCP API to Vercel for discovery and routing.

## License

Apache-2.0
