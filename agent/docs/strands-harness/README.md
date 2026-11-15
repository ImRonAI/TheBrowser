# Strands Harness Documentation (`agent/docs/strands-harness/`)

This directory holds reference documentation for **`strands-harness`** and its composition with the pinned **Strands Python SDK**:

- **[PINNED_0.1.2_REFERENCE.md](./PINNED_0.1.2_REFERENCE.md)** — **Authoritative ground truth for Ren**: line-by-line source verification of installed `strands-harness==0.1.2` (`./venv/lib/python3.14/site-packages/strands_harness/`) + pinned `strands` (`563f57d7a387931760a2c3106014cd7c0db4c9bc` = `v1.57.2` + `deploy/strands-bidi.patch`), including exact API signatures, portable JSON config schema, `AgentSkills` / `Skill` / `SKILL.md` frontmatter behavior, `make_subagent` & `Agent.as_tool()` `use_skill` subagent mechanics, skill-only `Graph` / `Swarm` formation node recipes, `_BackgroundTasks` / `strands_manage_background_task` internals, cross-agent async Deep Research tool patterns, and exact diffs against upstream `v0.3.4` docs.
- **[PACKAGE_README_0.1.2.md](./PACKAGE_README_0.1.2.md)** — Exact README extracted from installed `strands_harness-0.1.2.dist-info/METADATA`.
- **[upstream/](./upstream/)** — Upstream `strandsagents.com/docs/user-guide/harness/` and related SDK skills/subagent/agents-as-tools guides (`v0.3.4` / `v1.58+`; always consult `PINNED_0.1.2_REFERENCE.md` §1 for module paths and defaults that differ in `0.1.2`).
