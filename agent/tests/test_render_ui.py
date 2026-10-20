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
