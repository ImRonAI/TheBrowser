<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: transform-component

- **Category:** Layout
- **Curated practice:** Use for intentional miniature/diagram scaling, not to rescue overflowing body text; inspect layout box versus transformed visuals.
- **Deep-dive workflow:** [layouts.md](../layouts.md)
- **Canonical documentation:** https://sli.dev/features/transform-component.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/transform-component.md
description: |
  A component for scaling some elements.
---

# The `Transform` Component

The `Transform` component allows you to scale the size of the elements on your slides:

```md
<Transform :scale="0.5" origin="top center">
  <YourElements />
</Transform>
```

This is useful when you want to adjust the size of some elements on your slides without affecting the layout of the entire slide.

To scale all the slides in your presentation, you can set the slide canvas size:

To scale several slides in your presentation, you can use the `zoom` option:
