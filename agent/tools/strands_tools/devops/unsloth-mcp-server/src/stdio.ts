#!/usr/bin/env node
import dotenv from "dotenv";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./create-server.js";

dotenv.config();

const { server, jobManager } = createServer();

const run = async () => {
  await jobManager.init();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Unsloth MCP server running on stdio");
};

run().catch((error) => {
  console.error("Failed to start stdio server:", error);
  process.exit(1);
});

process.on("SIGINT", async () => {
  try {
    await jobManager.shutdown();
    await server.close();
  } catch (error) {
    console.error("Error during shutdown:", error);
  }
  process.exit(0);
});
