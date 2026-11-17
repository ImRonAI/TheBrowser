#!/bin/bash
# Temporary: shows why one panel test fails (to confirm it is unrelated to the Deep Research change).
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here/.." || exit 1
{
  ./venv/bin/python -m pytest "agent/tests/test_panel_composition.py::test_browser_kwarg_configures_only_the_selected_server" -q --no-header --tb=long -p no:cacheprovider 2>&1 | tail -70
  echo "--- same test with the dev stack's env cleared ---"
  env -u RON_BROWSER_DEFAULT -u API_PORT -u API_HOST ./venv/bin/python -m pytest "agent/tests/test_panel_composition.py::test_browser_kwarg_configures_only_the_selected_server" -q --no-header --tb=line -p no:cacheprovider 2>&1 | tail -6
  echo DONE
} > "$here/onetest.txt" 2>&1
