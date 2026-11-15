# Vue components, global context, composables, and lifecycle

Primary: [components](https://sli.dev/guide/component.html), [global context](https://sli.dev/guide/global-context.html), [slide hooks](features/slide-hook.md), [v53 useNav](https://github.com/slidevjs/slidev/blob/v53.1.0/packages/client/composables/useNav.ts).

## Local components

Create `components/RevealDiagram.vue`; use `<RevealDiagram />` without importing/registering it. Components can also be JS/TS/JSX/TSX/MD per directory conventions. Treat them as the same trusted Vue application: avoid leaking secrets into client props, and pin third-party packages. `<script setup>` is the default ergonomic choice.

```vue
<script setup lang="ts">
import { computed, onWatcherCleanup, ref, watch } from 'vue'
import { onSlideEnter, onSlideLeave, useIsSlideActive, useNav } from '@slidev/client'

const props = defineProps<{ label: string }>()
const { currentPage, total } = useNav()
const active = useIsSlideActive()
const progress = computed(() => `${currentPage.value} / ${total.value}`)

onSlideEnter(() => { /* start only the active visual */ })
onSlideLeave(() => { /* stop timers, audio, observers */ })
</script>

<template>
  <section class="diagram" :aria-label="label">
    <slot />
    <small>{{ progress }}</small>
  </section>
</template>
```

Use the actual public export surface of the installed `@slidev/client`; the example names are from the official global-context guide. Do not import `@slidev/client/logic/...` or other internal paths. If `useSlideContext()` is used in a file, automatic `$slidev` injection is disabled: obtain `$slidev` from the composable as documented.

## Context in Markdown/Vue templates

| API | Meaning |
|---|---|
| `$slidev` | Global Slidev context; `$slidev.configs` deck config; `$slidev.themeConfigs` theme config |
| `$frontmatter` | Current slide frontmatter; empty for out-of-slide global layers |
| `$page` | Local 1-based slide number |
| `$clicks` | Current slide's local click state |
| `$nav` | Global reactive navigation state and methods |
| `$renderContext` | `slide`, `overview`, `presenter`, `previewNext`, or print-related context depending use |

Use `v-if="$clicks >= 2"` only when intentionally coupling DOM existence to click state. For simple show/hide preserve Slidev click scheduling via `v-click` instead of implementing a second system. `<RenderWhen context="presenter">` is preferable for render-context variants.

`$nav.next()`, `nextSlide()`, `go(10)` and reactive `currentPage`, `currentLayout`, `currentFrontmatter`, `currentSlideRoute`, `total`, `isPresenter` are demonstrated/documented APIs. Consult the installed `SlidevContextNav` type for exact properties rather than inventing them. `$nav.clicks` is global navigation click state; `$clicks` is local to a slide. Never invoke navigation recursively from its own watcher. Do not assume preloaded components are active.

## Lifecycle and hooks

[Slide hooks](features/slide-hook.md) use `onSlideEnter` and `onSlideLeave` from `@slidev/client`. Register them inside a component/set-up context; clean up asynchronous work, media, WebSocket connections, observers, and events. A hook can be triggered after preloading: guard expensive work with `useIsSlideActive()` or actual entry state. Tests should include next/previous, overview, presenter, print/export, and component unmount behavior.

```ts
const stop = watch(active, (value) => {
  if (value) start()
  else stop()
})
onUnmounted(stop)
```

The active hook alone may not handle a component with multiple rendered contexts. Use `useSlideContext` and render context when previewNext/presenter/main instances need isolation. Keep WebGL/canvas loops bounded; pause when the slide is not visible.

## Advanced interactivity contract

- Use real buttons/inputs and labels, keyboard support, focus, and a reset action for demos.
- Prop-driven data should be serializable where possible; avoid depending on hidden global mutable state.
- Do not let a user click a demo trigger deck navigation; stop event propagation only on the specific control and test arrow-key behavior.
- Interactive Vue survives SPA hosting, not PDF. PNG/PPTX show one captured state. Export a deterministic poster and explain fallback behavior.
- Browser APIs require permissions or secure contexts: media, Wake Lock, clipboard, and remote data need explicit fallback.
- Keep animations reduced-motion aware and never require hover only.
