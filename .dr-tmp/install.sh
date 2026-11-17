#!/bin/bash
# Installs the Deep Research skill library with the Skills CLI (https://skills.sh), by the book:
# `npx skills add <owner/repo> --skill <name> -a universal -y` run from agent/skills/deep-research,
# which writes .agents/skills/<name>/ and skills-lock.json there.
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here/../agent/skills/deep-research" || exit 1
export DISABLE_TELEMETRY=1
add() { npx -y skills add "$@" -a universal -y; }
{
  add mattpocock/skills --skill research
  add daymade/claude-code-skills --skill fact-checker
  add k-dense-ai/scientific-agent-skills --skill citation-management --skill peer-review --skill scientific-visualization --skill scientific-writing --skill scientific-slides
  add wshobson/agents --skill data-storytelling
  add anthropics/knowledge-work-plugins --skill data-visualization
  add anthropics/skills --skill theme-factory --skill pdf
  add slidevjs/slidev --skill slidev
  add coreyhaines31/marketingskills --skill copy-editing
  add obra/superpowers --skill verification-before-completion
  add vercel-labs/skills --skill find-skills
  echo "--- installed ---"
  ls .agents/skills
  echo DONE
} > "$here/install.txt" 2>&1
