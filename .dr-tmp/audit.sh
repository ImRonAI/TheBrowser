#!/bin/bash
# Temporary: prints the skills.sh security audit the Skills CLI shows at install, for each library skill,
# installing into a throwaway folder; then swaps fact-checker for scientific-critical-thinking in the library.
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$here/audit" && cd "$here/audit" || exit 1
add() { npx -y skills add "$@" -a universal -y; }
{
  add mattpocock/skills --skill research
  add k-dense-ai/scientific-agent-skills --skill citation-management --skill peer-review --skill scientific-visualization --skill scientific-writing --skill scientific-slides --skill scientific-critical-thinking
  add wshobson/agents --skill data-storytelling
  add anthropics/knowledge-work-plugins --skill data-visualization
  add anthropics/skills --skill theme-factory --skill pdf
  add slidevjs/slidev --skill slidev
  add coreyhaines31/marketingskills --skill copy-editing
  add obra/superpowers --skill verification-before-completion
  add vercel-labs/skills --skill find-skills
  echo AUDIT_DONE
  cd "$here/../agent/skills/deep-research" || exit 1
  export DISABLE_TELEMETRY=1
  npx -y skills remove fact-checker -a universal -y
  add k-dense-ai/scientific-agent-skills --skill scientific-critical-thinking
  echo "--- library ---"; ls .agents/skills; cat skills-lock.json
  echo DONE
} > "$here/audit.txt" 2>&1
