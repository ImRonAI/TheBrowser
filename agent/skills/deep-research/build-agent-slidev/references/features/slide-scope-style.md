<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: slide-scope-style

- **Category:** Styling
- **Curated practice:** Scope intentional one-off slide treatments; use reusable local layouts/tokens for repeated patterns and keep presenter CSS unaffected.
- **Deep-dive workflow:** [syntax.md](../syntax.md)
- **Canonical documentation:** https://sli.dev/features/slide-scope-style.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/slide-scope-style.md
description: |
  Define styles for only the current slide.
---

# Slide Scope Styles

You can use the `<style>` tag in your Markdown to define styles for **only the current slide**.

```md
# This is Red

<style>
h1 {
  color: red;
}
</style>

---

# Other slides are not affected
```

The `<style>` tag in Markdown is always [scoped](https://vuejs.org/api/sfc-css-features.html#scoped-css). As a result, a selector with a child combinator (`.a > .b`) is unusable as such; see the previous link. To have global styles, check out the [customization section](https://sli.dev/custom/directory-structure#style).

Powered by [UnoCSS](https://sli.dev/custom/config-unocss), you can directly use nested css and [directives](https://unocss.dev/transformers/directives):

```md
# Slidev

> Hello **world**

<style>
blockquote {
  strong {
    --uno: 'text-teal-500 dark:text-teal-400';
  }
}
</style>
```
