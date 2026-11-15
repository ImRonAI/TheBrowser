# Exporting PDF, PNG, PPTX, Markdown, and notes

Primary: [exporting](https://sli.dev/guide/exporting.html), [CLI](https://sli.dev/builtin/cli.html#export), [build with PDF](features/build-with-pdf.md), [global layers](features/global-layers.md).

## Choose the artifact by need

| Format | Strength | Important limitation |
|---|---|---|
| SPA | Full Vue interaction, live code, video, web navigation | Requires hosting/browser; interactivity not in static exports |
| PDF | Portable faithful raster/vector view, handouts, backup | No live interaction; click default is final state |
| PPTX (`--format pptx`) | Familiar presenting/editing container, notes carried over, best PPTX visual fidelity | Each slide/click state is an image; text not selectable |
| Editable PPTX (`pptx-editable`) | Rebuilds native selectable/movable shapes and text, notes carried over | Lossy coverage/fallback; browser/PowerPoint text metrics/fonts differ |
| PNG | Individual frames for publishing/review/fallback | No navigation/animation or selectable text |
| MD (`--format md`) | Compiled Markdown using PNGs | Image-based, not a faithful source content transform |
| Notes PDF (`export-notes`) | Only slides with notes, with title/slide number, no previews | Requires Playwright; not full slide handout |

Install `playwright-chromium` locally as a deliberate dev dependency for CLI exports. Browser exporter UI is available at `/export` with modern Chromium; use CLI for editable PPTX and reproducible automation.

## Core commands and options

```sh
slidev export slides.md --format pdf --output output/deck.pdf
slidev export slides.md --format pptx --with-clicks false --output output/deck.pptx
slidev export slides.md --format pptx-editable --output output/editable.pptx
slidev export slides.md --format png --output output/frames
slidev export slides.md --range 1,6-8,10 --with-toc --dark
slidev export-notes slides.md --output output/speaker-notes.pdf
```

- Default `output`: `exportFilename` from headmatter or entry-derived name. `--output` overrides.
- `--timeout` defaults 30000 ms. `--wait` adds a delay before export, and documented `--wait-until networkidle|domcontentloaded|load|none` controls navigation readiness. Default `networkidle` is safest for ordinary assets but can hang with persistent connections. Diagnose stalled requests before bypassing them.
- `--range` chooses specific slide numbers/ranges; multiple entries export separate decks. `--dark` selects dark; verify it exists in the theme.
- `--with-clicks/-c` produces pages/slides per click. Default false for PDF/PNG/MD; true for PPTX formats. Explicit `--with-clicks false` when final-state PPTX is desired.
- `--omit-background` affects browser transparency, not every CSS background. Transparent exports need explicit application background styling.
- `--executable-path` selects Chrome/Edge for codecs when needed. Do not hardcode one developer's machine path into committed config.
- `--with-toc` creates PDF outline; `export.withToc` is headmatter equivalent. Export options use camelCase in YAML.
- `--per-slide` matters when nav-dependent global layers must recalculate per exported slide. It is not supported with `pptx-editable`; prefer per-slide layers where possible.

## Editable PowerPoint reality

Text, basic boxes, and supported styling can become native shapes. SVG (including Mermaid/icons), canvas, iframe, videos, KaTeX, CSS gradients, filter, backdrop-filter, mix-blend-mode, and clip-path stay pictures when no PowerPoint equivalent exists. Whole-slide fallback occurs when safe reconstruction is impossible or mostly images; CLI prints reasons.

Fonts are named, not embedded. Recipients need them installed. Browser and PowerPoint wrap text differently. Theme `::before`/`::after` normal-flow decorations and CSS-generated code-block line numbers may be omitted; exporter reports relevant decorations. Image PPTX remains best for fidelity, even if native editing is wanted. Inspect the actual output in target PowerPoint/LibreOffice, not only the CLI exit status.

## Persistent/global layers, code, and animation

Navigation-dependent global layers may capture stale state unless `--per-slide` is used or `slide-top.vue`/`slide-bottom.vue` is selected. Static exports do not include Monaco interaction, hover TwoSlash types, playing video, or future motion states. Supply final deterministic output/poster and test click policies. Magic Move/code animations can be several export pages, or a single finished code state; choose explicitly.

## Build with downloadable PDF

`download: true` in headmatter or `slidev build --download` generates PDF alongside build and enables its download button. `download: 'https://example.com/deck.pdf'` links a custom URL and skips rendering. The `--download` CLI form is boolean. Build download also requires appropriate browser dependencies and should be checked on production base path.

## Troubleshooting and output QA

- **Blank/missing/unfinished content:** inspect network and console; use targeted `--wait` after app readiness, or documented wait mode; ensure preloading/animation hooks settle.
- **Video codecs:** use browser-compatible encoding or executable path, preserve poster/transcript.
- **Broken emoji/CJK:** install required fonts before browser installation/capture in CI; Noto CJK/Emoji may be necessary. Prefer pinned generated OG or local fonts.
- **Fonts/text wrap:** compare PDF/PNG and editable PPTX separately; check fallback/charset availability.
- **Wrong notes or privacy:** notes may carry to PPTX and SPA. Build `--without-notes` for public SPA, and inspect outputs/metadata.
- **Count/content:** compare exported count to expected slide × click policy/range; extract PDF text or inspect PPTX ZIP structure for actual notes and slide count as supplementary checks.

Generate to a separate output folder, open representative pages, and report actual output paths and any live-only limitations. An existing nonempty file does not prove visual or semantic correctness.
