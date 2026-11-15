<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: monaco-write

- **Category:** Code
- **Curated practice:** Development only: writing saves to source files. Back up work and never enable a public write-capable demo.
- **Deep-dive workflow:** [code.md](../code.md)
- **Canonical documentation:** https://sli.dev/features/monaco-write.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/monaco-write.md
description: >
  A monaco editor that allows you to write code directly in the slides and save
  the changes back to the file.
---

# Writable Monaco Editor

You can also use the [Import Code Snippets](#import-code-snippets) syntax combined with the `{monaco-write}` directive, to link your Monaco Editor with a file on your filesystem. This will allow you to edit the code directly in the editor and save the changes back to the file.

```md
<<< ./some-file.ts {monaco-write}
```

When using this, be sure to back up your files beforehand, as the changes will be saved directly to the file.
