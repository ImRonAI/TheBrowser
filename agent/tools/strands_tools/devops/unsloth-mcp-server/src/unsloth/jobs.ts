import { randomUUID } from "crypto";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import {
  EXECUTION_ENABLED,
  HF_TOKEN,
  JOBS_DIR,
  LOGS_DIR,
  MAX_CONCURRENT_JOBS,
} from "./config.js";
import { ensureDataDirs, spawnPythonScript } from "./python.js";

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "dry_run";

export type JobType = "sft" | "generate" | "export";

export type JobRecord = {
  id: string;
  type: JobType;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  configPath: string;
  logPath: string;
  exitCode?: number | null;
  error?: string;
};

export class JobManager {
  private jobs = new Map<string, JobRecord>();
  private processes = new Map<string, ReturnType<typeof spawnPythonScript>>();
  private queue: string[] = [];
  private initialized = false;

  async init() {
    if (this.initialized) {
      return;
    }
    await ensureDataDirs();
    this.initialized = true;
  }

  listJobs() {
    return Array.from(this.jobs.values());
  }

  getJob(id: string) {
    return this.jobs.get(id) ?? null;
  }

  async createJob(
    type: JobType,
    config: Record<string, unknown>,
    options?: { run?: boolean; dryRun?: boolean }
  ) {
    const id = randomUUID();
    const configPath = path.join(JOBS_DIR, `${id}.json`);
    const logPath = path.join(LOGS_DIR, `${id}.log`);

    await fsPromises.writeFile(configPath, JSON.stringify(config, null, 2));
    await fsPromises.writeFile(logPath, "");

    const record: JobRecord = {
      id,
      type,
      status: "queued",
      createdAt: new Date().toISOString(),
      configPath,
      logPath,
    };

    this.jobs.set(id, record);

    if (options?.dryRun) {
      record.status = "dry_run";
      return record;
    }

    if (options?.run) {
      if (!EXECUTION_ENABLED) {
        record.status = "dry_run";
        record.error =
          "Execution disabled. Set UNSLOTH_EXECUTION=true to enable running jobs.";
        return record;
      }
      this.queue.push(id);
      await this.tryStartNext();
    }

    return record;
  }

  async runJob(id: string) {
    const record = this.jobs.get(id);
    if (!record) {
      throw new Error(`Job ${id} not found.`);
    }
    if (record.status === "running") {
      return record;
    }
    if (!EXECUTION_ENABLED) {
      record.status = "dry_run";
      record.error =
        "Execution disabled. Set UNSLOTH_EXECUTION=true to enable running jobs.";
      return record;
    }
    if (!this.queue.includes(id)) {
      this.queue.push(id);
    }
    await this.tryStartNext();
    return record;
  }

  async cancelJob(id: string) {
    const record = this.jobs.get(id);
    if (!record) {
      throw new Error(`Job ${id} not found.`);
    }

    const process = this.processes.get(id);
    if (process) {
      process.kill("SIGTERM");
      this.processes.delete(id);
    }

    this.queue = this.queue.filter((jobId) => jobId !== id);
    record.status = "cancelled";
    record.finishedAt = new Date().toISOString();
    return record;
  }

  async readLogs(id: string, tailLines = 200) {
    const record = this.jobs.get(id);
    if (!record) {
      throw new Error(`Job ${id} not found.`);
    }
    const content = await fsPromises.readFile(record.logPath, "utf-8");
    const lines = content.split(/\r?\n/);
    return lines.slice(Math.max(0, lines.length - tailLines)).join("\n");
  }

  async shutdown() {
    for (const [id, process] of this.processes.entries()) {
      try {
        process.kill("SIGTERM");
      } catch {
        // ignore
      }
      const record = this.jobs.get(id);
      if (record && record.status === "running") {
        record.status = "cancelled";
        record.finishedAt = new Date().toISOString();
      }
    }
    this.processes.clear();
    this.queue = [];
  }

  private async tryStartNext() {
    const running = Array.from(this.jobs.values()).filter(
      (job) => job.status === "running"
    ).length;
    if (running >= MAX_CONCURRENT_JOBS) {
      return;
    }

    const nextId = this.queue.shift();
    if (!nextId) {
      return;
    }
    await this.startJob(nextId);
  }

  private async startJob(id: string) {
    const record = this.jobs.get(id);
    if (!record) {
      return;
    }

    const runnerPath = path.resolve(process.cwd(), "python", "runner.py");
    if (!fs.existsSync(runnerPath)) {
      record.status = "failed";
      record.error = "Runner script not found.";
      record.finishedAt = new Date().toISOString();
      return;
    }

    record.status = "running";
    record.startedAt = new Date().toISOString();

    const logStream = fs.createWriteStream(record.logPath, { flags: "a" });
    const child = spawnPythonScript(runnerPath, [
      "--mode",
      record.type,
      "--config",
      record.configPath,
    ], {
      env: {
        ...process.env,
        HUGGINGFACE_TOKEN: HF_TOKEN,
      },
    });

    this.processes.set(id, child);

    child.stdout.on("data", (chunk) => {
      logStream.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      logStream.write(chunk);
    });

    child.on("close", (exitCode) => {
      record.exitCode = exitCode;
      record.finishedAt = new Date().toISOString();
      record.status = exitCode === 0 ? "succeeded" : "failed";
      this.processes.delete(id);
      logStream.end();
      void this.tryStartNext();
    });
  }
}
