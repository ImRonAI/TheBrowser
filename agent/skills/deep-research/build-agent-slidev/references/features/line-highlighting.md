<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: line-highlighting

- **Category:** Code
- **Curated practice:** Align highlight stages with spoken reasoning; avoid highlight changes with no visible explanation or accidental extra clicks.
- **Deep-dive workflow:** [code.md](../code.md)
- **Canonical documentation:** https://sli.dev/features/line-highlighting.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/line-highlighting.md
description: |
  Highlight specific lines in code blocks based on clicks.
---

# Line Highlighting

To highlight specific lines, simply add line numbers within brackets `{}`. Line numbers start counting from 1 by default.

````md
```ts {2,3}
function add(
  a: Ref<number> | number,
  b: Ref<number> | number
) {
  return computed(() => unref(a) + unref(b))
}
```
````

## Dynamic Line Highlighting

To change what's highlighted with multiple clicks, you can use `|` to separate each stage:

````md
```ts {2-3|5|all}
function add(
  a: Ref<number> | number,
  b: Ref<number> | number
) {
  return computed(() => unref(a) + unref(b))
}
```
````

This will first highlight `a: Ref<number> | number` and `b: Ref<number> | number`, and then `return computed(() => unref(a) + unref(b))` after one click, and lastly, the whole block.

You can set the line number to `hide` to hide the code block or `none` to not highlight any line:

````md
```ts {hide|none}
function add(
  a: Ref<number> | number,
  b: Ref<number> | number
) {
  return computed(() => unref(a) + unref(b))
}
```
````

> **Tip** (see upstream formatting)
Learn more in the [click animations guide](https://sli.dev/guide/animations#positioning).
