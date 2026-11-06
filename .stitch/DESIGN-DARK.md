# Design System: Ron Browser Mobile — Dark Edition (Warm Obsidian Graphite & Glowing Ember)

## 1. Visual Theme & Atmosphere
A nocturnal, high-craft mobile agentic browser cast in warm architectural graphite (#131312 to #191817) with warm parchment typography (#F3F1ED) and luminous Burnt Copper Ember accents (#D6825A / #C26A41). Rather than cold blue-black cybersecurity clichés, the dark mode feels like a dimly lit architectural study—matte carbon surfaces, subtle warm inner top-edge highlights, and crisp monospace telemetry.

## 2. Color Palette & Roles
- **Obsidian Carbon** (#131312) — Primary viewport background (surface-900, never pure #000000)
- **Warm Smoke** (#191817) — Elevated sheet & drawer background (surface-850)
- **Graphite Card** (#1F1E1C) — Card and module container surface (surface-800)
- **Basalt Border** (#2D2B28) — Hairline 1px structural borders (surface-700)
- **Parchment Inverse** (#F3F1ED) — Primary headline and body text
- **Ash Secondary** (#ADA79F) — Secondary descriptions and summaries
- **Stone Muted** (#86807A) — Overlines, timestamps, citation domains
- **Ember Copper** (#D6825A) — Primary luminous accent for active states, progress bars, and focus rings
- **Deep Copper Fill** (#2C150D) — Subtle tinted surface for active pills and agent badges
- **Sage Signal** (#4F7A5A) — Live stream indicator, consensus badge
- **Ochre Amber** (#B7791F) — Checkpoint / warning state
- **Cinnabar Red** (#C2413B) — Error / blocked status

## 3. Typography Rules
- **Display / Editorial Headlines:** `Newsreader` — High-contrast literary serif in `#F3F1ED` with italic copper-tinted emphasis, tracking `-0.02em`.
- **UI & Body Copy:** `Geist` — Clean sans-serif for controls, cards, and streaming responses.
- **Monospace / Telemetry:** `JetBrains Mono` — Tabular numerals for token rates, issue IDs, `ron://` routes, and source counts.

## 4. Mobile Component Stylings (390x844px iOS Viewport)
- **Bottom Chrome Dock:** Matte graphite floating dock (`#191817`) with `1px solid #2D2B28` border and subtle warm ember active indicator.
- **Cards:** `20px` rounded corners, `#1F1E1C` fill, `1px solid #2D2B28` border, deep shadow (`0 8px 32px -8px rgba(0,0,0,0.55)`).
- **Anti-Patterns (Strictly Banned):** No purple/indigo/cyan cyberpunk neon, no pure `#000000`, no emojis, no generic placeholder copy.
