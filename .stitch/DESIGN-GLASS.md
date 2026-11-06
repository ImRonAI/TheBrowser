# Design System: Ron Browser Mobile — Glass Edition (Smoked Quartz Spatial Glass & Copper Refraction)

## 1. Visual Theme & Atmosphere
A spatial, multi-layered glassmorphic mobile browser interface where every card, sheet, pill, and chrome bar is crafted from frosted smoked quartz (`backdrop-filter: blur(40px) saturate(200%)`) floating over a deep warm espresso-and-burnt-copper ambient mesh canvas (`#131312` base with diffused radial blooms of `#A9532E` at 18% opacity and `#4E271A` at 24% opacity). Every glass layer features a crisp `1px` specular top-left rim (`rgba(255,255,255,0.14)`) and soft refractive depth.

## 2. Color Palette & Roles
- **Ambient Mesh Canvas** (#131312 + radial blooms of #6B3420 & #A9532E) — Deep atmospheric backdrop that makes translucent glass layers visibly refract warm copper light
- **Smoked Quartz Card** (`rgba(255, 255, 255, 0.06)`) — Primary frosted card surface with `blur(24px) saturate(180%)`
- **Ultra Frosted Sheet** (`rgba(25, 24, 23, 0.72)`) — Floating bottom omnibar, drawers, and sticky headers with `blur(40px)`
- **Specular Rim Border** (`rgba(255, 255, 255, 0.14)`) — 1px luminous glass edge highlight (`inset 0 1px 1px rgba(255,255,255,0.12)`)
- **Copper Glass Tint** (`rgba(214, 130, 90, 0.16)`) — Active pill, lens tab, and primary button glass fill with `1px solid rgba(214, 130, 90, 0.45)`
- **Luminous Parchment** (#F8F7F4) — Primary crisp text over frosted glass
- **Champagne Secondary** (#D2CEC6) — Secondary body copy over glass
- **Warm Quartz Muted** (#A8A39A) — Monospace metadata, overlines, timestamps
- **Refractive Ember** (#E1A887) — Primary accent highlights, spark icons, live indicators

## 3. Typography Rules
- **Display / Editorial Headlines:** `Newsreader` — Literary serif in `#F8F7F4` with warm champagne italic accents (`#E1A887`).
- **UI & Body Copy:** `Geist` — High-legibility sans-serif engineered for crisp rendering over translucent blurred surfaces.
- **Monospace / Telemetry:** `JetBrains Mono` — Frosted pill counters, `ron://` protocol badges, and live agent metrics.

## 4. Mobile Component Stylings (390x844px iOS Viewport)
- **Floating Spatial Pills:** Every toolbar, lens bar, and card floats with visible separation, `24px` border radius, `backdrop-filter: blur(32px)`, specular `1px` borders (`rgba(255,255,255,0.14)`), and layered glass elevation (`0 12px 40px -8px rgba(0,0,0,0.45)`).
- **Anti-Patterns (Strictly Banned):** No opaque flat gray blocks (every container must visibly transmit the warm copper/espresso ambient canvas underneath), no purple/blue neon, no emojis, no generic placeholder text.
