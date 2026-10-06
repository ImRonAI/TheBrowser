"""Exercise the real upstream Agent SOP server without an LLM or network service."""

import pytest
from types import SimpleNamespace
from pathlib import Path
from strands import tool
from unittest.mock import AsyncMock

from agent.api.core.native_sop import native_sop_prompt


def test_native_mcp_prompt_reads_current_workflow_and_user_input(tmp_path):
    workflow = tmp_path / "workflow.sop.md"
    workflow.write_text("# Example\n\n## Overview\nObserve then verify.\n\n## Steps\n### 1. Read\nYou MUST read first.\n")
    prompt = native_sop_prompt(tmp_path, "Use the cobalt example")
    assert '<agent-sop name="workflow">' in prompt
    assert "You MUST read first." in prompt
    assert "<user-input>\nUse the cobalt example\n</user-input>" in prompt
    workflow.write_text("# Updated\n\n## Overview\nNew approved revision.\n\n## Steps\n### 1. Verify\nYou MUST verify first.\n")
    updated = native_sop_prompt(tmp_path, "second request")
    assert "You MUST verify first." in updated
    assert "You MUST read first." not in updated


def test_native_mcp_prompt_requires_approved_workflow_file(tmp_path):
    with pytest.raises(ValueError, match="missing"):
        native_sop_prompt(tmp_path)


def test_learning_a_new_skill_is_loaded_by_the_native_mcp_server():
    directory = Path(__file__).parents[1] / "sops"
    prompt = native_sop_prompt(directory, '{"phase":"review"}', name="learning-a-new-skill")
    assert '<agent-sop name="learning-a-new-skill">' in prompt
    assert "# Learning a New Skill" in prompt
    assert "MUST" in prompt and "MUST NOT" in prompt
    assert prompt.index("### 1. Observe and journal the live demonstration") < prompt.index("### 2. Establish the demonstrated process")
    assert prompt.index("### 4. Register dependencies first") < prompt.index("### 5. Document and load the learned SOP")
    assert "tool_catalog" in prompt


def test_native_mcp_server_rejects_invalid_workflow(tmp_path):
    (tmp_path / "workflow.sop.md").write_text("# No overview or workflow structure\n")
    with pytest.raises(Exception, match="Unknown prompt|unknown prompt|workflow"):
        native_sop_prompt(tmp_path)


@pytest.mark.asyncio
async def test_learned_execution_uses_one_agent_with_real_native_sop_prompt(tmp_path, monkeypatch):
    from agent.api.core import teaching

    @tool
    def read_example() -> str:
        """Read the harmless example."""
        return "example"

    manifest = {
        "id": "lesson", "name": "example", "description": "example", "created_at": "2026-10-02",
        "approval_revision": 1,
        "steps": [{"title": title, "instructions": f"Perform {title}", "expected_outcome": title,
                   "evidence_sequences": [index]} for index, title in enumerate(["Read", "Verify"], 1)],
        "tool_group": {"id": "group", "name": "Example", "approval_revision": 1,
                       "members": [{"id": "reader", "kind": "tool", "target": "read_example"}],
                       "steps": [{"step": index, "member_ids": ["reader"]} for index in (1, 2)]},
    }
    service = teaching.TeachingService(tmp_path)
    monkeypatch.setattr(teaching, "_service", service)
    monkeypatch.setattr(service, "list_skills", AsyncMock(return_value=[manifest]))
    monkeypatch.setattr(service, "read_file", AsyncMock(return_value={"content": "Use the approved native workflow."}))
    directory = tmp_path / teaching._scope("owner", "panel") / "skills" / "lesson" / "example"
    directory.mkdir(parents=True)
    (directory / "workflow.sop.md").write_text(
        "# Example\n\n## Overview\nRead and verify.\n\n## Steps\n### 1. Read\nRead first.\n### 2. Verify\nVerify second.\n"
    )
    constructed = []

    class Agent:
        def __init__(self, **kwargs):
            self.tools = kwargs["tools"]
            self.invocations = []
            constructed.append(self)

        async def invoke_async(self, prompt, structured_output_model=None):
            self.invocations.append(prompt[0]["text"])
            output = structured_output_model(complete=True, evidence="Both steps verified", result="success")
            return SimpleNamespace(structured_output=output)

    monkeypatch.setattr(teaching, "Agent", Agent)
    tools = teaching.create_learned_skill_tools("owner", "panel", lambda _: object(), [read_example])
    result = await tools[1](skill_name="example", request="Run approved procedure")
    assert result["status"] == "completed"
    assert len(constructed) == 1, "Native SOP must not become a custom per-step agent loop"
    assert len(constructed[0].invocations) == 1
    assert '<agent-sop name="workflow">' in constructed[0].invocations[0]
    assert "### 1. Read" in constructed[0].invocations[0] and "### 2. Verify" in constructed[0].invocations[0]
    assert read_example in constructed[0].tools
