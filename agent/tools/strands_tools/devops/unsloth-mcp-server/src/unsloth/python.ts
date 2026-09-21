import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import {
  ALLOW_ABSOLUTE_PATHS,
  DATA_DIR,
  JOBS_DIR,
  LOGS_DIR,
  PYTHON_BIN,
  SCRIPTS_DIR,
} from "./config.js";

export const ensureDataDirs = async () => {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(JOBS_DIR, { recursive: true });
  await fs.mkdir(LOGS_DIR, { recursive: true });
  await fs.mkdir(SCRIPTS_DIR, { recursive: true });
};

export const resolveDataPath = (requestedPath: string) => {
  if (!requestedPath) {
    throw new Error("Path is required.");
  }
  if (path.isAbsolute(requestedPath)) {
    if (!ALLOW_ABSOLUTE_PATHS) {
      throw new Error(
        "Absolute paths are disabled. Set UNSLOTH_ALLOW_ABSOLUTE_PATHS=true to allow them."
      );
    }
    return requestedPath;
  }
  return path.join(DATA_DIR, requestedPath);
};

export const runPythonCheck = async (code: string) => {
  return await new Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }>((resolve) => {
    const child = spawn(PYTHON_BIN, ["-c", code], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
};

export const spawnPythonScript = (
  scriptPath: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv }
) => {
  return spawn(PYTHON_BIN, [scriptPath, ...args], {
    cwd: options?.cwd,
    env: options?.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
};
