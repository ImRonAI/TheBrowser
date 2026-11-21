"""A Document as a file: a standalone HTML page, a PDF printed from it by Playwright's Chromium, or a Word document
converted from it by pandoc (pypandoc_binary bundles pandoc).

The page is the editor's saved HTML (images are data URLs there), so all three carry the page's text, tables,
images and links; a workflow block keeps the outline of its steps, as the editor writes it for readers without the
editor.
"""
from __future__ import annotations

import asyncio
from datetime import date
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

#: ren's Ink & Volt (ren's ``tailwind.config.ts`` and ``src/index.css``): Bricolage Grotesque for display, Inter for
#: text, JetBrains Mono for labels; ink #0B0C17, volt #5543FF, flat surfaces, 12 px cards. Without the network the page
#: falls back to the system's fonts.
_FONTS: Final[str] = (
    "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,400..800"
    "&family=Inter:wght@400..700&family=JetBrains+Mono:wght@400..600&display=swap"
)

_STYLE: Final[str] = """
:root { --ink: #0B0C17; --ink-2: #3A3B4A; --muted: #6B6C7E; --volt: #5543FF; --rule: #E3E3EC; --surface: #F5F5F9; }
body { font-family: Inter, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: var(--ink); line-height: 1.65;
       max-width: 46rem; margin: 2.5rem auto; padding: 0 1.25rem; font-size: 15px; }
h1, h2, h3, h4 { font-family: "Bricolage Grotesque", Inter, sans-serif; line-height: 1.15; letter-spacing: -0.015em;
                 page-break-after: avoid; }
h1 { font-size: 2.1em; font-weight: 700; } h2 { font-size: 1.5em; font-weight: 650; margin-top: 2em; }
h3 { font-size: 1.18em; font-weight: 600; margin-top: 1.6em; }
h2::before { content: ""; display: block; width: 2.25rem; height: 3px; background: var(--volt); margin-bottom: 0.6em;
             border-radius: 2px; }
.ren-cover { padding: 0 0 1.6rem; margin-bottom: 2rem; border-bottom: 1px solid var(--rule); }
.ren-mark { font-family: "Bricolage Grotesque", Inter, sans-serif; font-weight: 800; font-size: 1.35rem;
            letter-spacing: -0.04em; }
.ren-mark span { color: var(--volt); }
.ren-cover h1 { font-size: 2.9em; font-weight: 750; letter-spacing: -0.03em; margin: 1.6rem 0 0.8rem; }
.ren-date { font-family: "JetBrains Mono", Menlo, monospace; font-size: 0.78em; letter-spacing: 0.08em;
            text-transform: uppercase; color: var(--muted); }
p, li { color: var(--ink); } li { margin: 0.25em 0; }
img { max-width: 100%; height: auto; border-radius: 12px; border: 1px solid var(--rule); }
table { border-collapse: separate; border-spacing: 0; width: 100%; margin: 1.2em 0; font-size: 0.9em;
        border: 1px solid var(--rule); border-radius: 12px; overflow: hidden; }
th, td { padding: 0.55em 0.75em; text-align: left; vertical-align: top; border-bottom: 1px solid var(--rule); }
tr:last-child td { border-bottom: none; }
th { background: var(--surface); font-weight: 600; font-size: 0.92em; }
caption { caption-side: top; text-align: left; padding: 0 0.94em 0.5em; font-family: "JetBrains Mono", Menlo, monospace;
          font-size: 0.8em; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
blockquote { border-left: 3px solid var(--volt); margin: 1.2em 0; padding: 0.3em 1.1em; color: var(--ink-2); }
pre { background: var(--surface); padding: 0.9em 1.1em; border-radius: 12px; overflow-x: auto; font-size: 0.86em; }
code { font-family: "JetBrains Mono", Menlo, Consolas, monospace; }
a { color: var(--volt); text-decoration: none; }
hr { border: none; border-top: 1px solid var(--rule); margin: 2em 0; }
img, table, pre, blockquote, workflow-block { page-break-inside: avoid; }
grid-block { display: block; } grid-block table { page-break-inside: auto; } grid-block tr { page-break-inside: avoid; }
@page { margin: 18mm 16mm 20mm; }
@media print { body { margin: 0 auto; font-size: 10.5pt; } }
"""

#: The PDF's footer on every page: the title and the page number, as Chromium's print templates fill them.
_FOOTER: Final[str] = (
    '<div style="width:100%;padding:0 16mm;display:flex;justify-content:space-between;'
    'font-family:\'JetBrains Mono\',Menlo,monospace;font-size:7.5pt;letter-spacing:0.06em;color:#6B6C7E">'
    '<span class="title"></span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>'
)


class ExportedFile(TypedDict):
    filename: str
    media_type: str
    data: bytes


def filename(title: str, extension: str) -> str:
    """The page's title as a file name."""
    stem = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', " ", title).strip().strip(".") or "Untitled"
    return f"{stem[:120]}.{extension}"


def standalone_html(title: str, content: str) -> str:
    """The page as a complete HTML document: a ren cover with its title and date, then the page, in Ink & Volt."""
    heading = html.escape(title)
    today = date.today().strftime("%B %-d, %Y")
    return (
        "<!doctype html>\n<html><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        f"<title>{heading}</title><link rel=\"stylesheet\" href=\"{html.escape(_FONTS)}\"><style>{_STYLE}</style></head>"
        f"<body><header class=\"ren-cover\"><div class=\"ren-mark\">ren<span>.</span></div><h1>{heading}</h1>"
        f"<div class=\"ren-date\">{today}</div></header>\n{content}\n</body></html>\n"
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
            await page.evaluate("document.fonts.ready")
            return await page.pdf(format="Letter", print_background=True, display_header_footer=True,
                                  header_template="<span></span>", footer_template=_FOOTER,
                                  margin={"top": "18mm", "bottom": "20mm", "left": "16mm", "right": "16mm"})
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
