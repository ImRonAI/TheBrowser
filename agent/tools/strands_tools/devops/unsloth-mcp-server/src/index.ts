import dotenv from "dotenv";
import express, { Request, Response } from "express";
import cors from "cors";
import path from "path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./create-server.js";

dotenv.config();
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(process.cwd(), "public")));
app.use(
  cors({
    origin: true,
    methods: "*",
    allowedHeaders: "Authorization, Origin, Content-Type, Accept, *",
  })
);
app.options("*", cors());

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
});

app.post("/mcp", async (req: Request, res: Response) => {
  try {
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

const methodNotAllowed = (req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed.",
    },
    id: null,
  });
};

app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

const { server, jobManager } = createServer();

const setupServer = async () => {
  await jobManager.init();
  await server.connect(transport);
};

setupServer()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Unsloth MCP server listening on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });

process.on("SIGINT", async () => {
  console.log("Shutting down server...");
  try {
    await transport.close();
  } catch (error) {
    console.error("Error closing transport:", error);
  }

  try {
    await jobManager.shutdown();
    await server.close();
  } catch (error) {
    console.error("Error closing server:", error);
  }

  process.exit(0);
});
