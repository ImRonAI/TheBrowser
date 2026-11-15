<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: canvas-size

- **Category:** Layout
- **Curated practice:** Choose the canvas with the theme before laying out slides; do not change it late to conceal overflow.
- **Deep-dive workflow:** [layouts.md](../layouts.md)
- **Canonical documentation:** https://sli.dev/features/canvas-size.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/canvas-size.md
description: |
  Set the size for all your slides.
---

# Slide Canvas Size

Slidev allows you to set the size of the slide canvas via the `canvasWidth` and `aspectRatio` options in the headmatter:

```md
---
# aspect ratio for the slides
aspectRatio: 16/9
# real width of the canvas, unit in px
canvasWidth: 980
---

# Your slides here
```

To scale several slides in your presentation, you can use the `zoom` option:

To adjust the size of some elements on your slides, you can use the `Transform` component:
