import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


@pytest.fixture(autouse=True)
def _default_enable_perplexity_for_tests(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("RON_PERPLEXITY_AGENT_API", raising=False)
    monkeypatch.delenv("RON_PERPLEXITY_SEARCH", raising=False)

