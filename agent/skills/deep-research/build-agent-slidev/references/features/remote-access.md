<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: remote-access

- **Category:** Presenter
- **Curated practice:** Bind deliberately and protect presenter mode; a password/tunnel is not justification to expose secrets or dev-only write tools publicly.
- **Deep-dive workflow:** [presenter-tools.md](../presenter-tools.md)
- **Canonical documentation:** https://sli.dev/features/remote-access.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/remote-access.md
description: |
  Access your presentation remotely with Slidev's remote access feature.
---

# Remote Access

You can run your presentation with remote access by using the `--remote` flag:

::: code-group

```bash [pnpm]
pnpm dev --remote
# i.e. slidev --remote
```

```bash [npm]
npm run dev -- --remote
# i.e. slidev --remote
```

```bash [yarn]
yarn dev --remote
# i.e. slidev --remote
```

```bash [bun]
bun dev --remote
# i.e. slidev --remote
```

```bash [deno]
deno run dev --remote
# i.e. slidev --remote
```



## Password Protection

If you want to share your slides but don't want other people to access the presenter mode, you can pass a password to the option, i.e. `--remote=your_password`. Then the password is required when accessing the presenter mode.

## Remote Tunnel

You can open a [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) to expose your local server to the internet. This way, you can share your slides with others without setting up a server.

::: code-group

```bash [pnpm]
pnpm dev --remote --tunnel
# i.e. slidev --remote --tunnel
```

```bash [npm]
npm run dev -- --remote --tunnel
# i.e. slidev --remote --tunnel
```

```bash [yarn]
yarn dev --remote --tunnel
# i.e. slidev --remote --tunnel
```

```bash [bun]
bun dev --remote --tunnel
# i.e. slidev --remote --tunnel
```

```bash [deno]
deno run dev --remote --tunnel
# i.e. slidev --remote --tunnel
```
