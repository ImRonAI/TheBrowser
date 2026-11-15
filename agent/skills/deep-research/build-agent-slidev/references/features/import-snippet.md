<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: import-snippet

- **Category:** Code
- **Curated practice:** Import tested source rather than duplicating it; keep ranges stable with region comments and use correct filename/language metadata.
- **Deep-dive workflow:** [code.md](../code.md)
- **Canonical documentation:** https://sli.dev/features/import-snippet.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/import-snippet.md
description: |
  Import code snippets from existing files into your slides.
---

# Import Code Snippets

You can import code snippets from existing files via the following syntax:

```md
<<< @/snippets/snippet.js
```

> **Tip** (see upstream formatting)
The value of `@` corresponds to your package's root directory. It's recommended to put snippets in `@/snippets` in order to be compatible with the Monaco editor. Alternatively, you can also import from relative paths.


You can also use a [VS Code region](https://code.visualstudio.com/docs/editor/codebasics#_folding) to only include the corresponding part of the code file:

```md
<<< @/snippets/snippet.js#region-name
```

To explicitly specify the language of the imported code, you can add a language identifier after:

```md
<<< @/snippets/snippet.js ts
```

Any code block features like [line highlighting](#line-highlighting) and [Monaco editor](#monaco-editor) are also supported:

```md
<<< @/snippets/snippet.js {2,3|5}{lines:true}
<<< @/snippets/snippet.js ts {monaco}{height:200px}
```

Note that you can use `{*}` as a placeholder of :

```md
<<< @/snippets/snippet.js {*}{lines:true}
```
