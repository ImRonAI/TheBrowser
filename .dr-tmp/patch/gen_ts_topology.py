"""One-off: mirror the backend FORMATION_TOPOLOGY into src/lib/deep-research-api.ts (data only)."""
import json
from pathlib import Path
from typing import Any, Final

here = Path(__file__).parent
ns: dict[str, Any] = {"Any": Any, "Final": Final}
exec((here / "D_topology.txt").read_text(encoding="utf-8"), ns)
topology = ns["FORMATION_TOPOLOGY"]


def q(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


def emit(value: Any, indent: int) -> str:
    pad, inner = "  " * indent, "  " * (indent + 1)
    if isinstance(value, dict):
        items = [(k, v) for k, v in value.items() if v not in (None, [], "")]
        flat = "{ " + ", ".join(f"{k}: {emit(v, 0)}" for k, v in items) + " }"
        if all(not isinstance(v, (dict, list)) for _, v in items) and len(pad) + len(flat) <= 100:
            return flat
        return "{\n" + "".join(f"{inner}{k}: {emit(v, indent + 1)},\n" for k, v in items) + pad + "}"
    if isinstance(value, list):
        return "[\n" + "".join(f"{inner}{emit(v, indent + 1)},\n" for v in value) + pad + "]"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return q(value)
    return json.dumps(value)


target = here.parent.parent / "src" / "lib" / "deep-research-api.ts"
text = target.read_text(encoding="utf-8")
start = "export const DEFAULT_FORMATION_TOPOLOGY: FormationTopology = "
end = "\n\nexport type DeepResearchRunStatus ="
a = text.index(start) + len(start)
b = text.index(end, a)
text = text[:a] + emit(topology, 0) + text[b:]
target.write_text(text, encoding="utf-8")
print("ok")
