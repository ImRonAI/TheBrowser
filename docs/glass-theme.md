# Glass theme

Selecting **Glass** in the toolbar Appearance menu (`ThemeToggle`) makes the browser
shell translucent over a real macOS material. Websites (native `WebContentsView`
tabs) stay opaque.

## Why a native library and not a CSS/React "liquid glass" package

Chromium's `backdrop-filter` (and every SVG-displacement React library built on it,
e.g. `liquid-glass-react`) can only sample pixels painted **inside this renderer**.
It cannot see the desktop behind a transparent `BrowserWindow`, and it cannot see the
native tab views. Over Ron's transparent shell those libraries blur/refract an empty
layer. The only way to be actually see-through is an AppKit material behind the window:

| Layer | Implementation |
|---|---|
| Window material, macOS 26+ | [`electron-liquid-glass`](https://github.com/Meridius-Labs/electron-liquid-glass) inserts Apple's `NSGlassEffectView` (Liquid Glass) behind the web contents |
| Window material, older macOS | the same library falls back to `NSVisualEffectView`; if the addon can't load, Electron `setVibrancy('sidebar')` |
| Linux / Windows / plain browser | no material; the renderer paints a soft gradient backdrop (`html.glass:not(.glass-native)`) |
| Floating surfaces (agent panel, menus) | CSS `backdrop-filter` — they float over renderer content, so there is something to blur |

## Code

- `electron/window-material.ts` — `applyWindowMaterial(win, theme, dark)`, called from
  the `set-theme` IPC handler. Follows the library README: window `transparent: true`
  and **no** `vibrancy` option (vibrancy over Liquid Glass renders blurry),
  `setWindowButtonVisibility(true)`, view added after the page loads, documented
  `addView` only (the `unstable_*` private APIs are not used). The library has no
  `removeView`; leaving Glass keeps the view mounted under the opaque renderer.
- `electron-liquid-glass` is an **optionalDependency** (`"os": ["darwin"]`; the VPS
  `npm ci` on Linux must not fail) and is externalized in `electron.vite.config.ts`.
  It is loaded with a lazy `import()` so a missing addon degrades to vibrancy.
  A packaged build must `asarUnpack` `node_modules/electron-liquid-glass/prebuilds`.
- `src/lib/theme.ts` — `.glass` (+ `.dark` from the OS) and `.glass-native` on `<html>`.
- `src/index.css` "GLASS THEME" — tokens (`--ron-glass-*-alpha`), and the semantic hooks:
  `.ron-chrome` (frame tint), `.ron-toolbar` / `.ron-sidebar` (hairlines, control
  capsules), `.ron-content` (Ron pages: see-through content layer),
  `.ron-glass-panel` (agent panel: blur on a `::before` so it never becomes a
  containing block for `position: fixed` children), `bg-popover` / `.ron-popover`
  (menus). Selectors on utility tokens use `[class~="…"]` so Tailwind does not clone
  them into every `@apply`.

## Accessibility (Apple HIG, Materials)

- **Reduce Transparency** (`prefers-reduced-transparency: reduce`) → every glass alpha
  becomes 1 and blur is removed.
- **Increase Contrast** (`prefers-contrast: more`) → alphas ≈ 0.7–0.9 and dark hairlines.
- Ink follows the OS appearance (`.dark`) so text always contrasts with the material.
