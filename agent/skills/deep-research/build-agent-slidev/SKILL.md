---
name: build-agent-slidev
description: Create, improve, debug, present, or export exceptional Slidev decks.
  Use for slides.md, Slidev Markdown, technical or visual presentations, code storytelling,
  speaker notes, animations, Vue slide components, themes, PDF/PPTX/PNG exports, or
  presentation delivery and QA—even when Slidev is not named explicitly but web-based
  Markdown slides are intended.
allowed-tools: compile_slidev_deck search_saved_context
license: MIT (Slidev documentation snapshots; see THIRD_PARTY_NOTICES.md)
compatibility: Ren Deep Research (Strands SDK 1.57.2 / strands-harness 0.1.2)
metadata:
  original_name: slidev
  origin: Slidev Deckcraft (Ren Build Agent)
  local_source_path: /Users/tims-stuff/.ron/build/37b53c03e7885098b05b9756ef6a9feb/.claude/skills/slidev
  slidev_docs_snapshot: v52.19.1 / @slidev/cli v53.1.0 (2026-11-14)
  notes: Includes full SKILL.md deckcraft workflow, 21 curated guides + 44 feature
    references + scripts/sync-references.py; helper CLIs referenced in SKILL.md (scaffold.py,
    validate.py, slidev.py, browser-check.py, check-links.py) were not yet written
    in the Build workspace.
  role: leaf
  stage: synthesis
  pillar: pdf-slides
  context: none
  source: ron-build-agent
---

# Build Agent Slidev

> **Ren Deep Research Execution Note**: Materialize your Slidev deck by calling the `compile_slidev_deck(slides_markdown=..., title=...)` tool directly (ensure `routerMode: hash` is set in headmatter). Do not invoke external shell helper scripts.

# Slidev Deckcraft

Create a presentation, not a document split by `---`. Make the idea memorable, the visual system deliberate, and delivery reliable. Use the feature that serves the message; **never treat using many features as the goal**.

## Start here

1. Read [the feature atlas](references/INDEX.md) to route the task, and [versioning](references/versioning.md) to avoid stale syntax.
2. Inspect before editing: `ls -la`, `git status`, `package.json`, lockfile, `slides.md`, `components/`, `layouts/`, `public/`, and existing styles. Preserve the user's conventions and working work.
3. For an existing deck, diagnose before rewriting. Check the installed version and run the build first when possible. A failing older deck is not permission to replace its identity or toolchain.
4. Use `$PWD` or the agent's project-root variable for a new deck, and the directory containing the deck entry/package for an existing one. Resolve this skill's `scripts/` and `references/` relative to this file, **not** the deck directory.
5. Create a short plan for a multistep deck, then work through implementation and verification. Do not stop at a storyboard when a working deck was requested.

Only ask the user when a genuinely personal decision or unavailable source blocks progress. Otherwise infer a sensible direction, state assumptions briefly, and proceed.

## The deckcraft loop — follow this order

### 1. Frame the brief

Extract: **audience, desired change, one-sentence takeaway, duration, setting, delivery format, brand constraints, and asset/dependency restrictions**. Distinguish a keynote, workshop, investor narrative, report, and live coding demo; their density and interaction differ.

Before inventing content, gather user-provided facts and authoritative sources. Do not fabricate metrics, quotes, clients, citations, screenshots, or credentials. Mark missing evidence instead of making it attractive.

### 2. Storyboard before styling

Use [narrative and storyboarding](references/narrative.md). Write a one-line promise per slide, act transitions, and planned click beats. A compact deck usually needs: opening hook → stakes → mental model → evidence/demonstration → implications → action/decision → memorable close.

Keep one communicative purpose per slide. Split a busy slide by idea, not to hit an arbitrary slide count. Budget time including clicks and rehearsal, and decide which claims must survive PDF export.

### 3. Establish a visual system

Read [art direction](references/art-direction.md) and [layouts](references/layouts.md). Choose a theme or intentional local layouts; set a restrained palette, typography with fallbacks, spacing grid, canvas, and reusable components before producing many slides.

Make a repeatable rhythm: title/statement, evidence, diagram, demo, section divider, and closing treatment. Prefer real imagery or purposeful diagrams over decorative cards, repetitive icon grids, gradients, or emoji. Maintain contrast, visible focus, a safe margin, and a hierarchy that reads from the back row.

### 4. Implement the complete critical path

For a new project, use the deterministic scaffold rather than relying on interactive prompts:

```sh
python3 <skill-dir>/scripts/scaffold.py <target-directory>
```

Inspect its output before replacing starter content. It pins versions and copies the static validator; it does not install or overwrite silently. For an existing project, use its existing package manager and lockfile.

Follow [syntax](references/syntax.md) for separators/headmatter/frontmatter and [configuration](references/configuration.md) for deck and slide settings. Put reusable public files in `public/` and use `/file.ext`; use project-relative imports for authored code and components. Follow imports rather than linting only the entry file.

Progress from static content to components, and only then to interactive elements or custom hooks. Use [components](references/components.md), [custom Vue components](references/vue-components.md), [layouts](references/layouts.md), and [feature references](references/INDEX.md) as needed. Do not reproduce built-in behavior by hand.

### 5. Choreograph, do not decorate

Use default click order for simple reveals; explicit absolute `at` values for anything that must remain maintainable. Avoid a fragile web of mixed relative offsets. Read [animations](references/animations.md) before using `v-clicks`, Magic Move, presets, or Vue transitions.

Design a coherent initial, intermediate, and final state. Motion must explain causality, sequence, comparison, or code evolution. Ensure a final click count, no empty intermediate slide, and a useful exported final state. Interactive demos require a static poster/transcript or a documented live-only exception.

### 6. Write the performance layer

Give every substantial slide concise speaker notes: what to say, why it matters, transition, and optional click cues. Use `[click]` note markers for long, staged commentary. Keep facts and citations out of hidden comments if the audience needs them.

Use the last comment block of a slide for notes; comments elsewhere are not notes. Include rehearsal instructions and a recovery path for failed network, media, or code execution. See [presenter tools](references/presenter-tools.md).

### 7. Validate, render, rehearse, repeat

Run checks appropriate to the change; do not claim unrun checks passed:

```sh
python3 <skill-dir>/scripts/validate.py slides.md
python3 <skill-dir>/scripts/slidev.py . doctor
python3 <skill-dir>/scripts/slidev.py . build
python3 <skill-dir>/scripts/slidev.py . export -- --format pdf
python3 <skill-dir>/scripts/browser-check.py --entry slides.md --port 4173
python3 <skill-dir>/scripts/check-links.py --root public /image.png https://example.com
```

`doctor` checks the installed environment; `validate.py` checks source shape, not rendered correctness. `browser-check.py` can screenshot all slides/click states, capture runtime problems, and flag suspicious canvas overflow. Install dependencies and browser binaries deliberately when missing. Use [operations and QA](references/operations.md) and [exporting](references/exporting.md).

Inspect contact sheets and full-size representative slides: cover, most dense, code/diagram/math, interactive states, light/dark if supported, and ending. **A program can report overflow; only inspected images or a human can establish visual quality.** Rehearse keyboard flow, presenter synchronization, timer, media/audio, fullscreen, offline behavior, and the actual target machine when available.

### 8. Deliver honestly

Use [hosting and offline delivery](references/hosting.md) for static deployments and [exports](references/exporting.md) for the right format. Return the actual deck URL/output paths, what was verified, and any remaining caveats. Never call a deck perfect, visually verified, offline-ready, editable, or export-safe merely because a build succeeded.

## Guardrails

- **Pin, align, verify.** Keep CLI, theme, addons, and the intended Node engine compatible. Inspect installed docs/types before a major-version upgrade; do not promise future release behavior.
- **Do not fat-finger YAML.** `16/9` is intentionally unquoted; `30min`, arrays, custom objects, and nested `drawings`/`seoMeta`/`export` options are YAML. `defaults` applies slide frontmatter; it is not a dumping ground for deck config. See [configuration](references/configuration.md).
- **Reserve `---`.** At a slide separator, a following nonblank line starts frontmatter, which ends at the next exact `---`; two consecutive separators create ordinary slide body content instead. Code-block YAML frontmatter is for non-first slides only. Do not put horizontal rules at column zero. Use fenced outer blocks of at least four backticks to showcase inner triple-backtick code.
- **Do not confuse global states.** `$page` is the local 1-based slide number; `$clicks` local clicks, `$nav` global navigation. Never call `$nav.next()` recursively from a navigation watcher. Use public `@slidev/client` exports, not internal paths.
- **Never ship arbitrary execution casually.** Monaco runners are unsandboxed. Only run trusted code; sandbox or explicitly approve any remote runner. Writable Monaco is development-only and can modify source. Remote access is not public-internet security by itself.
- **Design delivery fallbacks.** Lock down network-dependent embeds/fonts/PlantUML before a critical talk. Bundle/localize assets and test offline if promised. Prefer Mermaid/local assets for self-contained builds.
- **Keep exports faithful.** Editable PPTX is lossy by definition; image PPTX is more faithful. SVG, canvas, video, iframes, math, and effects can remain rasterized in editable PPTX. `--with-clicks false` is explicit for a single-state PDF/PPTX. Verify notes and output pages, not just the file's existence.
- **Do not leak content.** `--without-notes`, `presenter`, `record`, SEO, and remote settings affect published surfaces. Never expose secrets in slides, setup code, public assets, a remote dev server, or speaker notes.
- **Honor reduced motion and accessibility.** Never rely on color, sound, hover, animation, or pointer dragging alone to carry meaning. Give charts/math/diagrams a concise explanation; test captions, contrast, focus, and speaking alternatives.

## Definition of done

- [ ] Brief, audience takeaway, narrative, visual system, and delivery assumptions are explicit.
- [ ] All requested content and factual sources are included or transparently marked unavailable.
- [ ] Source validation and compatible build are run; failures are fixed or reported.
- [ ] Browser screenshots cover every slide and relevant click state; runtime/asset problems are investigated.
- [ ] Representative images have actually been inspected for hierarchy, clipping, contrast, and consistency.
- [ ] Requested export formats and speaker notes are generated and inspected; click/export policy is intentional.
- [ ] Navigation, fallback, time budget, accessibility, and the target display/environment are checked as far as possible.
- [ ] Changed files, run commands, outputs, remaining limitations, and presentation instructions are reported truthfully.
