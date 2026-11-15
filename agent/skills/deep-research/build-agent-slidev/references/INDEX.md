# Feature atlas and reference router

Snapshot: 2026-11-14, docs labeled v52.19.1; verified integration target `@slidev/cli@53.1.0`. Read [versioning](versioning.md) first for an existing or upgraded deck. Each feature filename below is an official syntax snapshot; its linked curated guide adds delivery and design judgment.

## Start with a system, not a single trick

| Task | Read |
|---|---|
| Workflow, quality bar, ordering | [SKILL.md](../SKILL.md) |
| Story, time, evidence | [narrative](narrative.md) |
| Visual system, accessibility | [art direction](art-direction.md) |
| Markdown/frontmatter/imports/styles | [syntax](syntax.md) |
| All deck/slide settings | [configuration](configuration.md) |
| Built-in/theme/local layouts | [layouts](layouts.md) |
| Built-in Vue components, drag/video/embeds | [components](components.md) |
| Clicks/Magic Move/motion/transitions | [animations](animations.md) |
| Shiki/imported source/Monaco/TwoSlash | [code](code.md) |
| Mermaid/PlantUML/KaTeX/media | [visuals](visuals.md) |
| Components/composables/hooks | [Vue APIs](vue-components.md) |
| Themes/addons/eject | [theming](theming.md) |
| Vite/Vue/UnoCSS/fonts/routes/hooks | [customization](customization.md) |
| Presenter/record/remote/timer/drawing | [presenter tools](presenter-tools.md) |
| CLI/dev/build/environment | [CLI](cli.md) and [operations](operations.md) |
| Export formats/options/troubleshooting | [exporting](exporting.md) |
| SPA/hosting/PWA/SEO/assets | [hosting](hosting.md) |
| Built-in MCP/editing agents | [AI automation](ai-automation.md) |
| Script commands and limitations | [scripts](scripts.md) |
| Source map and completeness contract | [coverage manifest](coverage.json) |

## All official individual feature pages

This manifest is the exhaustive set from the [official feature index](https://sli.dev/llms.txt) at the snapshot date—44 features. The guides at the links above aggregate related concepts; they do not replace the feature's exact examples.

| Feature | Exact reference | Use it for / practice |
|---|---|---|
<!-- GENERATED:FEATURES -->
| block-frontmatter | [block-frontmatter](features/block-frontmatter.md) | Useful for YAML editor highlighting on later slides; never substitute it for the opening headmatter. ([syntax.md](syntax.md)) |
| build-with-pdf | [build-with-pdf](features/build-with-pdf.md) | Generate and inspect the PDF with the web build; use an explicit URL when supplying an externally produced PDF. ([exporting.md](exporting.md)) |
| bundle-remote-assets | [bundle-remote-assets](features/bundle-remote-assets.md) | Localize critical remote media and fonts; a service worker does not make arbitrary third-party URLs offline-safe. ([hosting.md](hosting.md)) |
| canvas-size | [canvas-size](features/canvas-size.md) | Choose the canvas with the theme before laying out slides; do not change it late to conceal overflow. ([layouts.md](layouts.md)) |
| click-marker | [click-marker](features/click-marker.md) | Keep click cues in long notes synchronized with the actual click choreography and rehearse both forward and backward. ([presenter-tools.md](presenter-tools.md)) |
| code-block-line-numbers | [code-block-line-numbers](features/code-block-line-numbers.md) | Use line numbers only when referring to lines; match startLine when displaying an excerpt from a file. ([code.md](code.md)) |
| code-block-max-height | [code-block-max-height](features/code-block-max-height.md) | Prefer a shorter excerpt or split; a scrollable code block is a workshop aid, not permission for unreadable dense slides. ([code.md](code.md)) |
| code-groups | [code-groups](features/code-groups.md) | Enable Comark first; use tabs for equivalent alternatives, not for content the audience must compare side by side. ([code.md](code.md)) |
| comark | [comark](features/comark.md) | Opt in intentionally; keep Markdown readable and test any MDC/Comark examples copied from older documentation. ([syntax.md](syntax.md)) |
| direction-variant | [direction-variant](features/direction-variant.md) | Use directional styles for continuity; always inspect backward navigation and reduced-motion behavior. ([animations.md](animations.md)) |
| draggable | [draggable](features/draggable.md) | Author explicit dragPos values for deterministic exports; never make dragging the only way to obtain meaning. ([components.md](components.md)) |
| drawing | [drawing](features/drawing.md) | Rehearse pen/touch mode, persistence, and synchronization; clean rehearsal annotations before recording or export. ([presenter-tools.md](presenter-tools.md)) |
| eject-theme | [eject-theme](features/eject-theme.md) | Eject only when owning the theme copy is justified; a small local layout/style is cheaper to maintain. ([theming.md](theming.md)) |
| frontmatter-merging | [frontmatter-merging](features/frontmatter-merging.md) | Predict which file wins before overriding imported content; validate flattened slide numbering and title references. ([syntax.md](syntax.md)) |
| global-layers | [global-layers](features/global-layers.md) | Prefer per-slide layers for export-correct footers; global navigation-state layers need --per-slide export testing. ([layouts.md](layouts.md)) |
| icons | [icons](features/icons.md) | Use one coherent icon family, pin its package, give meaningful icons names/labels, and do not substitute icons for a clear visual idea. ([art-direction.md](art-direction.md)) |
| import-snippet | [import-snippet](features/import-snippet.md) | Import tested source rather than duplicating it; keep ranges stable with region comments and use correct filename/language metadata. ([code.md](code.md)) |
| importing-slides | [importing-slides](features/importing-slides.md) | Split along narrative chapters, not arbitrary editor convenience; recursively validate imported files and link numbering after edits. ([syntax.md](syntax.md)) |
| latex | [latex](features/latex.md) | Explain equations in speech and use KaTeX-supported syntax; inspect editable-PPTX raster fallbacks and non-Latin fonts. ([visuals.md](visuals.md)) |
| line-highlighting | [line-highlighting](features/line-highlighting.md) | Align highlight stages with spoken reasoning; avoid highlight changes with no visible explanation or accidental extra clicks. ([code.md](code.md)) |
| mcp | [mcp](features/mcp.md) | Use structured edits when helpful but still review diffs, rebuild, and visually inspect; disable the HTTP endpoint on untrusted networks. ([ai-automation.md](ai-automation.md)) |
| mermaid | [mermaid](features/mermaid.md) | Simplify graphs before styling them; check light/dark contrast, label sizes, export rendering, and a textual explanation. ([visuals.md](visuals.md)) |
| monaco-editor | [monaco-editor](features/monaco-editor.md) | Reserve editor weight for actual live editing; a static Shiki block is faster and more faithful for read-only code. ([code.md](code.md)) |
| monaco-run | [monaco-run](features/monaco-run.md) | Use only trusted code: the built-in browser runner is unsandboxed. Prepare a static output fallback and explicit Run action for critical demos. ([code.md](code.md)) |
| monaco-write | [monaco-write](features/monaco-write.md) | Development only: writing saves to source files. Back up work and never enable a public write-capable demo. ([code.md](code.md)) |
| notes-auto-ruby | [notes-auto-ruby](features/notes-auto-ruby.md) | Check replacement scope, typography, and correct pronunciation with a fluent speaker; not a substitute for language review. ([presenter-tools.md](presenter-tools.md)) |
| og-image | [og-image](features/og-image.md) | Use an absolute public image URL in production, verify preview cards, and pin a generated image when CI font environments differ. ([hosting.md](hosting.md)) |
| plantuml | [plantuml](features/plantuml.md) | Treat the default renderer as a network and privacy dependency; self-host or bundle a proven image for offline/critical talks. ([visuals.md](visuals.md)) |
| prettier-plugin | [prettier-plugin](features/prettier-plugin.md) | Format after source edits, review semantic diff and notes; do not assume formatting validates Vue/YAML or rendered layout. ([operations.md](operations.md)) |
| pwa | [pwa](features/pwa.md) | Install the optional plugin, build, load once online, wait for Ready offline, then test the actual deck with network disabled. ([hosting.md](hosting.md)) |
| recording | [recording](features/recording.md) | Obtain consent, check permissions/audio/storage, and make a short test recording before the real presentation. ([presenter-tools.md](presenter-tools.md)) |
| remote-access | [remote-access](features/remote-access.md) | Bind deliberately and protect presenter mode; a password/tunnel is not justification to expose secrets or dev-only write tools publicly. ([presenter-tools.md](presenter-tools.md)) |
| rough-marker | [rough-marker](features/rough-marker.md) | Use hand-drawn emphasis selectively; bind clicks correctly and inspect mark dimensions during backward/export states. ([animations.md](animations.md)) |
| seo-meta | [seo-meta](features/seo-meta.md) | Set accurate title, description, canonical URL, and social image; remove private speaker notes from a public build separately. ([hosting.md](hosting.md)) |
| shiki-magic-move | [shiki-magic-move](features/shiki-magic-move.md) | Use small traceable edits and identical context lines; test every state, backward navigation, final code, and export without clicks. ([code.md](code.md)) |
| side-editor | [side-editor](features/side-editor.md) | Convenient for live source edits, not a visual QA substitute; keep development write access away from public deployments. ([operations.md](operations.md)) |
| slide-hook | [slide-hook](features/slide-hook.md) | Clean up listeners/timers and check active-slide state; do not start expensive work for every preloaded slide. ([vue-components.md](vue-components.md)) |
| slide-scope-style | [slide-scope-style](features/slide-scope-style.md) | Scope intentional one-off slide treatments; use reusable local layouts/tokens for repeated patterns and keep presenter CSS unaffected. ([syntax.md](syntax.md)) |
| slot-sugar | [slot-sugar](features/slot-sugar.md) | Use named slots exactly as the selected layout defines them; inspect nested Markdown and missing/extra slots in the browser. ([layouts.md](layouts.md)) |
| timer | [timer](features/timer.md) | Set duration after rehearsal, not aspiration; retain a Q&A/time buffer and verify countdown behavior on the presenter display. ([presenter-tools.md](presenter-tools.md)) |
| transform-component | [transform-component](features/transform-component.md) | Use for intentional miniature/diagram scaling, not to rescue overflowing body text; inspect layout box versus transformed visuals. ([layouts.md](layouts.md)) |
| twoslash | [twoslash](features/twoslash.md) | Use type information when it teaches something; pin TypeScript, resolve imports, and inspect hover-only information alternatives for exports. ([code.md](code.md)) |
| vscode-extension | [vscode-extension](features/vscode-extension.md) | Use visual/navigation editor tools when available; a preview is not a substitute for production build/export validation. ([operations.md](operations.md)) |
| zoom-slide | [zoom-slide](features/zoom-slide.md) | Use sparingly for a slide with intrinsically different density; enforce a readable minimum rather than hiding too much content with zoom. ([layouts.md](layouts.md)) |
<!-- /GENERATED:FEATURES -->

### Feature coverage invariants

- One local Markdown file per manifest feature; title and official URL must be present.
- Each feature has a curated guide and a specific application/verification practice in `coverage.json`.
- Core docs, customization hooks, layouts/components, CLI, export, hosting, themes/addons, global context, and agent/MCP have curated guides even where no separate feature page exists.
- Underlying third-party APIs (Vue, Vite, UnoCSS, Shiki, Monaco, Mermaid, KaTeX, Playwright) are linked at their official docs; this skill does not pretend to reproduce every upstream API.
- `check-skill.py` validates coverage and local links. It cannot establish that future documentation is unchanged; use `sync-references.py --update` deliberately and review the diff.

## Sources and license

Individual pages retain upstream frontmatter and source headings. [Third-party notices](../THIRD_PARTY_NOTICES.md) include the upstream MIT license. Use [theme gallery](https://sli.dev/resources/theme-gallery.html), [addon gallery](https://sli.dev/resources/addon-gallery.html), [showcases](https://sli.dev/resources/showcases.html), [curated covers](https://sli.dev/resources/covers.html), and [learning resources](https://sli.dev/resources/learning.html) for inspiration—not as permission to copy unattributed visual identities.
