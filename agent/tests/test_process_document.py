"""Process review document: capability requirements, escaping, and backward-compatible persistence."""

from html import escape

import pytest
from pydantic import ValidationError

from agent.api.core.process_document import (
    CAPABILITY_KINDS,
    CapabilityRequirement,
    ProcessDocument,
    render_capabilities,
    render_process_document,
)

LEGACY_DOCUMENT = {
    "title": "Weekly report",
    "overview": "Collect numbers and send the summary.",
    "prerequisites": ["Signed in to the dashboard"],
    "inputs": ["Week number"],
    "steps": [{"title": "Export", "instructions": "Open the export page.", "expected_outcome": "CSV downloaded", "evidence_sequences": [1, 2]}],
    "completion_criteria": ["Summary sent"],
    "exceptions": [],
}


def test_legacy_persisted_document_defaults_to_no_capabilities():
    document = ProcessDocument.model_validate(LEGACY_DOCUMENT)
    assert document.capabilities == []
    html = render_process_document(document, 1, "2026-10-02T07:00:00Z")
    assert "Required capabilities" in html
    assert "No capability requirements were recorded in this revision." in html
    assert "None required." not in html
    assert "0 capabilities" in html


def test_capability_requirement_schema_is_strict_and_described():
    base = {"name": "x", "purpose": "p", "source": "s"}
    for invalid in ({**base, "kind": "plugin", "disposition": "existing"},
                    {**base, "kind": "tool", "disposition": "maybe"},
                    {**base, "kind": "tool", "disposition": "existing", "extra": "no"}):
        with pytest.raises(ValidationError):
            CapabilityRequirement.model_validate(invalid)
    minimal = CapabilityRequirement(kind="tool", name="shell", purpose="run", source="strands_tools", disposition="existing")
    assert minimal.loader is None and minimal.verification is None
    schema = ProcessDocument.model_json_schema()
    requirement = schema["$defs"]["CapabilityRequirement"]
    for field in ("kind", "name", "purpose", "source", "disposition", "loader", "verification"):
        assert requirement["properties"][field]["description"]
    assert "capabilities" not in schema["required"]
    assert schema["properties"]["capabilities"]["description"]
    assert set(requirement["required"]) == {"kind", "name", "purpose", "source", "disposition"}
    assert [kind for kind, _ in CAPABILITY_KINDS] == ["tool", "mcp_server", "skill", "subagent"]


def test_render_covers_all_four_categories_with_explicit_none_rows():
    document = ProcessDocument.model_validate({**LEGACY_DOCUMENT, "capabilities": [
        {"kind": "tool", "name": "http_request", "purpose": "Fetch the export", "source": "installed strands_tools",
         "disposition": "existing", "loader": 'tool_catalog(action="load", name="http_request")', "verification": "Listed in the agent registry"},
        {"kind": "mcp_server", "name": "user_browser", "purpose": "Drive the dashboard", "source": "mcp.json", "disposition": "existing"},
        {"kind": "skill", "name": "summarise-report", "purpose": "Write the summary", "source": "lesson workspace", "disposition": "new"},
    ]})
    html = render_process_document(document, 2, "2026-10-02T07:00:00Z")
    table_start = html.index('<table class="capabilities">')
    table = html[table_start:html.index("</table>", table_start)]
    assert html.index('id="capabilities-heading"') < html.index('id="workflow-heading"')
    for label in ("Tools", "MCP servers", "Agent skills", "Subagents"):
        assert f'<th scope="row">{label}</th>' in table
    assert table.count("None required.") == 1
    assert '<th scope="row">Subagents</th><td colspan="6" class="quiet">None required.</td>' in table
    assert '<code>http_request</code>' in table
    assert escape('tool_catalog(action="load", name="http_request")') in table
    assert 'data-disposition="existing"' in table and 'data-disposition="new"' in table
    assert table.count("—") == 4  # loader + verification missing for two requirements
    assert "3 capabilities" in html


def test_render_escapes_capability_fields():
    hostile = "<script>alert('x')</script>"
    document = ProcessDocument.model_validate({**LEGACY_DOCUMENT, "title": hostile, "capabilities": [
        {"kind": "subagent", "name": hostile, "purpose": f"{hostile} & more", "source": '"quoted" <b>',
         "disposition": "unavailable", "loader": hostile, "verification": "</td><td>escape me"},
    ]})
    html = render_process_document(document, 3, "2026-10-02T07:00:00Z")
    assert "<script>" not in html
    assert html.count(escape(hostile)) >= 4
    assert "&quot;quoted&quot; &lt;b&gt;" in html
    assert "&lt;/td&gt;&lt;td&gt;escape me" in html
    assert 'data-disposition="unavailable"' in html
    assert render_capabilities([]) == '<p class="quiet">No capability requirements were recorded in this revision.</p>'


def test_header_names_the_learning_protocol_not_the_learned_skill():
    document = ProcessDocument.model_validate(LEGACY_DOCUMENT)
    html = render_process_document(document, 1, "2026-10-02T07:00:00Z")
    assert "Learning a New Skill" in html
    assert f'<h1 id="process-title">{escape(LEGACY_DOCUMENT["title"])}</h1>' in html
    assert "<title>Weekly report — Process review</title>" in html
