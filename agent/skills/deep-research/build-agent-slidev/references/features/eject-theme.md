<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: eject-theme

- **Category:** Theming
- **Curated practice:** Eject only when owning the theme copy is justified; a small local layout/style is cheaper to maintain.
- **Deep-dive workflow:** [theming.md](../theming.md)
- **Canonical documentation:** https://sli.dev/features/eject-theme.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/eject-theme.md
description: |
  Eject the installed theme from your project to customize it.
---

# Eject Theme

If you want to get full control of the current theme, you can **eject** it to your local file system and modify it as you want. By running the following command

```bash
$ slidev theme eject
```

It will eject the theme you are using currently into `./theme`, and change your frontmatter to

```yaml
---
theme: ./theme
---
```

This could also be helpful if you want to make a theme based on an existing one. If you do, remember to mention the original theme and the author :)

For more options of the `theme` command, please refer to the [Theme Command](https://sli.dev/builtin/cli#theme) section.
