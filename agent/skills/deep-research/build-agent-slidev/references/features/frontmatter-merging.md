<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: frontmatter-merging

- **Category:** Syntax
- **Curated practice:** Predict which file wins before overriding imported content; validate flattened slide numbering and title references.
- **Deep-dive workflow:** [syntax.md](../syntax.md)
- **Canonical documentation:** https://sli.dev/features/frontmatter-merging.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/frontmatter-merging.md
description: |
  Merge frontmatter from multiple markdown files.
---

# Frontmatter Merging

You can provide frontmatter instructions from both your main entry and external markdown pages. If there are duplicate keys in them, the ones from the **main entry have the higher priority**. For example:

::: code-group

```md [./slides.md]
---
src: ./cover.md
background: https://sli.dev/bar.png // [!code highlight]
class: text-center
---
```

```md [./cover.md]
---
layout: cover
background: https://sli.dev/foo.png // [!code highlight]
---

# Cover

Cover Page
```



They will end up being equivalent to the following page:

```md
---
layout: cover
background: https://sli.dev/bar.png // [!code highlight]
class: text-center
---

# Cover

Cover Page
```

## Importing Multiple Slides

When an external markdown file contains multiple slides, frontmatter next to `src` applies to **every imported slide**, not just the first one. This also applies when you [import specific slides](https://sli.dev/features/importing-slides#importing-specific-slides).

For example, the following sets `class: text-center` on every slide imported from `./chapter.md`:

```md [./slides.md]
---
src: ./chapter.md
class: text-center
---
```

To configure only the first imported slide, put the frontmatter in the imported file itself. For example, put `clicks: 4` in `./chapter.md` so that only its first slide requires four clicks:

```md [./chapter.md]
---
clicks: 4
---

# Chapter Opening

---

# Next Slide
```

Putting `clicks: 4` next to `src` instead would override the click count of every imported slide, including slides that define their own `clicks` value.
