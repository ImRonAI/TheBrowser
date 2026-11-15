<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: direction-variant

- **Category:** Animation
- **Curated practice:** Use directional styles for continuity; always inspect backward navigation and reduced-motion behavior.
- **Deep-dive workflow:** [animations.md](../animations.md)
- **Canonical documentation:** https://sli.dev/features/direction-variant.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/direction-variant.md
description: |
  Apply different styles and animations based on the navigation direction.
---

# Navigation Direction Variants

You may want to apply different classes based on whether it's navigating forward or backward. The `.slidev-nav-go-forward` or `.slidev-nav-go-backward` class will be applied to the slide container when navigating, and you can use them to apply different styles or animations:

```css
/* example: delay on only forward but not backward */
.slidev-nav-go-forward .slidev-vclick-target {
  transition-delay: 500ms;
}
.slidev-nav-go-backward .slidev-vclick-target {
  transition-delay: 0;
}
```

To make it easier, we also provided some [UnoCSS variants](https://github.com/slidevjs/slidev/blob/6adcf2016b8fb0cab65cf150221f1f67a76a2dd8/packages/client/uno.config.ts#L32-L38) for this. You can use the `forward:` or `backward:` prefix to any UnoCSS classes to only enable them in the specific navigation direction:

```html
<div v-click class="transition delay-300">Element</div> // [!code --]
<div v-click class="transition forward:delay-300">Element</div> // [!code ++]
```

In the above example, the animation is only delayed when navigating forward.
