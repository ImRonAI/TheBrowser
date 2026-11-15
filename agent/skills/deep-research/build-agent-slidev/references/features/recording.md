<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: recording

- **Category:** Presenter
- **Curated practice:** Obtain consent, check permissions/audio/storage, and make a short test recording before the real presentation.
- **Deep-dive workflow:** [presenter-tools.md](../presenter-tools.md)
- **Canonical documentation:** https://sli.dev/features/recording.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/recording.md
description: |
  Record your presentation with the built-in camera view and recording feature.
---

# Recording

Slidev comes with a built-in camera view and recording feature. They make it simple for you to record your presentation without having to switch between other recording tools while delivering a presentation.

## Camera View {#camera-view}

Click the  button in the [navigation bar](https://sli.dev/guide/ui#navigation-bar) to show your camera view in the presentation. You can drag it to move it, and use the handler on the right bottom corner to resize it. The size and position will persist across reloads.

## Start Recording {#start-recording}

Clicking the  button in the [navigation bar](https://sli.dev/guide/ui#navigation-bar) will bring up a dialog for you. Here you can choose to either record your camera output embedded in your slides or to separate them into two video files.

This feature is powered by [RecordRTC](https://github.com/muaz-khan/RecordRTC) and uses the [WebRTC API](https://webrtc.org/).

![](https://sli.dev/screenshots/recording.png)
