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
# NVIDIA NIM hosted endpoint (OpenAI-compatible chat completions): https://docs.api.nvidia.com/nim/reference/
NVIDIA_NIM_BASE_URL = os.getenv("NVIDIA_NIM_BASE_URL") or "https://integrate.api.nvidia.com/v1"
NIM_DEFAULT_MODEL = os.getenv("NIM_MODEL") or "z-ai/glm-5.3-flash"
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
# token (the Search plan returns 400 OPTION_NOT_IN_PLAN for them, so do not fall back to
# BRAVE_SEARCH_API_KEY). Verified policies 2026-10-07: suggest/spellcheck "100;w=1" (100 req/s),
# answers "2;w=1" (2 req/s); all with no monthly cap.
BRAVE_SUGGEST_API_KEY = os.getenv("BRAVE_SUGGEST_API_KEY")
BRAVE_SPELLCHECK_API_KEY = os.getenv("BRAVE_SPELLCHECK_API_KEY")
BRAVE_ANSWERS_API_KEY = os.getenv("BRAVE_ANSWERS_API_KEY")
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


def perplexity_agent_api_enabled() -> bool:
    """True unless RON_PERPLEXITY_AGENT_API is set to '0'."""
    return os.getenv("RON_PERPLEXITY_AGENT_API", "1") != "0"


def perplexity_search_enabled() -> bool:
    """True unless RON_PERPLEXITY_SEARCH is set to '0'."""
    return os.getenv("RON_PERPLEXITY_SEARCH", "1") != "0"

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
# --- Run stall watchdog / agent respawn (`core/panel_runtime.py`, wired in `endpoints/chat.py`) ---
#: No-activity window (seconds) before the watchdog cancels the wedged run and respawns a fresh
#: agent instance on the same native session (ThreadSessionManager restore + a durable
#: "[recovery]" user turn). 0 disables the watchdog. Tools emit no events while executing, so a
#: tool call in flight gets the longer PANEL_RUN_TOOL_STALL_SECONDS window instead.
PANEL_RUN_STALL_SECONDS = float(os.getenv("PANEL_RUN_STALL_SECONDS", "120"))
#: Silent-tool-execution window (seconds); must exceed the longest bounded silent tool
#: (song generation, RON_MUSIC_GENERATION_TIMEOUT=420) so it is never a false positive.
PANEL_RUN_TOOL_STALL_SECONDS = float(os.getenv("PANEL_RUN_TOOL_STALL_SECONDS", "480"))
#: Consecutive automatic recoveries (no tool call completed in between) before the run fails with
#: its error; the session stays open and the next message continues from the saved conversation.
PANEL_RUN_MAX_RECOVERIES = int(os.getenv("PANEL_RUN_MAX_RECOVERIES", "2"))
#: Share of the model's real context window at which the native SummarizingConversationManager
#: compresses the conversation before a model call (its ``compression_threshold``; SDK default 0.7).
PANEL_CONTEXT_COMPRESSION_THRESHOLD = float(os.getenv("PANEL_CONTEXT_COMPRESSION_THRESHOLD", "0.87"))
# --- Harness builtin plugins on the panel agent (`core/panel_agent.py`) ---
#: Todos: native todo_write task list kept in agent.state — session-snapshotted, re-injected
#: before every model call, and restored into the respawned instance after a stall recovery.
PANEL_TODOS = os.getenv("PANEL_TODOS", "1") != "0"
#: EnvironmentContext: platform/date/cwd/AGENTS.md injected before each user turn (harness builtin).
PANEL_ENVIRONMENT_CONTEXT = os.getenv("PANEL_ENVIRONMENT_CONTEXT", "1") != "0"
#: Build Agent workspaces (`core/build_workspace.py`): one private project directory per (user, session),
#: ``<RON_BUILD_ROOT>/<sha256(user_id \n session_id)[:32]>``. Read per call, so tests can repoint it.
RON_BUILD_ROOT = Path(os.getenv("RON_BUILD_ROOT", "~/.ron/build")).expanduser()
#: Optional interventions gate ("ask" | "smart" | natural-language policy | .cedar path), resolved
#: with strands_harness.resolve_interventions onto Agent(interventions=...). Default off: an
#: interrupt-based approval gate parks unattended runs.
PANEL_INTERVENTIONS = os.getenv("PANEL_INTERVENTIONS", "").strip()
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
    # The installed `shell` tool runs every command in a PTY (`pty.fork`) and the child inherits this
    # environment. With a terminal attached, git log/diff/show, man and friends start a pager, git may
    # open an editor or ask for credentials, and each waits for a keypress nobody will press until
    # SHELL_DEFAULT_TIMEOUT (900 s): a Build run hung on `git commit ... && git log --oneline`.
    # Agents read output; nothing in their shells pages, edits or prompts.
    os.environ.update({"PAGER": "cat", "GIT_PAGER": "cat", "GIT_EDITOR": "true", "GIT_TERMINAL_PROMPT": "0"})

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

# --- Memory (core/memory.py): native FileMemoryStores, search_memory/add_memory, userTurn injection ---
#: Perplexity Agent API model for the panel Agent's native aux_model, which runs the `facts`
#: store's ModelExtractor (verified in GET /v1/models 2026-10-26).
DEFAULT_MEMORY_MODEL = "google/gemini-3.5-flash-lite"

# --- Media intake (core/media_understanding.py, core/media_capabilities.py) ---
#: `<provider>/<model id>` that looks at media for a lead model that cannot see images (`understand_media`).
#: GLM 5.3 Flash on Mistral: input "text, image" (docs.mistral.ai/models/zai-glm-5-3-flash), `capabilities.vision`
#: true in GET /v1/models. A multimodal lead never uses it: it gets `view_media` and looks itself.
RON_MEDIA_MODEL = os.getenv("RON_MEDIA_MODEL", "mistral/zai-glm-5-3-flash")
#: Still frames sampled from a video (ffmpeg). Mistral vision accepts at most 8 images per request
#: (docs.mistral.ai/studio/conversations/vision).
RON_MEDIA_MAX_FRAMES = max(1, int(os.getenv("RON_MEDIA_MAX_FRAMES", "8")))

# --- Prompt attachments (core/prompt_attachments.py, POST /attachments/title) ---
#: Mistral model that names a pasted prompt's attachment card (the v0-clone-blurple PASTE_TITLE_MODEL).
RON_ATTACHMENT_TITLE_MODEL = os.getenv("RON_ATTACHMENT_TITLE_MODEL", "zai-glm-5-3-flash")
#: Its reasoning effort ("" = the model's default). GLM 5.3 Flash reasons by default and spent the whole
#: 64-token title budget thinking (live 2026-11-09: 0 text tokens); at `low` it answers in ~10 tokens, <2 s.
RON_ATTACHMENT_TITLE_EFFORT = os.getenv("RON_ATTACHMENT_TITLE_EFFORT", "low") or None
#: Seconds before the card keeps the name the panel gave it.
RON_ATTACHMENT_TITLE_TIMEOUT = float(os.getenv("RON_ATTACHMENT_TITLE_TIMEOUT", "8"))

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
#: Model provider for the Strands Harness search agent (follow-up conversation) and the shopping
#: agent (default: NVIDIA NIM). The first answer to a query is Brave Answers, not this model.
RON_SEARCH_PROVIDER = os.getenv("RON_SEARCH_PROVIDER", "nim").strip().lower() or "nim"
#: Search agent model id (default: GLM-5.3-Flash on NIM).
RON_SEARCH_AGENT_MODEL = os.getenv("RON_SEARCH_AGENT_MODEL", "z-ai/glm-5.3-flash")
#: Shopping agent model id (default: GLM-5.3-Flash on NIM).
RON_SEARCH_SHOPPING_MODEL = os.getenv("RON_SEARCH_SHOPPING_MODEL", "z-ai/glm-5.3-flash")
#: Default search level when the client omits one (see search_agent.SEARCH_LEVELS).
RON_SEARCH_DEFAULT_LEVEL = os.getenv("RON_SEARCH_DEFAULT_LEVEL", "low")
#: Optional domain allowlist; defaults to [] (unrestricted online + brick-and-mortar search).
RON_SEARCH_SHOPPING_DOMAINS = [
    d.strip().lower()
    for d in os.getenv("RON_SEARCH_SHOPPING_DOMAINS", "").split(",")
    if d.strip()
]
#: Directory for persistent Strands Harness search sessions (SnapshotSessionManager + offloaded context).
SEARCH_SESSIONS_DIR = SESSION_STORAGE_DIR / "search-sessions"
SEARCH_SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
