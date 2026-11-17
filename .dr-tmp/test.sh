#!/bin/bash
# Temporary: runs the Deep Research checks on this Mac and writes the output to .dr-tmp/test.txt.
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here/.." || exit 1
{
  if [ -d agent/skills/deep-research/.agents/skills/fact-checker ]; then
    (cd agent/skills/deep-research && DISABLE_TELEMETRY=1 npx -y skills remove fact-checker -y 2>&1 | tail -4)
  fi
  echo "=== library ==="; ls agent/skills/deep-research/.agents/skills | tr '\n' ' '; echo
  echo "=== pytest ==="
  ./venv/bin/python -m pytest agent/tests/test_deep_research_graph.py agent/tests/test_deep_research_api.py -q --no-header --tb=short -p no:cacheprovider "$@" 2>&1 | tail -150
  echo "=== node tests ==="
  node --experimental-strip-types --test src/lib/deep-research-api.test.ts src/lib/deep-research-graph.test.ts 2>&1 | tail -70
  echo "=== typecheck ==="
  npm run typecheck 2>&1 | tail -40
  echo DONE
} > "$here/test.txt" 2>&1
