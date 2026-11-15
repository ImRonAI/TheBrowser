<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: comark

- **Category:** Syntax
- **Curated practice:** Opt in intentionally; keep Markdown readable and test any MDC/Comark examples copied from older documentation.
- **Deep-dive workflow:** [syntax.md](../syntax.md)
- **Canonical documentation:** https://sli.dev/features/comark.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/comark.md
description: |
  A powerful syntax to enhance your markdown content with components and styles.
---

# Comark Syntax

Slidev supports optional [Comark Syntax](https://comark.dev/syntax/markdown) (formerly known as MDC, Markdown Components) powered by [`@comark/markdown-it`](https://github.com/comarkdown/comark).

You can enable it by adding `comark: true` to the frontmatter of your markdown file.

```mdc
---
comark: true
---

This is a [red text]{style="color:red"} :inline-component{prop="value"}

![](/image.png){width=500px lazy}

::block-component{prop="value"}
The **default** slot
::
```

Learn more about [Comark Syntax](https://comark.dev/syntax/markdown).
