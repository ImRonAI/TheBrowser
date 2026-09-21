# Ron Browser Rebuild - Global Agent Runbook

Welcome! This repository is a clean rebuild of the Ron Browser application. It runs a local-first browser layout powered by Electron and React, and leverages `electron-playwright-mcp` for agentic tab control and browser automation.

## Developer Commands

```bash
# Install dependencies
npm install

# Run in development mode (starts Electron + Python API concurrently)
npm run dev

# Run Vite dev server for frontend
npm run dev:vite

# Run Python agent backend
npm run dev:backend

# Build the Electron package
npm run build

# Type check
npm run typecheck
```

## Important: ELECTRON_RUN_AS_NODE

The parent shell may have `ELECTRON_RUN_AS_NODE=1` exported. The npm scripts explicitly unset it so that the Electron binary launches in app mode. If you run Electron manually, use:

```bash
unset ELECTRON_RUN_AS_NODE
./node_modules/.bin/electron .
```

## Environment Setup (.env)

Create a `.env` file in the root directory:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_SUPABASE_PROJECT_ID=your_supabase_project_id
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_service_key
PERPLEXITY_API_KEY=your_perplexity_key
NVIDIA_NIM_API_KEY=your_nvidia_nim_key
OPENAI_API_KEY=your_openai_key
GOOGLE_API_KEY=your_google_key
```

## MCP Client Configuration

Use `mcp.json` to connect Claude Desktop / Cursor / Cline to the running Electron app:

```json
{
  "mcpServers": {
    "electron-playwright-mcp": {
      "command": "/Users/tims-stuff/RonBrowserRebuild/venv/bin/electron-playwright-mcp",
      "env": {
        "ELECTRON_PLAYWRIGHT_MCP_ELECTRON_URL": "http://localhost:3000/electron",
        "ELECTRON_PLAYWRIGHT_MCP_PLAYWRIGHT_URL": "http://localhost:8931/mcp",
        "ELECTRON_PLAYWRIGHT_MCP_CDP_URL": "http://localhost:9222"
      }
    }
  }
}
```

Start the Electron app first, then the MCP server can drive browser tabs via the HTTP/CDP endpoints.
