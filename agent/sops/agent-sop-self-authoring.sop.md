# Agent SOP Self-Authoring

## Overview

This SOP guides an agent to author a new SOP for itself, using tool-based research and strict clarity checks. It enforces zero-guessing behavior, requires explicit questions for unknowns, and produces a compliant `.sop.md` file that can be loaded by the agent-sop MCP server.

## Parameters

- **workflow_goal** (required): The workflow or task area to codify as a new SOP.
- **target_agent_context** (required): The agent's runtime context (available tools, permissions, environments, and constraints).
- **output_sop_name** (optional, default: "custom-agent-sop"): Kebab-case SOP name (without `.sop.md`).
- **output_dir** (optional, default: "agent/sops"): Directory to save the new SOP.
- **research_sources** (optional): Any initial sources or links to consult.

**Constraints for parameter acquisition:**
- You MUST ask for all required parameters upfront in a single prompt rather than one at a time.
- You MUST support multiple input methods including:
  - Direct input: Text provided directly in the conversation.
  - File path: Path to a local file containing requirements.
  - URL: Link to documentation or specifications.
  - Other methods: You SHOULD be open to other ways the user might want to provide inputs.
- You MUST use appropriate tools to access content based on the input method.
- You MUST confirm successful acquisition of all required parameters before proceeding.
- You SHOULD save acquired inputs to a consistent working note (e.g., `sop_authoring_inputs.md`).

## Steps

### 1. Clarity Gate

Identify all ambiguities in the requested SOP and resolve them before drafting.

**Constraints:**
- You MUST enumerate all open questions explicitly.
- You MUST NOT proceed if any ambiguity remains.
- You MUST ask each open question using one of the following:
  - Ask DeepWiki (if a DeepWiki tool/server is available in the environment).
  - Sonar Reasoning Pro or Sonar Deep Research (via the available research tools).
- If DeepWiki is unavailable, You MUST use Sonar Reasoning Pro/Deep Research instead.
- If no research tool is available, You MUST ask the user to enable one; you MUST NOT guess.

### 2. Tooling and Environment Inventory

Capture the agent's actual toolset and constraints to ensure the SOP is implementable.

**Constraints:**
- You MUST list all available tools and any known limitations from the provided `target_agent_context`.
- You MUST use available tool-discovery or environment tools if they exist (e.g., environment listing).
- You SHOULD retrieve any relevant prior SOPs or notes from memory tools if available.
- You MUST record this inventory in a short context note (e.g., `sop_authoring_tooling.md`).

### 3. Research the Target Domain

Use tools to research best practices for the workflow being encoded.

**Constraints:**
- You MUST use tools for research; do not rely on assumptions.
- You MUST use at least one of:
  - Sonar Reasoning Pro search
  - Sonar Deep Research
  - A relevant MCP server (via `mcp_client`) if domain-specific tools exist
- You MUST capture citations or source links when available.
- You MUST store the research output in a working file (e.g., `sop_authoring_research.md`).

### 4. SOP Structure Draft

Create a compliant SOP skeleton before writing detailed steps.

**Constraints:**
- You MUST follow the standard Agent SOP format: Title, Overview, Parameters, Steps.
- You SHOULD include Examples and Troubleshooting for complex workflows.
- You MUST use RFC 2119 keywords (MUST, SHOULD, MAY) in constraints.
- You MUST provide context for any negative constraints (MUST NOT, SHOULD NOT).

### 5. SOP Detail and Constraints

Write the SOP steps with clear, testable outcomes and explicit tool usage.

**Constraints:**
- Each step MUST have a clear purpose and measurable outcome.
- You MUST specify where any artifacts are written (file names and paths).
- You MUST include explicit instructions for tool usage relevant to the workflow.
- You MUST include a zero-guessing rule for all ambiguous areas.
- You MUST ensure the SOP instructs the agent to use tools to research the area it is codifying.

### 6. Validation Pass

Validate the SOP against the Agent SOP specification and project constraints.

**Constraints:**
- You MUST confirm the file name ends with `.sop.md` and uses kebab-case.
- You MUST confirm parameter names are snake_case.
- You MUST verify RFC 2119 constraints exist in each step.
- You MUST verify negative constraints include rationale.
- If any requirement fails, You MUST fix the SOP before proceeding.

### 7. Persist and Publish

Save the SOP and ensure it is discoverable by the agent-sop MCP server.

**Constraints:**
- You MUST write the SOP to `{output_dir}/{output_sop_name}.sop.md`.
- You MUST confirm the file exists and is readable.
- You MUST ensure the MCP server's SOP paths include `output_dir`.
- If the MCP server is already running, You MUST request a restart or reload.
- You MUST report the final SOP path and MCP server instructions to the user.

## Examples

### Example Input
```
workflow_goal: "Create an SOP for incident triage in the app"
target_agent_context: "Strands agent with mcp_client, file_read, file_write, mem0_memory"
output_sop_name: "incident-triage"
output_dir: "agent/sops"
```

### Example Output
```
Created SOP at agent/sops/incident-triage.sop.md
MCP server updated to include agent/sops in --sop-paths
```

## Troubleshooting

### Missing Research Tool
If no DeepWiki or Sonar tools are available, request the user to enable one and stop. Do not guess.

### Ambiguous Requirements
If the workflow goal is unclear or underspecified, ask clarifying questions via DeepWiki or Sonar before proceeding.
