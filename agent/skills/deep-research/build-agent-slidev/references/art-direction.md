# Art direction and accessible slide craft

Capability sources: [directory structure](https://sli.dev/custom/directory-structure.html), [layouts](https://sli.dev/builtin/layouts.html), [themes/addons](https://sli.dev/guide/theme-addon.html), [fonts](https://sli.dev/custom/config-fonts.html). The aesthetic discipline below is skill guidance.

## Choose a visual idea, not a bag of effects

Define a two- or three-word art direction that follows the subject (for example, “editorial systems map” or “quiet laboratory notebook”). Turn it into a repeatable visual grammar:

- **Canvas:** preserve the theme's design assumptions. Default `16/9`, `canvasWidth: 980`; change only deliberately, and do not use `zoom` to hide structural overflow.
- **Grid:** fixed outer safe area, a small set of aligned columns, consistent gutters. Position a recurring title, eyebrow, folio, and footer in local layouts/global layers rather than by eye on each slide.
- **Hierarchy:** one focal point, one content level, optional annotation. Try a 3-level typographic system instead of many unrelated sizes.
- **Palette:** background, primary text, muted text, and one purposeful accent, with light/dark values. Use semantic tokens for success/warning/info and never use those colors as decoration elsewhere.
- **Typography:** a display/text family plus monospace only when needed. Limit weights; specify actual charset support and local/system fallbacks. Avoid loading dozens of Google Font weights.
- **Shape and motion:** repeat a small number of corner, border, line, and duration choices. Use transitions as continuity, not confetti.

Create 3 representative slides first—a cover, dense content, and diagram/code—render them, and refine the system before producing 30 slides.

## Make data and code readable

Charts need a stated comparison, direct labels where possible, units, a meaningful scale, and source/date. Do not fabricate a chart from decorative numbers. Tables need fewer numbers, aligned decimals, and a highlighted conclusion rather than every cell shouting.

Code should show the minimum complete mental step. Use imported source to avoid drift, highlight only the current concept, and hide boilerplate with pre-parser/ranges when warranted. Do not shrink 80 lines to illegibility to claim it fits. Magic Move is best for small purposeful evolutions; a full rewrite is clearer as separate states.

## Images, diagrams, and media

Prefer owned or properly licensed images with useful crop, correct aspect ratio, and alt text. Local files in `public/` are referenced `/name.ext`; authored compile-time assets can be imported from source. Keep high-resolution source but optimize delivery size. Do not hotlink critical visuals.

Use Mermaid for relationships and process; simplify crossing lines and enormous auto-layout diagrams. Use a custom Vue/SVG diagram when precise editorial positioning is the point. Math needs an explanation in words. Videos need a poster and playback/export fallback. Interactive embeds need an owner, network expectation, and screenshot fallback.

## Accessibility checks that affect implementation

- Contrast body text and controls against their actual background, including image overlays and dark mode. Large text is not permission for faint copy.
- Do not encode distinction solely by color, position, sound, hover, or movement. Add text/pattern, explicit announcement, or static alternative.
- Preserve visible focus and normal keyboard navigation in custom controls. Give real `<button>` elements labels.
- Give images descriptive `alt` when informative, empty `alt` when decorative. Explain complex SVG/canvas diagrams in adjacent text or notes.
- Do not rely on dragging as the only way to reveal content; persist final positions and provide a static/export-safe state.
- Reduce motion for users requesting it. `@media (prefers-reduced-motion: reduce)` can disable nonessential transitions and custom animations; verify Slidev state transitions still reach their final state.
- Keep text as text when possible; a flattened PPTX is not an accessible substitute for a tagged document. Supply an accessible transcript/source handout when requested.
- Test the actual languages, RTL direction, emoji, CJK, code glyph widths, and fallback fonts—not only English placeholders.

## Global styles without collateral damage

Global stylesheet selectors affect presenter and overview UI too. Scope audience-slide rules under `.slidev-layout`, a local layout class, or slide-scoped `<style>`. Do not globally reset `*`, button, input, or iframe behavior without testing tools/presenter mode. Keep third-party game/demo styles inside a component shadow root or scoped wrapper when necessary.
