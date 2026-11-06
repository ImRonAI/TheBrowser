"""render_ui: the agent builds HTML/JSX views; the result is a native json content block."""

from __future__ import annotations

import pytest

from agent.api.core.render_ui_tool import MAX_BYTES, render_ui, render_ui_directive, ui_action_text


@pytest.mark.asyncio
async def test_html_view_is_returned_as_a_json_block_the_runtime_forwards_verbatim():
    result = await render_ui(format="html", source="<html><body><div id='x'>hi</div></body></html>", title="Videos", height=50)
    assert result["status"] == "success"
    ui = result["content"][0]["json"]["ui"]
    assert ui["format"] == "html" and ui["title"] == "Videos" and ui["source"].startswith("<html>")
    assert ui["height"] == 240  # clamped to the minimum
    assert len(ui["view_id"]) == 12
    assert "Rendered html view" in result["content"][1]["text"]


@pytest.mark.asyncio
async def test_view_id_is_kept_so_a_later_render_replaces_the_view():
    result = await render_ui(format="jsx", source="<Card><CardTitle>Top pick</CardTitle></Card>", view_id="picks-v1")
    assert result["content"][0]["json"]["ui"]["view_id"] == "picks-v1"


@pytest.mark.asyncio
@pytest.mark.parametrize("kwargs", [
    dict(format="pdf", source="<div/>"),
    dict(format="html", source="   "),
    dict(format="html", source="just words, no markup"),
    dict(format="html", source="<div>" + "x" * MAX_BYTES + "</div>"),
    dict(format="html", source="<div/>", view_id="Bad Id!"),
])
async def test_invalid_input_is_rejected_with_a_clear_error(kwargs):
    with pytest.raises(ValueError):
        await render_ui(**kwargs)


def test_ui_action_text_matches_the_renderer_format():
    assert ui_action_text("v1", "thumbs_up", {"video": "abc"}) == '[ui_action v1] action=thumbs_up payload={"video": "abc"}'
    assert ui_action_text("v1", "Bad!", None) == "[ui_action v1] action=action payload=null"


def test_every_agent_gets_render_ui_and_the_directive():
    from agent.api.core.live_tools import live_host_tools
    from agent.api.core.panel_agent import PROJECT_TOOLS_DIR, SKILLS_AND_SPECIALISTS_DIRECTIVE
    from agent.api.core.panel_tools import CORE_TOOL_NAMES, build_core_tools

    assert "render_ui" in CORE_TOOL_NAMES
    assert "render_ui" in {tool.tool_name for tool in build_core_tools(PROJECT_TOOLS_DIR)}
    assert "render_ui" in {tool.tool_name for tool in live_host_tools(PROJECT_TOOLS_DIR)}
    assert render_ui_directive() in SKILLS_AND_SPECIALISTS_DIRECTIVE
    assert "ron:ui_action" in SKILLS_AND_SPECIALISTS_DIRECTIVE and "add_memory" in render_ui_directive()


@pytest.mark.asyncio
async def test_render_workflow_returns_jsx_for_the_workflow_kit_with_inert_attribute_values():
    from agent.api.core.render_ui_tool import render_workflow

    result = await render_workflow(title="Release", steps=[
        {"id": "plan", "label": "Plan", "description": "Scope the \"v2\" release {draft}"},
        {"id": "build", "label": "Build", "content": "CI runs </WorkflowNode> tests", "footer": "~10 min"},
        {"id": "rollback", "label": "Roll back"},
        {"id": "ship", "label": "Ship"},
    ], connections=[
        {"source": "plan", "target": "build"},
        {"source": "build", "target": "ship", "type": "animated"},
        {"source": "build", "target": "rollback", "type": "temporary"},
        {"source": "build", "target": "ship"},
    ], view_id="release-flow")
    ui = result["content"][0]["json"]["ui"]
    assert ui["format"] == "jsx" and ui["view_id"] == "release-flow" and ui["title"] == "Release"
    source = ui["source"]
    assert source.startswith('<Workflow title={"Release"}>') and source.endswith("</Workflow>")
    assert '<WorkflowNode id={"plan"} label={"Plan"} description={"Scope the \\"v2\\" release {draft}"} />' in source
    assert 'content={"CI runs </WorkflowNode> tests"}' in source
    assert source.count("<WorkflowEdge ") == 3  # the duplicate build -> ship arrow is dropped
    assert '<WorkflowEdge source={"build"} target={"rollback"} type={"temporary"} />' in source
    assert "4 steps, 3 connections" in result["content"][1]["text"]


@pytest.mark.asyncio
async def test_render_workflow_draws_flowchart_shapes_and_arrow_labels():
    from agent.api.core.render_ui_tool import STEP_KINDS, render_workflow

    result = await render_workflow(title="Refund", steps=[
        {"id": "ask", "label": "Refund request", "kind": "io"},
        {"id": "ok", "label": "Within 30 days?", "kind": "Gateway"},
        {"id": "db", "label": "Orders DB", "kind": "database"},
        {"id": "pay", "label": "Refund card", "kind": "automation"},
        {"id": "x", "label": "Explain policy", "kind": "hologram"},
    ], connections=[
        {"source": "ask", "target": "ok"},
        {"source": "ok", "target": "pay", "label": "  Yes "},
        {"source": "ok", "target": "x", "type": "temporary", "label": "No" * 30},
        {"source": "db", "target": "ok"},
    ])
    source = result["content"][0]["json"]["ui"]["source"]
    assert 'id={"ask"} label={"Refund request"} kind={"io"}' in source
    assert 'kind={"decision"}' in source and 'kind={"data"}' in source and 'kind={"automation"}' in source
    # An unknown shape is left to inference instead of failing the call.
    assert '<WorkflowNode id={"x"} label={"Explain policy"} />' in source
    assert '<WorkflowEdge source={"ok"} target={"pay"} type={"animated"} label={"Yes"} />' in source
    assert 'label={"' + ("No" * 20) + '"}' in source
    assert len(STEP_KINDS) == 11


@pytest.mark.asyncio
async def test_render_workflow_connects_steps_in_order_when_connections_are_omitted():
    from agent.api.core.render_ui_tool import render_workflow

    source = (await render_workflow(title="Intake", steps=[{"id": "a", "label": "A"}, {"id": "b", "label": "B"},
                                                          {"id": "c", "label": "C"}]))["content"][0]["json"]["ui"]["source"]
    assert '<WorkflowEdge source={"a"} target={"b"} type={"animated"} />' in source
    assert '<WorkflowEdge source={"b"} target={"c"} type={"animated"} />' in source


@pytest.mark.asyncio
@pytest.mark.parametrize("kwargs", [
    dict(title="", steps=[{"id": "a", "label": "A"}]),
    dict(title="T", steps=[]),
    dict(title="T", steps=[{"id": "a", "label": "A"}, {"id": "a", "label": "B"}]),
    dict(title="T", steps=[{"id": "bad id", "label": "A"}]),
    dict(title="T", steps=[{"id": "a", "label": "  "}]),
    dict(title="T", steps=[{"id": "a", "label": "A"}], connections=[{"source": "a", "target": "missing"}]),
    dict(title="T", steps=[{"id": "a", "label": "A"}], connections=[{"source": "a", "target": "a"}]),
    dict(title="T", steps=[{"id": "a", "label": "A"}, {"id": "b", "label": "B"}],
         connections=[{"source": "a", "target": "b", "type": "dotted"}]),
    dict(title="T", steps=[{"id": f"s{n}", "label": "S"} for n in range(61)]),
])
async def test_render_workflow_rejects_invalid_graphs(kwargs):
    from agent.api.core.render_ui_tool import render_workflow

    with pytest.raises(ValueError):
        await render_workflow(**kwargs)


def test_every_agent_gets_render_workflow():
    from agent.api.core.live_tools import live_host_tools
    from agent.api.core.panel_agent import PROJECT_TOOLS_DIR, SKILLS_AND_SPECIALISTS_DIRECTIVE
    from agent.api.core.panel_tools import CORE_TOOL_NAMES, build_core_tools

    assert "render_workflow" in CORE_TOOL_NAMES
    assert "render_workflow" in {tool.tool_name for tool in build_core_tools(PROJECT_TOOLS_DIR)}
    assert "render_workflow" in {tool.tool_name for tool in live_host_tools(PROJECT_TOOLS_DIR)}
    assert "render_workflow" in SKILLS_AND_SPECIALISTS_DIRECTIVE
