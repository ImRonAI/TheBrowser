"""One-off: rewrite agent/api/core/deep_research.py for the set skill-agent formation."""
from pathlib import Path

here = Path(__file__).parent
target = here.parent.parent / "agent" / "api" / "core" / "deep_research.py"
text = target.read_text(encoding="utf-8")
block = lambda name: (here / name).read_text(encoding="utf-8")


def once(old: str, new: str, count: int = 1) -> None:
    global text
    found = text.count(old)
    assert found == count, f"expected {count} of {old[:70]!r}, found {found}"
    text = text.replace(old, new)


def span(start: str, end: str, new: str) -> None:
    """Replace from the start of `start` up to (not including) `end`."""
    global text
    assert text.count(start) == 1, f"start not unique: {start[:70]!r} ({text.count(start)})"
    a = text.index(start)
    b = text.index(end, a)
    text = text[:a] + new + text[b:]


# 1. module docstring
span('"""Deep Research Native Skill Formations & Asynchronous Runtime.', "from __future__ import annotations", block("A_docstring.txt") + "\n")

# 2. imports
once("import asyncio\nfrom collections import deque\n", "import asyncio\nimport base64\nfrom collections import deque\n")
once("import logging\nimport os\n", "import logging\nimport mimetypes\nimport os\n")
once("import subprocess\nimport tempfile\n", "import subprocess\nimport sys\nimport tempfile\n")
once("from strands import Agent, tool\n", "from strands import Agent, tool\nfrom strands.handlers import null_callback_handler\n")
once("    AfterNodeCallEvent,\n    BeforeMultiAgentInvocationEvent,", "    AfterNodeCallEvent,\n    AgentInitializedEvent,\n    BeforeMultiAgentInvocationEvent,")
once("from strands.vended_plugins.skills import AgentSkills, Skill\n", "from strands.vended_plugins.skills import Skill\n")
once("from strands_harness.tools import AgentSpec, Fixed, Inherit, Preset, make_subagent\n", "")

# 3. constants
span("DEEP_RESEARCH_SKILLS_DIR: Final[Path] = Path(__file__)", "FORBIDDEN_LEAF_TOOL_NAMES: Final[frozenset[str]]", block("C_constants.txt"))

# 4. topology
span("FORMATION_TOPOLOGY: dict[str, Any] = {", "def get_formation_topology()", block("D_topology.txt") + "\n")

# 5. local images in the compiled report and deck
once("def _make_markdown_renderer() -> MarkdownIt:", block("G_inline.txt") + "def _make_markdown_renderer() -> MarkdownIt:")
tpl = text.index('_SCHOLARLY_REPORT_HTML_TEMPLATE: Final[str] = """')
style_end = text.index("\n  </style>", tpl)
text = text[:style_end] + "\n    {{ extra_css }}" + text[style_end:]
once(
    '    citations: Sequence[Mapping[str, str]] = (),\n) -> dict[str, Any]:\n    """Write ``report.md`` and compile',
    '    citations: Sequence[Mapping[str, str]] = (),\n    css: str = "",\n) -> dict[str, Any]:\n    """Write ``report.md`` and compile',
)
once("body_html = md_renderer.render(body_md or clean_md)", "body_html = md_renderer.render(_inline_local_images(body_md or clean_md, artifact_dir))")
once("        extra_citations=extra_citations,\n    )", '        extra_citations=extra_citations,\n        extra_css=css.replace("</style", ""),\n    )')
once(
    '            shutil.copy2(slides_md_path, tmp_dir / "slides.md")\n',
    '            (tmp_dir / "slides.md").write_text(\n'
    '                _inline_local_images(slides_md_path.read_text(encoding="utf-8"), slides_md_path.parent),\n'
    '                encoding="utf-8",\n'
    "            )\n",
)
once('"html": md_renderer.render(item["markdown"]),', '"html": md_renderer.render(_inline_local_images(item["markdown"], artifact_dir)),')

# 6. skills loader
once(
    '"""Load all native AgentSkills under ``agent/skills/deep-research/`` via ``Skill.from_directory``."""',
    '"""Load every Agent Skill in ``DEEP_RESEARCH_SKILLS_DIR`` via ``Skill.from_directory``."""',
)
span("def _skill_instructions(skill: Skill) -> str:", "def _assert_allowed_leaf_tool_name(tool_name: str) -> None:", "")

# 7. tool pool
once(
    '"""Construct the vetted research & studio compilation tool pool available ONLY to leaf ``use_skill`` subagents."""',
    '"""Construct the research & studio compilation tools every Deep Research skill agent gets (no browser automation)."""',
)
once(
    '    async def compile_scholarly_pdf(markdown_content: str = "", title: str = "") -> dict[str, Any]:\n'
    '        """Compile the verified Markdown research dossier into ``report.md`` and publication-grade ``report.pdf``.\n'
    "\n"
    "        Args:\n"
    "            markdown_content: Complete Markdown report body (defaults to the verified executive_editor dossier if omitted).\n"
    "            title: Optional explicit document title for the masthead and PDF metadata.\n"
    '        """\n'
    '        effective_md = (markdown_content or "").strip()\n',
    '    async def compile_scholarly_pdf(markdown_content: str = "", title: str = "", css: str = "") -> dict[str, Any]:\n'
    '        """Compile the Markdown report into ``report.md`` and a styled ``report.pdf`` in the run\'s workspace.\n'
    "\n"
    "        Args:\n"
    "            markdown_content: Complete Markdown report body; omit it to compile the workspace's ``report.md``.\n"
    "            title: Optional explicit document title for the masthead and PDF metadata.\n"
    "            css: Optional CSS appended to the report stylesheet (typography, colour, figures, tables, ``@page``).\n"
    '        """\n'
    '        effective_md = (markdown_content or "").strip()\n'
    '        report_file = resolved_artifact_dir / "report.md"\n'
    "        if not effective_md and report_file.is_file():\n"
    '            effective_md = report_file.read_text(encoding="utf-8").strip()\n',
)
once("            citations=effective_citations,\n        )", "            citations=effective_citations,\n            css=css,\n        )")
once(
    "            slides_markdown: Complete Slidev Markdown deck separated by ``---`` (enforces ``routerMode: hash`` in headmatter).\n",
    "            slides_markdown: Complete Slidev Markdown deck separated by ``---`` (enforces ``routerMode: hash`` in\n"
    "                headmatter); omit it to compile the workspace's ``slides.md``.\n",
)
once(
    '        effective_slides = (slides_markdown or "").strip()\n        if not effective_slides:\n',
    '        effective_slides = (slides_markdown or "").strip()\n'
    '        slides_file = resolved_artifact_dir / "slides.md"\n'
    "        if not effective_slides and slides_file.is_file():\n"
    '            effective_slides = slides_file.read_text(encoding="utf-8").strip()\n'
    "        if not effective_slides:\n",
)
once(
    "    _register(compile_slidev_deck)\n",
    "    _register(compile_slidev_deck)\n"
    "    # Tavily and Exa each require their own API key, so each joins the pool only where it is configured.\n"
    '    if os.getenv("TAVILY_API_KEY"):\n'
    "        from strands_tools import tavily\n"
    "\n"
    "        for tavily_tool in (tavily.tavily_search, tavily.tavily_extract, tavily.tavily_crawl, tavily.tavily_map):\n"
    "            _register(tavily_tool)\n"
    '    if os.getenv("EXA_API_KEY"):\n'
    "        from strands_tools import exa\n"
    "\n"
    "        for exa_tool in (exa.exa_search, exa.exa_get_contents):\n"
    "            _register(exa_tool)\n",
)

# 8. conditions
span("def all_investigation_branches_completed(", "def _extract_node_result_text(node_result: NodeResult | None) -> str:", "")
span("def should_refine(", "def _resolve_default_selection(", block("H_condition.txt"))

# 9. builder
once(
    "def build_deep_research_graph(",
    "def _silence_agent(event: AgentInitializedEvent) -> None:\n"
    '    """Stop an agent, and the ``subagent`` children the harness builds from it, printing to the server log."""\n'
    "    event.agent.callback_handler = null_callback_handler\n"
    "\n\n"
    "def build_deep_research_graph(",
)
span(
    '    """Build the 3-level nested Strands ``Graph`` + ``Swarm`` Deep Research formation.',
    "# ─────────────────────────────────────────────────────────────────────────────\n# Citation Extraction & Preview Helpers",
    block("I_builder.txt").replace("                callback_handler=None,\n", "                hooks=[_silence_agent],\n"),
)

# 10. runtime
once(
    "                if full_path == [\"synthesis_formation\", \"executive_editor\"] and full_node_text:\n"
    "                    run.report_markdown = full_node_text\n"
    "                    run._report_source_node = \"executive_editor\"\n"
    "                elif (\n"
    "                    full_path == [\"synthesis_formation\", \"slidev_producer\"]\n"
    "                    and full_node_text\n"
    "                    and \"---\" in full_node_text\n"
    "                    and not (session_artifact_dir / \"slides.md\").is_file()\n"
    "                ):\n"
    "                    run.slidev_markdown = full_node_text\n",
    "",
)
once('["synthesis_formation", "pdf_publisher"]', '["production_graph", "pdf_publisher"]')
once('["synthesis_formation", "slidev_producer"]', '["production_graph", "deck_producer"]')
once(
    '                extra_fields["slidev_markdown"] = str(compiled["slidev_markdown"])\n',
    '                extra_fields["slidev_markdown"] = str(compiled["slidev_markdown"])\n'
    '            if kind == "report_pdf" and (session_artifact_dir / "report.md").is_file():\n'
    '                extra_fields["report_markdown"] = (session_artifact_dir / "report.md").read_text(encoding="utf-8")\n',
)
once(
    '# 1. Child subagent stream events emitted by `make_subagent(name="use_skill", ...)`.',
    "# 1. Child agent stream events emitted by the harness's built-in `subagent` tool.",
)
once('tool_use.get("name") != "use_skill"', 'tool_use.get("name") != "subagent"')
once('inp.get("agent_type") or inp.get("preset") or "use_skill")', 'inp.get("agent_type") or inp.get("preset") or "subagent")', count=2)
once(
    "# 2. Orchestrator message boundaries (catch `use_skill` start/stop even when 0 stream chunks fired).",
    "# 2. The agent's own message boundaries (catch `subagent` start/stop even when 0 stream chunks fired).",
)
once('if tu.get("name") != "use_skill":', 'if tu.get("name") != "subagent":')
once('skill_meta.get(skill_id, ("use_skill", time.monotonic()))', 'skill_meta.get(skill_id, ("subagent", time.monotonic()))', count=2)
span(
    "            # Extract authoritative final report from synthesis_formation when available.",
    "            if extracted_report:\n                cits = _extract_citations_from_payload(extracted_report, fallback_source=\"report\")",
    "            # The report the writing swarm saved to the workspace is the authoritative final report.\n"
    "            extracted_report = run.report_markdown.strip()\n"
    '            report_disk_path = session_artifact_dir / "report.md"\n'
    "            if report_disk_path.is_file():\n"
    '                extracted_report = report_disk_path.read_text(encoding="utf-8").strip() or extracted_report\n'
    "\n",
)
once('await _emit_new_citations(cits, ["synthesis_formation", "executive_editor"])', 'await _emit_new_citations(cits, ["writing_swarm", "report_writer"])')
once(
    "                        candidate_slides_md = (\n"
    "                            run.slidev_markdown.strip()\n"
    '                            if "---" in run.slidev_markdown\n',
    '                        slides_file = session_artifact_dir / "slides.md"\n'
    "                        candidate_slides_md = (\n"
    '                            slides_file.read_text(encoding="utf-8")\n'
    "                            if slides_file.is_file()\n",
)

# 11. exports
once('    "all_investigation_branches_completed",\n', "")
once('    "should_refine",\n    "should_synthesize",\n', "")
once('    "load_deep_research_skills",\n', '    "load_deep_research_skills",\n    "qa_requests_revision",\n')

target.write_text(text, encoding="utf-8")
print("patched", target, len(text.splitlines()), "lines")
