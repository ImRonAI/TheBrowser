import os
from pathlib import Path
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / ".env")

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",")
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8765"))

# Anchored to REPO_ROOT so session history does not depend on the process CWD.
SESSION_STORAGE_DIR = Path(
    os.getenv("SESSION_STORAGE_DIR", str(REPO_ROOT / ".sessions"))
)

# Model keys for the Agent Panel providers: Perplexity, Mistral, xAI, Gemini.
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or GOOGLE_API_KEY
NVIDIA_NIM_API_KEY = os.getenv("NVIDIA_NIM_API_KEY")
PERPLEXITY_API_KEY = os.getenv("PERPLEXITY_API_KEY")
MISTRAL_API_KEY = os.getenv("MISTRAL_API_KEY")

# Brave Search API (Discover homepage feed: web/news/images/videos/places,
# suggest/spellcheck, local POIs/descriptions, rich search). Backend-only:
# the renderer must never receive this key (no VITE_* mirror).
BRAVE_SEARCH_API_KEY = os.getenv("BRAVE_SEARCH_API_KEY")
BRAVE_SEARCH_BASE_URL = "https://api.search.brave.com/res/v1"
# Client-side ceiling for the shared token bucket. Verified plan policy is
# 50 req/s with no monthly cap (x-ratelimit-policy "50;w=1, 0;w=2592000").
BRAVE_SEARCH_RPS = float(os.getenv("BRAVE_SEARCH_RPS", "10"))

# Perplexity Agent API. GET /v1/models is the model catalogue that backs the
# picker; POST /v1/responses runs a turn (OpenAI Responses wire format).
# Verified live 2026-08-09: /v1/models returns 39 ids. This is PINNED, not
# env-driven: the /router Gateway host is NOT the Agent API (it 403s /v1/models
# and serves a reduced catalogue), and an inherited shell export of
# PERPLEXITY_BASE_URL=<...>/router previously poisoned this value at runtime.
PERPLEXITY_BASE_URL = "https://api.perplexity.ai"
PERPLEXITY_MODELS_URL = f"{PERPLEXITY_BASE_URL}/v1/models"

# OpenAI-SDK style base_url: the SDK appends "/responses", so this must end at
# "/v1" to resolve to POST /v1/responses.
PERPLEXITY_API_BASE_URL = f"{PERPLEXITY_BASE_URL}/v1"

# Direct Responses endpoint, used by the reasoning-effort validation probes.
PERPLEXITY_RESPONSES_URL = f"{PERPLEXITY_BASE_URL}/v1/responses"

PERPLEXITY_MAX_OUTPUT_TOKENS = int(os.getenv("PERPLEXITY_MAX_OUTPUT_TOKENS", "128000"))

# Default catalogue model for the Agent Panel picker. Must be a full
# provider/model id from GET /v1/models.
PERPLEXITY_DEFAULT_MODEL = os.getenv("PERPLEXITY_MODEL") or "xai/grok-4.5"

# xAI native provider (strands-xai). Distinct from Perplexity catalogue ids
# such as "xai/grok-4.5", which still route through the Agent API.
XAI_API_KEY = os.getenv("XAI_API_KEY")
XAI_MODEL = os.getenv("XAI_MODEL", "grok-4.5")
XAI_DEFAULT_MODEL = XAI_MODEL

# Gemini AI Studio / Mistral defaults from the Strands provider docs.
GEMINI_DEFAULT_MODEL = os.getenv("GEMINI_MODEL") or "gemini-flash-latest"
MISTRAL_DEFAULT_MODEL = os.getenv("MISTRAL_MODEL") or "mistral-large-latest"

XAI_CONTEXT_WINDOW_LIMIT = int(os.getenv("XAI_CONTEXT_WINDOW_LIMIT", "500000"))

# "none" | "low" | "medium" | "high"
XAI_REASONING_EFFORT = os.getenv("XAI_REASONING_EFFORT", "high")

XAI_NATIVE_TOOLS_ENABLED = os.getenv("XAI_NATIVE_TOOLS_ENABLED", "true").lower() == "true"

# Comma-separated collection ids for collections_search.
XAI_COLLECTION_IDS = [
    c.strip() for c in os.getenv("XAI_COLLECTION_IDS", "").split(",") if c.strip()
]

# xai_sdk binds its tracer at import time and emits a duplicate chat.stream span,
# so this must be set before xai_sdk is first imported.
os.environ.setdefault("XAI_SDK_DISABLE_TRACING", "1")

# Model overrides
PERPLEXITY_MODEL = os.getenv("PERPLEXITY_MODEL")

# Bedrock Knowledge Base memory.
# strands_tools.memory reads STRANDS_KNOWLEDGE_BASE_ID and strands_tools.retrieve reads
# KNOWLEDGE_BASE_ID directly from os.environ, so both are exported back into the process
# environment here. This is SDK-native configuration, not a wrapper.
STRANDS_KNOWLEDGE_BASE_ID = os.getenv("STRANDS_KNOWLEDGE_BASE_ID") or os.getenv(
    "AWS_BEDROCK_KB_ID"
)
if STRANDS_KNOWLEDGE_BASE_ID:
    os.environ.setdefault("STRANDS_KNOWLEDGE_BASE_ID", STRANDS_KNOWLEDGE_BASE_ID)
    os.environ.setdefault("KNOWLEDGE_BASE_ID", STRANDS_KNOWLEDGE_BASE_ID)

# Optional AWS credentials for the Bedrock-backed code interpreter
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")

# Browser / sandbox
AGENT_SANDBOX_ROOT = Path(os.getenv("RON_AGENT_SANDBOX_ROOT", str(Path.home() / ".ronbrowser" / "sandbox")))
AGENT_SANDBOX_ROOT.mkdir(parents=True, exist_ok=True)

# --- Memory: journal (add_memory) + dreaming (native extraction) + everyTurn injection + recall ---
#: Perplexity Agent API model chain of the `recall` subagent (ModelRouter/FallbackStrategy); the
#: first id is also the panel Agent's native aux_model, which runs the dreaming extraction.
RON_MEMORY_AGENT_MODELS = os.getenv("RON_MEMORY_AGENT_MODELS",
    "google/gemini-3.5-flash-lite,openai/gpt-5.4-nano,perplexity/sonar,perplexity/nemotron-3-ultra-550b-a55b")
#: RON_MEMORY_AGENT=0 drops the `recall` tool (memory_agent.RecallConfig.from_env).
RON_MEMORY_AGENT = os.getenv("RON_MEMORY_AGENT", "1") != "0"

# --- Tool repair (CAT-50/51): per-user fixer over sandboxed verification ---
#: RON_TOOL_REPAIR=0 disables the repair trigger, endpoints stay inert (tool_repair.RepairConfig).
RON_TOOL_REPAIR = os.getenv("RON_TOOL_REPAIR", "1") != "0"
#: Same (tool, exception class) failures in one live session before a repair is proposed.
RON_TOOL_REPAIR_THRESHOLD = int(os.getenv("RON_TOOL_REPAIR_THRESHOLD", "2"))
#: Perplexity Agent API model(s) of the fixer: a strong coding model at maximum reasoning effort.
#: Comma list = FallbackStrategy order; the effort applies to every candidate.
RON_TOOL_REPAIR_MODELS = os.getenv("RON_TOOL_REPAIR_MODELS", "openai/gpt-6.1-sol")
RON_TOOL_REPAIR_EFFORT = os.getenv("RON_TOOL_REPAIR_EFFORT", "max")
#: Perplexity Agent API server-side tools on the fixer's model (docs.perplexity.ai/docs/agent-api/tools):
#: built-ins by `type`, plus the managed GitHub connector (`{"type": "connector", "id": "connector_github"}`,
#: must be connected on the Perplexity Project connectors page) and Context7's remote MCP server
#: (`{"type": "mcp", "server_url": ...}`, Streamable HTTP; `CONTEXT7_API_KEY` is sent as `authorization`).
RON_TOOL_REPAIR_HOSTED_TOOLS = os.getenv("RON_TOOL_REPAIR_HOSTED_TOOLS",
                                         "web_search,fetch_url,image_search,sandbox,connector_github,context7")
CONTEXT7_MCP_URL = os.getenv("CONTEXT7_MCP_URL", "https://mcp.context7.com/mcp")
CONTEXT7_API_KEY = os.getenv("CONTEXT7_API_KEY", "")
#: Extra A2A peers for the fixer only (every agent already gets a2a_tools.a2a_agent_urls()).
RON_TOOL_REPAIR_A2A_AGENTS = os.getenv("RON_TOOL_REPAIR_A2A_AGENTS", "")

# --- A2A (`core/a2a_tools.py`, `core/panel_a2a.py`) ---
#: PANEL_A2A_ENABLED (default on) mounts Ron's native A2AServer at PANEL_A2A_URL
#: (default http://127.0.0.1:<API_PORT>/a2a) and gives EVERY Ron agent the installed strands_tools
#: A2AClientToolProvider tools over that server plus RON_A2A_AGENTS (comma list of HTTP(S) URLs).
RON_A2A_AGENTS = os.getenv("RON_A2A_AGENTS", "")
#: Wall-clock bound of one fixer run (seconds).
RON_TOOL_REPAIR_TIMEOUT_S = int(os.getenv("RON_TOOL_REPAIR_TIMEOUT_S", "900"))

# --- Browser search (`endpoints/search.py`, `core/search_agent.py`) ---
#: Every search runs the Perplexity Agent API with preset=<level> and this model
#: override. Must be a full provider/model id from GET /v1/models.
RON_SEARCH_AGENT_MODEL = os.getenv("RON_SEARCH_AGENT_MODEL", "openai/gpt-6.1-sol")
#: Shopping section model: no preset; tools restricted to web_search (domain-
#: filtered), fetch_url and image_search.
RON_SEARCH_SHOPPING_MODEL = os.getenv("RON_SEARCH_SHOPPING_MODEL", "openai/gpt-6-luna")
#: Default search level when the client omits one (see search_agent.SEARCH_LEVELS).
RON_SEARCH_DEFAULT_LEVEL = os.getenv("RON_SEARCH_DEFAULT_LEVEL", "low")
#: Domains the shopping agent's web_search is restricted to (Agent API caps
#: search_domain_filter at 20 entries).
RON_SEARCH_SHOPPING_DOMAINS = [
    d.strip().lower()
    for d in os.getenv(
        "RON_SEARCH_SHOPPING_DOMAINS",
        "amazon.com,target.com,walmart.com,kohls.com,macys.com,ebay.com,etsy.com,"
        "bestbuy.com,nordstrom.com,zappos.com,asos.com,gap.com,uniqlo.com,hm.com,"
        "nike.com,adidas.com,wayfair.com,sephora.com,ulta.com,lego.com",
    ).split(",")
    if d.strip()
][:20]
