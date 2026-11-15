<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: build-with-pdf

- **Category:** Delivery
- **Curated practice:** Generate and inspect the PDF with the web build; use an explicit URL when supplying an externally produced PDF.
- **Deep-dive workflow:** [exporting.md](../exporting.md)
- **Canonical documentation:** https://sli.dev/features/build-with-pdf.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/build-with-pdf.md
description: |
  Generate a downloadable PDF along with your slides build.
---

# Generate PDF when Building

You can provide a downloadable PDF in your built slides with the following config in headmatter:

```md
---
download: true
---
```

Slidev will generate a PDF file along with the build, and a download button will be displayed in the build.

You can also provide a custom URL for the PDF. In that case, the rendering process will be skipped.

```md
---
download: 'https://myside.com/my-talk.pdf'
---
```

This can also be done with the CLI option `--download` (`boolean` only).

```bash
$ slidev build --download
```

When using the download option, you can also provide the export options via:

* [CLI export options](https://sli.dev/builtin/cli#export)
* [Headmatter export options](https://sli.dev/custom/#headmatter)
