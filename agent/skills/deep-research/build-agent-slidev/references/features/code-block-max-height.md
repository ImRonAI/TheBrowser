<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: code-block-max-height

- **Category:** Code
- **Curated practice:** Prefer a shorter excerpt or split; a scrollable code block is a workshop aid, not permission for unreadable dense slides.
- **Deep-dive workflow:** [code.md](../code.md)
- **Canonical documentation:** https://sli.dev/features/code-block-max-height.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/code-block-max-height.md
description: |
  Set a maximum height for a code block and enable scrolling.
---

# Max Height

If the code doesn't fit into one slide, you use the `maxHeight` to set a fixed height and enable scrolling:

````md
```ts {2|3|7|12}{maxHeight:'100px'}
function add(
  a: Ref<number> | number,
  b: Ref<number> | number
) {
  return computed(() => unref(a) + unref(b))
}
/// ...as many lines as you want
const c = add(1, 2)
```
````

Note that you can use `{*}` as a placeholder of :

````md
```ts {*}{maxHeight:'100px'}
// ...
```
````
