# Configuration: headmatter, per-slide settings, and project layout

Primary sources: [all configuration](https://sli.dev/custom/), [types](https://github.com/slidevjs/slidev/blob/v53.1.0/packages/types/src/frontmatter.ts), [directory structure](https://sli.dev/custom/directory-structure.html). The source types for the **installed version** are authoritative. Theme/addon/local-layout options extend these lists.

## Headmatter

Only the first slide's frontmatter is headmatter. Common production settings:

```yaml
---
theme: default
title: Systems, made visible
info: |
  Short description supporting **Markdown**.
author: Your Name
keywords: systems, architecture
colorSchema: dark
aspectRatio: 16/9
canvasWidth: 980
transition: fade
selectable: true
lineNumbers: false
monaco: true
twoslash: true
codeCopy: true
magicMoveCopy: final
drawings:
  enabled: true
  persist: false
  presenterOnly: false
  syncAll: true
presenter: true
record: dev
remoteAssets: build
pwa: false
download: false
exportFilename: systems-made-visible
export:
  format: pdf
  timeout: 30000
  dark: false
  withClicks: false
  withToc: true
favicon: /favicon.svg
htmlAttrs:
  lang: en
  dir: ltr
defaults:
  layout: default
seoMeta:
  ogTitle: Systems, made visible
  ogDescription: A visual explanation of the architecture
  ogImage: https://example.com/og-image.png
  twitterCard: summary_large_image
---
```

Do not cargo-cult this entire block into every deck. Useful defaults from the v52 docs/v53 types:

| Group | Options and default |
|---|---|
| Metadata | `title` inferred if absent, `titleTemplate: '%s - Slidev'`, `info: false`, `author`, `keywords`, `favicon`, `seoMeta` |
| Rendering | `theme: default`, `addons: []`, `aspectRatio: 16/9`, `canvasWidth: 980`, `colorSchema: auto`, `routerMode: history`, `transition: undefined`, `clickAnimation: undefined`, `themeConfig.primary` |
| Features | `presenter: true`, `browserExporter: dev`, `record: dev`, `contextMenu: true`, `wakeLock: true`, `pwa: false`, `overviewSnapshots: false`, `mcp: true` |
| Code | `lineNumbers: false`, `monaco: true`, `monacoTypesSource: local`, `monacoTypesAdditionalPackages: []`, `monacoRunAdditionalDeps: []`, `twoslash: true`, `codeCopy: true`, `magicMoveCopy: true` |
| Assets | `remoteAssets: false`, `fonts` with provider/weights/local/fallback settings, `plantUmlServer` public PlantUML by default |
| Export | `download: false`, `exportFilename`, `export` using CLI options in camelCase |
| Notes/privacy | `notesAutoRuby: {}`, `--without-notes` at build; `presenter: false` where appropriate |

The values `true`, `false`, `'dev'`, and `'build'` are supported by several feature switches, but **not interchangeably for every option**. Check the selected type definitions. `colorSchema` source types also allow `'all'`; normally choose `auto`, `light`, or `dark` after testing both.

## Per-slide frontmatter

```yaml
---
layout: two-cols
class: chapter-spread
background: /images/topology.webp
clicks: 3
clicksStart: 0
transition: slide-left
clickAnimation: fade-up
zoom: 1
preload: true
disabled: false
hideInToc: false
routeAlias: topology
title: A useful TOC title
level: 1
dragPos:
  label: 100,100,240,80,0
---
```

- `layout` defaults to `cover` on the first slide, otherwise `default`.
- `disabled` and its alias `hide` completely remove a slide. `hideInToc` only excludes it from `<Toc>`; it does not make it private.
- `clicks` overrides the automatic total, including deliberately creating click-only states or reducing clicks. Setting a guessed number is not validation; inspect actual states. `clicksStart` controls initial click offset.
- `preload` mounts a slide before entering; side effects must account for inactive/preloaded slides. `zoom` scales slide content; [canvas sizing](features/canvas-size.md) is deck-wide.
- `src` imports other Markdown; [import behavior](features/importing-slides.md) and [merging](features/frontmatter-merging.md) have their own precedence rules.
- `title` and `level` affect title/TOC rendering only when supplied; `routeAlias` makes a stable named destination for `<Link>`.
- `background`, `image`, `url`, `backgroundSize`, and `class` can be layout-specific. Consult the selected theme/layout source rather than applying all to arbitrary layouts.
- `defaults` in headmatter supplies default **per-slide** settings, not arbitrary headmatter settings.
- Custom fields are available through `$nav.currentFrontmatter` and the current slide frontmatter; they are not recognized simply because a YAML key exists.

## Conventional files

All are optional:

```text
components/                 auto-imported Vue/JS/TS/JSX/TSX/MD components
layouts/                    auto-imported layouts
public/                     files served/copied at root; refer to /asset.ext
setup/                      shiki, monaco, code-runners, katex, mermaid, routes, etc.
snippets/                   imported executable or displayed source
styles/index.{css,js,ts}    or style.css: global styling
index.html                  head/body injection
vite.config.ts              Vite configuration
global-top.vue              persistent layer, single instance
global-bottom.vue           persistent layer, single instance
slide-top.vue               per-slide layer
slide-bottom.vue            per-slide layer
custom-nav-controls.vue     navigation controls
slides.md                   default entry
```

Use `/image.png` for `public/image.png`, not `./image.png`. For an imported compile-time asset, follow [assets handling](https://sli.dev/guide/faq.html#assets-handling) and Vite semantics. Root-relative public URLs interact with deployment `base`; verify a subpath production build. Local CSS should be scoped to `.slidev-layout` or layouts because global styles also reach presenter UI.

## Validation policy

A permissive YAML parser cannot know custom theme fields. The included validator checks shape, common values, file references, and obvious mistakes without rejecting valid custom keys. Compile with the actual CLI for verification. If a custom preparser or Vite transform generates slides/frontmatter, source checks are necessarily partial.
