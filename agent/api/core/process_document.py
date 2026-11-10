from html import escape
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

CapabilityKind = Literal["tool", "mcp_server", "skill", "subagent"]
CapabilityDisposition = Literal["existing", "new", "unavailable"]

# Render order and labels for the four categories the learning SOP assesses separately.
CAPABILITY_KINDS: tuple[tuple[CapabilityKind, str], ...] = (
    ("tool", "Tools"),
    ("mcp_server", "MCP servers"),
    ("skill", "Agent skills"),
    ("subagent", "Subagents"),
)


class ProcessStep(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    instructions: str = Field(min_length=1, max_length=12000)
    expected_outcome: str = Field(min_length=1, max_length=4000)
    evidence_sequences: list[int] = Field(min_length=1, max_length=1000)


class CapabilityRequirement(BaseModel):
    """One capability the learned workflow depends on, assessed before the workflow is written."""

    model_config = ConfigDict(extra="forbid")
    kind: CapabilityKind = Field(description="Category of capability: tool, mcp_server, skill, or subagent.")
    name: str = Field(min_length=1, max_length=200, description="Exact registry name of the capability, as listed by tool_catalog or the MCP/skill configuration.")
    purpose: str = Field(min_length=1, max_length=2000, description="Which workflow steps need it and what it does for them.")
    source: str = Field(min_length=1, max_length=500, description="Where it comes from: installed strands_tools, the vendored catalog, a configured MCP server, a taught or configured skill, a stored specialist agent (list_harness_agents), an A2A agent, or the lesson workspace.")
    disposition: CapabilityDisposition = Field(description="existing = already available and preferred over a duplicate; new = must be authored in the lesson workspace or created with create_harness at publication; unavailable = genuinely missing or blocked.")
    loader: str | None = Field(default=None, max_length=500, description="Native loading mechanism, e.g. tool_catalog(action=\"load\", name=...). Omit when none is known.")
    verification: str | None = Field(default=None, max_length=1000, description="How successful registration is verified in the agent registry. Omit when none is known.")


class ProcessDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    overview: str = Field(min_length=1, max_length=6000)
    prerequisites: list[str] = Field(max_length=50)
    inputs: list[str] = Field(max_length=50)
    steps: list[ProcessStep] = Field(min_length=1, max_length=80)
    completion_criteria: list[str] = Field(min_length=1, max_length=50)
    exceptions: list[str] = Field(max_length=50)
    # Default keeps reviews persisted before capability analysis valid; an empty list means "not recorded", not "none".
    capabilities: list[CapabilityRequirement] = Field(default_factory=list, max_length=80,
        description="Every tool, MCP server, agent skill, and subagent the workflow depends on, assessed per category. Prefer existing capabilities; list genuinely missing ones as unavailable.")
    implementation: str = Field(default="", max_length=6000,
        description="The most efficient way to perform this workflow from now on and why: compare reusing existing tools, skills, MCP servers or specialist agents with connecting an MCP server, authoring a tool or script, writing an Agent Skill, or creating a specialist agent with create_harness. The learned workflow is always published as a native Agent SOP.")
    questions: list[str] = Field(default_factory=list, max_length=30,
        description="Questions the user must answer before approval; each one changes the workflow if answered differently. Empty when nothing is unresolved.")


def render_capabilities(capabilities: list[CapabilityRequirement]) -> str:
    """Escaped table covering all four categories, with an explicit row for each category that needs nothing."""
    if not capabilities:
        return '<p class="quiet">No capability requirements were recorded in this revision.</p>'

    def cell(value: str | None, empty: str = "—") -> str:
        return escape(value) if value else f'<span class="quiet">{escape(empty)}</span>'

    rows = []
    for kind, label in CAPABILITY_KINDS:
        matching = [capability for capability in capabilities if capability.kind == kind]
        if not matching:
            rows.append(f'<tr><th scope="row">{escape(label)}</th><td colspan="6" class="quiet">None required.</td></tr>')
            continue
        for capability in matching:
            rows.append(
                f'<tr><th scope="row">{escape(label)}</th><td><code>{escape(capability.name)}</code></td>'
                f'<td>{escape(capability.purpose)}</td><td>{escape(capability.source)}</td>'
                f'<td><span class="disposition" data-disposition="{escape(capability.disposition)}">{escape(capability.disposition)}</span></td>'
                f'<td>{cell(capability.loader)}</td><td>{cell(capability.verification)}</td></tr>'
            )
    return ('<table class="capabilities"><thead><tr><th scope="col">Category</th><th scope="col">Name</th><th scope="col">Purpose</th>'
            '<th scope="col">Source</th><th scope="col">Disposition</th><th scope="col">Loading</th><th scope="col">Verification</th></tr></thead>'
            f'<tbody>{"".join(rows)}</tbody></table>')


def render_process_document(document: ProcessDocument, revision: int, created_at: str) -> str:
    def items(values: list[str], empty: str) -> str:
        return "<ul>" + "".join(f"<li>{escape(value)}</li>" for value in values) + "</ul>" if values else f"<p class=\"quiet\">{escape(empty)}</p>"

    stages = "".join(
        f'<li class="stage"><div class="stage-number" aria-hidden="true">{index:02}</div>'
        f'<div><h3>{escape(step.title)}</h3><p class="instructions">{escape(step.instructions)}</p>'
        f'<div class="outcome"><span class="label">Expected outcome</span><p>{escape(step.expected_outcome)}</p></div>'
        f'<p class="evidence">Journal evidence: {", ".join(str(sequence) for sequence in step.evidence_sequences)}</p></div></li>'
        for index, step in enumerate(document.steps, 1)
    )
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>{escape(document.title)} — Process review</title><style>
/* Portable snapshot of tailwind.config.ts surface/ink/accent and type tokens, plus Tailwind's spacing scale.
   System font stacks keep saved HTML self-contained under its resource-denying CSP. */
:root{{color-scheme:light dark;
--surface-0:#FFFFFF;--surface-50:#FAFAFA;--surface-100:#F5F5F5;--surface-200:#E5E5E5;--surface-400:#A3A3A3;--surface-700:#262626;--surface-800:#171717;--surface-850:#121212;
--ink-default:#0A0A0A;--ink-secondary:#525252;--accent-indigo:#3730A3;--accent-subtle:#C7D2FE;
--font-body:system-ui,sans-serif;--font-display:Georgia,serif;--font-mono:ui-monospace,monospace;
--text-display-lg:3rem;--text-display-sm:1.875rem;--text-body-lg:1.125rem;--text-body-md:1rem;--text-body-sm:.875rem;--text-body-xs:.75rem;--text-label:.6875rem;
--leading-body:1.625;--leading-display:1.25;--tracking-display:-.01em;--tracking-label:.05em;--weight-normal:400;--weight-semibold:600;
--space-0:0;--space-half:.125rem;--space-1:.25rem;--space-2:.5rem;--space-3:.75rem;--space-4:1rem;--space-5:1.25rem;--space-6:1.5rem;--space-7:1.75rem;--space-8:2rem;--space-10:2.5rem;--space-12:3rem;--space-16:4rem;--reading-width:56rem;--overview-width:70ch;
--paper:var(--surface-50);--ink:var(--ink-default);--muted:var(--ink-secondary);--rule:var(--surface-200);--accent:var(--accent-indigo);--wash:var(--surface-100)}}
*{{box-sizing:border-box}}body{{margin:var(--space-0);background:var(--paper);color:var(--ink);font-family:var(--font-body);font-size:var(--text-body-md);font-weight:var(--weight-normal);line-height:var(--leading-body)}}
article{{max-width:var(--reading-width);margin:auto;padding:var(--space-12) var(--space-12) var(--space-16)}}header{{border-bottom:1px solid var(--rule);padding-bottom:var(--space-8);margin-bottom:var(--space-8)}}
.eyebrow,.label,.evidence,.metadata{{font-family:var(--font-mono);font-size:var(--text-label);letter-spacing:var(--tracking-label)}}
.eyebrow{{color:var(--accent);text-transform:uppercase;margin:var(--space-0) var(--space-0) var(--space-4)}}h1,h2{{font-family:var(--font-display);font-weight:var(--weight-normal);line-height:var(--leading-display)}}
h1{{font-size:clamp(var(--text-display-sm),5vw,var(--text-display-lg));margin:var(--space-0) var(--space-0) var(--space-5);letter-spacing:var(--tracking-display)}}h2{{font-size:var(--text-display-sm);margin:var(--space-0) var(--space-0) var(--space-4)}}h3{{font-size:var(--text-body-lg);margin:var(--space-0) var(--space-0) var(--space-3);font-weight:var(--weight-semibold)}}
p{{margin:var(--space-0) var(--space-0) var(--space-3);overflow-wrap:anywhere}}.overview{{font-size:var(--text-body-lg);max-width:var(--overview-width)}}.metadata,.quiet,.evidence{{color:var(--muted)}}
.metadata{{margin-top:var(--space-6)}}.preparation{{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-8);border-bottom:1px solid var(--rule);padding-bottom:var(--space-7);margin-bottom:var(--space-8)}}
ul{{margin:var(--space-0);padding-left:var(--space-5)}}li{{padding-left:var(--space-1);margin-bottom:var(--space-2);overflow-wrap:anywhere}}.stages{{list-style:none;padding:var(--space-0);margin:var(--space-0)}}
.stage{{display:grid;grid-template-columns:var(--space-10) 1fr;gap:var(--space-4);margin:var(--space-0);padding:var(--space-6) var(--space-0);border-top:1px solid var(--rule)}}
.stage-number{{font-family:var(--font-mono);font-size:var(--text-body-md);color:var(--accent);padding-top:var(--space-half)}}.instructions{{white-space:pre-wrap}}
.outcome{{background:var(--wash);border-left:2px solid var(--accent);padding:var(--space-3) var(--space-4);margin:var(--space-4) var(--space-0) var(--space-3)}}.outcome p{{margin:var(--space-1) var(--space-0) var(--space-0);white-space:pre-wrap}}
.label{{color:var(--accent);text-transform:uppercase}}.evidence{{margin:var(--space-0)}}.closing{{border-top:1px solid var(--rule);padding-top:var(--space-7);margin-top:var(--space-4)}}
.capabilities{{width:100%;border-collapse:collapse;font-size:var(--text-body-sm);margin-top:var(--space-2)}}.capabilities th,.capabilities td{{text-align:left;vertical-align:top;padding:var(--space-2) var(--space-3);border-top:1px solid var(--rule);overflow-wrap:anywhere}}
.capabilities thead th{{font-family:var(--font-mono);font-size:var(--text-label);letter-spacing:var(--tracking-label);text-transform:uppercase;color:var(--muted);border-top:none;font-weight:var(--weight-normal)}}
.capabilities tbody th{{font-weight:var(--weight-semibold);white-space:nowrap}}.capabilities code{{font-family:var(--font-mono);font-size:var(--text-body-sm)}}
.disposition{{font-family:var(--font-mono);font-size:var(--text-label);letter-spacing:var(--tracking-label);text-transform:uppercase;padding:var(--space-half) var(--space-2);border:1px solid var(--rule);white-space:nowrap}}
.disposition[data-disposition="existing"]{{color:var(--accent);border-color:var(--accent)}}.disposition[data-disposition="unavailable"]{{background:var(--wash)}}
footer{{margin-top:var(--space-10);border-top:1px solid var(--rule);padding-top:var(--space-4);color:var(--muted);font-size:var(--text-body-xs)}}
@media(prefers-color-scheme:dark){{:root{{--paper:var(--surface-850);--ink:var(--surface-100);--muted:var(--surface-400);--rule:var(--surface-700);--accent:var(--accent-subtle);--wash:var(--surface-800)}}}}
@media(max-width:560px){{article{{padding:var(--space-7) var(--space-5) var(--space-10)}}.preparation{{grid-template-columns:1fr;gap:var(--space-6)}}.stage{{grid-template-columns:var(--space-7) 1fr;gap:var(--space-3)}}.capabilities{{display:block;overflow-x:auto}}}}
@media print{{:root{{--paper:var(--surface-0);--ink:var(--ink-default);--muted:var(--ink-secondary);--rule:var(--surface-200);--accent:var(--ink-default);--wash:var(--surface-100)}}article{{padding:var(--space-0)}}.stage{{break-inside:avoid}}}}
</style></head><body><article aria-labelledby="process-title"><header>
<p class="eyebrow">Ren · Learning a New Skill · Process review</p><h1 id="process-title">{escape(document.title)}</h1>
<p class="overview">{escape(document.overview)}</p><p class="metadata">Revision {revision} · {escape(created_at)} · {len(document.steps)} steps · {len(document.capabilities)} capabilities</p></header>
<section class="preparation" aria-label="Preparation"><div><h2>Before you begin</h2>{items(document.prerequisites, "No additional prerequisites were identified.")}</div>
<div><h2>Inputs</h2>{items(document.inputs, "No additional inputs were identified.")}</div></section>
<section class="closing" aria-labelledby="questions-heading"><h2 id="questions-heading">Questions for you</h2>{items(document.questions, "Ren has no open questions about this revision.")}<p class="quiet">Answer them in the correction box; Ren prepares a new revision with your answers.</p></section>
<section class="closing" aria-labelledby="implementation-heading"><h2 id="implementation-heading">Recommended implementation</h2>{f'<p class="instructions">{escape(document.implementation)}</p>' if document.implementation else '<p class="quiet">No implementation recommendation was recorded in this revision.</p>'}</section>
<section class="closing" aria-labelledby="capabilities-heading"><h2 id="capabilities-heading">Required capabilities</h2><p class="quiet">Tools, MCP servers, agent skills, and subagents the workflow depends on. Existing capabilities are preferred; nothing is loaded or created until this revision is approved.</p>{render_capabilities(document.capabilities)}</section>
<section aria-labelledby="workflow-heading"><h2 id="workflow-heading">The workflow</h2><ol class="stages">{stages}</ol></section>
<section class="closing"><h2>What done looks like</h2>{items(document.completion_criteria, "")}</section>
<section class="closing"><h2>Exceptions &amp; open questions</h2>{items(document.exceptions, "No unresolved exceptions were identified in this revision.")}</section>
<footer>This document describes the recorded process and its capability plan. Review its details and approve the current revision in the teaching studio before generating a skill.</footer>
</article></body></html>'''
