# Static hosting, base paths, offline assets, and social metadata

Primary: [build/host](https://sli.dev/guide/hosting.html), [PWA](features/pwa.md), [remote assets](features/bundle-remote-assets.md), [SEO](features/seo-meta.md), [OG image](features/og-image.md).

## Production SPA

```sh
slidev build slides.md --out dist --base /
# For a repository/subdirectory:
slidev build slides.md --base /talks/my-talk/
slidev build slides.md --without-notes
```

`--base` must begin and end with `/`. History router normally requires SPA fallback/rewrite to `index.html`; alternatively evaluate `routerMode: hash` for static/subdirectory setups. `routerMode: memory` does not reflect slide number in URL and cannot support normal deep links/presenter/export URL paths; use only for deliberate kiosk/externally controlled decks.

Multiple entry Markdown files build separate output folders. Preview the actual `dist` using a local static server with correct SPA rewrites/base—not just the dev server. `npx vite preview` can be used when Vite is already a project dependency; never fetch an unrelated tool implicitly for a security-sensitive deck.

## Official host patterns

- **GitHub Pages:** official workflow uses checkout/setup-node, frozen lockfile install, build `--base /<repository>/`, configure-pages and upload-pages-artifact, then deploy-pages with scoped permissions. Use supported current action versions and set Node according to the pinned package.
- **Netlify:** publish `dist`, run project build, configure SPA redirect `/* -> /index.html` status 200.
- **Vercel:** configure rewrite `/(.*) -> /index.html` in `vercel.json`.
- **deed.page:** static upload uses `X-Spa: 1` for unknown routes and an authorization token for updates.
- **Docker:** official docs point to community `tangramor/slidev` image; audit/version-pin before using. Keep source, credentials, and editing endpoints out of public runtime.

Deployment, token handling, external tunnels, and publication require explicit authorization. A build command that transparently deploys (such as third-party integrations) is not merely a local build; disclose and confirm it.

## Assets and offline behavior

Public files (`public/foo.webp`) are served/copied at `/foo.webp`. Reference as `/foo.webp`. Imported compile-time source assets follow Vite rules. Base-path behavior must be tested for both. Remote images can be cached/bundled via `remoteAssets: true|'dev'|'build'`, but remote requests still need review and may include other runtime resources. Local assets and deterministic data are the safest choice for a critical presentation.

[PWA](features/pwa.md) is opt-in with `pwa: true|dev|build|false`. It uses optional peer dependency `vite-plugin-pwa` and Workbox. Install it deliberately for CI rather than relying on interactive CLI prompting. A production build precaches generated JS/CSS/HTML and built media (including files up to 100 MB per documented limit); it does **not** magically cache CDN/remote fonts, social embeds, PlantUML, or arbitrary APIs.

Offline contract:

1. Enable `pwa: build` or appropriate setting and bundle/localize critical remote assets.
2. Build and serve over the same secure/localhost origin expected for the talk.
3. Visit once online and wait for `Caching for offline…` to become `Ready offline`.
4. Exercise every slide/media resource once if lazy behavior applies, then disable network and reload/navigate/play.
5. Verify video seeking separately: full cached response supports start playback but range-request seeking may need more work.
6. Test a service-worker update after a deck revision; stale cached decks are a real presentation risk.

The generated manifest intentionally has no icons so offline doesn't depend on a remote favicon. PWA is useful but not a replacement for a tested PDF fallback.

## SEO, metadata, and social image

Set `seoMeta.ogTitle`, `ogDescription`, absolute `ogImage`, `ogUrl`, Twitter card/title/description/image/site/URL as appropriate. Powered by `@unhead/vue` in the selected docs; validate rendered `<head>` and final served URLs. Placeholder `example.com` must not survive production. Metadata does not make a private deck private; public builds may need `--without-notes`, disabled recording/presenter/MCP/edit capabilities, and careful source disclosure review.

`seoMeta.ogImage: auto` (v52.1+) captures the first slide into `./og-image.png` using Playwright. Commit the reviewed image for deterministic CI and font stability, especially CJK/emoji. A project-root `./og-image.png` is automatically picked up when no explicit image is configured. Social platforms need an accessible absolute public URL when deployed; local file discovery alone does not make a crawler see it.

## Delivery checklist

Build at final base and serve it, check routes and all assets in an isolated/browser context, verify external links and social metadata, test required offline mode, inspect public speaker notes/source/config for sensitive content, and carry known-good PDF/PPTX fallbacks. Version all dependencies and record the exact build command used.
