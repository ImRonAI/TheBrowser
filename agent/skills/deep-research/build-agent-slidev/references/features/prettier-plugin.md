<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: prettier-plugin

- **Category:** Tooling
- **Curated practice:** Format after source edits, review semantic diff and notes; do not assume formatting validates Vue/YAML or rendered layout.
- **Deep-dive workflow:** [operations.md](../operations.md)
- **Canonical documentation:** https://sli.dev/features/prettier-plugin.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/prettier-plugin.md
description: |
  Use the Prettier plugin to format your slides.
---

# Prettier Plugin

The Slidev's syntax may be incompatible with the default Markdown parser of [Prettier](https://prettier.io/). To solve this, Slidev provides a Prettier plugin to format your slides. You can use it with your favorite editor that supports Prettier.

## 1. Install

::: code-group

```bash [npm]
npm i -D prettier prettier-plugin-slidev
```

```bash [pnpm]
pnpm i -D prettier prettier-plugin-slidev
```

```bash [yarn]
yarn add -D prettier prettier-plugin-slidev
```

```bash [bun]
bun add -D prettier prettier-plugin-slidev
```

```bash [deno]
deno add -D npm:prettier npm:prettier-plugin-slidev
```



## 2. Activate the plugin

Create or modify your [prettier configuration file](https://prettier.io/docs/en/configuration) to activate the plugin:

```json
{
  "overrides": [
    {
      "files": ["slides.md", "pages/*.md"],
      "options": {
        "parser": "slidev",
        "plugins": ["prettier-plugin-slidev"]
      }
    }
  ]
}
```

Note that only specifying `plugins` is not enough, because Slidev and common Markdown files share the same file extension `.md`.
