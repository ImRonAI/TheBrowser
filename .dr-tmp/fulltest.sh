#!/bin/bash
# Temporary: runs the whole backend test suite on this Mac and writes the output to .dr-tmp/fulltest.txt.
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here/.." || exit 1
{
  ./venv/bin/python -m pytest agent/tests -q --no-header --tb=short -p no:cacheprovider 2>&1 | grep -v 'context_window_limit' | tail -60
  echo DONE
} > "$here/fulltest.txt" 2>&1
