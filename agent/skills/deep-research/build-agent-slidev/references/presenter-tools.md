# Presenter tooling, navigation, notes, recording, and remote delivery

Sources: [UI](https://sli.dev/guide/ui.html), [timer](features/timer.md), [drawings](features/drawing.md), [recording](features/recording.md), [remote](features/remote-access.md), [notes click markers](features/click-marker.md), [auto ruby](features/notes-auto-ruby.md).

## Navigation and views

Move the pointer to bottom-left to show navigation. Standard shortcuts include `Right`/`Space` next animation or slide, `Left` previous, `Up`/`Down` previous/next slide, `o` quick overview, `g` goto, `d` dark mode, `f` fullscreen. Visit `/overview` for linear slides/notes and click-state sliders; `/notes-edit` for batch notes in supported v52+ decks. Notes editors save source with debounce; review source diff after automated edits.

Presenter mode at `/presenter` synchronizes connected play views. Open audience play and presenter in separate windows; share only the audience window. Three presenter layouts prioritize current slide, notes, and next preview differently. Screen Mirror can capture another monitor/window into presenter view when supported; verify permissions and do not accidentally show private notes to the audience.

Presentation settings include CSS filters (invert/brightness/contrast/saturation/sepia/hue), idle-cursor hiding, fit/1:1 scale, and wake lock. Filters alter appearance, not source/export; use them to adapt to a projector, not as a substitute for accessible colors. Wake Lock requires support and does not replace a charged, correctly configured machine.

## Notes, timer, and rehearsal

Use the last comment block on a slide for notes with Markdown/HTML. `[click]`, `[click:3]` sections synchronize note highlight/autoscroll with click states; `[click:n]` skips according to documented semantics. Keep cues terse enough to scan in low light. Timer config:

```yaml
duration: 30min
timer: countdown # or stopwatch
```

Use the measured rehearsal duration plus question/demo buffer. Stopwatch/countdown is available in presenter view; reset it before the actual talk.

`notesAutoRuby` maps terms to pronunciation/ruby text in speaker notes (v52.4+). Verify substitutions and language accuracy; ensure the presenter display actually wraps long ruby text correctly. Export speaker notes separately with `slidev export-notes` when a rehearsal handout is useful.

## Drawing and annotations

Navigation/presenter drawing is synchronized automatically across instances by default. Stylus input can draw without enabling drawing mode while fingers/mouse still navigate. `drawings.persist: true` stores SVG under `.slidev/drawings`, making annotations part of hosted/exported deck; clean rehearsal marks deliberately. `enabled: false|dev|true` controls availability; `presenterOnly: true` confines drawing mode. `syncAll: false` means only presenter drawings sync to others. Test overlay z-index/pointer capture and export if persistence is enabled.

## Camera and recording

Camera view can be dragged/resized and persists across reloads. The recording dialog offers camera embedded in slides or separate screen/camera video files. Built with RecordRTC/WebRTC. Browser codec/support, microphone selection, display selection, permissions, available storage, and consent need a short real test. Stop/save and play back a test clip; verify audio is not muted and camera does not obscure essential slide content. `record: dev|build|boolean` controls availability. Do not turn on camera/mic in automation without consent.

## Remote mode and tunnel

`--remote` listens publicly according to CLI bind behavior and enables remote interaction; `--bind <address>` selects address in remote mode. `--remote=<password>` protects presenter access through a URL password parameter. `--tunnel` opens a Cloudflare Quick Tunnel in supported current CLIs (check local `--help`).

A dev server is a development application: MCP and writable editor/source endpoints may exist. Do not expose source, secrets, local filesystem, or unsandboxed code execution to an untrusted network. Bind loopback by default for local work, use explicit approval before tunnels, do not put passwords in committed scripts/logs, and prefer a locked-down production build for public audiences. Remote access is not required for audience/presenter windows on one machine.

## Day-of checklist

Charge/connect display, disable notifications, test browser offline/local assets, click through back and forth, test audio and presenter timer, prepare PDF fallback, confirm final version, and close unused dev/edit/MCP/remote endpoints. Record or transmit only with participant consent.
