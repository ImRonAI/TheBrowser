import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DATA_DIR,
  EXECUTION_ENABLED,
  MAX_CONCURRENT_JOBS,
  PYTHON_BIN,
  SERVER_NAME,
  SERVER_VERSION,
} from "./unsloth/config.js";
import { JobManager } from "./unsloth/jobs.js";
import { listNotebooks, getNotebook } from "./unsloth/notebooks.js";
import { listHfModels } from "./unsloth/models.js";
import { resolveDataPath, runPythonCheck } from "./unsloth/python.js";

const FEATURES = [
  {
    name: "Fine-tuning and RL",
    details:
      "LoRA/QLoRA fine-tuning, preference optimization (DPO/ORPO/KTO), and GRPO/GSPO via notebooks and guides.",
    docs: "https://unsloth.ai/docs/get-started/fine-tuning-llms-guide",
  },
  {
    name: "Vision, TTS, Embeddings",
    details:
      "Vision fine-tuning, text-to-speech, speech-to-text, and embedding fine-tuning workflows.",
    docs: "https://unsloth.ai/docs/get-started/unsloth-notebooks",
  },
  {
    name: "Export and deployment",
    details: "Export to GGUF, vLLM, SGLang, and Hugging Face.",
    docs: "https://unsloth.ai/docs/basics/inference-and-deployment",
  },
  {
    name: "Hardware support",
    details: "Supports NVIDIA, AMD, and Intel GPUs with optimized kernels.",
    docs: "https://unsloth.ai/docs/get-started/install-and-update",
  },
];

const FRAMEWORKS = [
  {
    name: "Transformers + TRL",
    details: "Integrates with Hugging Face Transformers, TRL, and Trainer APIs.",
    docs: "https://github.com/unslothai/unsloth",
  },
  {
    name: "Notebooks (Colab/Kaggle)",
    details: "Curated notebooks for fine-tuning, RL, vision, and TTS.",
    docs: "https://github.com/unslothai/notebooks",
  },
  {
    name: "Reinforcement Learning",
    details: "DPO, ORPO, KTO, GRPO, GSPO workflows and guides.",
    docs: "https://unsloth.ai/docs/get-started/reinforcement-learning-rl-guide",
  },
];

const sftSchema = z.object({
  model_name: z.string().min(1),
  dataset: z.object({
    type: z.enum(["huggingface", "json"]),
    name: z.string().optional(),
    data_files: z.record(z.string()).optional(),
    split: z.string().optional(),
    text_field: z.string().optional(),
  }),
  output_dir: z.string().min(1),
  max_seq_length: z.number().optional(),
  load_in_4bit: z.boolean().optional(),
  use_gradient_checkpointing: z.union([z.boolean(), z.literal("unsloth")]).optional(),
  lora_rank: z.number().optional(),
  lora_alpha: z.number().optional(),
  lora_dropout: z.number().optional(),
  target_modules: z.array(z.string()).optional(),
  per_device_train_batch_size: z.number().optional(),
  gradient_accumulation_steps: z.number().optional(),
  warmup_steps: z.number().optional(),
  max_steps: z.number().optional(),
  learning_rate: z.number().optional(),
  logging_steps: z.number().optional(),
  seed: z.number().optional(),
  model_args: z.record(z.unknown()).optional(),
  lora_args: z.record(z.unknown()).optional(),
  trainer_args: z.record(z.unknown()).optional(),
  run: z.boolean().optional(),
  dry_run: z.boolean().optional(),
});

const generateSchema = z.object({
  model_path: z.string().min(1),
  prompt: z.string().min(1),
  max_new_tokens: z.number().optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  run: z.boolean().optional(),
  dry_run: z.boolean().optional(),
});

const exportSchema = z.object({
  model_path: z.string().min(1),
  output_path: z.string().min(1),
  export_format: z.enum(["huggingface"]),
  run: z.boolean().optional(),
  dry_run: z.boolean().optional(),
});

export const createServer = () => {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });
  const jobManager = new JobManager();

  server.tool(
    "server_info",
    "Get server configuration and runtime info",
    z.object({}),
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              name: SERVER_NAME,
              version: SERVER_VERSION,
              execution_enabled: EXECUTION_ENABLED,
              python_bin: PYTHON_BIN,
              data_dir: DATA_DIR,
              max_concurrent_jobs: MAX_CONCURRENT_JOBS,
              job_count: jobManager.listJobs().length,
            },
            null,
            2
          ),
        },
      ],
    })
  );

  server.tool(
    "check_installation",
    "Check Python dependencies for Unsloth workflows",
    z.object({}),
    async () => {
      const code = `
import json, importlib
modules = ["unsloth", "torch", "transformers", "datasets", "trl"]
results = {}
for name in modules:
    try:
        mod = importlib.import_module(name)
        version = getattr(mod, "__version__", "unknown")
        results[name] = {"installed": True, "version": version}
    except Exception as e:
        results[name] = {"installed": False, "error": str(e)}
print(json.dumps(results))
`;
      const result = await runPythonCheck(code);
      const payload = result.stdout.trim() || result.stderr.trim();
      return {
        content: [
          {
            type: "text",
            text: payload || "No output from Python.",
          },
        ],
      };
    }
  );

  server.tool(
    "list_frameworks",
    "List Unsloth-supported frameworks and guides",
    z.object({}),
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(FRAMEWORKS, null, 2),
        },
      ],
    })
  );

  server.tool(
    "list_features",
    "List Unsloth features and documentation links",
    z.object({}),
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(FEATURES, null, 2),
        },
      ],
    })
  );

  server.tool(
    "list_notebooks",
    "List Unsloth notebooks from the official repo",
    z.object({
      filter: z.string().optional(),
      limit: z.number().optional(),
    }),
    async ({ filter, limit }) => {
      const notebooks = await listNotebooks({ filter, limit });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(notebooks, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "get_notebook",
    "Fetch a specific notebook entry by filename",
    z.object({
      name: z.string(),
    }),
    async ({ name }) => {
      const notebook = await getNotebook(name);
      if (!notebook) {
        return {
          content: [
            {
              type: "text",
              text: `Notebook not found: ${name}`,
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(notebook, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "list_models",
    "List Unsloth models from the Hugging Face Hub",
    z.object({
      search: z.string().optional(),
      limit: z.number().optional(),
    }),
    async ({ search, limit }) => {
      const models = await listHfModels({ search, limit });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(models, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "create_sft_job",
    "Create a supervised fine-tuning job (LoRA/QLoRA) with Unsloth",
    sftSchema,
    async (input) => {
      const resolvedOutput = resolveDataPath(input.output_dir);
      const resolvedDataFiles =
        input.dataset.type === "json" && input.dataset.data_files
          ? Object.fromEntries(
              Object.entries(input.dataset.data_files).map(([key, value]) => [
                key,
                resolveDataPath(value),
              ])
            )
          : undefined;
      const config = {
        model: {
          name: input.model_name,
          max_seq_length: input.max_seq_length ?? 2048,
          load_in_4bit: input.load_in_4bit ?? true,
          use_gradient_checkpointing:
            input.use_gradient_checkpointing ?? "unsloth",
          model_args: input.model_args ?? {},
        },
        dataset: {
          type: input.dataset.type,
          name: input.dataset.name,
          data_files: resolvedDataFiles,
          split: input.dataset.split ?? "train",
          text_field: input.dataset.text_field ?? "text",
        },
        training: {
          output_dir: resolvedOutput,
          per_device_train_batch_size: input.per_device_train_batch_size ?? 2,
          gradient_accumulation_steps: input.gradient_accumulation_steps ?? 4,
          warmup_steps: input.warmup_steps ?? 10,
          max_steps: input.max_steps ?? 100,
          learning_rate: input.learning_rate ?? 2e-4,
          logging_steps: input.logging_steps ?? 1,
          seed: input.seed ?? 3407,
          lora_rank: input.lora_rank ?? 16,
          lora_alpha: input.lora_alpha ?? 16,
          lora_dropout: input.lora_dropout ?? 0,
          target_modules: input.target_modules,
          lora_args: input.lora_args ?? {},
          trainer_args: input.trainer_args ?? {},
        },
      };

      if (input.dataset.type === "huggingface" && !input.dataset.name) {
        throw new Error("dataset.name is required for huggingface datasets.");
      }
      if (input.dataset.type === "json" && !input.dataset.data_files) {
        throw new Error("dataset.data_files is required for json datasets.");
      }

      const job = await jobManager.createJob("sft", config, {
        run: input.run,
        dryRun: input.dry_run,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(job, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "create_generate_job",
    "Create a text generation job using a fine-tuned model",
    generateSchema,
    async (input) => {
      const config = {
        model_path: input.model_path,
        prompt: input.prompt,
        max_new_tokens: input.max_new_tokens ?? 256,
        temperature: input.temperature ?? 0.7,
        top_p: input.top_p ?? 0.9,
      };
      const job = await jobManager.createJob("generate", config, {
        run: input.run,
        dryRun: input.dry_run,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(job, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "create_export_job",
    "Create a model export job (Hugging Face format)",
    exportSchema,
    async (input) => {
      const resolvedOutput = resolveDataPath(input.output_path);
      const config = {
        model_path: input.model_path,
        output_path: resolvedOutput,
        export_format: input.export_format,
      };
      const job = await jobManager.createJob("export", config, {
        run: input.run,
        dryRun: input.dry_run,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(job, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "run_job",
    "Start a queued job by ID",
    z.object({ job_id: z.string() }),
    async ({ job_id }) => {
      const job = await jobManager.runJob(job_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(job, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "job_status",
    "Get status for a job",
    z.object({ job_id: z.string() }),
    async ({ job_id }) => {
      const job = jobManager.getJob(job_id);
      if (!job) {
        return {
          content: [
            {
              type: "text",
              text: `Job not found: ${job_id}`,
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(job, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "job_logs",
    "Read the last N lines of a job log",
    z.object({ job_id: z.string(), tail_lines: z.number().optional() }),
    async ({ job_id, tail_lines }) => {
      const logs = await jobManager.readLogs(job_id, tail_lines ?? 200);
      return {
        content: [
          {
            type: "text",
            text: logs,
          },
        ],
      };
    }
  );

  server.tool(
    "cancel_job",
    "Cancel a running or queued job",
    z.object({ job_id: z.string() }),
    async ({ job_id }) => {
      const job = await jobManager.cancelJob(job_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(job, null, 2),
          },
        ],
      };
    }
  );

  return { server, jobManager };
};
