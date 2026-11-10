# Ren — brand identity

Ren is a local-first agentic browser for people who make things: builders, creators, and anyone who
wants their browser to automate the boring parts. The product and its agent share one human name.

## Name

**Ren.** Short, global, gender-neutral, and the most popular boys' name in Japan through the 2020s.
人 *rén* is "person" (the human in the loop), 連 *ren* is "connect", 錬 *ren* is "to forge". It is one
letter away from Ron, the name it replaces, so existing users recognise it at once.

- Product: **Ren**. Agent: **Ren** ("Ask Ren", "Teach Ren", "Ren is working").
- Wordmark: lowercase **ren.** with a volt full stop (`RenWordmark`).
- Tagline: *The browser that builds.* Build agent hook: *Let Ren cook.*
- Internal identifiers keep the `ron` spelling: the `ron://` scheme, `ron-*` storage keys, `RON_*`
  env vars, Python modules, API routes and component file names. They are persisted or wired into
  other processes; renaming them would lose user state. Only what people read says Ren.

## Voice

Short, confident, warm. Verbs first. Sentence case everywhere. No exclamation marks, no emoji in the
chrome, never "AI-powered", "magic" or "supercharge". A little attitude in heroes and empty states
only ("Let Ren cook.", "Nothing here yet. Make something."). Errors say what happened and what to do.

## Colour — Ink & Volt

One electric colour, used with intent: primary actions, focus, selection, active state, agent
activity, data highlights. Everything else is ink and paper. Orange does not exist in Ren.

| Token | Light | Dark | Use |
|---|---|---|---|
| Volt (`blurple`) | 600 `#5543FF` | 400 `#8D98FE` | primary, focus ring, active, links |
| Ink | `#0B0C17` | `#F5F5FA` | text, ink buttons, sticker outlines |
| Paper (`surface-0` / `surface-900`) | `#FFFFFF` | `#10121C` | content |
| Chrome (`--ron-chrome`) | `#F1F2F6` | `#0B0C15` | tab strip, toolbar, sidebar |
| Hairline | ink 9% | paper 8% | borders |
| Success | `#01B568` | | done, connected |
| Signal (`amber`/`yellow`) | `#E6C103` | | warnings: yellow, never orange |
| Danger | `#EF2D4A` | | errors, destructive |

Blurple scale (OKLCH hue 277): 50 `#F5F6FE` · 100 `#E9ECFE` · 200 `#D3DAFE` · 300 `#B3BDFF` ·
400 `#8D98FE` · 500 `#676AFE` · 600 `#5543FF` · 700 `#4533D8` · 800 `#3429A7` · 900 `#251F78` ·
950 `#130F4B`. `indigo`, `violet`, `purple` and `ember` classes resolve to it; `zinc`, `slate`,
`gray`, `neutral`, `stone` resolve to the cool ink neutrals; `amber`, `orange`, `yellow` resolve to
signal yellow. Use `text-volt` / `bg-volt` when the shade must follow the theme (600 on paper,
400 on ink). Never hard-code hex or `rgb()` in components: use the scales, the shadcn tokens
(`bg-primary`, `text-muted-foreground`, `border-border`) or `rgb(var(--ren-volt) / a)`.

## Type

- **Display**: Bricolage Grotesque Variable (opsz, wdth, wght). Headings 700–800, tracking
  −0.025em to −0.045em, line-height 0.92–1.1. `.ren-display` is the poster cut (800, 86% width).
- **UI**: Inter Variable 400/500/600, 13–14px for controls and body, 12px for secondary.
- **Mono**: JetBrains Mono 400/500/600 for code, numbers in data, and tag labels.
- Scale: `text-display-2xl … display-sm` for heroes and page titles; one display heading per view.

## Shape and depth

- Radius: 8px controls (`rounded-lg`), 12px cards (`rounded-xl`), 16–20px panels and dialogs,
  full pills for chips and segmented controls.
- Borders are 1px hairlines (`border-surface-200 dark:border-surface-800`).
- Flat surfaces. Shadow only on layers that float (menus, dialogs, panels): `shadow-float`.
- Selected / active: a solid fill (ink pill, or volt for primary), not a glow.
- Motion: 150–220ms, `ease-out-expo`; no decorative pulsing; agent activity uses shimmer text.

## Motifs — street-gallery details

Use one per screen, two at most, never on dense data UI (tables, boards, editors):

1. **Tag label** — `.tag-label` (+ `.tag-label-slash` for the volt `//`): mono caps micro-label
   above a section or hero, e.g. `// PROJECTS`.
2. **Sticker** — `.sticker` / `.sticker-volt`: ink outline, hard offset shadow, rotated −2°. For
   NEW / LIVE / BETA and hero badges. `.sticker-flat` removes the tilt inside dense rows.
3. **Spray halo** — `.spray-halo`: a soft volt bloom behind a hero heading or empty-state mark.
4. **Marker** — `<Marker>`: a hand-drawn volt underline under one word of a hero heading.
5. **Halftone** — `.halftone`: printed-dot texture behind a hero, faded at the edges.
6. **The volt dot** — the logotype's full stop, ending a one-word line (`Build.`, as in the opening).

## Logo

The logo is the name: lowercase **ren.** with a volt full stop, nothing else. It is Bricolage Grotesque
(opsz 96, wght 800, wdth 92) stored as outlines in `src/components/brand/logotype.ts` (shaped with
HarfBuzz, outlined with fontTools, hand-spaced), so it is identical everywhere, including before fonts
load and in the app icon.

- `RenWordmark`: the logotype in a line, ink in `currentColor`, volt dot (`dotClassName` turns it white
  on a volt ground). Sized like text: its letters are as tall as the font size's x-height.
- `RenMark` `tile`: the white logotype on the volt gradient tile, for squares (panel headers, the URL bar,
  avatars). `glyph`: the logotype alone, fitted to the square.
- App icon `public/ren-app-icon.png` (the tile; set as the macOS Dock icon by `setDockIcon` in
  `electron/main.ts`); favicon `public/ren-mark.svg`.

Minimum sizes: 14px for the wordmark, 16px for the tile. Never recolour, outline, stretch, rotate or
add effects to it, and never set the name in another typeface as a logo.

## Opening

A first-time user's first screen is the opening sequence (`src/components/brand/OpeningSequence.tsx`),
about five seconds on an ink stage whatever the theme:

1. The `ren` outlines draw themselves in volt, then fill white.
2. The dot drops in, squashes as it lands, throws a shockwave and paint flecks, and drips.
3. *Browse.* *Build.* *Automate.* tick through one slot, then *Let Ren cook.* lands with the marker
   underline, the tagline and a "hello, builder" sticker.
4. **Let's go** (or Enter) floods the screen volt from the dot and dissolves into the app.

Skip or Esc leaves at once; Enter during the animation jumps to the last frame. It plays once, on a fresh
install (no `ron-first-run-v1`), and is marked seen (`ron-intro-seen-v1`) when it ends; the `#intro`
hash replays it (`src/lib/intro.ts`). Reduced motion shows the last frame still. The app behind it is
`inert` while it plays.

## Themes

- **Light**: paper content on a cool chrome, ink text, volt accents.
- **Dark**: blue-black ink surfaces (`surface-900` content on `#0B0C15` chrome), white ink, volt 400.
- **Glass**: a blue-toned translucent shell. Ice-blue tint (`234 240 255`) over a light desktop,
  deep navy (`15 22 61`) over a dark one, with blurple refraction hairlines; never grey or black.
  Rules and tokens: "GLASS THEME" in `src/index.css`; native material: `electron/window-material.ts`.

Every component must read correctly in all three. Glass works through tokens: pages use
`bg-surface-0 dark:bg-surface-900`, floating panels add `.ron-glass-panel`, menus use `bg-popover`.
