"""A Document as a PDF, HTML and Word file, through the real converters (Chromium and pandoc)."""
from __future__ import annotations

import base64
import io
import zipfile

import pypdf
import pytest

from agent.api.core.document_export import export_document, filename
from agent.api.core.render_ui_tool import workflow_block_html, workflow_graph

#: A 1x1 PNG.
_PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
_CONTENT = (
    "<p>Costs fell 40%[1].</p><table><tr><th>Year</th><th>Cost</th></tr><tr><td>2024</td><td>$120</td></tr></table>"
    f'<p><img src="data:image/png;base64,{base64.b64encode(_PNG).decode()}" alt="Cost"></p>'
    + workflow_block_html("Permitting", workflow_graph([{"id": "a", "label": "Apply"}, {"id": "b", "label": "Approve"}], None))
)


def test_the_file_name_is_the_title_without_path_characters() -> None:
    assert filename('Grid: costs / "2026"', "pdf") == "Grid  costs    2026.pdf"
    assert filename("  ", "docx") == "Untitled.docx"


@pytest.mark.asyncio
async def test_html_is_a_standalone_page_with_the_title() -> None:
    exported = await export_document("Grid <storage>", _CONTENT, "html")
    page = exported["data"].decode()
    assert exported["media_type"] == "text/html; charset=utf-8"
    assert page.startswith("<!doctype html>") and "<title>Grid &lt;storage&gt;</title>" in page
    assert "<li>Apply</li>" in page and "data:image/png;base64," in page


@pytest.mark.asyncio
async def test_pdf_prints_the_page() -> None:
    exported = await export_document("Grid storage", _CONTENT, "pdf")
    text = pypdf.PdfReader(io.BytesIO(exported["data"])).pages[0].extract_text()
    assert exported["filename"] == "Grid storage.pdf"
    assert "Grid storage" in text and "Costs fell 40%[1]." in text and "Approve" in text


@pytest.mark.asyncio
async def test_word_keeps_the_text_table_and_image() -> None:
    exported = await export_document("Grid storage", _CONTENT, "docx")
    archive = zipfile.ZipFile(io.BytesIO(exported["data"]))
    body = archive.read("word/document.xml").decode()
    assert "Costs fell 40%[1]." in body and "<w:tbl>" in body and "Approve" in body
    assert any(name.startswith("word/media/") for name in archive.namelist())
