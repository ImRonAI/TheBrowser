<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: zoom-slide

- **Category:** Layout
- **Curated practice:** Use sparingly for a slide with intrinsically different density; enforce a readable minimum rather than hiding too much content with zoom.
- **Deep-dive workflow:** [layouts.md](../layouts.md)
- **Canonical documentation:** https://sli.dev/features/zoom-slide.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/zoom-slide.md
description: |
  Zoom the content of a slide to a specific scale.
---

# Zoom Slides

You may find some slides in your presentation too spacious or too crowded. Slidev provides a `zoom` option for each slide that allows you to scale the content of a slide:

```md
---
zoom: 0.8
---

# A Slide with lots of content

---

# Other slides aren't affected
```

To scale all the slides in your presentation, you can set the slide canvas size:

To adjust the size of some elements on your slides, you can use the `Transform` component:
