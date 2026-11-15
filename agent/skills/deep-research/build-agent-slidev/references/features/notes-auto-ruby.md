<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: notes-auto-ruby

- **Category:** Presenter
- **Curated practice:** Check replacement scope, typography, and correct pronunciation with a fluent speaker; not a substitute for language review.
- **Deep-dive workflow:** [presenter-tools.md](../presenter-tools.md)
- **Canonical documentation:** https://sli.dev/features/notes-auto-ruby.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/notes-auto-ruby.md
description: Automatically add `<ruby>` tags to your notes.
---

# Notes Auto Ruby

> Available since v52.4.0

When you write notes in your slides, you might want to add some ruby text to help pronouncing the some words. You can always add `<ruby>` tags to your notes manually, but Slidev also provides a convenient way to do this automatically by a global auto-replacement.

In the headmatter, you can set the `notesAutoRuby` option to a map of words to their ruby text:

```md
---
notesAutoRuby:
  日本語: ni hon go
  勉強: べんきょう
---

# Your slides here

<!--
私は日本語を勉強しています。
-->
```

And the notes will be rendered as:
