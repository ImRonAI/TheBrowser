<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: timer

- **Category:** Presenter
- **Curated practice:** Set duration after rehearsal, not aspiration; retain a Q&A/time buffer and verify countdown behavior on the presenter display.
- **Deep-dive workflow:** [presenter-tools.md](../presenter-tools.md)
- **Canonical documentation:** https://sli.dev/features/timer.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/timer.md
description: Timer for the presenter mode.
---

# Presenter Timer

Slidev provides a timer for the presenter mode. You can start, pause, and reset the timer.

It will show a timer (in stopwatch or countdown mode), and a progress bar in the presenter mode.

## Configuration

You can set the duration of the presentation in the headmatter. Default is `30min`.

```yaml
---
# duration of the presentation, default is '30min'
duration: 30min
# timer mode, can be 'countdown' or 'stopwatch', default is 'stopwatch'
timer: stopwatch
---
```
