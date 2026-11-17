"""A Document as a file: a standalone HTML page, a PDF printed from it by Playwright's Chromium, or a Word document
converted from it by pandoc (pypandoc_binary bundles pandoc).

The page is the editor's saved HTML (images are data URLs there), so all three carry the page's text, tables,
images and links; a workflow block keeps the outline of its steps, as the editor writes it for readers without the
editor.
"""
from __future__ import annotations

import asyncio
import html
from pathlib import Path
import re
import tempfile
from typing import Final, Literal, TypedDict

ExportFormat = Literal["pdf", "html", "docx"]

MEDIA_TYPES: Final[dict[ExportFormat, str]] = {
    "pdf": "application/pdf",
    "html": "text/html; charset=utf-8",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

_STYLE: Final[str] = """
body { font-family: Inter, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #0B0C17; line-height: 1.6;
       max-width: 46rem; margin: 2.5rem auto; padding: 0 1.25rem; font-size: 15px; }
h1, h2, h3 { line-height: 1.25; page-break-after: avoid; }
h1 { font-size: 2em; } h2 { font-size: 1.45em; margin-top: 1.8em; } h3 { font-size: 1.15em; }
img { max-width: 100%; height: auto; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.92em; }
th, td { border: 1px solid #d6d7e0; padding: 0.4em 0.6em; text-align: left; vertical-align: top; }
th { background: #f3f3f7; }
blockquote { border-left: 3px solid #5543FF; margin: 1em 0; padding: 0.2em 1em; color: #3a3b4a; }
pre { background: #f3f3f7; padding: 0.8em 1em; border-radius: 8px; overflow-x: auto; font-size: 0.88em; }
code { font-family: "JetBrains Mono", Menlo, Consolas, monospace; }
a { color: #5543FF; }
img, table, pre, blockquote, workflow-block { page-break-inside: avoid; }
@page { margin: 18mm 16mm; }
"""


class ExportedFile(TypedDict):
    filename: str
    media_type: str
    data: bytes


def filename(title: str, extension: str) -> str:
    """The page's title as a file name."""
    stem = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', " ", title).strip().strip(".") or "Untitled"
    return f"{stem[:120]}.{extension}"


def standalone_html(title: str, content: str) -> str:
    """The page as a complete HTML document: its title as the heading and the print styles."""
    heading = html.escape(title)
    return (
        "<!doctype html>\n<html><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        f"<title>{heading}</title><style>{_STYLE}</style></head>"
        f"<body><h1>{heading}</h1>\n{content}\n</body></html>\n"
    )


async def _pdf(page_html: str) -> bytes:
    from playwright.async_api import Error as PlaywrightError, async_playwright

    async with async_playwright() as playwright:
        args = ["--no-sandbox", "--disable-dev-shm-usage"]
        try:
            browser = await playwright.chromium.launch(headless=True, args=args)
        except PlaywrightError:
            # Playwright's own Chromium isn't installed (a desktop without `playwright install`): use Chrome, as the
            # reader does (core/articles.py).
            browser = await playwright.chromium.launch(channel="chrome", headless=True, args=args)
        try:
            page = await browser.new_page()
            await page.set_content(page_html, wait_until="load")
            return await page.pdf(format="Letter", print_background=True,
                                  margin={"top": "18mm", "bottom": "18mm", "left": "16mm", "right": "16mm"})
        finally:
            await browser.close()


def _docx(page_html: str) -> bytes:
    import pypandoc

    with tempfile.TemporaryDirectory() as directory:
        output = Path(directory) / "document.docx"
        pypandoc.convert_text(page_html, "docx", format="html", outputfile=str(output), sandbox=True)
        return output.read_bytes()


async def export_document(title: str, content: str, format: ExportFormat) -> ExportedFile:
    """The page as a PDF, HTML or Word file."""
    page_html = standalone_html(title, content)
    if format == "html":
        data = page_html.encode("utf-8")
    elif format == "pdf":
        data = await _pdf(page_html)
    else:
        data = await asyncio.to_thread(_docx, page_html)
    return {"filename": filename(title, format), "media_type": MEDIA_TYPES[format], "data": data}
