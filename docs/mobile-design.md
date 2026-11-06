# DESIGN.md — Ron Browser Mobile Design System & Component Specification

> **Authority:** Canonical mobile design specification for **Ron Browser** (`393 × 852 px` portrait viewport). Derived directly from `tailwind.config.ts`, `src/index.css`, and the production React 19 + TypeScript component tree in `src/pages/` and `src/components/`.

---

## 1. Core Design Philosophy & Non-Negotiable Rules

1. **Bold Minimalism (`60%–75%` Open Canvas):**
   - Mobile screens must breathe. Every screen is structured around architectural `1px` hairlines, crisp pill/card containment, bold typographic hierarchy, and expansive negative space.
   - Never stack redundant toolbars, decorative badges, or multi-column desktop grids into a mobile viewport.

2. **One Universal Font Family Across 100% of the UI:**
   - **Font Family:** `'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif`
   - Every single text node—display titles, section headers, body copy, URL bar routes (`ron://...`), buttons, model selector pills, keyboard hints, and status badges—uses **this single geometric sans-serif family**.
   - **Strictly Forbidden:** Never mix serif display fonts (`Newsreader`, `Georgia`, `Times`) or monospace fonts (`JetBrains Mono`, `Courier`) anywhere in the mobile UI chrome.
   - **CSS Rule Implementation:** Apply `font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;` on `html, body, button, input, textarea, select`. Never put `* { font-family: ... !important; }` on the universal selector if icon fonts are present; always render icons as inline `<svg>` elements.

3. **Empty State First Principle (Zero Invented Subject Matter):**
   - Every screen in Ron Browser is designed and verified in its **pristine, resting Empty State first**, before any user query, article, project, issue, or agent transcript exists.
   - Empty states must **never** contain hallucinated subject matter (no chemistry/physics prompts, no fake news headlines, no fake user personas, no fake chat logs, no fake tasks).
   - Used states are additive projections on top of the exact same shell and component primitives.

4. **Inline SVG Iconography (`1.5px` Stroke):**
   - All icons use crisp, minimal `1.5px`-stroke vector geometry (`16×16px` inside pills/buttons, `18×18px` in chrome bars, `20×20px` inside `44×44px` empty-state containers).
   - Never rely on unstyled text ligatures (`material-symbols-outlined`) that can fail to load or render raw ligature strings (`arrow_back`, `auto_awesome`, `menu_book`).

---

## 2. Three-Theme Material & Color System (`Light`, `Dark`, `Glass`)

Every screen and component in Ron Browser Mobile must support three exact theme modes without altering layout geometry, spacing, or typography.

### 2.1 Theme 1 — `Light` (`Paper` · Warm Architectural Daylight)

| Token | CSS Variable / Class | Hex / Value | Usage |
|---|---|---|---|
| **Canvas Primary** | `--color-bg-primary` / `bg-surface-0` | `#FFFEFC` | Main page canvas, primary card surface, active pill surface |
| **Canvas Secondary** | `--color-bg-secondary` / `bg-surface-50` | `#F8F7F4` | Top/bottom browser chrome bars, resting empty-state stage well |
| **Canvas Tertiary** | `--color-bg-tertiary` / `bg-surface-100` | `#F1EFEB` | Recessed input wells, inactive segmented-control track |
| **Border Hairline** | `--color-border` / `border-surface-200` | `#E4E1DB` | `1px solid` card, input, and toolbar dividers |
| **Border Subtle** | `--color-border-subtle` / `border-surface-100` | `#F1EFEB` | Internal row dividers and subtle hairlines |
| **Border Strong** | `border-surface-300` | `#D2CEC6` | Active composer ring or hovered card border |
| **Ink Primary** | `--color-text-primary` / `text-ink` | `#1A1917` | Headings, primary body text, active labels, primary CTA background |
| **Ink Secondary** | `--color-text-secondary` / `text-ink-secondary` | `#57524C` | Subtitles, secondary descriptions, inactive tab labels |
| **Ink Muted** | `--color-text-muted` / `text-ink-muted` | `#7F7971` | Placeholders, timestamps, micro-labels, helper hints |
| **Ink Ghost** | `text-ink-ghost` | `#D2CEC6` | Disabled icons and decorative grid dots |
| **Primary CTA Fill** | `bg-ink text-surface-0` | `#1A1917` fill / `#FFFEFC` text | Primary buttons (`Continue`, `Start teaching`, `Send`, `+ New Issue`) |
| **Accent (Ember)** | `--color-accent` / `text-accent` | `#A9532E` | Subtle `6px` status dot, active focus ring (`ring-accent/60`), `Ask Ron` sparkle icon |
| **Semantic Status** | `success` / `warning` / `danger` / `info` | `#4F7A5A` / `#B7791F` / `#C2413B` / `#4A6FA5` | Connection indicator dot (`#4F7A5A`), error banners (`#C2413B`) |
| **Elevation Shadow SM** | `--shadow-sm` | `0 1px 2px 0 rgb(26 25 23 / 0.04)` | Resting cards, segmented active pills |
| **Elevation Shadow MD** | `--shadow-md` | `0 6px 20px -8px rgb(26 25 23 / 0.10)` | Floating search composer, bottom sheets |

---

### 2.2 Theme 2 — `Dark` (`Graphite` · Pure Matte Near-Black)

> **Critical Dark Mode Rule:** Dark mode surfaces and borders are **pure neutral matte dark graphite** (`#131312` / `#191817` / `#1F1E1C` with `#2D2B28` neutral dark gray borders). **Never** tint dark cards, backgrounds, or borders brown, copper, or orange.

| Token | CSS Variable / Class | Hex / Value | Usage |
|---|---|---|---|
| **Canvas Primary** | `--color-bg-primary` / `dark:bg-surface-900` | `#131312` | Main page canvas |
| **Canvas Deep** | `dark:bg-surface-950` | `#0C0C0B` | Deep recessed well / modal backdrop |
| **Canvas Secondary** | `--color-bg-secondary` / `dark:bg-surface-850` | `#191817` | Top/bottom browser chrome bars, elevated cards, drawers |
| **Canvas Tertiary** | `--color-bg-tertiary` / `dark:bg-surface-800` | `#1F1E1C` | Input fields, segmented-control track, secondary pills |
| **Border Hairline** | `--color-border` / `dark:border-surface-700` | `#2D2B28` | `1px solid` neutral dark gray hairline border |
| **Border Subtle** | `--color-border-subtle` / `dark:border-surface-800` | `#1F1E1C` | Subtle internal dividers |
| **Border Strong** | `dark:border-surface-600` | `#4E4A44` | Focused input border |
| **Ink Primary** | `--color-text-primary` / `dark:text-ink-inverse` | `#F3F1ED` | Headings, active labels, primary CTA background |
| **Ink Secondary** | `--color-text-secondary` / `dark:text-ink-inverse-secondary` | `#ADA79F` | Subtitles, secondary copy, inactive tabs |
| **Ink Muted** | `--color-text-muted` / `dark:text-ink-inverse-muted` | `#86807A` | Placeholders, micro-labels, keyboard hints |
| **Primary CTA Fill** | `dark:bg-ink-inverse dark:text-surface-900` | `#F3F1ED` fill / `#131312` text | High-contrast primary action buttons |
| **Accent (Ember Light)** | `--color-accent-light` / `text-accent-light` | `#D6825A` | Used **only** for `6px` status dots, `Ask Ron` sparkle icon, and `:focus-visible` ring |
| **Elevation Shadow SM** | `--shadow-sm` | `0 1px 2px 0 rgb(0 0 0 / 0.30)` | Resting cards and pills |
| **Elevation Shadow MD** | `--shadow-md` | `0 6px 20px -8px rgb(0 0 0 / 0.50)` | Floating sheets and composer |

---

### 2.3 Theme 3 — `Glass` (`Liquid Glass` · `html.glass` Translucent Daylight Shell)

> **Critical Glass Mode Rule (`src/index.css` lines 756–860):** Glass mode is **Daylight Frosted White Glass** floating over a soft warm-stone-to-cool-mist architectural gradient backdrop with dark charcoal ink (`#1A1917`). It is **never** dark cyberpunk neon.

| Token | CSS Variable / Value | Exact Value | Usage |
|---|---|---|---|
| **Ambient Viewport Backdrop** | `html.glass:not(.glass-native) body` | `radial-gradient(1100px 760px at 10% 6%, rgb(214 130 90 / 0.38), transparent 62%), radial-gradient(1000px 720px at 92% 94%, rgb(74 111 165 / 0.32), transparent 60%), linear-gradient(160deg, #ECE6DE 0%, #D8DDE5 100%)` | Full-bleed mobile `body` background behind all translucent layers |
| **Glass Base Tint** | `--ron-glass-tint` | `255 254 252` (`#FFFEFC`) | Base RGB tint for all frosted white glass surfaces |
| **Glass Chrome Surface** | `--ron-glass-chrome-alpha: 0.16` | `rgb(255 254 252 / 0.16)` + `backdrop-filter: blur(30px) saturate(180%)` | Top mobile chrome bar & bottom navigation bar |
| **Glass Control Capsule** | `--ron-glass-control-alpha: 0.50` | `rgb(255 254 252 / 0.50)` | Address pill (`ron://...`), `Ask Ron` button, segmented control track |
| **Glass Content Card** | `--ron-glass-content-alpha: 0.52` | `rgb(255 254 252 / 0.52)` + `backdrop-filter: blur(30px) saturate(180%)` | Primary content cards, empty-state containers, form wells |
| **Glass Floating Panel / Sheet** | `--ron-glass-panel-alpha: 0.62` | `rgb(255 254 252 / 0.62)` + `backdrop-filter: blur(30px) saturate(180%)` | Agent Panel, Sidebar Drawer, Teach Ron Studio, Issue Detail Sheet |
| **Glass Popover / Active Pill** | `--ron-glass-popover-alpha: 0.60` / `0.82` | `rgb(255 254 252 / 0.78)` | Active segmented pill, dropdowns, floating composer |
| **Glass Refraction Hairline** | `--ron-glass-hairline` | `1px solid rgb(255 255 255 / 0.55)` | All card, bar, and pill borders in Glass mode |
| **Glass Specular Edge** | `--ron-glass-edge` | `inset 0 1px 0 0 rgb(255 255 255 / 0.70), inset 0 0 0 1px rgb(255 255 255 / 0.28)` | Inner specular highlight on every glass panel and card |
| **Glass Floating Shadow** | `--ron-glass-shadow` | `0 18px 48px -18px rgb(26 25 23 / 0.22)` | Soft ambient elevation under glass cards |
| **Glass Ink Palette** | `text-ink` / `text-ink-secondary` / `text-ink-muted` | `#1A1917` / `#57524C` / `#7F7971` | Identical high-contrast charcoal ink hierarchy to Light mode |
| **Glass Primary CTA** | `bg-ink text-surface-0` | `#1A1917` fill / `#FFFEFC` text | Solid charcoal pill button for crisp contrast against frosted glass |

---

## 3. Universal Typography Scale (Single Font Family)

**Font Stack:** `'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif`  
**Font Feature Settings:** `"cv02", "cv03", "cv04", "cv11", "ss03"`

| Token Name | Size (`px` / `rem`) | Weight | Line Height | Letter Spacing | Mobile Usage |
|---|---|---|---|---|---|
| **`mobile-display-lg`** | `30px` (`1.875rem`) | `600` (`semibold`) | `1.15` (`34px`) | `-0.025em` | Wordmark (`Ron`), primary auth/onboarding hero title |
| **`mobile-display-md`** | `24px` (`1.5rem`) | `600` (`semibold`) | `1.20` (`29px`) | `-0.02em` | Page headers (`Projects Index`, `November 2026`, `How can I help?`) |
| **`mobile-title-lg`** | `18px` (`1.125rem`) | `600` (`semibold`) | `1.30` (`23px`) | `-0.015em` | Empty-state titles (`No tasks in Backlog`, `No article open`, `Search the web`) |
| **`mobile-title-md`** | `15px` (`0.9375rem`) | `600` (`semibold`) | `1.35` (`20px`) | `-0.01em` | Card titles, drawer destination labels, active sheet header (`Ron · Teach a skill`) |
| **`mobile-body-md`** | `14px` (`0.875rem`) | `400` (`normal`) | `1.50` (`21px`) | `-0.006em` | Primary body copy, input values, composer text, empty-state descriptions |
| **`mobile-body-sm`** | `13px` (`0.8125rem`) | `500` (`medium`) | `1.40` (`18px`) | `-0.005em` | Segmented control labels, button labels, URL pill text (`ron://home`), prompt pills |
| **`mobile-caption`** | `12px` (`0.75rem`) | `500` (`medium`) | `1.35` (`16px`) | `0em` | Model selector pill (`claude-sonnet-4-5`), metadata counts (`0 tasks · All tasks`) |
| **`mobile-micro-caps`** | `10px` (`0.625rem`) | `600` (`semibold`) | `1.20` (`12px`) | `+0.14em` (`uppercase`) | Section eyebrows (`PROJECTS`, `DESTINATIONS`, `OPEN TABS`, `OBSERVATION DESK`) |

---

## 4. Mobile Viewport, Layout Grid & Safe Areas

- **Target Device Viewport:** `393 × 852 px` (`390 × 844 px` standard iOS portrait). Full-bleed mobile viewport (`width: 100%; max-width: 393px; min-height: 852px; overflow-x: hidden`). Never wrap the mobile viewport inside a `2560 × 2048` desktop monitor canvas unless generating a presentation mockup.
- **Horizontal Padding:**
  - Chrome bars: `12px` left/right padding.
  - Main page content: `16px` left/right padding (`20px` inside cards/modals).
- **Corner Radii (`--radius: 10px` base):**
  - Full pills (URL bar, `Ask Ron`, search depth pills, primary CTAs): `9999px` (`rounded-full`)
  - Primary cards & empty-state stages: `20px` (`rounded-[20px]`)
  - Secondary cards, inputs & prompt composer: `14px` (`rounded-[14px]`)
  - Icon containers & segmented buttons: `10px` (`rounded-[10px]`)
- **Touch Targets:** Minimum `36 × 36 px` for secondary icon buttons; `44px` height for primary inputs, list rows, and primary CTA buttons.

### Three-Zone Vertical Architecture

```
┌───────────────────────────────────────────┐
│  iOS Safe Area Status Bar (44px)          │  9:41 · Signal / Wi-Fi / Battery
├───────────────────────────────────────────┤
│  Zone 1: MobileChromeToolbar (52px)       │  [Drawer] [   ron://route   ] [Read] [✦ Ask Ron]
├───────────────────────────────────────────┤
│                                           │
│  Zone 2: Primary Viewport Canvas          │  • Page Header / Sub-bar (if applicable)
│  (flex-1, min 60–75% open canvas          │  • Centered EmptyStateStage (Resting State)
│   in resting Empty State)                 │    OR Structured Content List (Used State)
│                                           │
├───────────────────────────────────────────┤
│  Zone 3: MobileBottomNavBar (56px)        │  [ ← ]    [ → ]    [ ⌕ ]    [ ❐ 1 ]    [ ⋯ ]
│  OR PromptComposerDock (Sheet Views)      │  + 20px Home Indicator Safe Area
└───────────────────────────────────────────┘
```

---

## 5. Reusable Mobile Component Specifications (`14 Core Primitives`)

### 5.1 `MobileChromeToolbar` (`src/components/browser/ChromeToolbar.tsx`)
- **Height:** `52px`, `px-3`, bottom `1px` border (`#E4E1DB` Light / `#2D2B28` Dark / `rgb(255 255 255 / 0.55)` Glass).
- **Left Slot:** `36 × 36 px` rounded-`10px` icon button (`Sidebar` panel icon, `1.5px` stroke) to open `MobileDrawerSheet`.
- **Center Slot (Address Pill):** Flex-1 capsule (`height: 34px`, `rounded-full`, `px-3`), subtle surface fill (`#F1EFEB` Light / `#1F1E1C` Dark / `rgb(255 254 252 / 0.50)` Glass), `1px` border. Contains a `12px` lock/globe SVG + centered or left-aligned route text in `13px` medium (`ron://home`, `ron://search`, `ron://execute`, `ron://calendar`, `ron://projects`, `ron://vibe`, `ron://build`, `ron://showcase`).
- **Right Slot:**
  1. **Reader Button:** `32 × 32 px` icon button (`BookOpen` SVG).
  2. **`Ask Ron` Trigger Pill:** `height: 32px`, `px-3`, `rounded-full`, `1px` border, `12px` sparkle icon (`#A9532E` Light/Glass, `#D6825A` Dark) + `"Ask Ron"` (`12px` semibold).

### 5.2 `MobileBottomNavBar`
- **Height:** `56px` (+ `20px` bottom safe area), `px-4`, top `1px` border, matching chrome surface.
- **5 Equal Touch Slots (`44 × 44 px` each):**
  1. `Back` (`ArrowLeft` SVG — muted when disabled)
  2. `Forward` (`ArrowRight` SVG — muted when disabled)
  3. `Search / Home` (`Search` or `Compass` SVG — centered primary action)
  4. `Tabs Switcher` (`Square` badge with current tab count `1` in `11px` semibold)
  5. `More / Settings` (`MoreHorizontal` or `Sliders` SVG)

### 5.3 `MobileSearchComposer` (`HomePage.tsx` & `Sidebar.tsx`)
- **Container:** `rounded-[18px]`, `p-3.5`, `1px` border, `--shadow-md`.
- **Top Input Row:** `16px` search icon + input (`"Search the web or enter URL..."`, `14px` regular) + `32 × 32 px` circular submit button (`ArrowRight` SVG, `#1A1917` fill in Light/Glass, `#F3F1ED` in Dark).
- **Bottom Depth Selector Row:** 4 compact pills (`height: 26px`, `px-2.5`, `rounded-full`, `11px` medium):
  - `Quick` (active default: `1px` border + `#A9532E` / `#D6825A` `5px` dot)
  - `Standard`
  - `Deep`
  - `Deep Research`

### 5.4 `SegmentedControlPill`
- **Track:** `height: 36px`, `p-1`, `rounded-full` (or `rounded-[12px]`), recessed background (`#F1EFEB` Light / `#1F1E1C` Dark / `rgb(255 254 252 / 0.45)` Glass), `1px` border.
- **Active Segment:** Elevated pill (`#FFFEFC` Light / `#2D2B28` or `#F3F1ED` Dark / `rgb(255 254 252 / 0.85)` Glass), `--shadow-sm`, `12px` semibold primary ink.
- **Inactive Segment:** Transparent background, `12px` medium secondary ink.
- **Instances:**
  - `Sign In | Create Account` (`SignInPage`)
  - `Light | Dark | Glass` (`OnboardingPage` & `Sidebar`)
  - `Kanban | Calendar | Gantt | List` (`ExecutePage`)
  - `Day | Week | Month | Quarter` (`CalendarPage`)
  - `Workflow | Swarm | Graph` (`SuperAgentPage`)
  - `Chat | Live` (`AgentPanel` & `BuildPage`)

### 5.5 `LensBarStrip` (`src/components/search/LensBar.tsx`)
- **Primary Lens Strip:** Horizontal single-line pill row (`height: 34px`, `gap-1.5`):
  - `All` (active pill), `Sources 0`, `Media 0`, `Thread`, `Notes`
- **Secondary Mode Switch:** Right-aligned or sub-row compact segmented pill:
  - `Answer | Sources | Agent`

### 5.6 `EmptyStateStage` (`src/components/search/primitives.tsx` & page empty states)
- **Layout:** Centered vertically and horizontally inside the primary viewport canvas (`min-height: 360px`, `px-6`, `text-center`).
- **Anatomy (Strict 3-Element Cap + Optional Single CTA):**
  1. **Icon Tile:** `44 × 44 px`, `rounded-[14px]`, `1px` border, subtle surface fill, centered `20 × 20 px` `1.5px`-stroke SVG icon (`#57524C` Light/Glass, `#ADA79F` Dark).
  2. **Heading:** `18px` (`mobile-title-lg`) semibold primary ink, `mt-4`.
  3. **Subtitle:** `13px–14px` regular secondary ink, `max-w-[260px]`, `mt-1.5`, balanced 1–2 lines.
  4. **Optional Action Pill:** Single `height: 36px`, `px-4`, `rounded-full` button (`mt-5`).

### 5.7 `PromptComposerDock` (`src/components/agent-panel/AgentPanel.tsx`)
- **Container:** Docked at the bottom of sheet/workbench views (`mx-3 mb-3`, `rounded-[18px]`, `p-3`, `1px` border, `--shadow-md`).
- **Textarea Row:** `"Ask anything... / for commands"` (or `"What would you like to accomplish?"` on Vibe), `14px` regular, `min-h-[36px]`.
- **Controls Footer Row (`mt-2.5`, `flex items-center justify-between`):**
  - **Left Controls:**
    - `+` Attachment button (`28 × 28 px` circular `1px` border button)
    - `Thinking` toggle button (`28 × 28 px` circular `1px` border button with lightbulb SVG)
    - `Model Selector Pill` (`height: 28px`, `px-2.5`, `rounded-full`, `1px` border, `"claude-sonnet-4-5 ▾"` in `11px` medium)
  - **Right Control:**
    - `Send ↑` pill button (`height: 30px`, `px-3.5`, `rounded-full`, solid primary ink fill `#1A1917` Light/Glass or `#F3F1ED` Dark).
- **Micro-Footer:** Centered below the card (`"↵ to send · Shift + ↵ for a new line"`, `10px` muted ink).

### 5.8 `MobileDrawerSheet` (`src/components/browser/Sidebar.tsx`)
- **Container:** Left slide-over sheet (`width: 86%` max `336px`, `height: 100%`, right `1px` border) over a `14%` dimmed/blurred backdrop peeking on the right edge.
- **Sections:**
  1. Header: `R` square badge (`28×28px`, `rounded-lg`) + `"Ron"` (`16px` semibold) + `32×32px` close `×` button.
  2. Embedded `MobileSearchComposer`.
  3. `DESTINATIONS` (`10px` uppercase tracking `+0.14em`): 5 rows (`40px` height, `rounded-xl`, `px-3`) — `Discover` (active), `Execute`, `Calendar`, `Vibe`, `Build`.
  4. `OPEN TABS` (`10px` uppercase tracking `+0.14em` + `+ New Tab` action): Active tab row (`Discover · ron://home` + close `×`).
  5. Footer (`mt-auto`, top `1px` border): `Appearance` label + `Light | Dark | Glass` segmented control.

### 5.9 `IssueCardMobile` & `KanbanColumnStage` (`src/pages/ExecutePage.tsx`)
- **Column Header Bar:** `6px` status dot + column name (`Backlog`, `14px` semibold) + `QUEUED WORK` (`10px` uppercase muted) + right count pill (`0` in Empty State).
- **Empty Column Stage:** Full-height `rounded-[20px]` `1px` border container with centered `EmptyStateStage` (`"No tasks in Backlog"` + `"+ New Issue"` pill).
- **Used State Issue Card:** `rounded-[14px]`, `p-3.5`, `1px` border, `--shadow-sm`. Top row: `PRO-1` identifier (`11px` muted) + priority badge (`Medium`). Middle: Issue title (`14px` semibold, max 2 lines). Bottom: Sub-issue count + assigned `Ron` agent status dot.

### 5.10 `IssueDetailSheet` (`src/components/projects/ProjectWorkspaceModal.tsx`)
- **Header (`48px`):** Window dots (`red/amber/green` `8px` circles) + `"PRO-1 · Issue · v1 · Saved"` (`12px` muted) + right `"Save & close"` pill (`height: 28px`, `12px` medium).
- **Tab Strip (`40px`, bottom `1px` border):** `Description` (active `2px` underline), `Ron`, `Comms`, `History`.
- **Inline AI Assist Bar:** `height: 38px`, `rounded-full`, `1px` border, `px-3`: sparkle icon + `"Ask Ron to draft or refine description..."` + right `"Draft"` pill.
- **Pinned Metadata Bar (Bottom):** Two `height: 36px` dropdown pills side-by-side: `Status: Backlog ▾` and `Priority: Medium ▾`.

### 5.11 `AgentStatusHeader` (`src/components/agent-panel/AgentPanel.tsx`)
- **Height:** `52px`, `px-3.5`, bottom `1px` border.
- **Left:** `"Ron"` (`16px` semibold) + `6px` green dot (`#4F7A5A`) + `"Ready"` (`12px` muted).
- **Center-Right:** `"Take Over"` outline pill (`height: 28px`, `px-2.5`, `11px` medium) + `Chat | Live` segmented switch (`height: 28px`).
- **Right Icons:** `Threads` (`MessageSquare` SVG, `30×30px`), `New` (`Plus` SVG, `30×30px`), `Close` (`X` SVG, `30×30px`).

### 5.12 `TeachRonStepperSheet` (`src/components/agent-panel/TeachSkill.tsx`)
- **Header (`50px`):** Back button (`←`) + `R` badge + `"Ron · Teach a skill"` (`14px` semibold) + minimize (`—`) + close (`×`).
- **4-Step Pill Strip (`40px`):** `01 Brief` (active pill), `02 Demonstrate`, `03 Review`, `04 Saved`.
- **Observation Desk Card:** `OBSERVATION DESK` (`10px` uppercase) + `00:00` timer pill + `rounded-[16px]` preview well (`height: 120px`, `1px` border, centered monitor icon + `"The browser window is not being shared."`) + footer row (`"Observation journal · 0 entries"` | `"Skill library · 0"`).

### 5.13 `CollapsibleWorkspaceDrawer` (`src/pages/BuildPage.tsx`)
- **Collapsed Bar (Empty State Default):** Single `height: 44px`, `rounded-[14px]`, `1px` border pill (`px-3.5`) containing `ChevronRight` SVG + `"Workspace"` (`13px` semibold) + `"· files and terminal"` (`12px` muted) + right status pill (`"Idle"` or `"0 files"`).
- **Expanded Sheet (Used State):** Slides up to reveal `Files | Terminal | Preview` tabs without crowding the chat canvas when idle.

### 5.14 `FavoriteLinksStrip` (`src/components/FavoriteLinks.tsx`)
- **Resting Empty State:** Single muted caption `"No pinned favorites yet"` + compact pill button `"+ Add favorite"` (`height: 30px`, `px-3`, `rounded-full`, `1px` border, `12px` medium).

---

## 6. Screen-by-Screen Mobile Specification (`All 15 Screens`)

Every screen below defines:
1. **Source Components** in the repository,
2. **Canonical Empty State** (built first — zero fake content), and
3. **Used State Transition** (how real data populates the exact same primitives).

---

### Screen 01 — Sign In & Account Entry (`01_signin`)
- **Source:** `src/pages/SignInPage.tsx`, `src/components/auth/AuthPageLayout.tsx`
- **Route:** Pre-authentication entry screen (no browser URL bar).
- **Layout & Components (Empty State):**
  - Top bar (`px-5 pt-4`): Left `R` square badge (`28×28px`) + `"Ron"` (`15px` semibold); right `"Guest mode →"` pill (`height: 30px`, `px-3`, `rounded-full`, `1px` border).
  - Centered Hero (`mt-8 mb-6`, `text-center`): Large `"Ron"` wordmark (`32px` semibold) + subtitle `"A quiet, fast browser with an agent inside."` (`13px` secondary ink).
  - Auth Card (`mx-5`, `p-5`, `rounded-[20px]`, `1px` border, `--shadow-md`):
    - Top `SegmentedControlPill`: `Sign In` (active) | `Create Account`.
    - Field 1: Label `"Email"` (`12px` medium) + empty input (`height: 44px`, `rounded-[12px]`, placeholder `"you@domain.com"`).
    - Field 2: Label `"Password"` (`12px` medium) + empty input (`height: 44px`, `rounded-[12px]`, placeholder `"••••••••"`).
    - Primary CTA: Full-width `"Continue"` button (`height: 44px`, `rounded-full`, solid primary ink fill).
    - Divider: `1px` hairline with centered `"or"` (`11px` muted).
    - Secondary CTA: Full-width `"Continue without an account"` button (`height: 42px`, `rounded-full`, `1px` border).
  - Footer (`mt-auto pb-6`, `text-center`): `"Local-first · Your keys and history stay on your device"` (`11px` muted).
- **Used State:** Email input populated with focused ring (`ring-2 ring-accent/60`), inline validation or loading spinner inside `"Continue"`.

---

### Screen 02 — Onboarding & Appearance Selection (`02_onboarding`)
- **Source:** `src/pages/OnboardingPage.tsx`
- **Route:** First-run setup flow.
- **Layout & Components (Empty State):**
  - Top progress header (`px-5 pt-4`): 3 minimal horizontal progress pills (`28 × 4 px`, step 1 active) + right `"Skip"` button (`12px` muted).
  - Hero Title (`px-5 mt-6`): `"Make Ron yours"` (`26px` semibold) + subtitle `"Choose your surface material and default search depth."` (`13px` secondary ink).
  - Card 1 — `APPEARANCE` (`mx-5 mt-6`, `p-4`, `rounded-[20px]`, `1px` border):
    - Eyebrow `"APPEARANCE"` (`10px` uppercase tracking `+0.14em`).
    - 3-column swatch selector (`gap-2.5`, `mt-3`):
      - `Light` (`Paper` warm ivory preview tile `#FFFEFC`)
      - `Dark` (`Graphite` matte dark preview tile `#131312`)
      - `Glass` (`Liquid` translucent frosted preview tile)
      - Active swatch matches the current theme variant (`1.5px` primary ink ring + checkmark badge).
  - Card 2 — `DEFAULT SEARCH DEPTH` (`mx-5 mt-3.5`, `p-4`, `rounded-[20px]`, `1px` border):
    - Eyebrow `"DEFAULT SEARCH DEPTH"` (`10px` uppercase) + `SegmentedControlPill` (`Quick | Standard | Deep | Research`, `Standard` active) + 1-line helper `"Synthesizes live sources with inline citations."` (`12px` muted).
  - Bottom CTA (`mx-5 mt-auto pb-6`): Full-width `"Enter Ron Browser →"` pill button (`height: 46px`, `rounded-full`, solid primary ink fill).
- **Used State:** Interactive preview updates live as the user taps `Light`, `Dark`, or `Glass`.

---

### Screen 03 — Home / Discover (`03_discover`)
- **Source:** `src/pages/HomePage.tsx`, `src/components/browser/ChromeToolbar.tsx`, `src/components/FavoriteLinks.tsx`
- **Route:** `ron://home`
- **Layout & Components (Empty State):**
  - Zone 1: `MobileChromeToolbar` with route `"ron://home"`.
  - Zone 2 (Centered Open Canvas — 70% negative space):
    - Wordmark `"Ron"` (`36px` semibold, `-0.03em` tracking) centered above composer.
    - `MobileSearchComposer` (`"Search the web or enter URL..."` + `Quick | Standard | Deep | Deep Research` pills).
    - `FavoriteLinksStrip` (`"No pinned favorites yet"` + `"+ Add favorite"` pill).
    - Bottom Quiet Discover Anchor (`mx-4 mt-auto mb-4`, `px-4 py-3`, `rounded-[16px]`, `1px` border, `flex items-center justify-between`): Left `"Discover"` (`11px` uppercase semibold) + `"Quiet mode · Feed hidden until requested"` (`12px` muted); right `"Load feed"` pill (`height: 28px`, `px-3`).
  - Zone 3: `MobileBottomNavBar`.
- **Used State:** Tapping `"Load feed"` expands vertical editorial cards (`DiscoverItem`: category tag, bold headline in `Plus Jakarta Sans`, source domain + relative timestamp) below the search composer, and populates `FavoriteLinksStrip` with 4 circular favicon pills.

---

### Screen 04 — Navigation & Tabs Drawer (`04_sidebar_drawer`)
- **Source:** `src/components/browser/Sidebar.tsx`
- **Route:** Slide-over drawer over `ron://home`.
- **Layout & Components (Empty State):**
  - Left sheet (`86%` width, `100%` height, right `1px` border) + `14%` dimmed underlying page on right.
  - Drawer Header: `R` badge + `"Ron"` (`16px` semibold) + close `×` button.
  - Compact `MobileSearchComposer` (`"Search the web or enter URL..."` + `"Depth · Medium ▾"` pill).
  - `DESTINATIONS` section (`10px` uppercase): 5 clean navigation rows (`40px` height each) with `16px` inline SVG icons:
    - `Discover` (active pill fill)
    - `Execute`
    - `Calendar`
    - `Vibe`
    - `Build`
  - `OPEN TABS` section (`10px` uppercase + `"+ New Tab"` button):
    - Single active tab row (`Discover · ron://home` + close `×`) and generous empty space below.
  - Pinned Footer: `"Appearance"` (`12px` secondary ink) + `Light | Dark | Glass` segmented pill.
- **Used State:** `OPEN TABS` lists multiple open web/internal tabs with favicons, titles, and audio/agent activity indicators.

---

### Screen 05 — Search Results (`05_search`)
- **Source:** `src/pages/SearchResultsPage.tsx`, `src/components/search/SearchHeader.tsx`, `src/components/search/LensBar.tsx`, `src/components/search/primitives.tsx`
- **Route:** `ron://search`
- **Layout & Components (Empty State):**
  - Zone 1: `MobileChromeToolbar` with route `"ron://search"`.
  - Search Sub-Header (`px-4 pt-3 pb-2.5`, bottom `1px` border):
    - Resting search input pill (`height: 40px`, `rounded-full`, `1px` border, `"Search anything or enter a URL..."` + `"Standard ▾"` depth badge).
    - `LensBarStrip` (`All` active, `Sources 0`, `Media 0`, `Thread`, `Notes` + right `Answer | Sources | Agent`).
  - Zone 2: Centered `EmptyStateStage`:
    - `44 × 44 px` rounded-`14px` icon tile (`Search` SVG).
    - Title: `"Search the web"` (`18px` semibold).
    - Subtitle: `"Enter a query above to synthesize live sources, citations, and answers."` (`13px` secondary ink).
  - Zone 3: `MobileBottomNavBar`.
- **Used State:** Displays horizontal `Sources` citation cards (`01`, `02`, `03` with domain + title), collapsible `Reasoning / Steps` accordion, synthesized answer paragraphs in `Plus Jakarta Sans` with inline citation pills `[1]`, and a docked follow-up input bar at the bottom.

---

### Screen 06 — Article Reader View (`06_reader`)
- **Source:** `src/components/ReaderView.tsx`
- **Route:** `ron://read`
- **Layout & Components (Empty State):**
  - Zone 1: `MobileChromeToolbar` with route `"ron://read"`.
  - Reader Sub-Header (`height: 42px`, `px-4`, bottom `1px` border, `flex items-center justify-between`):
    - Left `"← Back"` pill (`height: 28px`, `px-2.5`).
    - Center `"READER"` (`10px` uppercase tracking `+0.14em`).
    - Right `"Original ↗"` pill (`height: 28px`, `px-2.5`).
  - Zone 2: Centered `EmptyStateStage`:
    - `44 × 44 px` rounded-`14px` icon tile (`BookOpen` SVG).
    - Title: `"No article open"` (`18px` semibold).
    - Subtitle: `"Select any story from Discover or Search to read in a distraction-free view and highlight text to ask Ron."` (`13px` secondary ink).
    - CTA Pill: `"Return to Discover"` (`height: 36px`, `px-4`, `rounded-full`, `1px` border).
  - Zone 3: `MobileBottomNavBar`.
- **Used State:** Displays extracted article domain eyebrow, `24px` semibold title, author/reading-time metadata, clean `15px` (`line-height: 1.65`) body paragraphs in `Plus Jakarta Sans`, and a floating selection toolbar (`Highlight | Ask Ron`).

---

### Screen 07 — Execute Operational Hub (`07_execute`)
- **Source:** `src/pages/ExecutePage.tsx`
- **Route:** `ron://execute`
- **Layout & Components (Empty State):**
  - Zone 1: `MobileChromeToolbar` with route `"ron://execute"`.
  - Hub Header Card (`mx-4 mt-3`, `p-3.5`, `rounded-[18px]`, `1px` border):
    - Top Row: `32×32px` icon tile (`Kanban` SVG) + `"Operational Hub"` (`16px` semibold) + `"0 tasks · All tasks"` (`12px` muted) + right `"+ New Issue"` solid pill (`height: 32px`, `px-3`).
    - Middle Row (`mt-2.5`, `flex gap-2`): Search input (`height: 34px`, `"Search tasks..."`) + `"Filters"` pill (`height: 34px`, `px-3`).
    - Bottom Row (`mt-2.5`): `SegmentedControlPill` (`Kanban` active, `Calendar`, `Gantt`, `List`) + right `"Projects ↗"` link.
  - Active Column Header (`mx-4 mt-4`, `flex items-center justify-between`):
    - Left: `6px` accent dot + `"Backlog"` (`14px` semibold) + `"QUEUED WORK"` (`10px` uppercase muted).
    - Right: Count badge `0` (`height: 22px`, `px-2`, `rounded-full`, `1px` border).
  - Zone 2: `KanbanColumnStage` (`mx-4 my-2.5`, `flex-1`, `rounded-[20px]`, `1px` border):
    - Centered `EmptyStateStage`: Inbox icon tile + `"No tasks in Backlog"` (`16px` semibold) + `"Create a new issue or ask Ron to plan a workflow."` (`13px` secondary) + `"+ New Issue"` pill.
  - Zone 3: `MobileBottomNavBar`.
- **Used State:** Populates `KanbanColumnStage` with vertical `IssueCardMobile` cards and horizontal swipe gestures to switch between `Backlog`, `In Progress`, `Review`, and `Done`.

---

### Screen 08 — Calendar Schedule View (`08_calendar`)
- **Source:** `src/pages/CalendarPage.tsx`
- **Route:** `ron://calendar`
- **Layout & Components (Empty State):**
  - Zone 1: `MobileChromeToolbar` with route `"ron://calendar"`.
  - Calendar Header (`px-4 pt-3 pb-2.5`, bottom `1px` border):
    - Top Row: `"November 2026"` (`20px` semibold) + right date stepper capsule (`‹` | `"Today"` | `›`, `height: 30px`, `rounded-full`, `1px` border).
    - Middle Row (`mt-2.5`): `SegmentedControlPill` (`Day` | `Week` active | `Month` | `Quarter`).
    - Week Strip (`mt-3`, 7 equal columns `MON 2` through `SUN 8`): `MON 2` highlighted in a `32×32px` solid primary ink circle.
  - Zone 2 (Time Grid + Centered Empty Overlay):
    - Quiet hourly horizontal hairlines (`09:00` through `15:00`, `11px` muted labels on left) with zero booked blocks.
    - Centered `EmptyStateStage` card (`p-5`, `rounded-[18px]`, `1px` border): Calendar icon tile + `"No scheduled tasks this week"` (`15px` semibold) + `"Tasks with due dates or scheduled blocks appear here."` (`12px` secondary).
    - Floating `"+ New Task"` pill (`height: 38px`, `px-4`, `rounded-full`, solid primary ink fill) at bottom-right (`bottom-16 right-4`).
  - Zone 3: `MobileBottomNavBar`.
- **Used State:** Time-slot blocks render on the hourly grid with issue ID, title, and status dot.

---

### Screen 09 — Projects Index (`09_projects`)
- **Source:** `src/pages/ProjectsPage.tsx`
- **Route:** `ron://projects`
- **Layout & Components (Empty State):**
  - Zone 1: `MobileChromeToolbar` with route `"ron://projects"`.
  - Projects Header Card (`mx-4 mt-3`, `p-4`, `rounded-[20px]`, `1px` border):
    - Top Row: `"PROJECTS"` (`10px` uppercase tracking `+0.14em`) + right `"0 total"` badge (`height: 22px`, `px-2.5`, `rounded-full`, `1px` border).
    - Title: `"Projects Index"` (`22px` semibold, `mt-1`) + subtitle `"Organize work into structured containers and navigate by type, status, and urgency."` (`13px` secondary).
    - Controls Row (`mt-3`, `flex items-center gap-2`): Search input (`height: 36px`, `"Search projects..."`) + view toggle pill (`Grid | List`, `height: 36px`) + `"+ New"` solid pill (`height: 36px`, `px-3.5`).
  - Zone 2: Open Canvas Card (`mx-4 my-3`, `flex-1`, `rounded-[20px]`, `1px` border):
    - Centered `EmptyStateStage`: Folder icon tile + `"No projects yet"` (`17px` semibold) + `"Create your first project container to track issues, hierarchy, and durable issue agents."` (`13px` secondary) + `"+ New Project"` solid pill (`height: 38px`, `px-4`).
  - Zone 3: `MobileBottomNavBar`.
- **Used State:** Grid/list of project cards showing project key (`PRO`), title, issue progress bar, and active issue-agent count.

---

### Screen 10 — Project Issue Workspace Sheet (`10_project_issue`)
- **Source:** `src/components/projects/ProjectWorkspaceModal.tsx`
- **Route:** Full-screen mobile modal sheet over `ron://projects`.
- **Layout & Components (Empty State — New Blank Issue):**
  - Sheet Header (`height: 48px`, `px-4`, bottom `1px` border): Left window dots + `"PRO-1 · Issue · v1 · Saved"` (`12px` muted); right `"Save & close"` pill (`height: 28px`, `px-3`).
  - Tab Strip (`height: 40px`, `px-4`, bottom `1px` border): `Description` (active `2px` underline), `Ron`, `Comms`, `History`.
  - Inline AI Draft Bar (`mx-4 mt-3`, `height: 38px`, `rounded-full`, `1px` border, `px-3`): Sparkle icon + `"Ask Ron to draft or refine description..."` + right `"Draft"` pill.
  - Blank Document Canvas (`px-4 mt-5`, `flex-1`):
    - Placeholder Title: `"Untitled issue"` (`24px` semibold muted `#7F7971` / `#86807A`).
    - Placeholder Body: `"Write a description, or type / for blocks..."` (`14px` muted, `mt-2`).
  - Child Issues Section (`mx-4 mb-3 pt-3`, top `1px` border):
    - Header: `"Child issues"` (`12px` semibold) + right `"+ Create child"` link (`12px` accent).
    - Empty state text: `"No child issues."` (`12px` muted).
  - Pinned Bottom Metadata Bar (`height: 56px`, `px-4`, top `1px` border, `grid grid-cols-2 gap-2.5 items-center`):
    - Left pill: `"Status · Backlog ▾"` (`height: 36px`, `rounded-[10px]`, `1px` border).
    - Right pill: `"Priority · Medium ▾"` (`height: 36px`, `rounded-[10px]`, `1px` border).
- **Used State:** Rich block description, sub-issue checklist rows, and dedicated per-issue `Ron` agent thread tab (`issue_agents.py`).

---

### Screen 11 — Vibe / SuperAgent Canvas (`11_vibe_superagent`)
- **Source:** `src/pages/SuperAgentPage.tsx`
- **Route:** `ron://vibe`
- **Layout & Components (Empty State):**
  - Zone 1: `MobileChromeToolbar` with route `"ron://vibe"`.
  - SuperAgent Sub-Header (`height: 46px`, `px-3.5`, bottom `1px` border, `flex items-center justify-between`):
    - Left: `28×28px` rounded-lg node icon + `"SuperAgent"` (`14px` semibold).
    - Right: Model pill (`"claude-sonnet-4-5 ▾"`, `height: 28px`, `11px` medium) + mode pill (`"Deep Research"`, `6px` green dot, `height: 28px`) + `+` icon button (`28×28px`).
  - Zone 2 (Dot-Grid Canvas — `radial-gradient` `1px` dots every `20px` at `8%` opacity):
    - Top Mode Switch (`mt-5`, centered): `SegmentedControlPill` (`→ Workflow` active | `Swarm` | `Graph`).
    - Centered Starter Prompt Pills (`my-auto`, vertical stack of 4 clean outline pills, `height: 38px`, `px-4`, `rounded-full`, `1px` border, `13px` medium):
      1. `"Research a topic in depth"`
      2. `"Analyze and summarize documents"`
      3. `"Build a workflow automation"`
      4. `"Help me code something"`
    - Bottom Docked Composer: `PromptComposerDock` with placeholder `"What would you like to accomplish?"`, `+` button, input, and circular submit arrow `↑`, plus `"↵ to send"` hint.
  - Zone 3: `MobileBottomNavBar`.
- **Used State:** Renders live multi-agent DAG nodes (`Workflow` / `Swarm` / `Graph`) on the dot-grid canvas with streaming status badges and node inspection drawers.

---

### Screen 12 — Build Coding Workbench (`12_build_workbench`)
- **Source:** `src/pages/BuildPage.tsx`
- **Route:** `ron://build`
- **Layout & Components (Empty State):**
  - Zone 1: `MobileChromeToolbar` with route `"ron://build"`.
  - Build Sub-Header (`height: 48px`, `px-3.5`, bottom `1px` border, `flex items-center justify-between`):
    - Left: `"Build"` (`15px` semibold) + `6px` green dot + `"Ready"` (`12px` muted).
    - Right: `"Take Over"` pill (`height: 28px`) + `Chat | Live` segmented switch (`height: 28px`) + `Threads` icon button + `New` `+` icon button.
  - Zone 2 (Centered Open Canvas):
    - Centered `EmptyStateStage`:
      - `44 × 44 px` rounded-`14px` `1px` border tile with Ron eyebrow mark SVG.
      - Title: `"How can I help?"` (`24px` semibold, `mt-3`).
      - Subtitle: `"Ask about this page, search, or work on a project."` (`13px` secondary).
    - Below Greeting (`mx-5 mt-5`): `CollapsibleWorkspaceDrawer` in its resting collapsed state (`"▸ Workspace · files and terminal"` + right `"Idle"` badge).
  - Zone 3: Docked `PromptComposerDock` (`"Ask anything... / for commands"`, `+`, lightbulb, `"claude-sonnet-4-5 · High ▾"`, `"Send ↑"`).
- **Used State:** Streaming tool calls (`editor`, `shell`) in the main thread and expandable `CollapsibleWorkspaceDrawer` showing the file tree, code diff, and terminal output.

---

### Screen 13 — Agent Panel Slide-Over Sheet (`13_agent_panel`)
- **Source:** `src/components/agent-panel/AgentPanel.tsx`
- **Route:** Full-height mobile slide-over sheet over active browser tab.
- **Layout & Components (Empty State):**
  - Header: `AgentStatusHeader` (`Ron · Ready`, `Take Over`, `Chat | Live`, `Threads`, `New +`, `Close ×`).
  - Main Body (`flex-1`, 75% open canvas):
    - Centered `EmptyStateStage`:
      - `44 × 44 px` rounded-`14px` `1px` border tile with Ron eyebrow mark SVG (`6px` accent dot centered above two minimal curved arcs).
      - Title: `"How can I help?"` (`24px` semibold, `mt-3.5`).
      - Subtitle: `"Ask about this page, search, or work on a project."` (`13px` secondary, `max-w-[240px]`).
  - Footer: `PromptComposerDock` (`"Ask anything... / for commands"`, `+`, Thinking lightbulb, `"claude-sonnet-4-5 ▾"`, `"Send ↑"`, and `"↵ to send · Shift + ↵ for a new line"`).
- **Used State:** Renders user turns, collapsible `Reasoning` trace blocks, tool call pills (`mcp_client`, `http_request`, `perplexity_search`), checkpoint resume banners, and streaming assistant responses.

---

### Screen 14 — Teach Ron Skill Studio (`14_teach_ron`)
- **Source:** `src/components/agent-panel/TeachSkill.tsx`
- **Route:** Full-height mobile studio sheet (`TeachRonStepperSheet`).
- **Layout & Components (Empty State — `01 Brief`):**
  - Header (`height: 50px`, `px-4`, bottom `1px` border): Back `←` button + `R` badge + `"Ron · Teach a skill"` (`14px` semibold) + minimize `—` + close `×`.
  - Stepper Bar (`height: 42px`, `px-4`, bottom `1px` border): `01 Brief` (active pill), `02 Demonstrate`, `03 Review`, `04 Saved`.
  - Brief Form (`px-4 pt-4`, resting empty fields):
    - Field 1: Label `"Workflow name"` (`12px` semibold) + empty input (`height: 42px`, `rounded-[12px]`, placeholder `"e.g. Prepare the weekly report"`).
    - Field 2 (`mt-3`): Label `"Intended outcome"` (`12px` semibold) + empty textarea (`height: 68px`, `rounded-[12px]`, placeholder `"What should be accomplished? What does success look like?"`).
    - Field 3 (`mt-3`): Label `"Context & prerequisites · optional"` (`12px` semibold) + empty textarea (`height: 60px`, `rounded-[12px]`, placeholder `"Accounts, starting conditions, or decisions Ron should know..."`).
    - Primary CTA (`mt-4`): Full-width `"Start teaching →"` pill button (`height: 44px`, `rounded-full`, solid primary ink fill).
  - Observation Desk Section (`mx-4 mt-5 pt-4`, top `1px` border):
    - Header Row: `"OBSERVATION DESK"` (`10px` uppercase tracking `+0.14em`) + right timer badge (`"• 00:00"`, `height: 22px`, `px-2.5`, `rounded-full`, `1px` border).
    - Preview Well (`mt-2.5`, `height: 112px`, `rounded-[16px]`, `1px` border): Centered monitor SVG + `"The browser window is not being shared."` (`12px` muted).
    - Footer Row (`mt-3`, `flex justify-between`, `12px` secondary ink): `"Observation journal · 0 entries"` and `"Skill library · 0"`.
- **Used State (`02 Demonstrate` & `03 Review`):** Live 1 fps browser frame preview with bottom-right circular camera PIP, live voice/debrief waveform, chronological journal entries, and escaped HTML process review with `"Approve & Publish Skill"`.

---

### Screen 15 — AI Elements Showcase (`15_showcase`)
- **Source:** `src/pages/AIElementsShowcase.tsx`
- **Route:** `ron://showcase`
- **Layout & Components (Empty State):**
  - Zone 1: `MobileChromeToolbar` with route `"ron://showcase"`.
  - Showcase Sub-Header (`height: 48px`, `px-4`, bottom `1px` border, `flex items-center justify-between`):
    - Left: `"AI Elements Showcase"` (`15px` semibold).
    - Right: `"Start Demo"` outline pill (`height: 30px`, `px-3.5`, `rounded-full`, `1px` border, `12px` semibold).
  - Zone 2 (Centered Open Canvas):
    - Centered `EmptyStateStage`:
      - `48 × 48 px` rounded-`16px` `1px` border tile with `"R"` (`20px` semibold).
      - Title: `"AI Elements Demo"` (`24px` semibold, `mt-4`).
      - Subtitle: `"Interactive verification surface for Ron Browser's native agent UI primitives, checkpoints, and streaming states."` (`13px` secondary, `max-w-[260px]`).
      - Primary CTA (`mt-5`): `"Start Demo"` solid pill button (`height: 40px`, `px-6`, `rounded-full`, solid primary ink fill).
  - Zone 3: `MobileBottomNavBar`.
- **Used State:** Streams live verification cards for `Reasoning`, `ToolCall`, `Checkpoint` (with `Restore` action), `Sources`, and `Artifact` primitives.

---

## 7. Component-to-Screen Matrix

| Screen ID | Route / Context | `MobileChromeToolbar` | `MobileBottomNavBar` | `EmptyStateStage` | `SegmentedControlPill` | `PromptComposerDock` |
|---|---|---|---|---|---|---|
| `01_signin` | Auth Entry | — | — | — | `Sign In \| Create Account` | — |
| `02_onboarding` | First-Run Setup | — | — | — | `Quick \| Standard \| Deep \| Research` | — |
| `03_discover` | `ron://home` | Yes | Yes | Quiet Discover Bar | `Quick \| Standard \| Deep \| Deep Research` | — |
| `04_sidebar_drawer` | Drawer Overlay | Underlying | — | Open Tabs Well | `Light \| Dark \| Glass` | — |
| `05_search` | `ron://search` | Yes | Yes | `"Search the web"` | `Answer \| Sources \| Agent` | Used State Follow-up |
| `06_reader` | `ron://read` | Yes | Yes | `"No article open"` | — | — |
| `07_execute` | `ron://execute` | Yes | Yes | `"No tasks in Backlog"` | `Kanban \| Calendar \| Gantt \| List` | — |
| `08_calendar` | `ron://calendar` | Yes | Yes | `"No scheduled tasks this week"` | `Day \| Week \| Month \| Quarter` | — |
| `09_projects` | `ron://projects` | Yes | Yes | `"No projects yet"` | `Grid \| List` | — |
| `10_project_issue` | Modal Sheet | — | Pinned Status Bar | `"Untitled issue"` | `Description \| Ron \| Comms \| History` | Inline Draft Bar |
| `11_vibe_superagent` | `ron://vibe` | Yes | Yes | 4 Starter Prompt Pills | `Workflow \| Swarm \| Graph` | Yes (Bottom Dock) |
| `12_build_workbench` | `ron://build` | Yes | — | `"How can I help?"` | `Chat \| Live` | Yes (Bottom Dock) |
| `13_agent_panel` | Slide-Over Sheet | — | — | `"How can I help?"` | `Chat \| Live` | Yes (Bottom Dock) |
| `14_teach_ron` | Studio Sheet | — | — | `"The browser window is not being shared."` | `01 Brief \| 02 Demonstrate \| 03 Review \| 04 Saved` | — |
| `15_showcase` | `ron://showcase` | Yes | Yes | `"AI Elements Demo"` | — | — |

---

## 8. Used-State AI Elements Primitives (Mobile Stream & Agent Components)

When transitioning any screen from its canonical **Empty State** to its **Used State**, use only these five compact mobile primitives. Never invent verbose terminal boxes or multi-nested cards.

### 8.1 `ReasoningTracePill` (`Collapsible Thought Accordion`)
- **Default State (Collapsed by Default on Mobile):** Single-line `height: 34px`, `px-3`, `rounded-[12px]`, `1px` border (`#E4E1DB` Light / `#2D2B28` Dark / `rgb(255 255 255 / 0.55)` Glass), subtle background fill.
- **Content:** `14px` sparkle/pulse SVG + `"Reasoned · 3 steps"` (`12px` medium secondary ink) + right duration `"1.4s ▸"` (`11px` muted ink).
- **Expanded State:** Left `1px` vertical guide line (`ml-3 pl-3`) with concise `12px` secondary-ink step rows in `Plus Jakarta Sans`.

### 8.2 `ToolCallPill` (`Inline Tool Execution Capsule`)
- **Geometry:** Inline `height: 28px`, `px-2.5`, `rounded-full`, `1px` border.
- **Content:** `12px` tool SVG + tool name (`"perplexity_search"`, `"http_request"`, `"mcp_client"`, `"editor"`, `"shell"` in `11px` medium `Plus Jakarta Sans`) + `6px` status dot (`#4F7A5A` complete / `#A9532E` running).

### 8.3 `SourceCitationStrip` & Inline `[n]` Pill
- **Horizontal Carousel (`Sources`):** Single horizontal snap-scroll row (`gap-2`, `overflow-x: auto`, no scrollbar) of compact `176 × 72 px` `rounded-[14px]` `1px` border cards:
  - Top row: Index badge (`01` in `10px` semibold muted) + domain (`11px` muted).
  - Bottom row: Source title (`12px` semibold primary ink, 2-line clamp).
- **Inline Citation Badge:** `height: 18px`, `px-1.5`, `rounded-[6px]`, `10px` semibold (`bg-surface-100` Light / `bg-surface-800` Dark / `rgb(255 254 252 / 0.65)` Glass).

### 8.4 `CheckpointDividerRow` (`Native Strands Checkpoint`)
- **Geometry:** Full-width `height: 36px` row between turns with a `1px` dashed horizontal line, left bookmark SVG + `"Checkpoint"` (`11px` muted), and right `"Restore"` pill button (`height: 24px`, `px-2.5`, `rounded-full`, `1px` border, `11px` medium).

### 8.5 `LiveVoiceStage` (`Chat | Live` Mode Toggle on Shared Thread)
- **Behavior:** Toggling `Chat | Live` in `AgentStatusHeader` keeps the **exact same `session_id` thread**.
- **Geometry:** Centered minimal breathing circle (`88 × 88 px`, `1px` border with subtle radial pulse), status caption (`"Listening..."` or `"Speaking..."` in `13px` secondary ink), and bottom 3-button control bar (`Mic Mute`, `Share Browser Tab 1fps`, `End Live`).

---

## 9. Mobile Sheet, Drawer & Gesture Physics

1. **Slide-Over Sheets (`AgentPanel`, `TeachSkill`, `Sidebar`):**
   - Use `--ease-smooth: cubic-bezier(0.16, 1, 0.3, 1)` (`280ms` duration).
   - `AgentPanel` and `TeachSkill` open as full-height (`100dvh`) mobile sheets so the virtual keyboard and `PromptComposerDock` never collide with underlying browser chrome.
2. **Modal Bottom Sheets (`IssueDetailSheet`, `CollapsibleWorkspaceDrawer`, Search Depth Picker):**
   - Top center drag handle: `36 × 4 px`, `rounded-full`, `#D2CEC6` (Light/Glass) or `#45413C` (Dark), `mt-2 mb-1`.
   - Top corners: `rounded-t-[22px]`, top `1px` border.
   - Backdrop Scrim: `rgb(26 25 23 / 0.18)` with `backdrop-filter: blur(4px)` in Light/Glass; `rgb(0 0 0 / 0.55)` in Dark.
3. **Slash-Command Configuration Rule (`src/lib/panel-commands.ts`):**
   - Never add settings gear forms, model parameter sliders, or goal toggles to headers. Typing `/` inside `PromptComposerDock` opens a floating command menu above the composer (`rounded-[14px]`, `1px` border, `--shadow-md`) with `/goal`, `/background`, `/checkpoint`, `/context`, and `/tools`.

---

## 10. Strict Anti-Patterns & Implementation Guardrails (Never Do This)

1. **No Desktop Wrapper Frames:**
   - Never render a phone bezel floating inside a `2560 × 2048 px` desktop wallpaper canvas. Every screen document must be a direct `393 × 852 px` (`width: 100%; max-width: 393px; min-height: 852px`) mobile viewport.
2. **No `* { font-family: ... !important }` Wildcard Overrides:**
   - Declare `font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;` on `html, body, button, input, textarea, select`. Never apply `!important` to the `*` universal selector, and always render icons as inline `<svg>` paths (`stroke-width="1.5"`).
3. **No Brown/Copper Tint on Dark Mode Surfaces:**
   - Dark mode surfaces (`#131312`, `#191817`, `#1F1E1C`) and borders (`#2D2B28`) are strictly neutral dark graphite. The ember accent (`#D6825A`) is restricted to `6px` status dots, the `Ask Ron` sparkle icon, and `:focus-visible` outlines.
4. **No Fake Content or Decorative Chrome:**
   - Never add notification bells, user avatar photos, fake battery/Wi-Fi widgets inside app headers, marketing slogans, or invented user queries.
   - Never place more than **3 data points per card** or more than **4 cards in a single viewport** without scrolling.

