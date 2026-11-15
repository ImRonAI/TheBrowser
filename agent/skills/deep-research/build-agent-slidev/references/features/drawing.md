<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: drawing

- **Category:** Presenter
- **Curated practice:** Rehearse pen/touch mode, persistence, and synchronization; clean rehearsal annotations before recording or export.
- **Deep-dive workflow:** [presenter-tools.md](../presenter-tools.md)
- **Canonical documentation:** https://sli.dev/features/drawing.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/drawing.md
description: |
  Draw and annotate your slides with ease.
---

# Drawing & Annotations

Slidev comes with a built-in drawing and annotation feature powered by [drauu](https://github.com/antfu/drauu). It allows you to draw and annotate your slides with ease.

To start, click the  icon in the [navigation bar](https://sli.dev/guide/ui#navigation-bar) to open the drawing toolbar. It's also available in the [Presenter Mode](https://sli.dev/guide/ui#presenter-mode). Drawings and annotations you created will be **synced** automatically across all instances in real-time.

## Use with Stylus Pen

When using a stylus pen on a tablet (for example, iPad with Apple Pencil), Slidev will intelligently detect the input type. You can directly draw on your slides with the pen without turning on the drawing mode while having your fingers or mouse control the navigation.

## Persist Drawings

The following frontmatter configuration allows you to persist your drawings as SVGs under `.slidev/drawings` directory and have them inside your exported PDF or hosted site.

```md
---
drawings:
  persist: true
---
```

## Disable Drawings

Entirely:

```md
---
drawings:
  enabled: false
---
```

Only in Development:

```md
---
drawings:
  enabled: dev
---
```

Only in Presenter Mode:

```md
---
drawings:
  presenterOnly: true
---
```

## Drawing Syncing

By default, Slidev syncs up your drawings across all instances. If you are sharing your slides with others, you might want to disable the syncing via:

```md
---
drawings:
  syncAll: false
---
```

With this config, only the drawing from the presenter instance will be able to sync with others.
