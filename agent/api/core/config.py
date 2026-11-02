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
# Brave sells Suggest, Spellcheck and Answers as separate plans, each with its own subscription
# token (the Search plan returns 400 OPTION_NOT_IN_PLAN for them). Each falls back to the Search
# key so a single-plan account still works. Verified policies 2026-10-07: suggest/spellcheck
# "100;w=1" (100 req/s), answers "2;w=1" (2 req/s); all with no monthly cap.
BRAVE_SUGGEST_API_KEY = os.getenv("BRAVE_SUGGEST_API_KEY") or BRAVE_SEARCH_API_KEY
BRAVE_SPELLCHECK_API_KEY = os.getenv("BRAVE_SPELLCHECK_API_KEY") or BRAVE_SEARCH_API_KEY
BRAVE_ANSWERS_API_KEY = os.getenv("BRAVE_ANSWERS_API_KEY") or BRAVE_SEARCH_API_KEY
BRAVE_ASSIST_RPS = float(os.getenv("BRAVE_ASSIST_RPS", "20"))
BRAVE_ANSWERS_RPS = float(os.getenv("BRAVE_ANSWERS_RPS", "2"))
# Answers plan defaults (POST /chat/completions). `brave` is the documented quick model; the API's
# own default is `brave-pro`. Research mode can run for minutes, so it is opt-in per call.
BRAVE_ANSWERS_MODEL = os.getenv("BRAVE_ANSWERS_MODEL", "brave")
BRAVE_ANSWERS_TIMEOUT = float(os.getenv("BRAVE_ANSWERS_TIMEOUT", "120"))

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

# --- Live Music (Lyria RealTime) for the Live agent's music_* tools (core/live_music.py) ---
#: ``client.aio.live.music.connect(model=...)`` model resource name (experimental preview model).
LIVE_MUSIC_MODEL = os.getenv("RON_LIVE_MUSIC_MODEL", "models/lyria-realtime-exp")
#: google-genai http_options.api_version for the music client (BidiGenerateMusic is served on
#: v1alpha and v1beta; the official sample uses v1beta). Verified live 2026-10-06 on both.
LIVE_MUSIC_API_VERSION = os.getenv("RON_LIVE_MUSIC_API_VERSION", "v1beta")
#: RON_LIVE_MUSIC=0 removes the music_* tools and the Lyria skill from the Live agent.
LIVE_MUSIC_ENABLED = os.getenv("RON_LIVE_MUSIC", "1") != "0"
#: gemini-3.8-live-extended-thinking announces a tool call, never emits the toolCall frame, and either
#: says "a system error occurred" or stalls IN_PROGRESS (googleapis/python-genai#3015, reproduced on the
#: raw WebSocket with Google's own sample). The community workaround is one text nudge once the model is
#: idle; RON_LIVE_TOOL_NUDGE=0 disables it, the others bound how long IN_PROGRESS may stall and how often.
LIVE_TOOL_NUDGE_ENABLED = os.getenv("RON_LIVE_TOOL_NUDGE", "1") != "0"
#: When a Live thread ends with work pending (app closed, signed out, tunnel down, Live failure) the Chat agent
#: takes the same native session over on the cloud browser. RON_LIVE_TAKEOVER=0 disables the hand-off.
LIVE_TAKEOVER_ENABLED = os.getenv("RON_LIVE_TAKEOVER", "1") != "0"
LIVE_TOOL_NUDGE_STALL_SECONDS = float(os.getenv("RON_LIVE_TOOL_NUDGE_STALL_SECONDS", "12"))
LIVE_TOOL_NUDGE_MAX_PER_TURN = int(os.getenv("RON_LIVE_TOOL_NUDGE_MAX_PER_TURN", "2"))
#: Rolling take kept in memory per Live session for ``music_save`` (48 kHz stereo PCM16 = 192 KB/s;
#: 240 s = 46 MB, under Supabase Storage's default 50 MB per-file limit). Oldest audio is dropped when full.
LIVE_MUSIC_RECORD_SECONDS = float(os.getenv("RON_LIVE_MUSIC_RECORD_SECONDS", "240"))
#: Refuse uploads above this before contacting Storage (Supabase default global limit is 50 MB; raise both
#: this and the project/bucket limit together).
LIVE_MUSIC_MAX_UPLOAD_BYTES = int(float(os.getenv("RON_LIVE_MUSIC_MAX_UPLOAD_MB", "50")) * 1_000_000)
#: Supabase Storage bucket for saved takes (created private on first save if missing).
LIVE_MUSIC_BUCKET = os.getenv("RON_LIVE_MUSIC_BUCKET", "music")

# --- Batch music generation (core/music_generation.py): Lyria 3.5 via the Interactions API, ElevenLabs Music ---
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY") or os.getenv("XI_API_KEY")
#: One Lyria 3.5 song or ElevenLabs composition is a single blocking request (Lyria Clip measured ~93 s).
MUSIC_GENERATION_TIMEOUT = float(os.getenv("RON_MUSIC_GENERATION_TIMEOUT", "420"))
#: RON_MUSIC_GENERATION=0 removes the batch generation tools from every agent.
MUSIC_GENERATION_ENABLED = os.getenv("RON_MUSIC_GENERATION", "1") != "0"
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

# Host tools (installed strands_tools shell/editor/environment/http_request and the vendored
# library) gate every mutating action behind a prompt_toolkit "[y/*]" confirmation on stdin
# unless BYPASS_TOOL_CONSENT=true. The API has no TTY (systemd on the VPS, a detached npm
# script locally), so without the bypass each such call dies with
# "[Errno 22] Invalid argument" and every agent -- text, Live, issue, fixer -- reports an
# unexplained tool error. AGENTS.md already declares these tools unsandboxed host execution
# with agent output trusted, so the bypass is the only consistent policy. Set it in the
# process environment to opt out (RON_TOOL_CONSENT=prompt), e.g. for an interactive REPL.
if os.getenv("RON_TOOL_CONSENT", "bypass").lower() != "prompt":
    os.environ.setdefault("BYPASS_TOOL_CONSENT", "true")

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
