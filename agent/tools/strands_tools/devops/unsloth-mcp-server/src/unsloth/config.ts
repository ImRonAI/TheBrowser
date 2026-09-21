import path from "path";

export const SERVER_NAME = "unsloth-mcp";
export const SERVER_VERSION = "2.0.0";

export const DATA_DIR = path.resolve(
  process.env.UNSLOTH_DATA_DIR ?? path.join(process.cwd(), "data")
);
export const JOBS_DIR = path.join(DATA_DIR, "jobs");
export const LOGS_DIR = path.join(DATA_DIR, "logs");
export const SCRIPTS_DIR = path.join(DATA_DIR, "scripts");

export const PYTHON_BIN = process.env.UNSLOTH_PYTHON || "python3";
export const EXECUTION_ENABLED = process.env.UNSLOTH_EXECUTION === "true";
export const MAX_CONCURRENT_JOBS = Number.parseInt(
  process.env.UNSLOTH_MAX_CONCURRENT_JOBS || "1",
  10
);
export const ALLOW_ABSOLUTE_PATHS =
  process.env.UNSLOTH_ALLOW_ABSOLUTE_PATHS === "true";

export const HF_TOKEN =
  process.env.HUGGINGFACE_TOKEN || process.env.HF_TOKEN || "";
export const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
