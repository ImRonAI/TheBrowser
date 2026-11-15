# Scholarly & Executive PDF Publication Rubric

## 1. Typography & Page Geometry
- **Page Format**: US Letter (`8.5in × 11in`) with `0.85in` horizontal and `0.8in` vertical print margins, running header (document title), and running footer (source attribution + `pageNumber / totalPages`).
- **Hierarchy**:
  - Cover/Banner Block: Kicker (`REN DEEP RESEARCH · VERIFIED DOSSIER`), bold display title, inquiry metadata strip, and executive summary framing.
  - Body Copy: High-legibility serif typography (`10.5pt–11pt`, `1.58` line-height) for sustained scholarly reading, paired with crisp sans-serif headings and monospace code/data spans.
- **Pagination Hygiene**:
  - Enforce `break-inside: avoid` on tables, figures, callout boxes, and blockquotes.
  - Enforce `break-after: avoid` on all section headings (`h1`–`h4`) so headings are never orphaned at page bottoms.

## 2. Tables, Callouts & Citations
- Render comparative GFM tables with subtle header shading, crisp horizontal rules, tabular numerals (`font-variant-numeric: tabular-nums`), and zero horizontal clipping.
- Preserve every inline `[Title](https://...)` hyperlink as an active clickable PDF link and ensure a clean `## Sources` / bibliography section appears at the end of the document.
- Stamp PDF document metadata (`Title`, `Author="Ren Deep Research"`, `Subject`) and verify `page_count >= 1` via `pypdf.PdfReader`.
