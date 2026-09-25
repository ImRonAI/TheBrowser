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
