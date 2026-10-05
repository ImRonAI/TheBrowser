"""On-demand (paid) before/after proof for a tool repair (CAT-51, task 17).

Runs ``strands_evals`` ``Experiment``/``Case`` with ``ToolParameterAccuracyEvaluator`` and
``ToolSelectionAccuracyEvaluator`` over the five demonstrations of a stored revision, once on the
vendored baseline and once on the repaired revision, and stores ``eval.json`` next to the manifest.

Skipped unless ``RON_TOOL_REPAIR_EVAL=1`` **and** ``RON_TOOL_REPAIR_EVAL_USER``/``..._TOOL``/``..._REV``
point at an existing verified revision; needs ``PERPLEXITY_API_KEY`` (LLM judges) and the
panel storage of the environment (``PANEL_STORAGE``). Never part of the default pytest run.

    RON_TOOL_REPAIR_EVAL=1 RON_TOOL_REPAIR_EVAL_USER=<id> RON_TOOL_REPAIR_EVAL_TOOL=<tool> \
    RON_TOOL_REPAIR_EVAL_REV=<rev> ./venv/bin/python -m pytest agent/tests/evals -q
"""

from __future__ import annotations

import asyncio
import json
import os

import pytest

pytestmark = pytest.mark.skipif(os.getenv("RON_TOOL_REPAIR_EVAL") != "1", reason="paid eval; set RON_TOOL_REPAIR_EVAL=1")


def _agent_for(revision_file, tool_name: str, source_path: str):
    from strands import Agent

    from agent.api.core.panel_agent import PROJECT_TOOLS_DIR, build_model
    from agent.api.core.panel_tools import load_library_tool

    tool = load_library_tool(PROJECT_TOOLS_DIR, PROJECT_TOOLS_DIR / source_path, tool_name, revision_file=revision_file)
    model = build_model("perplexity", os.getenv("RON_TOOL_REPAIR_EVAL_MODEL", "openai/gpt-5.4-nano"), None, hosted_tools=False)
    return Agent(model=model, tools=[tool], callback_handler=None,
                 system_prompt=f"You must call the `{tool_name}` tool with exactly the input the user gives you, then report its result verbatim.")


def test_before_after_proof_writes_eval_json():
    user_id, tool_name, rev = (os.getenv(name) for name in ("RON_TOOL_REPAIR_EVAL_USER", "RON_TOOL_REPAIR_EVAL_TOOL", "RON_TOOL_REPAIR_EVAL_REV"))
    if not (user_id and tool_name and rev):
        pytest.skip("RON_TOOL_REPAIR_EVAL_USER/TOOL/REV are required")
    from strands_evals import Case, Experiment
    from strands_evals.evaluators import ToolParameterAccuracyEvaluator, ToolSelectionAccuracyEvaluator

    from agent.api.core import tool_repair
    from agent.api.core.panel_agent import build_model

    manifest = asyncio.run(tool_repair.read_manifest(user_id, tool_name, rev))
    assert manifest is not None and manifest["status"] in ("verified", "active", "rolled_back")
    revision_file = asyncio.run(tool_repair.materialize_revision(user_id, tool_name, rev))
    demonstrations = [d for d in manifest["demonstrations"] if not d.get("dry_run")]
    assert demonstrations, "only dry-run demonstrations: nothing can be executed for real"
    cases = [Case(name=f"{d['kind']}-{i}", input=f"Call {tool_name} with input {json.dumps(d['input'])}.",
                  expected_output=d.get("expected", ""), metadata={"kind": d["kind"], "source": d.get("source")})
             for i, d in enumerate(demonstrations)]
    judge = build_model("perplexity", os.getenv("RON_TOOL_REPAIR_EVAL_MODEL", "openai/gpt-5.4-nano"), None, hosted_tools=False)
    evaluators = [ToolParameterAccuracyEvaluator(model=judge), ToolSelectionAccuracyEvaluator(model=judge)]

    def run(revision):
        def task(case: Case):
            agent = _agent_for(revision, tool_name, manifest["source_path"])
            try:
                result = agent(case.input)
                return {"output": str(result), "trajectory": [str(result.stop_reason)]}
            finally:
                agent.cleanup()
        return Experiment(cases=cases, evaluators=evaluators).run_evaluations(task)

    baseline = run(None)
    repaired = run(revision_file)
    report = {"tool_name": tool_name, "revision": rev, "cases": len(cases),
              "baseline": baseline.model_dump(mode="json"), "repaired": repaired.model_dump(mode="json"),
              "baseline_score": baseline.calculate_overall_score(), "repaired_score": repaired.calculate_overall_score()}
    asyncio.run(tool_repair.repair_storage(user_id).write(f"{tool_name}/{rev}/eval.json",
                                                           json.dumps(report, ensure_ascii=False, indent=2).encode()))
    assert report["repaired_score"] >= report["baseline_score"]
