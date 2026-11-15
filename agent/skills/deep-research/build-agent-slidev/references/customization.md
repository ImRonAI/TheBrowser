# Customization hooks: use the right layer

Official customizations: <https://sli.dev/custom/>. Conventions: <https://sli.dev/custom/directory-structure.html>. All setup files are trusted application code and can affect dev/build/export.

| Capability | Conventional file / purpose | Exact source |
|---|---|---|
| Shiki | `setup/shiki.ts`: themes, languages, transformers | [guide](https://sli.dev/custom/config-highlighter.html) |
| Vite/plugins | `vite.config.ts`, `defineConfig` and Slidev config helpers | [guide](https://sli.dev/custom/config-vite.html) |
| Vue app | `setup/main.ts`: `defineAppSetup`, app/plugins/components | [guide](https://sli.dev/custom/config-vue.html) |
| UnoCSS | `uno.config.ts`: extend rules, shortcuts, presets | [guide](https://sli.dev/custom/config-unocss.html) |
| Code runners | `setup/code-runners.ts`: trusted browser/remote execution | [guide](https://sli.dev/custom/config-code-runners.html) |
| Transformers | `setup/transformers.ts`: pre/post code transformation | [guide](https://sli.dev/custom/config-transformers.html) |
| Monaco | `setup/monaco.ts`: editor options and setup | [guide](https://sli.dev/custom/config-monaco.html) |
| KaTeX | `setup/katex.ts`: KaTeX options | [guide](https://sli.dev/custom/config-katex.html) |
| Mermaid | `setup/mermaid.ts`: Mermaid config/themes | [guide](https://sli.dev/custom/config-mermaid.html) |
| Mermaid renderer | `setup/mermaid-renderer.ts`: renderer setup | [guide](https://sli.dev/custom/config-mermaid-renderer.html) |
| Routes | `setup/routes.ts`: custom app routes | [guide](https://sli.dev/custom/config-routes.html) |
| Shortcuts | `setup/shortcuts.ts`: keyboard behavior | [guide](https://sli.dev/custom/config-shortcuts.html) |
| Context menu | `setup/context-menu.ts`: custom actions | [guide](https://sli.dev/custom/config-context-menu.html) |
| Fonts | headmatter `fonts`: provider/local/weights/fallbacks | [guide](https://sli.dev/custom/config-fonts.html) |
| Pre-parser | `setup/preparser.ts`: raw lines/slides/notes extensions | [guide](https://sli.dev/custom/config-parser.html) |

## Examples and layer selection

Use headmatter for built-in switches, CSS for a visual treatment, a local Vue component/layout for repeated structure, and a setup hook only when the underlying tool must change. Avoid a preparser for something a normal component or Markdown transformer can express.

```ts
// setup/main.ts
import { defineAppSetup } from '@slidev/types'
import MyPlugin from './my-plugin'

export default defineAppSetup(({ app, router }) => {
  app.use(MyPlugin)
  // router customization only if truly needed
})
```

Return functions/objects expected by the exact `define*Setup` types; do not import private Slidev internals. Vite is extended with its normal `defineConfig`; Slidev's internal plugins can also be configured where officially documented. Restart after Vite/preparser changes; upstream specifically says a pre-parser change requires stop/restart, and HMR alone may be insufficient.

## Pre-parser semantics

Parsing occurs in three phases: raw-file splitting/frontmatter; Markdown parse; `src` resolution. `definePreparserSetup(({ filepath, headmatter, mode }) => [extensions])` supports:

- `transformRawLines(lines)` after headmatter, before splitting; can mutate raw lines.
- `transformSlide(content, frontmatter)` after splitting; return content or undefined.
- `transformNote(note, frontmatter)` after splitting; return note or undefined.
- optional `name`.

`mode` distinguishes dev/build/export. Use explicit namespaced fields such as `_scale` for custom metadata to avoid collisions. Advanced transformations can break side-editor source mapping and make static validators incomplete. Test conventional plus generated sources, entry/import paths, and editor integration.

## Fonts, routes, shortcuts, and context menus

Fonts default to Google provider, typical weights 200/400/600 and no italic. Use `provider: none`, `local`, explicit weights, or manual HTML/CSS for licensed local assets. Specify actual charset coverage and fallback; CI/PPT recipients may not have the font. Avoid hotlinking critical fonts.

Custom routes/shortcuts/context actions are application features. Keep audience navigation predictable and input focus safe. Do not intercept normal text editing or browser accessibility shortcuts. Disable or hide development MFA/MCP/edit privileges when hosting untrusted audiences. `$router` modifications need base-path/subdirectory verification.

## Security and regression review

Setup files execute at build and/or browser runtime with their respective privileges. Never load an unreviewed remote setup script or expose tokens in client config. Sanitize returned runner HTML, constrain filesystem writes, and avoid unsafe eval. For every customization, test dev, production, presenter, export, and offline behavior if promised. If changing versions, inspect release-tagged types rather than relying on `main`.
