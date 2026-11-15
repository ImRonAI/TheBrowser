<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: importing-slides

- **Category:** Syntax
- **Curated practice:** Split along narrative chapters, not arbitrary editor convenience; recursively validate imported files and link numbering after edits.
- **Deep-dive workflow:** [syntax.md](../syntax.md)
- **Canonical documentation:** https://sli.dev/features/importing-slides.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/importing-slides.md
description: >
  Split your `slides.md` into multiple files for better reusability and
  organization.
---

# Importing Slides

You can split your `slides.md` into multiple files for better reusability and organization. To do this, you can use the `src` frontmatter option to specify the path to the external markdown file. For example:

::: code-group

```md [./slides.md]
# Title

This is a normal page

---
src: ./pages/toc.md // [!code highlight]
---

<!-- this page will be loaded from './pages/toc.md' -->

Contents here are ignored

---

# Page 4

Another normal page

---
src: ./pages/toc.md   # Reuse the same file // [!code highlight]
---
```

```md [./pages/toc.md]
# Table of Contents

Part 1

---

# Table of Contents

Part 2
```



## Importing Specific Slides

To reuse some of the slides inside another Markdown file, you can use the hash part of the import path:

```md
---
src: ./another-presentation.md#2,5-7
---
```

This will import the slides 2, 5, 6, and 7 from `./another-presentation.md`.

## Frontmatter Merging

Frontmatter next to `src` applies to every slide imported from that file. To configure only its first slide, put the frontmatter in the imported file itself. See the following page for examples and merge priority:
