# Built-in components and interactive HTML/Vue in slides

Primary: [built-in component reference](https://sli.dev/builtin/components.html), [components in slides](https://sli.dev/guide/component.html). Theme/addon components extend this list and are auto-imported like local `components/` files.

## Component atlas

| Component | Purpose and key API |
|---|---|
| `<Arrow>` | SVG-ish visual connector; required `x1,y1,x2,y2`; `width=2`, `color=currentColor`, `two-way=false` |
| `<VDragArrow>` | Draggable Arrow; non-position props match Arrow |
| `<AutoFitText>` | Fitty-powered text fit; `min=30`, `max=100`, `modelValue`, `multiLine=true` |
| `<LightOrDark>` | `#light` / `#dark` slots; slot props pass through via `v-bind="props"` |
| `<Link>` | Navigate to 1-based slide `to="42"` or `routeAlias`; optional `title` |
| `<RenderWhen>` | Conditional render by `context`, `#default`/`#fallback` |
| `<SlideCurrentNo>` / `<SlidesTotal>` | Current slide / total number |
| `<TitleRenderer>` | Render title from another slide via `no`; virtual import `#slidev/title-renderer` |
| `<Toc>` | `columns`, `listClass`, `minDepth=1`, `maxDepth=Infinity`, `mode=all|onlyCurrentTree|onlySiblings` |
| `<Transform>` | `scale=1`, `origin='top left'`; visual transform, not ordinary responsive layout |
| `<Tweet>` | `id` or `url` (id wins), `scale`, `conversation`, `cards`; network/external-content dependency |
| `<BlueSky>` | `uri` AT-URI or bsky.app post URL; `scale`; network/external-content dependency |
| `<VClick>`, `<VAfter>`, `<VClicks>` | Click reveal/hide shorthand; see animation guide |
| `<VSwitch>` | Click-index slots; `unmount=false`, `tag`, `childTag`, `transition=false` |
| `<VDrag>` / `v-drag` | Position/size/rotate draggable elements |
| `<SlidevVideo>` | Playback synchronized with clicks/print; source slots and specific autoplay/reset/poster props |
| `<Youtube>` | `id`, `width`, `height`; `?start=seconds` supports start time |

### Video

```md
<SlidevVideo v-click autoplay="once" controls autoreset="click"
  poster="/demo-poster.webp" printPoster="/demo-poster.webp"
  :timestamp="2" printTimestamp="last">
  <source src="/demo.webm" type="video/webm" />
  <source src="/demo.mp4" type="video/mp4" />
  <p>Video unavailable. <a href="/demo.mp4">Download the demonstration.</a></p>
</SlidevVideo>
```

- `controls=false` by default.
- `autoplay: true` or `'once'` starts only once and does not automatically restart after ending/pausing; false uses controls/manual playback.
- `autoreset='slide'` or `'click'` resets when navigating back to the slide/click turn.
- `poster` covers playback and print unless `printPoster` overrides; `timestamp` and `printTimestamp` control position (`printTimestamp='last'` allowed).
- Export Chromium may lack proprietary codecs. Supply compatible formats, `--executable-path` deliberately, or a tested static poster/transcript.

### Navigation, TOC, and visibility

`RenderWhen.context` accepts a value or array from `'main' | 'visible' | 'print' | 'slide' | 'overview' | 'presenter' | 'previewNext'`; `'main'` means slide + presenter. `hideInToc` controls TOC inclusion without hiding a slide. A `title` can be explicitly set and `level` controls extracted hierarchy. Use `routeAlias` for stable links instead of slide numbers when content may reorder.

### Draggable elements

See [draggable syntax](features/draggable.md) for all directive/component forms. Prefer named `dragPos` frontmatter positions in five-value `Left,Top,Width,Height,Rotate` form for reproducibility. Directive inline array updates use regex to modify source and can be brittle. A new draggable can generate initial positions, but generated coordinates must be committed and visually/export checked. Give essential content a static layout path; dragging is not keyboard/screen-reader navigation.

## Custom component development

Put `components/MyVisual.vue` in the project root and use `<MyVisual />` without manual registration. Use real semantic controls, keyboard operation, focus indication, alt text, and cleanup. See [Vue APIs](vue-components.md) for public composables, navigation, slide hooks, and lifecycle.

Do not make arbitrary remote data or remote post embeds a load-bearing requirement. A deck may need CSP/CORS cookies or third-party JS; iframes can refuse framing. Always inspect production build and provide local fallback imagery/explanation. Components run as trusted web application code, same-origin with your deck.
