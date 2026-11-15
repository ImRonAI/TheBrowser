<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: slide-hook

- **Category:** API
- **Curated practice:** Clean up listeners/timers and check active-slide state; do not start expensive work for every preloaded slide.
- **Deep-dive workflow:** [vue-components.md](../vue-components.md)
- **Canonical documentation:** https://sli.dev/features/slide-hook.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/slide-hook.md
description: |
  Hooks to manage the slide lifecycle.
---

# Slide Hooks

Slidev provides a set of hooks to help you manage the slide lifecycle:

```ts twoslash
import { onSlideEnter, onSlideLeave, useIsSlideActive } from '@slidev/client'

const isActive = useIsSlideActive()

onSlideEnter((to, from) => {
  /* Called whenever the slide becomes active */
})

onSlideLeave((to, from) => {
  /* Called whenever the slide becomes inactive */
})
```

You can also use  to access other useful context information.

> **Warning** (see upstream formatting)

In the slide component, `onMounted` and `onUnmounted` hooks are not available, because the component instance is preserved even when the slide is not active. Use `onSlideEnter` and `onSlideLeave` instead.
