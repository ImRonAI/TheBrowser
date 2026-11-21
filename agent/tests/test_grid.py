"""Spreadsheets: the grid agents write, the block a page keeps, the fence agents read back and the Excel file."""
from __future__ import annotations

import base64
import io
import json
import zipfile

from fastapi import HTTPException
from pydantic import ValidationError
import pytest

from agent.api.core.document_export import export_document
from agent.api.core.grid import (
    GRID_MARKDOWN, XLSX_MEDIA_TYPE, column_letter, grid_block_html, grid_from_json, grid_markdown, grid_xlsx,
    normalize_grid,
)
from agent.api.core.media_understanding import html_to_markdown, markdown_to_html
from agent.api.endpoints.projects import DocumentUpdate, GridExport, export_grid

_GRID = {"title": "Fleet costs", "sheets": [
    {"name": "Fleet", "rows": [
        ["Model", "Units", "Unit cost", "Total", "Share", "Site"],
        ["Atlas", 1000, 4.5, "=B2*C2", "=D2/D4", "https://example.com/atlas"],
        ["Borealis <new>", 250, 12.25, "=B3*C3", "=D3/D4", True],
        ["Total", "=SUM(B2:B3)", None, "=SUM(D2:D3)"],
    ], "formats": {"B": "#,##0", "C": "$#,##0.00", "D": "$#,##0.00", "E": "0.0%"}},
    {"name": "Notes", "rows": [["Note"], ["Costs are per unit."]]},
]}
#: What the spreadsheet calculated for the first sheet's formulas.
_VALUES = [[[], [None, None, None, 4500, 0.595], [None, None, None, 3062.5, 0.405], [None, 1250, None, 7562.5]]]


def test_column_letters() -> None:
    assert [column_letter(index) for index in (0, 25, 26, 27, 701, 702)] == ["A", "Z", "AA", "AB", "ZZ", "AAA"]


def test_a_grid_is_normalized_to_named_sheets_of_plain_cells() -> None:
    grid = normalize_grid({"title": "  Costs  ", "sheets": [
        {"name": "Costs", "rows": [["a", 1, 2.5, True, None], "not a row", [float("nan"), {"x": 1}, [1]]],
         "formats": {"B": "#,##0", "b": "0", "C": "", "D": 3}},
        "not a sheet",
        {"name": "costs", "rows": []},
        {"name": " Q1: plan / [draft]  and a name that is far too long for Excel "},
        {"rows": [[1]]},
    ]})
    assert grid is not None and grid["title"] == "Costs"
    assert [sheet["name"] for sheet in grid["sheets"]] == ["Costs", "Sheet2", "Q1 plan draft and a name that i", "Sheet4"]
    assert grid["sheets"][0] == {"name": "Costs", "rows": [["a", 1, 2.5, True, None], [None, None, None]],
                                 "formats": {"B": "#,##0"}}
    assert "formats" not in grid["sheets"][1] and grid["sheets"][2]["rows"] == []
    assert normalize_grid(grid) == grid
    assert normalize_grid({"title": "x", "sheets": []}) is None and normalize_grid([1]) is None
    assert normalize_grid({"sheets": [{"rows": []}]}) == {"title": "Spreadsheet", "sheets": [{"name": "Sheet1", "rows": []}]}
    unnamed = normalize_grid({"sheets": [{"name": "sheet2"}, {}]})
    assert unnamed is not None and [sheet["name"] for sheet in unnamed["sheets"]] == ["sheet2", "Sheet3"]
    assert grid_from_json("{not json") is None and grid_from_json("3") is None
    assert grid_from_json(json.dumps(_GRID)) == _GRID


def test_agents_write_a_fence_the_page_keeps_as_a_grid_block_and_read_the_fence_back() -> None:
    fence = grid_markdown(_GRID)
    assert fence.startswith('```grid\n{"title": "Fleet costs", "sheets": [\n    {"name": "Fleet", "formats": {')
    assert '      ["Atlas", 1000, 4.5, "=B2*C2", "=D2/D4", "https://example.com/atlas"],\n' in fence
    page = markdown_to_html(f"Costs by model.\n\n{fence}\n\nDone.\n")
    assert page.startswith("<p>Costs by model.</p>\n<grid-block data-grid=\"{&quot;title&quot;")
    assert "<caption>Fleet</caption><tbody><tr><th>Model</th><th>Units</th>" in page
    assert "<td>Borealis &lt;new&gt;</td><td>250</td><td>12.25</td><td>=B3*C3</td><td>=D3/D4</td><td>TRUE</td>" in page
    assert "<tr><td>Total</td><td>=SUM(B2:B3)</td><td></td><td>=SUM(D2:D3)</td><td></td><td></td></tr>" in page
    assert page.rstrip().endswith("</grid-block>\n<p>Done.</p>") and "language-grid" not in page
    assert html_to_markdown(page) == f"Costs by model.\n\n{fence}\n\nDone."


def test_a_grid_the_editor_calculated_reads_back_as_the_grid_not_what_it_shows() -> None:
    shown = grid_block_html(_GRID).replace("<td>=B2*C2</td>", "<td>$4,500.00</td>")
    for marks in ('data-calculated=""', 'data-calculated="" data-workbook="{&quot;sheetOrder&quot;:[&quot;sheet-1&quot;]}"'):
        saved = shown.replace('"><table>', f'" {marks}><table>', 1)
        assert f" {marks}>" in saved and "$4,500.00" in saved and html_to_markdown(saved) == grid_markdown(_GRID)


def test_a_fence_that_holds_no_grid_stays_code_and_a_broken_block_reads_as_its_tables() -> None:
    assert "language-grid" in markdown_to_html("```grid\nnot a grid\n```\n")
    assert "language-grid" in markdown_to_html('```grid\n{"sheets": []}\n```\n')
    broken = '<grid-block data-grid="{">' "<table><tbody><tr><th>Model</th></tr><tr><td>Atlas</td></tr></tbody></table></grid-block>"
    assert "| Model |" in html_to_markdown(broken) and "| Atlas |" in html_to_markdown(broken)
    assert "```grid" in GRID_MARKDOWN


def test_the_excel_file_keeps_formulas_with_their_results_formats_and_a_frozen_header() -> None:
    archive = zipfile.ZipFile(io.BytesIO(grid_xlsx(_GRID, _VALUES)))
    workbook = archive.read("xl/workbook.xml").decode()
    assert '<sheet name="Fleet" sheetId="1"' in workbook and '<sheet name="Notes" sheetId="2"' in workbook
    assert 'fullCalcOnLoad="1"' in workbook
    sheet = archive.read("xl/worksheets/sheet1.xml").decode()
    assert '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' in sheet
    assert "<f>B2*C2</f><v>4500</v>" in sheet and "<f>SUM(D2:D3)</f><v>7562.5</v>" in sheet
    assert '<c r="B2" s="2"><v>1000</v></c>' in sheet and '<c r="F3" t="b"><v>1</v></c>' in sheet
    styles = archive.read("xl/styles.xml").decode()
    assert 'formatCode="$#,##0.00"' in styles and 'formatCode="0.0%"' in styles and "<b/>" in styles
    assert "https://example.com/atlas" in archive.read("xl/worksheets/_rels/sheet1.xml.rels").decode()
    # A formula with no result given is left for the reader to calculate.
    bare = zipfile.ZipFile(io.BytesIO(grid_xlsx(_GRID))).read("xl/worksheets/sheet1.xml").decode()
    assert "<f>B2*C2</f><v></v>" in bare


@pytest.mark.asyncio
async def test_the_export_endpoint_answers_the_file_as_a_page_export_does() -> None:
    exported = await export_grid(GridExport(grid=_GRID, values=_VALUES))
    assert exported["filename"] == "Fleet costs.xlsx" and exported["media_type"] == XLSX_MEDIA_TYPE
    archive = zipfile.ZipFile(io.BytesIO(base64.b64decode(exported["data"])))
    assert "<f>B2*C2</f><v>4500</v>" in archive.read("xl/worksheets/sheet1.xml").decode()
    with pytest.raises(HTTPException) as refused:
        await export_grid(GridExport(grid={"title": "Empty", "sheets": []}))
    assert refused.value.status_code == 422


@pytest.mark.asyncio
async def test_a_page_with_a_grid_prints_its_tables() -> None:
    page = (await export_document("Fleet", grid_block_html(_GRID), "html"))["data"].decode()
    assert "<caption>Fleet</caption>" in page and "grid-block table" in page
    word = zipfile.ZipFile(io.BytesIO((await export_document("Fleet", grid_block_html(_GRID), "docx"))["data"]))
    body = word.read("word/document.xml").decode()
    assert body.count("<w:tbl>") == 2 and "Borealis &lt;new&gt;" in body and "=SUM(D2:D3)" in body


def test_a_page_past_what_a_document_holds_is_refused_in_the_words_the_page_reads() -> None:
    # ``documentErrorMessage`` (src/lib/project-documents.ts) reads this as a page too large to save.
    with pytest.raises(ValidationError, match="at most 2000000 characters"):
        DocumentUpdate(version=1, content="x" * 2_000_001)
