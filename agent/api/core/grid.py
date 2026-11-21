"""Spreadsheets in Documents and Squad's DataGrid outcome.

A grid is what agents write and read: JSON with sheets of rows, in a ```grid fence. A page keeps it as the editor's
grid block, ``<grid-block data-grid="{…}">`` with a table per sheet, which is what prints and what a reader without
the editor sees (``src/lib/grid.ts`` reads and writes the same block). Once the editor's spreadsheet has calculated a
grid, the block is marked ``data-calculated`` and its tables hold what each cell shows; once the grid has been changed
there, the block also carries the workbook the spreadsheet keeps (``data-workbook``). Agents still read and write the
grid.
"""

from __future__ import annotations

import html
import json
import math
import re
from typing import Final, NotRequired, TypedDict

GridCell = str | int | float | bool | None


class GridSheet(TypedDict):
    name: str
    rows: list[list[GridCell]]
    #: A column's Excel number format by its letter.
    formats: NotRequired[dict[str, str]]


class Grid(TypedDict):
    title: str
    sheets: list[GridSheet]


#: A grid's JSON, as agents are told to write it.
GRID_JSON: Final[str] = (
    '{"title": ..., "sheets": [{"name": ..., "rows": [[...], ...], "formats": {"B": "#,##0"}}]}. The first row of a '
    'sheet is its header; a cell is a number, true or false, text, or a formula as text starting with "=" in A1 '
    'notation ("=SUM(B2:B9)", "=Sheet2!B4*0.2"); "formats" is optional and gives a column\'s Excel number format by '
    "its letter."
)

#: What Excel refuses in a sheet's name, which is 31 characters at most; runs of spaces read as one.
_SHEET_NAME_CHARS: Final[re.Pattern[str]] = re.compile(r"[\[\]:*?/\\\s]+")
_COLUMN: Final[re.Pattern[str]] = re.compile(r"[A-Z]+")
_GRID_FENCE: Final[re.Pattern[str]] = re.compile(r'<pre><code class="language-grid">(.*?)</code></pre>', re.DOTALL)


def _cell(value: object) -> GridCell:
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value if isinstance(value, (str, int, float, bool)) else None


def normalize_grid(value: object) -> Grid | None:
    """A grid from JSON anyone wrote: every sheet with a name of its own and rows of plain cells; None when it holds
    no sheet."""
    if not isinstance(value, dict) or not isinstance(value.get("sheets"), list):
        return None
    sheets: list[GridSheet] = []
    taken: set[str] = set()
    for raw in value["sheets"]:
        if not isinstance(raw, dict):
            continue
        name = raw.get("name")
        name = _SHEET_NAME_CHARS.sub(" ", name).strip()[:31].strip() if isinstance(name, str) else ""
        number = len(sheets) + 1
        while not name or name.lower() in taken:
            name, number = f"Sheet{number}", number + 1
        taken.add(name.lower())
        rows = raw.get("rows")
        sheet: GridSheet = {
            "name": name,
            "rows": [[_cell(cell) for cell in row] for row in rows if isinstance(row, list)]
            if isinstance(rows, list) else [],
        }
        formats = raw.get("formats")
        kept = {
            letter: pattern for letter, pattern in formats.items()
            if isinstance(letter, str) and _COLUMN.fullmatch(letter) and isinstance(pattern, str) and pattern
        } if isinstance(formats, dict) else {}
        if kept:
            sheet["formats"] = kept
        sheets.append(sheet)
    if not sheets:
        return None
    title = value.get("title")
    return {"title": (title.strip()[:120] if isinstance(title, str) else "") or "Spreadsheet", "sheets": sheets}


def grid_from_json(text: str) -> Grid | None:
    """The grid a ```grid fence, a grid block's ``data-grid`` or a run's grid.json holds, or None when it isn't one."""
    try:
        return normalize_grid(json.loads(text))
    except ValueError:
        return None


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False)


def grid_markdown(grid: Grid) -> str:
    """A grid as its ```grid fence: a row a line, so a sheet reads as a table."""
    sheets = ",\n".join(
        f'    {{"name": {_json(sheet["name"])}'
        + (f', "formats": {_json(sheet["formats"])}' if "formats" in sheet else "")
        + ', "rows": [\n'
        + ",\n".join(f"      {_json(row)}" for row in sheet["rows"])
        + "\n    ]}"
        for sheet in grid["sheets"]
    )
    return f'```grid\n{{"title": {_json(grid["title"])}, "sheets": [\n{sheets}\n]}}\n```'


def _shown(cell: GridCell) -> str:
    """A cell as it reads before a spreadsheet has calculated it: as written, a formula as its text."""
    if cell is None:
        return ""
    if isinstance(cell, bool):
        return "TRUE" if cell else "FALSE"
    if isinstance(cell, float) and cell.is_integer():
        return str(int(cell))
    return str(cell)


def grid_block_html(grid: Grid) -> str:
    """The editor's grid block for a grid no spreadsheet has calculated yet: the grid, and a table per sheet with each
    cell as written."""
    tables: list[str] = []
    for sheet in grid["sheets"]:
        width = max((len(row) for row in sheet["rows"]), default=0)
        rows = "".join(
            "<tr>"
            + "".join(
                f"<{tag}>{html.escape(_shown(cell))}</{tag}>" for cell in [*row, *[None] * (width - len(row))]
            )
            + "</tr>"
            for tag, row in (("td" if r else "th", row) for r, row in enumerate(sheet["rows"]))
        )
        tables.append(f"<table><caption>{html.escape(sheet['name'])}</caption><tbody>{rows}</tbody></table>")
    return f'<grid-block data-grid="{html.escape(_json(grid), quote=True)}">{"".join(tables)}</grid-block>'


def with_grid_blocks(page_html: str) -> str:
    """Rendered Markdown with every ```grid fence as the editor's grid block; a fence that holds no grid stays code."""

    def block(match: re.Match[str]) -> str:
        grid = grid_from_json(html.unescape(match.group(1)))
        return grid_block_html(grid) if grid else match.group(0)

    return _GRID_FENCE.sub(block, page_html)
