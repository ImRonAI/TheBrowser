# Phase 5: System Prompt Optimization - Implementation Guide

**Context**: This document provides comprehensive instructions for reducing the SuperAgent system prompt from 26,224 characters (~6,500 tokens) to a more efficient structure using Strands SDK SOPs (Standard Operating Procedures) and a tool index.

**Why this matters**: Even with prompt caching, a 6,500 token system prompt costs ~1,625 tokens after caching. Reducing to ~2,000 tokens would save ~500 tokens per cached request.

## Current State Analysis

### Current System Prompt Structure
Location: `/agent/superagent.py` lines 211-715 (504 lines, 26,224 characters)

**Content breakdown**:
1. **Browser Automation Instructions** (~150 lines)
   - Playwright/Electron MCP Server configuration
   - 5 different connection modes with full argument lists
   - Security defaults
   - 4-step interaction protocol (Navigate → Screenshot → Execute → Verify)
   - Data collection guidelines

2. **Tool-Specific Instructions** (~200 lines)
   - MCP client usage patterns
   - Multi-agent orchestration (workflow, swarm, graph)
   - Memory management (mem0)
   - Task management instructions
   - File operations
   - HTTP request guidelines

3. **Operational Rules** (~100 lines)
   - Error handling protocols
   - Rate limiting
   - Retry strategies
   - Session management

4. **Context & Constraints** (~50 lines)
   - User context awareness
   - Security constraints
   - Performance guidelines

### Currently Loaded Tools (Always Available)
From `superagent.py` lines 997-1018:

**Meta-tooling** (3 tools):
- `load_tool` - Dynamic tool loading
- `sandbox_tools.shell` - Shell command execution
- `sandbox_tools.editor` - File editing

**Multi-agent orchestration** (5 tools):
- `use_agent` - Spawn sub-agents
- `workflow` - Sequential agent workflows
- `swarm` - Autonomous multi-agent coordination
- `graph` - DAG-based agent orchestration
- `think` - Extended reasoning/planning

**Core utilities** (8 tools):
- `http_request` - HTTP client
- `sandbox_tools.file_read` - Read files
- `sandbox_tools.file_write` - Write files
- `environment` - Environment variable access
- `mcp_client` - MCP server communication
- `mem0_memory` - Long-term memory storage
- `stop` - Halt execution
- `sleep` - Delay execution
- `image_reader` - Vision/screenshot analysis

**Browser execution** (1 tool):
- `browser.browser` - Local Chromium browser automation

**Task Management** (6 tools):
- `task_tools.create_task` - Create Supabase tasks
- `task_tools.update_task` - Update task state
- `task_tools.add_file_reference` - Link files to tasks
- `task_tools.search_tasks` - Query tasks
- `task_tools.get_task` - Fetch task details
- `task_tools.add_relationship` - Create task relationships

**MCP server management** (3 tools):
- `load_mcp_server` - Connect to MCP servers
- `load_openapi_server` - Load OpenAPI specs as tools
- `unload_mcp_server` - Disconnect MCP servers

**A2A** (1+ tools):
- `A2AClientToolProvider` - Agent-to-Agent protocol tools

**Total**: 27+ always-available tools

### MCP Servers Available (Dynamically Loaded)
From `superagent.py` lines 63-79:

1. **telnyx** - Voice/SMS API
2. **datacommons** - Public data API
3. **cms-coverage** - Medicare/Medicaid coverage API
4. **playwright** - Browser automation (Electron mode)
5. **pophive** - Population health data
6. **healthcare** - Healthcare data API
7. **agent-sops** - Agent SOP management

## Strands SDK SOP Recommendations

**From DeepWiki research**: Strands SDK uses separate Markdown files for SOPs, structured as:

```markdown
# [Agent Name] SOP

## Role
Brief description of agent's purpose and goal

## Steps
### 1. [Step Name]
Description of step

**Constraints:**
- MUST/SHOULD/MAY requirements
- Specific limitations

### 2. [Next Step]
...

## Best Practices
- General guidelines
- Repository-specific instructions
```

**SOPs are loaded by**: `strands-agent-runner` action which takes `system_prompt` input pointing to SOP file location.

**For this project**: Since we're not using GitHub Actions, we'll:
1. Create SOP files in `/agent/sops/` directory
2. Load SOP content and inject as system_prompt in `create_superagent()`

## Phase 5 Implementation Plan

### Step 1: Create Core SOP File
**File**: `/agent/sops/superagent-core.sop.md`

**Content structure**:
```markdown
# Ron Superagent Core SOP

## Role
You are Ron Superagent, a powerful orchestration agent built on Strands SDK. Your purpose is to coordinate multi-agent workflows, manage browser automation, maintain user context, and execute complex tasks using available tools and MCP servers.

## Core Principles
- Always verify browser state with screenshots before actions
- Use appropriate MCP servers for specialized tasks
- Maintain conversation context and user preferences
- Follow sequential execution for uncertain actions

## Workflow Patterns
### Browser Automation
See: TOOL_INDEX.md → browser.browser

### Multi-Agent Orchestration
See: TOOL_INDEX.md → workflow, swarm, graph

### Memory & Context
See: TOOL_INDEX.md → mem0_memory

## Constraints
- MUST verify browser state with image_reader before uncertain actions
- MUST use Playwright MCP as primary browser automation tool
- MUST preserve user context across sessions
- SHOULD prefer specialized MCP servers over direct HTTP requests
- MAY load additional tools dynamically via load_tool
```

**Length target**: ~500 tokens (~2,000 characters)

### Step 2: Create Tool Index
**File**: `/agent/TOOL_INDEX.md`

**Purpose**: Verbose descriptions and use case examples for all tools. This file is NOT loaded into system prompt - it's referenced documentation that the agent can read via file_read when needed.

**Structure**:
```markdown
# Ron Superagent Tool Index

## Navigation
- [Meta-tooling](#meta-tooling)
- [Multi-agent Orchestration](#multi-agent-orchestration)
- [Core Utilities](#core-utilities)
- [Browser Execution](#browser-execution)
- [Task Management](#task-management)
- [MCP Server Management](#mcp-server-management)
- [A2A Protocol](#a2a-protocol)

---

## Meta-tooling

### load_tool
**Purpose**: Dynamically load Python functions as agent tools at runtime

**Use Cases**:
- Loading custom domain-specific tools
- Extending agent capabilities without restart
- Loading tools from external packages

**Parameters**:
- `module_path` (str): Python module path (e.g., "my_tools.custom")
- `function_name` (str): Function name to load as tool

**Examples**:
```python
# Load a custom data processing tool
load_tool(module_path="data_tools.processors", function_name="process_csv")

# Load healthcare-specific tool
load_tool(module_path="healthcare_tools", function_name="parse_hl7")
```

**When to use**:
- Need specialized functionality not in core toolset
- Loading domain-specific tools for specific tasks
- Extending capabilities without modifying agent code

**When NOT to use**:
- For functionality already covered by existing tools
- For one-off operations (use http_request or shell instead)
- When MCP server would be more appropriate

---

### sandbox_tools.shell
**Purpose**: Execute shell commands in sandboxed environment

**Use Cases**:
- Git operations (clone, commit, push)
- Package management (npm, pip, cargo)
- File system operations (ls, find, grep)
- Process management (ps, kill)
- System inspection (env, whoami)

**Parameters**:
- `command` (str): Shell command to execute

**Examples**:
```bash
# Clone repository
shell("git clone https://github.com/user/repo.git")

# Install dependencies
shell("npm install")

# Search files
shell("find . -name '*.py' -type f")
```

**Security constraints**:
- Runs in sandboxed electron environment
- No access to parent process environment variables
- Limited to project directory scope

**When to use**:
- Need to execute CLI tools
- Performing git operations
- Managing dependencies
- System file operations

**When NOT to use**:
- For file reading (use file_read instead - faster)
- For HTTP requests (use http_request instead - better error handling)
- For browser automation (use browser tool instead)

---

### sandbox_tools.editor
**Purpose**: Edit files with find-replace and line-based operations

**Use Cases**:
- Code refactoring
- Configuration updates
- Multi-line text replacements
- Precise code modifications

**Parameters**:
- `file_path` (str): Path to file
- `operation` (str): "replace", "insert", "delete"
- `search` (str): Text to find
- `replace` (str): Replacement text

**Examples**:
```python
# Replace function implementation
editor(
    file_path="src/api.ts",
    operation="replace",
    search="export function oldApi() {",
    replace="export function newApi() {"
)
```

**When to use**:
- Need precise text replacements
- Modifying existing code
- Configuration file updates

**When NOT to use**:
- Creating new files (use file_write)
- Reading files (use file_read)
- Complex refactoring (use multi-agent workflow)

---

## Multi-agent Orchestration

### use_agent
**Purpose**: Spawn a sub-agent for specialized tasks

**Use Cases**:
- Delegating complex sub-tasks
- Parallel task execution
- Specialized domain tasks (e.g., data analysis)

**Parameters**:
- `agent_type` (str): Type of agent to spawn
- `task` (str): Task description
- `context` (dict): Context data to pass

**Examples**:
```python
# Spawn data analysis agent
use_agent(
    agent_type="data_analyst",
    task="Analyze sales data and identify trends",
    context={"data_path": "sales_2024.csv"}
)
```

**When to use**:
- Task requires specialized expertise
- Need parallel execution
- Sub-task is self-contained

**When NOT to use**:
- Simple operations covered by existing tools
- When sequential execution is required
- For tasks requiring main agent context

---

### workflow
**Purpose**: Execute sequential multi-agent workflow

**Use Cases**:
- Multi-step processes with dependencies
- Data pipelines
- Sequential task chains

**Parameters**:
- `steps` (list): Ordered list of agent steps
- `context` (dict): Shared context across steps

**Examples**:
```python
# Data processing pipeline
workflow(
    steps=[
        {"agent": "data_fetcher", "task": "Fetch user data"},
        {"agent": "data_cleaner", "task": "Clean and validate"},
        {"agent": "data_analyzer", "task": "Generate insights"}
    ],
    context={"user_id": "12345"}
)
```

**When to use**:
- Multi-step process with clear dependencies
- Need to pass results between steps
- Sequential execution required

**When NOT to use**:
- Steps can run in parallel (use swarm)
- Complex branching logic needed (use graph)
- Single-step tasks

---

### swarm
**Purpose**: Autonomous multi-agent collaboration with dynamic handoffs

**Use Cases**:
- Complex problem-solving requiring multiple perspectives
- Dynamic task allocation
- Self-organizing agent teams

**Parameters**:
- `agents` (list): Available agent types
- `goal` (str): High-level goal
- `autonomy_level` (str): "low", "medium", "high"

**Examples**:
```python
# Research and implementation swarm
swarm(
    agents=["researcher", "architect", "implementer", "tester"],
    goal="Implement user authentication system",
    autonomy_level="high"
)
```

**When to use**:
- Complex tasks requiring multiple specializations
- Unpredictable task breakdown
- Need adaptive problem-solving

**When NOT to use**:
- Clear sequential workflow exists (use workflow)
- Single-agent task
- Strict execution order required

---

### graph
**Purpose**: DAG-based agent orchestration with conditional branching

**Use Cases**:
- Complex workflows with branching logic
- Parallel execution paths
- Conditional task execution

**Parameters**:
- `nodes` (list): Agent tasks as graph nodes
- `edges` (list): Dependencies between nodes
- `conditions` (dict): Branching conditions

**Examples**:
```python
# Deployment pipeline with conditions
graph(
    nodes=[
        {"id": "test", "agent": "tester", "task": "Run tests"},
        {"id": "staging", "agent": "deployer", "task": "Deploy to staging"},
        {"id": "prod", "agent": "deployer", "task": "Deploy to production"}
    ],
    edges=[
        {"from": "test", "to": "staging"},
        {"from": "staging", "to": "prod"}
    ],
    conditions={
        "staging": "test.passed == true",
        "prod": "staging.passed == true && approval == true"
    }
)
```

**When to use**:
- Complex branching logic
- Parallel execution paths
- Conditional task execution

**When NOT to use**:
- Simple sequential workflow (use workflow)
- Fully autonomous coordination needed (use swarm)
- No branching logic required

---

### think
**Purpose**: Extended reasoning and planning before execution

**Use Cases**:
- Complex problem analysis
- Multi-step planning
- Exploring solution approaches

**Parameters**:
- `question` (str): Problem to analyze
- `depth` (str): "shallow", "medium", "deep"
- `output_format` (str): "markdown", "json"

**Examples**:
```python
# Plan implementation approach
think(
    question="What's the best architecture for a real-time chat system with 10K concurrent users?",
    depth="deep",
    output_format="markdown"
)
```

**When to use**:
- Need deep analysis before action
- Exploring multiple approaches
- Complex decision-making

**When NOT to use**:
- Simple straightforward tasks
- Already have clear implementation plan
- Time-critical operations

---

## Core Utilities

### http_request
**Purpose**: Make HTTP requests with error handling and retries

**Use Cases**:
- REST API calls
- Webhook triggers
- Data fetching from web services

**Parameters**:
- `url` (str): Target URL
- `method` (str): HTTP method (GET, POST, PUT, DELETE)
- `headers` (dict): Request headers
- `body` (dict): Request body
- `timeout` (int): Request timeout in seconds

**Examples**:
```python
# Fetch user data
http_request(
    url="https://api.example.com/users/123",
    method="GET",
    headers={"Authorization": "Bearer <token>"}
)

# Create resource
http_request(
    url="https://api.example.com/resources",
    method="POST",
    headers={"Content-Type": "application/json"},
    body={"name": "New Resource", "type": "document"}
)
```

**When to use**:
- Need to call external APIs
- Webhook triggers
- REST API interactions

**When NOT to use**:
- MCP server exists for the service (use mcp_client)
- Web scraping (use browser tool)
- GraphQL APIs (consider specialized MCP server)

---

### mem0_memory
**Purpose**: Long-term memory storage with vector search

**Use Cases**:
- Storing user preferences
- Caching research findings
- Maintaining conversation context across sessions
- Building knowledge bases

**Parameters**:
- `operation` (str): "store", "retrieve", "search"
- `user_id` (str): User identifier
- `content` (str): Content to store
- `metadata` (dict): Associated metadata

**Examples**:
```python
# Store user preference
mem0_memory(
    operation="store",
    user_id="user@example.com",
    content="User prefers TypeScript over JavaScript",
    metadata={"category": "preferences", "source": "onboarding"}
)

# Search memories
mem0_memory(
    operation="search",
    user_id="user@example.com",
    query="programming language preferences"
)
```

**When to use**:
- Need persistence across sessions
- Building user profiles
- Caching expensive research
- Semantic search over historical data

**When NOT to use**:
- Temporary session data (use conversation history)
- File-based storage more appropriate
- Need relational queries (use database)

---

### image_reader
**Purpose**: Analyze images/screenshots with vision model

**Use Cases**:
- Browser state verification
- Screenshot analysis
- UI testing
- Visual debugging

**Parameters**:
- `image_path` (str): Path to image file

**Examples**:
```python
# Verify browser state after navigation
image_reader(image_path="/tmp/screenshot_1234.png")
```

**When to use**:
- ALWAYS after browser navigation
- Verifying UI state
- Visual debugging
- Screenshot analysis

**When NOT to use**:
- Text-based content (use file_read)
- Don't need visual verification

---

## Browser Execution

### browser.browser
**Purpose**: Local Chromium browser automation with screenshot capabilities

**Use Cases**:
- Web scraping
- Form automation
- UI testing
- Web application interaction

**Core Actions**:
- `navigate` - Go to URL
- `click` - Click element
- `type` - Type text
- `screenshot` - Capture page state
- `get_text` - Extract DOM text
- `get_html` - Extract HTML
- `scroll` - Scroll page

**MANDATORY WORKFLOW**:
1. Navigate to page
2. Take screenshot
3. Use image_reader to verify state
4. Execute actions
5. Take screenshot after changes
6. Verify with image_reader
7. Repeat as needed

**Example workflow**:
```python
# Step 1: Navigate
browser(action="navigate", url="https://example.com", session_name="default")

# Step 2: Screenshot
browser(action="screenshot", session_name="default", output_path="/tmp/screen1.png")

# Step 3: Verify
image_reader(image_path="/tmp/screen1.png")
# Agent reads: "Login form with username/password fields visible"

# Step 4: Execute action
browser(action="type", selector="input[name='username']", text="user@example.com", session_name="default")
browser(action="type", selector="input[name='password']", text="password123", session_name="default")
browser(action="click", selector="button[type='submit']", session_name="default")

# Step 5: Screenshot after action
browser(action="screenshot", session_name="default", output_path="/tmp/screen2.png")

# Step 6: Verify new state
image_reader(image_path="/tmp/screen2.png")
```

**When to use**:
- Web interaction required
- Need to see rendered page
- Form automation
- Dynamic content

**When NOT to use**:
- Simple HTTP API (use http_request)
- Static content (use http_request)
- Playwright MCP available (use that instead)

**CRITICAL CONSTRAINTS**:
- NEVER assume page state without screenshot + image_reader
- ALWAYS verify after navigation
- ALWAYS verify after actions that change page
- Use session_name="default" unless specific session needed

---

## Task Management

### task_tools.create_task
**Purpose**: Create new task in Supabase task management system

**Use Cases**:
- User creates new task
- Agent identifies subtask needed
- Breaking down complex work

**Parameters**:
- `title` (str): Task title
- `description` (str): Detailed description
- `status` (str): Initial status
- `user_id` (str): Owner user ID
- `metadata` (dict): Additional data

**Examples**:
```python
# Create user task
task_tools.create_task(
    title="Implement login page",
    description="Create React login component with email/password authentication",
    status="todo",
    user_id="user@example.com",
    metadata={"priority": "high", "project": "auth-system"}
)
```

**When to use**:
- User requests task creation
- Agent identifies subtask needed
- Breaking down complex work

**When NOT to use**:
- Task already exists (use update_task)
- Temporary internal coordination (use conversation context)

---

### task_tools.add_relationship
**Purpose**: Create relationships between tasks (blocks, depends_on, relates_to)

**Use Cases**:
- Linking dependent tasks
- Tracking blockers
- Organizing related work

**Parameters**:
- `source_task_id` (str): Source task ID
- `target_task_id` (str): Target task ID
- `relationship_type` (str): "blocks", "depends_on", "relates_to"

**Examples**:
```python
# Task A blocks Task B
task_tools.add_relationship(
    source_task_id="task_123",
    target_task_id="task_456",
    relationship_type="blocks"
)
```

**When to use**:
- Tasks have dependencies
- Need to track blockers
- Organizing complex project structure

**When NOT to use**:
- Tasks are independent
- Simple task list (no relationships needed)

---

## MCP Server Management

### load_mcp_server
**Purpose**: Connect to MCP server and load its tools

**Available MCP Servers**:
1. **telnyx** - Voice/SMS APIs
2. **datacommons** - Public data APIs
3. **cms-coverage** - Medicare/Medicaid coverage data
4. **playwright** - Browser automation (Electron mode)
5. **pophive** - Population health data
6. **healthcare** - Healthcare data APIs
7. **agent-sops** - Agent SOP management

**Parameters**:
- `server_name` (str): Server identifier from available list

**Examples**:
```python
# Load healthcare MCP server
load_mcp_server(server_name="healthcare")

# Load Playwright for browser automation
load_mcp_server(server_name="playwright")
```

**When to use**:
- Need specialized APIs (healthcare, voice, data)
- Browser automation via Playwright MCP
- Domain-specific functionality

**When NOT to use**:
- Core tools already cover functionality
- Would load unused tools
- Simple HTTP API (use http_request)

**Server Selection Guide**:
- **Healthcare tasks** → healthcare, pophive, cms-coverage
- **Voice/SMS** → telnyx
- **Browser automation** → playwright (preferred over browser tool)
- **Public data** → datacommons
- **SOP management** → agent-sops

---

## A2A Protocol

### A2AClientToolProvider
**Purpose**: Agent-to-Agent protocol for distributed agent communication

**Use Cases**:
- Multi-agent systems across processes
- Distributed task execution
- Agent federation

**Configuration**:
```python
A2AClientToolProvider(known_agent_urls=["http://localhost:9000"])
```

**When to use**:
- Multi-agent system with remote agents
- Distributed architecture
- Agent federation needed

**When NOT to use**:
- Single-agent system
- All agents in same process (use use_agent, workflow, swarm, graph)

---

## Tool Selection Decision Tree

```
Need to interact with web?
├─ YES → Is it a form/dynamic UI?
│   ├─ YES → Is Playwright MCP available?
│   │   ├─ YES → Use Playwright MCP (load_mcp_server + mcp_client)
│   │   └─ NO → Use browser.browser with MANDATORY screenshot workflow
│   └─ NO → Is there an API?
│       ├─ YES → Is there an MCP server for it?
│       │   ├─ YES → Use MCP server (load_mcp_server + mcp_client)
│       │   └─ NO → Use http_request
│       └─ NO → Use browser.browser to scrape
└─ NO → What do you need to do?
    ├─ File operations → Use file_read, file_write, or editor
    ├─ Shell commands → Use shell
    ├─ Multi-agent work → Use workflow, swarm, or graph
    ├─ Store knowledge → Use mem0_memory
    ├─ Task management → Use task_tools.*
    ├─ Extended reasoning → Use think
    └─ Load custom tool → Use load_tool
```

---

## Performance Guidelines

### Token Efficiency
- Use file_read instead of shell cat (faster, no shell overhead)
- Use http_request instead of shell curl (better error handling)
- Use editor for precise edits (don't read entire file)

### Rate Limiting
- Browser actions: Max 10 actions/minute per session
- HTTP requests: Respect API rate limits (check headers)
- MCP servers: Check individual server limits

### Error Recovery
- Browser: Take screenshot on error to diagnose
- HTTP: Check response codes, retry on 429/503
- MCP: Reconnect on connection errors

---

## Security Constraints

### Browser Automation
- NEVER pass --electron-allow-destructive-cdp unless explicitly allowed
- Unsafe eval and full Electron APIs are OFF by default
- Only interact with trusted domains

### HTTP Requests
- Validate URLs before requests
- Use HTTPS when available
- Don't expose credentials in logs

### File Operations
- Stay within project directory scope
- Don't read/write sensitive files (.env, credentials)
- Validate file paths

---

## Common Patterns

### Pattern: Web Research
```python
# 1. Navigate and verify
browser(action="navigate", url="https://research-site.com", session_name="research")
browser(action="screenshot", session_name="research", output_path="/tmp/s1.png")
image_reader(image_path="/tmp/s1.png")

# 2. Extract data
content = browser(action="get_text", selector="article", session_name="research")

# 3. Store in context file
file_write(
    path="research_context.md",
    content=f"# Research Findings\n\n{content}"
)

# 4. Store in memory for future sessions
mem0_memory(
    operation="store",
    user_id="user@example.com",
    content=content,
    metadata={"source": "research-site.com", "topic": "AI"}
)
```

### Pattern: Multi-Agent Implementation
```python
# Use workflow for clear sequential steps
workflow(
    steps=[
        {
            "agent": "researcher",
            "task": "Research authentication best practices",
            "outputs": ["research_context.md"]
        },
        {
            "agent": "architect",
            "task": "Design authentication system based on research",
            "inputs": ["research_context.md"],
            "outputs": ["architecture.md"]
        },
        {
            "agent": "implementer",
            "task": "Implement authentication following architecture",
            "inputs": ["architecture.md"],
            "outputs": ["src/auth/*"]
        },
        {
            "agent": "tester",
            "task": "Write and run tests for authentication",
            "inputs": ["src/auth/*"],
            "outputs": ["tests/auth/*"]
        }
    ],
    context={"user_id": "user@example.com", "project": "auth-system"}
)
```

### Pattern: Healthcare Data Integration
```python
# 1. Load healthcare MCP servers
load_mcp_server(server_name="healthcare")
load_mcp_server(server_name="cms-coverage")

# 2. Fetch patient data (via MCP tools)
patient_data = mcp_client(
    server="healthcare",
    tool="get_patient_record",
    patient_id="12345"
)

# 3. Check coverage
coverage = mcp_client(
    server="cms-coverage",
    tool="check_medicare_coverage",
    patient_id="12345"
)

# 4. Store for later use
mem0_memory(
    operation="store",
    user_id="provider@hospital.com",
    content=f"Patient 12345: {patient_data}, Coverage: {coverage}",
    metadata={"category": "patient_data", "patient_id": "12345"}
)
```

---

## FAQ

**Q: When should I take screenshots?**
A: ALWAYS after navigation, ALWAYS after actions that change page state, and ANYTIME you're uncertain about page state.

**Q: Should I use browser tool or Playwright MCP?**
A: Prefer Playwright MCP when available (more features, better reliability). Use browser tool as fallback.

**Q: How do I choose between workflow, swarm, and graph?**
A:
- Clear sequential steps → workflow
- Complex autonomous coordination → swarm
- Branching/conditional logic → graph

**Q: When should I store things in mem0_memory?**
A: When you need it in future sessions, when building user profiles, when caching expensive research, or when building searchable knowledge bases.

**Q: How do I know which MCP server to use?**
A: Check the "Available MCP Servers" section above. For healthcare → healthcare/pophive/cms-coverage, for voice/SMS → telnyx, for browser → playwright.
```

**Length**: ~18,000 characters (~4,500 tokens) - NOT loaded into system prompt, available as reference documentation

### Step 3: Update superagent.py to Load SOP

**Location**: `/agent/superagent.py` line ~211

**Current code**:
```python
SUPERAGENT_SYSTEM_PROMPT = """You are Ron Superagent...[26,224 characters]"""
```

**New code**:
```python
# Load core SOP from file
def load_sop(sop_name: str) -> str:
    """Load SOP content from /agent/sops/ directory."""
    sop_path = Path(__file__).parent / "sops" / f"{sop_name}.sop.md"
    if sop_path.exists():
        return sop_path.read_text()
    else:
        logger.warning(f"SOP file not found: {sop_path}")
        return f"# {sop_name} SOP\n\nSOP file not found. Please create {sop_path}"

SUPERAGENT_SYSTEM_PROMPT = load_sop("superagent-core")
```

**This reduces system prompt from 26,224 chars → ~2,000 chars (6,500 tokens → 500 tokens)**

### Step 4: Add Tool Index Reference to SOP

In the SOP file, add reference to tool index:

```markdown
## Available Tools

This agent has 27+ always-available tools across 7 categories. For detailed documentation of each tool including use cases, examples, constraints, and decision trees, read the Tool Index:

**To access**: Use `file_read(path="/agent/TOOL_INDEX.md")` and search for the tool you need.

**Quick reference**:
- Browser automation → browser.browser (MUST follow screenshot workflow)
- Multi-agent work → use_agent, workflow, swarm, graph
- HTTP requests → http_request (prefer MCP servers when available)
- Memory → mem0_memory
- Task management → task_tools.*
- MCP servers → load_mcp_server (healthcare, playwright, telnyx, etc.)
```

### Step 5: Create Tool Auto-Discovery

**Optional enhancement**: Add tool that generates tool list dynamically

**File**: `/agent/tools/tool_introspection.py`

```python
from strands import tool

@tool
def list_available_tools() -> str:
    """Get a list of all currently available tools with brief descriptions.

    Returns formatted list of tools by category. For detailed documentation,
    read TOOL_INDEX.md using file_read.
    """
    # This will be auto-populated by Strands SDK
    # Returns tool names + brief descriptions from tool docstrings
    pass
```

## Expected Impact

**Token savings**:
- System prompt: 6,500 tokens → 500 tokens (92% reduction)
- Per request after caching: ~1,625 tokens → ~125 tokens (92% reduction)
- Annual savings: Assuming 1M requests/year × 1,500 tokens saved × $0.0003/1K tokens = ~$450/year

**Performance impact**:
- First request: Slightly slower (needs to load SOP file from disk - negligible)
- Cached requests: Same performance (cached prompt is smaller)
- Agent can read TOOL_INDEX.md when needed (~4,500 tokens, but only when needed)

**Maintainability improvements**:
- SOP file can be edited without code changes
- Tool documentation centralized
- Easier to onboard new contributors
- Version control on operational procedures

## Verification Steps

After implementation:

1. **Test basic agent functionality**:
   ```python
   agent = create_superagent(session_id="test", memory=memory)
   response = agent("Navigate to google.com and search for 'Strands SDK'")
   # Should follow screenshot workflow correctly
   ```

2. **Verify tool access**:
   ```python
   response = agent("List all available tools")
   # Should use list_available_tools or read TOOL_INDEX.md
   ```

3. **Test MCP server loading**:
   ```python
   response = agent("Load the playwright MCP server and navigate to example.com")
   # Should load MCP server and use it correctly
   ```

4. **Check token usage**:
   - Monitor prompt caching metrics in AWS Bedrock console
   - Confirm ~500 token system prompt size
   - Verify cache hit rates remain high

5. **Test tool documentation access**:
   ```python
   response = agent("How do I use the workflow tool? Show me examples.")
   # Should read TOOL_INDEX.md and provide examples from there
   ```

## Rollback Plan

If issues arise:

1. **Immediate rollback**: Change `load_sop()` to return original inline prompt:
   ```python
   SUPERAGENT_SYSTEM_PROMPT = """You are Ron Superagent...[original content]"""
   ```

2. **Partial rollback**: Keep SOP for high-level guidance, inline critical paths:
   ```python
   SUPERAGENT_SYSTEM_PROMPT = load_sop("superagent-core") + "\n\n" + CRITICAL_BROWSER_INSTRUCTIONS
   ```

## Future Enhancements

1. **SOP Versioning**: Track SOP versions in git, allow loading specific versions
2. **Dynamic SOP Loading**: Load different SOPs based on task type
3. **SOP Composition**: Compose SOPs from smaller modules (browser.sop.md + memory.sop.md + ...)
4. **Tool Auto-Documentation**: Generate TOOL_INDEX.md from tool docstrings automatically
5. **MCP Server Documentation**: Add detailed docs for each MCP server

## Implementation Checklist

- [ ] Create `/agent/sops/` directory
- [ ] Write `superagent-core.sop.md` (target: ~500 tokens)
- [ ] Write `TOOL_INDEX.md` (comprehensive tool documentation)
- [ ] Update `superagent.py` to use `load_sop()`
- [ ] Test basic functionality
- [ ] Test tool access and documentation
- [ ] Test MCP server loading
- [ ] Verify token usage reduction
- [ ] Monitor for any behavioral regressions
- [ ] Update deployment documentation
- [ ] Create backup of original inline prompt
- [ ] Update team on new SOP-based architecture

## Questions for Future Implementation

1. Should we create separate SOPs for different agent modes (research mode, implementation mode, browser automation mode)?
2. Should TOOL_INDEX.md be split into multiple files by category?
3. Should we implement tool auto-documentation from docstrings?
4. Should we version SOPs and allow loading specific versions?
5. Should we create SOP templates for custom agents?

---

**Last Updated**: 2025-01-21
**Implemented By**: [Future Claude]
**Status**: Ready for Implementation
**Estimated Implementation Time**: 2-3 hours
**Risk Level**: Low (easy rollback available)
