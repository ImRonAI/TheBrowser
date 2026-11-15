<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: block-frontmatter

- **Category:** Syntax
- **Curated practice:** Useful for YAML editor highlighting on later slides; never substitute it for the opening headmatter.
- **Deep-dive workflow:** [syntax.md](../syntax.md)
- **Canonical documentation:** https://sli.dev/features/block-frontmatter.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/block-frontmatter.md
description: |
  Use a YAML code block as the frontmatter.
---

# Block Frontmatter

The usual way to define frontmatters of slides is concise, but may lack of highlighting and formatter support. To solve this, you can use a YAML block at the very beginning of the slide content as the frontmatter of the slide:

````md
---
theme: default
---

# Slide 1

---

```yaml
layout: quote
```

# Slide 2

---

# Slide 3
````

> **Warning** (see upstream formatting)

Headmatter in Slidev is exactly the usual called "frontmatter" of the a Markdown file, which is supported by most of the Markdown editors and formatters. So you can't use a YAML block as the headmatter of the whole slide deck.
