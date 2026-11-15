# Click choreography, motion, and transitions

Primary: [official animation guide](https://sli.dev/guide/animations.html). Exact related syntax: [Magic Move](features/shiki-magic-move.md), [markers](features/rough-marker.md), [direction variants](features/direction-variant.md), [note click markers](features/click-marker.md).

## Reveal, hide, and group

```md
<div v-click>Shown after the next click</div>
<v-click>Equivalent component form</v-click>
<div v-click.hide>Hidden at its click position</div>
<div v-after>Shown with the previous relative click</div>
<v-click hide>Hidden at its click position</v-click>

<v-clicks depth="2" every="1">

- First point
- Second point
  - Nested point

</v-clicks>
```

`<v-clicks>` applies clicks to direct children; `depth` descends nested lists, `every` reveals that many items per click. `v-after` is a `+0` relative click. Components use `at`/`hide` props; directives use `v-click`, `.hide`, and values. Do not put independent auto-increment directives in components whose render order may change without testing.

## Relative and absolute schedules

The default relative position is `'+1'`; `'+0'` binds to the previous relative click. Relative offsets persist from previous relative elements. Use absolute positions for meaningful, explicitly storyboarded states:

```md
<div v-click="1">First beat</div>
<div v-click="2">Second beat</div>
<div v-click="[2, 4]">Visible only at clicks 2 and 3</div>
<div v-click="['+1', '+2']">Relative enter/range example; use deliberately</div>
<v-click-gap size="1" />

<v-switch>
  <template #1>Click 1</template>
  <template #2>Click 2 until click 5</template>
  <template #5-7>Clicks 5 and 6</template>
</v-switch>
```

Ranges are exclusive at the end. `<VSwitch>` offers `unmount`, `tag`, `childTag`, and `transition`; unmount only when removing state is intended. `clicks: N` in frontmatter overrides automatic total clicks; `clicksStart` sets a starting offset. Check a slide at 0, each middle beat, and its final click both forward and backward. Too many clicks stalls the story; too few exposes the answer before the question.

Dynamic code highlighting with `{hide|1-2|4|all}` participates in clicks. A code fence can additionally use `{at:'+5'}` to offset its schedule. [Line highlighting](features/line-highlighting.md) gives exact syntax. Keep code and the explanation on the same beat.

## Presets and CSS

Set `clickAnimation` deck-wide/per-slide, or modifiers per element:

```md
<div v-click.fade.right>Composed fade + right</div>
<div v-click.scale>Scale</div>
<div v-click.none>No visual animation</div>
```

Built-ins: `fade`, `fade-in`, `up`, `down`, `left`, `right`, `scale`, `none`. A custom preset `pop` uses `.slidev-vclick-anim-pop.slidev-vclick-hidden`. Standard targets receive `.slidev-vclick-target` and hidden targets `.slidev-vclick-hidden` (opacity 0 and `pointer-events: none` by default). Override these classes in intentionally scoped styles; transitions of `all` can cause layout jitter. Scope by `.slidev-page-N` or a layout class where necessary.

[Rough markers](features/rough-marker.md) use `v-mark` with type/color/click options for underline, box, circle, highlight, and related Rough Notation effects. [Direction variants](features/direction-variant.md) expose `.slidev-nav-go-forward`, `.slidev-nav-go-backward`, and UnoCSS `forward:`/`backward:`. [Note markers](features/click-marker.md) highlight presenter note sections at matching beats.

## VueUse Motion

`v-motion` supports `initial`, `enter`, `leave`, and click variants:

```html
<div v-motion
  :initial="{ x: -50, opacity: 0 }"
  :enter="{ x: 0, opacity: 1 }"
  :click-2="{ x: 40 }"
  :click-3-5="{ y: 30 }"
  :leave="{ x: 50, opacity: 0 }">
  A purposeful state change
</div>
```

`click-x` applies when `$clicks >= x`; `click-x-y` applies `x <= $clicks < y`. Click-specific variants have priority over `enter`. The upstream guide warns that only `v-click` on the same element can currently control motion due to a Vue bug; use `v-if="3 < $clicks"` as a tested workaround where necessary. Modern versions no longer need the old `preload: false` workaround. Verify spring/motion completion in exported images and give delayed content a `--wait` need, not an arbitrary global delay.

## Slide and element transitions

Built-in `transition` values: `fade`, `fade-out`, `slide-left`, `slide-right`, `slide-up`, `slide-down`, `view-transition`. Set globally or per slide. Custom transition names and Vue `TransitionGroupProps` are supported; custom `none` can suppress a transition in an otherwise animated deck. `view-transition` depends on browser support and matching `view-transition-name` values, optionally assigned through Comark classes. Do not require it for narrative meaning.

A transition belongs to the slide boundary, whereas click effects occur within the slide. Avoid using entrance motion on every preloaded slide if it triggers too early. Components need `onSlideEnter`/`onSlideLeave` or active state to control timers/media; see [slide hooks](features/slide-hook.md).

## Final/export contract

- PDF by default exports final states without separate clicks; PPTX defaults to every click. Set `--with-clicks` or `--with-clicks false` intentionally.
- Prefer one final coherent state. If a concept disappears midway, provide an export companion or a deliberate click-step export.
- Interactive/canvas/WebGL motion may not serialize correctly in print/editable PPTX; provide a static frame.
- Respect `prefers-reduced-motion` for custom work and test the final state. Animation must not contain information unavailable any other way.
- Verify final click count with keyboard and browser captures, not source regex alone. Relative calculations, hooks, and imported content make static counting only a heuristic.
