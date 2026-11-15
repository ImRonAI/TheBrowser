# Layouts, slots, canvas, scaling, and persistent layers

Sources: [built-in layouts](https://sli.dev/builtin/layouts.html), [using layouts](https://sli.dev/guide/layout.html), [custom layouts](https://sli.dev/guide/write-layout.html), [directory structure](https://sli.dev/custom/directory-structure.html).

## Built-in layout map

| Layout | Role / configuration |
|---|---|
| `cover` | Default first slide; title/context |
| `default` | Default later slide; normal flow |
| `center` | Center content horizontally and vertically |
| `intro` | Presentation/presenter introduction |
| `section` | Meaningful chapter transition |
| `statement` | Single assertion as the main visual |
| `fact` | Prominent fact/number |
| `quote` | Quotation with attribution |
| `end` | Final slide; do not let it become an accidental blank ending |
| `full` | All available slide space |
| `none` | No layout styling; author owns all positioning |
| `image` | Full/main image via `image`; `backgroundSize` defaults to `cover`, can be `contain` or CSS size |
| `image-left`, `image-right` | Split image and content; `image`, `class`, optional `backgroundSize` |
| `iframe`, `iframe-left`, `iframe-right` | Web page embed via `url`; network/embed permissions/fallback required |
| `two-cols` | Default slot left; `::right::` right |
| `two-cols-header` | Default top header; `::left::` and `::right::` lower columns |

```md
---
layout: two-cols-header
---

# One comparison, one conclusion

::left::

## Before

Evidence, not generic filler.

::right::

## After

Equivalent evidence in the same visual language.
```

Themes and addons can add or override these. Load precedence is default → theme → addons → local `layouts/`, with later definitions overriding earlier ones. Inspect the selected layout before guessing slots.

## Custom layouts

Define `layouts/visual-proof.vue` and use `layout: visual-proof`. Use `<slot />`, named `<slot name="right" />`, slide frontmatter via `$frontmatter`, and scoped CSS/UnoCSS. [Slot sugar](features/slot-sugar.md) supplies named sections such as `::right::`; arbitrary names only work if the chosen layout actually declares them.

```vue
<script setup lang="ts">
defineProps<{ kicker?: string }>()
</script>

<template>
  <div class="visual-proof h-full grid grid-cols-12 gap-6 p-12">
    <header class="col-span-12">
      <p v-if="kicker" class="text-sm uppercase tracking-widest">{{ kicker }}</p>
      <slot name="heading" />
    </header>
    <main class="col-span-7"><slot /></main>
    <aside class="col-span-5"><slot name="evidence" /></aside>
  </div>
</template>
```

Props are slide frontmatter fields passed as defined by the layout. Prefer this reusable structure for repeated patterns rather than hand-positioning every slide. Avoid deep absolute coordinates except truly spatial diagrams or drag interactions.

## Size and scale hierarchy

1. [Canvas size](features/canvas-size.md): `canvasWidth` and `aspectRatio` globally determine design coordinates.
2. [Slide zoom](features/zoom-slide.md): `zoom` scales the content of one slide; use for rare intentional density differences.
3. [Transform component](features/transform-component.md): scale an element/miniature with `origin`; transformed visual size and original layout box differ.
4. CSS sizing: normal flow/grid should handle ordinary composition.

Do not use arbitrarily small `zoom` or `Transform` to make an overstuffed slide “fit.” Inspect `scrollWidth`/`scrollHeight` as well as the rendered image: CSS overflow can exist even when the outer slide bounds look fine.

## Persistent layers and export

[Global layers](features/global-layers.md) conventions:

- `global-top.vue` / `global-bottom.vue`: one persistent instance, good for deck-wide effects or navigation-dependent state.
- `slide-top.vue` / `slide-bottom.vue`: per-slide instance, good for folios/footer treatments that must have correct export context.
- `custom-nav-controls.vue`: extend navigation, not slide content.

Z-order top to bottom: nav controls → global top → slide top → slide content → slide bottom → global bottom. Establish `pointer-events` intentionally so decorations do not steal controls. `$frontmatter` is empty in out-of-slide components; use `$nav.currentFrontmatter` or `$nav.currentLayout`. Global navigation-dependent layers may need `--per-slide` export (not supported for editable PPTX); prefer per-slide layers where possible.

```vue
<!-- slide-bottom.vue -->
<template>
  <footer v-if="$nav.currentLayout !== 'cover'" class="folio">
    <SlideCurrentNo /> / <SlidesTotal />
  </footer>
</template>
<style scoped>
.folio { position: absolute; right: 2rem; bottom: 1.25rem; font-size: .75rem; }
</style>
```

Avoid putting essential narrative only in an overlay: print, presenter, overview, and interactive context differ. Use `<RenderWhen>` for explicit contexts and inspect all relevant ones.
