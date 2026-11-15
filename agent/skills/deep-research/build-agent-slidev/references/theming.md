# Themes, addons, layouts, and sharing

Sources: [theme/addon guide](https://sli.dev/guide/theme-addon.html), [write theme](https://sli.dev/guide/write-theme.html), [write addon](https://sli.dev/guide/write-addon.html), [theme gallery](https://sli.dev/resources/theme-gallery.html), [addon gallery](https://sli.dev/resources/addon-gallery.html), [eject](features/eject-theme.md).

## Choose before designing dozens of slides

```yaml
---
theme: seriph
addons:
  - slidev-addon-excalidraw
themeConfig:
  primary: '#315c72'
---
```

A theme is an npm package or local path. Install it in the deck project and align its peer/Slidev compatibility. Inspect its README, actual layouts, slots, color variables, fonts, and examples before writing against assumed props. Built-in/default themes can change meaning with major versions.

Resolution precedence for layouts/components is defaults → theme → addons → local. This makes local overrides powerful but name collisions possible. Do not fork a theme to change three CSS rules: use `themeConfig`, local styles, or a local layout first. `themeConfig` keys inject `--slidev-theme-x` CSS variables for theme customization as supported by the theme.

Addons can bundle components, layouts, styles, and tooling. Audit packages, network behavior, maintenance, transitive dependencies, and license. An addon gallery entry is not a compatibility or security guarantee. Do not install a collection just to appear feature-rich.

## Write a local theme-like system first

For most decks, use `styles/index.css` for tokens under `.slidev-layout`, `layouts/*.vue` for repeated slide treatments, `components/*.vue` for content patterns, and global/per-slide layers for persistent decoration. Keep a stable spacing and type scale. Inspect presenter/overview because global styles affect them.

```css
.slidev-layout {
  --deck-accent: #d8ff5f;
  --deck-muted: #a8b0bd;
}
.slidev-layout.proof {
  border-top: 2px solid var(--deck-accent);
}
```

## Package a reusable theme or addon

Read the official package-structure guides before authoring. Typical npm names are `slidev-theme-name` and `slidev-addon-name`; the package entry points/exports and conventional directories matter. Themes/addons can supply `layouts`, `components`, `styles`, `setup`, example source, and configuration hooks supported by the selected Slidev version. Use correct package metadata and peer dependencies and document minimum compatible CLI/Node.

Test a packed/installed artifact, not just a source symlink. Include a demonstration deck that exercises every supplied layout/component in dev, production, export, light/dark, and presenter/overview. Provide fallback fonts/assets and avoid unexpected CDN calls. Version changes as a package and publish only with authorization.

## Ejecting a theme

`slidev theme eject [entry] --dir theme --theme optional-name` copies the current theme locally for ownership/customization; see [exact eject guidance](features/eject-theme.md). This increases maintenance and can freeze upstream fixes. Commit only the intentional copy (respect its license), record source version, then adjust the selected theme/local path and rerun full visual QA. Do not eject as a first response to an ordinary alignment issue.
