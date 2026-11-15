<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: code-block-line-numbers

- **Category:** Code
- **Curated practice:** Use line numbers only when referring to lines; match startLine when displaying an excerpt from a file.
- **Deep-dive workflow:** [code.md](../code.md)
- **Canonical documentation:** https://sli.dev/features/code-block-line-numbers.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/code-block-line-numbers.md
description: |
  Enable line numbering for all code blocks across the slides or individually.
---

# Line Numbers

You can enable line numbering for all code blocks across the slides by setting `lineNumbers: true` in the headmatter, or enable each code block individually by setting `lines: true`.

You can also set the starting line for each code block and highlight the lines accordingly via `{startLine: number}`, which defaults to 1.

````md
```ts {6,7}{lines:true,startLine:5}
function add(
  a: Ref<number> | number,
  b: Ref<number> | number
) {
  return computed(() => unref(a) + unref(b))
}
```
````

Note that you can use `{*}` as a placeholder of :

````md
```ts {*}{lines:true,startLine:5}
// ...
```
````
