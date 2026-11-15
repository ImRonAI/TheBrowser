<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: twoslash

- **Category:** Code
- **Curated practice:** Use type information when it teaches something; pin TypeScript, resolve imports, and inspect hover-only information alternatives for exports.
- **Deep-dive workflow:** [code.md](../code.md)
- **Canonical documentation:** https://sli.dev/features/twoslash.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/twoslash.md
description: >
  A powerful tool for rendering TypeScript code blocks with type information on
  hover or inlined.
---

# TwoSlash Integration

[TwoSlash](https://twoslash.netlify.app/) is a powerful tool for rendering TypeScript code blocks with type information on hover or inlined. It's quite useful for preparing slides for JavaScript/TypeScript-related topics.

To use it, you can add `twoslash` to the code block's language identifier:

````md
```ts twoslash
import { ref } from 'vue'

const count = ref(0)
//            ^?
```
````

It will be rendered as:

```ts twoslash
import { ref } from 'vue'

const count = ref(0)
//            ^?
```
