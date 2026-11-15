<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: click-marker

- **Category:** Presenter
- **Curated practice:** Keep click cues in long notes synchronized with the actual click choreography and rehearse both forward and backward.
- **Deep-dive workflow:** [presenter-tools.md](../presenter-tools.md)
- **Canonical documentation:** https://sli.dev/features/click-marker.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/click-marker.md
description: |
  Highlighting notes and auto-scrolling to the active section of notes.
---

# Click Markers

For some slides you may have longer notes that could be hard to find your place. Slidev supports click markers that allow highlighting and auto-scrolling to the section of notes from your corresponding content. Put `[click]` markers at the beginning of any line in your notes for the timing you need to go to another [click](https://sli.dev/guide/animations#click-animation). You may skip `n` clicks by using `[click:{n+1}]`. For example:

```md
<!--
Content before the first click

[click] This will be highlighted after the first click

Also highlighted after the first click

- [click] This list element will be highlighted after the second click

[click:3] Last click (skip two clicks)
-->
```

Slidev divides the content between the click markers and highlights it in presenter notes, synchronized with your slide progress.
