# Design System: Ron Browser Mobile — Light Edition (Warm Alabaster Paper & Burnt Copper)

## 1. Visual Theme & Atmosphere
An editorial-grade, gallery-airy mobile agentic browser interface that blends the literary authority of a print journal with the tactile precision of a Swiss instrument. Surfaces feel like warm, sun-lit archival paper (#FFFEFC to #F8F7F4) paired with deep charcoal ink (#1A1917) and a single disciplined Burnt Copper accent (#A9532E). Thumb-zone-first mobile ergonomics anchor the omnibar and agent triggers at the bottom edge while leaving the upper viewport calm and breathable.

## 2. Color Palette & Roles
- **Alabaster Paper** (#FFFEFC) — Primary viewport background surface (surface-0)
- **Warm Parchment** (#F8F7F4) — Elevated section & sheet background (surface-50)
- **Stone Wash** (#F1EFEB) — Subtle pill, chip, and input fill (surface-100)
- **Hairline Sand** (#E4E1DB) — Structural 1px borders and dividers (surface-200)
- **Charcoal Ink** (#1A1917) — Primary editorial & UI text (never pure #000000)
- **Umber Secondary** (#57524C) — Secondary body copy & descriptions
- **WarmPewter Muted** (#7F7971) — Metadata, overlines, timestamps, citations
- **Burnt Copper** (#A9532E) — Primary accent for active indicators, CTAs, focus rings, reading progress
- **Soft Terracotta** (#F6E6DA) — Tinted badge & active pill surface fill (ember-100)
- **Sage Signal** (#4F7A5A) — Live agent status, verified consensus, completed tasks
- **Ochre Amber** (#B7791F) — Due-soon warnings, HITL checkpoints
- **Cinnabar Red** (#C2413B) — Blocked issues, destructive actions

## 3. Typography Rules
- **Display / Editorial Headlines:** `Newsreader` — Literary high-contrast serif, weight 400 with italic emphasis (`<em>`) on key nouns/concepts, tight tracking (`-0.02em`), line-height `1.08`.
- **UI & Body Copy:** `Geist` — Crisp technical sans-serif, weight 400/500/600, comfortable `1.55` line-height.
- **Monospace / Telemetry:** `JetBrains Mono` — For `ron://` URLs, issue keys (`RON-142`), latency counters (`184ms`), citation indices (`[01]`), and overline labels (`11px`, uppercase, `0.12em` letter-spacing).

## 4. Mobile Component Stylings (390x844px iOS Viewport)
- **Bottom Chrome Dock:** Docked thumb-zone navigation bar featuring a pill omnibar (`ron://...`), tab counter square, Ask Ron copper spark button, and Teach Ron studio trigger. Minimum `44x44px` tap targets.
- **Editorial Cards:** `20px` border radius, `#FFFEFC` fill, `1px solid #E4E1DB` hairline border, diffused warm shadow (`0 4px 16px -4px rgba(26,25,23,0.06)`).
- **Pills & Lens Tabs:** Full-radius (`9999px`) chips or crisp `2px` Burnt Copper underline tabs with live monospace counters.
- **Anti-Patterns (Strictly Banned):** No purple/blue neon AI glows, no emojis, no pure black, no generic placeholder names ("John Doe", "Acme"), no overlapping text.
