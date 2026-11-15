# Operations, browser QA, and delivery rehearsal

Primary sources: [CLI](cli.md), [exporting](exporting.md), [user interface](presenter-tools.md), [troubleshooting](https://sli.dev/guide/faq.html). Script paths below are relative to the skill directory.

## Layered verification

1. **Source:** `python3 scripts/validate.py slides.md` detects malformed structural conventions, missing local references, unresolved imports, placeholder content, and heuristic click risks. These are diagnostics, not a compiler.
2. **Environment:** `python3 scripts/slidev.py . doctor` identifies package manager, local dependency, selected version, Node engine, and browser availability. It changes nothing.
3. **Compiler/build:** use the project's pinned CLI to build the production SPA. A dev render alone does not verify production asset paths or remote/offline policies.
4. **Runtime:** `python3 scripts/browser-check.py --entry slides.md --port 4173` starts an isolated local dev process, visits each discovered slide/click state, collects page errors, console errors, request failures, writes screenshots, and flags suspicious geometry. Stop it with its normal cleanup; do not leave unknown servers running.
5. **Output:** generate requested PDF/PPTX/PNG/notes exports using explicit options. Check count, dimensions, notes, fonts, and files; use a PDF/image viewer to inspect representative pages. A return code or nonempty file alone is not visual validation.
6. **Human rehearsal:** present from the intended machine/display, with network conditions and an offline fallback if promised.

Static validation cannot understand arbitrary pre-parser output, themes, or custom components. If a warning is a known false positive, explain or use the validator's ignore option rather than expanding unsafe ignore-all behavior.

## Browser inspection checklist

Inspect full-slide images and contact sheets, including final states:

- Cover establishes a focal point and has intentional title treatment.
- Most text-dense slide fits without an unintended internal scrollbar or overlap.
- All code, Magic Move, diagrams, math, footers, citations, images, and icons are legible and not clipped.
- Every relevant click state has meaningful content; backward navigation restores state. No surprise extra click at slide end.
- Interactive/prolonged animations have settled; screenshots represent a real presentation state.
- Global layers stay behind/in front of intended content and do not cover Slidev controls.
- Light/dark views, mobile/preview, print, and presenter are checked where in scope.
- No broken images, unhandled errors, unexpected network calls, missing glyphs, or font fallback caused by unavailable hosts.

The browser heuristic examines visible slide subtree bounds. CSS effects, intentional bleed, clipped containers, iframes, late media, and transforms can be false reports. Inspect the screenshot and DOM before declaring a defect. Reduced-motion emulation can be used for another capture pass.

## Package-manager discipline

Use pnpm for a new scaffold unless the workspace has an established manager. For existing projects use its lockfile and scripts. With npm scripts, extra CLI flags go after `--`; `slidev.py` handles this for its command wrapper. Do not use `npx slidev`—that is not `@slidev/cli`.

Example lifecycle (replace manager with the project's convention):

```sh
pnpm install --frozen-lockfile
pnpm exec slidev slides.md --port 3030 --open
pnpm exec slidev build slides.md --out dist --base /
pnpm add -D playwright-chromium   # deliberate export dependency change
pnpm exec slidev export slides.md --format pdf --output output/deck.pdf
```

Install a compatible Chromium build and fonts deliberately in CI. The exporter uses Playwright. If exports time out, first find slow/unavailable network assets, then consider `--wait`, `--timeout`, or a documented `--wait-until` setting. Never mask all loading errors with an arbitrary huge sleep.

## Rehearsal and contingency

- Run `Right`/`Space`, `Left`, `Up`/`Down`, `o` overview, `g` goto, `f` fullscreen; configure shortcuts only after testing default muscle memory.
- Open audience play and `/presenter` in separate windows; verify synchronized navigation, next preview, notes/click markers, timer, and notes edits.
- Check presenter synchronization after refresh and when content has been reordered.
- Test camera/microphone permissions and recording only with consent. Know where output is saved and its size.
- If using remote control, protect presenter mode with a password and bind only to the intended interface; never expose secrets/development filesystem on an untrusted network.
- Bundle critical images/fonts, test with network disabled, and prepare screenshots/video fallbacks. PWA still needs a first successful load/caching pass and a production build.
- Carry a known-good static PDF plus local browser build. Editable PowerPoint needs a separate render on the recipient's expected font/platform setup.

## Report format

State actual entry file, package/version, outputs, commands run and their outcomes, screenshots/output paths inspected, and unverified environmental limitations. Include what remains live-only or network-dependent. Never report “all tests pass” when checks were skipped, and never equate static clean output with “perfect.”
