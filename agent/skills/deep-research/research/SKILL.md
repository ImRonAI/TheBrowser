---
name: research
description: Investigate a question against high-trust primary sources and capture
  the findings as a Markdown file in the repo. Use when the user wants a topic researched,
  docs or API facts gathered, or reading legwork delegated to a background agent.
allowed-tools: brave_web_search brave_answer extract_article_content search_saved_context
license: MIT
compatibility: skills.sh / Ren Deep Research (Strands SDK 1.57.2 / strands-harness
  0.1.2)
metadata:
  role: leaf
  stage: investigation
  pillar: deep-research
  context: none
  source: skills.sh
  skills_sh_url: https://skills.sh/mattpocock/skills/research
  github_repo: mattpocock/skills
  github_stars: 324389
  install_command: npx skills add mattpocock/skills --skill research
  security_audits:
    gen_agent_trust_hub: Pass
    socket: Pass
    snyk: Pass
---

# Research

Spin up a **background agent** to do the research, so you keep working while it reads. Start it with a fresh context window.

Its job:

1. Investigate the question against **primary sources** (official docs, source code, specs, first-party APIs), not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Write the findings to a single Markdown file, citing each claim's source.
3. Save it where the repo already keeps such notes; match the existing convention, and if there is none, put it somewhere sensible and say where.
