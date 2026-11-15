# Slidev Markdown, separators, frontmatter, and imports

Primary: [syntax](https://sli.dev/guide/syntax.html), [configuration](https://sli.dev/custom/), [v53 parser](https://github.com/slidevjs/slidev/blob/v53.1.0/packages/parser/src/core.ts). Use the exact feature examples linked below rather than memorized approximations.

## Mental model

`slides.md` is the default entry. Ordinary Markdown, HTML, and Vue templates can coexist. Slidev pre-parses raw lines into slides, resolves frontmatter and includes, then renders the Markdown/Vue app. Pre-parser extensions can make source lint incomplete; the actual CLI is authoritative.

```md
---
theme: default
title: A precise title
---

# Opening promise

A sentence for the audience.

<!--
The last HTML comment block is presenter notes.
-->

---
layout: center
class: text-center
routeAlias: model
---

# One idea per slide

Use **normal Markdown** and purposeful components.
```

## Separator and frontmatter rules

- The first conventional frontmatter is **headmatter**, configuring the deck and the first slide. It begins and ends with `---` at the file start.
- Later `---` separators divide slides. For each later separator, a **nonblank next line** causes the parser to seek a closing exact `---` for frontmatter; an immediately following blank line produces ordinary content. Two consecutive `---` lines do not mean “YAML plus blank line”; the next separator can consume content as YAML. Use conventional `---`, YAML, `---`, then content for configured slides.
- Indent horizontal rules or use another Markdown representation; an unindented `---` line at top level is a slide boundary. Fenced code is skipped by Slidev's separator scanner; close a fence before the intended slide boundary.
- Comments can hide separators while the comment remains open. Do not place an HTML comment around many slides expecting a simple lexical split.
- A YAML fence such as ```` ```yaml ```` at the beginning of a later slide can be block frontmatter. The opening deck headmatter still uses conventional `---`. See [block frontmatter](features/block-frontmatter.md).
- Quote YAML values where their grammar requires it, but keep `aspectRatio: 16/9` and `duration: 30min` as standard configurations. Slide metadata accepts theme- and custom-layout-specific fields; unknown fields are not automatically mistakes.

## Notes

The final HTML comment of a slide is notes; a comment before later slide content is ordinary content. Markdown/HTML in notes renders in presenter mode. Keep citations meant for the audience visible; notes are a presenter/private delivery surface and must be deliberately excluded from a public build when necessary. `[click]` note markers are covered in [click markers](features/click-marker.md).

## Markdown blank lines and components

Keep blank lines around Markdown inside component/template slots when it must be parsed as Markdown. Keep HTML/Vue opening and closing tags balanced and avoid Markdown list indentation that unintentionally changes DOM structure. Code samples inside a Markdown code fence need an outer fence of at least four backticks. Inline Vue interpolations such as `{{ $page }}` expose context, not arbitrary safe eval; treat imports and execute hooks as trusted application code.

## Imported slides

[Slide imports](features/importing-slides.md) use `src` to compose source files; paths support page ranges and multiple entries where documented. [Frontmatter merging](features/frontmatter-merging.md) determines whether root/imported values win. Read both before relying on an override. Range addressing applies to the imported file's rendered slide sequence; modifications earlier in the source can change numbering.

Organize by meaningful chapters (`pages/01-problem.md`) instead of splitting every paragraph. Reused sources may inherit defaults; avoid surprising deck-wide mutations deep in a chapter. Validate recursively from the root and inspect rendered slide numbering, titles, `routeAlias`, and links after reordering.

## Style location

A slide-local `<style>` is scoped differently from normal global CSS; see [slide scope styles](features/slide-scope-style.md). Use `styles/index.css` (or `style.css`) for intentional global tokens under `.slidev-layout`; component/layout scoped CSS for reusable templates. General `h1`, `button`, or `.grid` selectors can damage presenter/overview UI. See [directory structure](https://sli.dev/custom/directory-structure.html).

## Optional Comark

[Comark syntax](features/comark.md) must be enabled with `comark: true`; use attribute sugar, inline/block components, and container syntax only after that. It supersedes old MDC examples but copied syntax still needs compilation in the selected version. Code groups depend on it. Do not enable a second syntax unnecessarily for ordinary Markdown.

## Diagnostic order

If the number of slides surprises you: inspect separators and closing fences first; then frontmatter and comments; then `src` includes; finally custom `setup/preparser.ts` and Markdown transformers. `validate.py` helps with conventional sources but deliberately reports uncertainty for custom processing. For source-map actions/editor features, custom preparser transformations can break them even if the rendered output appears correct.
