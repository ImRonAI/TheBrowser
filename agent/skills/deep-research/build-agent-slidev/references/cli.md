# Slidev CLI and project operations

Primary: [CLI reference](https://sli.dev/builtin/cli.html), [getting started](https://sli.dev/guide/). Run `slidev <command> --help` in the installed version for additional/new options. Package is **`@slidev/cli`**, binary **`slidev`**; `npx slidev` is usually not supported.

## Commands

| Command | Core purpose / common options |
|---|---|
| `slidev [entry]` | Dev server; `--port/-p 3030`, `--base /`, `--open/-o`, `--remote [password]`, `--bind 0.0.0.0` remote default, `--log`, `--force/-f`, `--theme/-t` |
| `slidev build [entry]` | Hostable SPA; `--out/-o dist`, `--base /`, `--download`, `--theme`, `--without-notes` |
| `slidev export [...entry]` | PDF/PNG/PPTX/editable PPTX/MD; `--output`, `--format`, `--timeout`, `--range '1,4-5,6'`, `--dark`, `--with-clicks`, `--theme`, `--omit-background` |
| `slidev export-notes [...entry]` | PDF of slide title/number/notes for slides that have notes; `--output`, `--timeout`, `--wait` |
| `slidev format [entry]` | Formats Markdown organization, not its human content or visual quality |
| `slidev mcp [entry]` | Stdio MCP server for direct structured file edits |
| `slidev theme eject [entry]` | Copy current theme locally; `--dir theme`, `--theme/-t` |

Options accept `--port 3030` or `--port=3030`; boolean true can be `--open` or `--open true`. For npm scripts forward options after `--`: `npm run dev -- --port 3030 --open`.

## Setup and package manager

The docs recommend `pnpm create slidev`. Prefer the deterministic `scaffold.py` supplied with this skill for agent-authored decks; it writes a tested baseline without interactive prompts or silent installs. Always inspect generated files before replacing the story/design.

Export/browser automation requires the project's `playwright-chromium` development dependency, installed deliberately with the established manager. Do not install or update browsers globally as an unnoticed side effect. Pin CLI/theme/addons, use lockfile frozen installs in CI, and align Node with the selected package's engines.

```sh
pnpm exec slidev slides.md --port 3030 --open
pnpm exec slidev build slides.md --out dist --base /
pnpm exec slidev export slides.md --format pdf --output output/deck.pdf
pnpm exec slidev export-notes slides.md --output output/notes.pdf
```

## Included wrapper

`python3 scripts/slidev.py <project-dir> doctor|dev|build|export|export-notes|format -- [additional CLI flags]`.

- `doctor` is read-only; identifies local package version, Node engine and Playwright.
- `dev` and lifecycle commands invoke the local executable through the existing package manager, never a global CLI silently.
- The wrapper does not install missing dependencies. It returns the underlying exit code and prints the exact invocation.
- Bind development to loopback unless the user explicitly asks for remote access. Prefer passing `-- --bind 127.0.0.1` for dev, and use a free local port.
- Build/export output remains user-controlled through normal CLI flags. `export` with no format intentionally defers to configured/default PDF; the wrapper is not a fake exporter.

Read [exporting](exporting.md), [operations](operations.md), [hosting](hosting.md) for output and validation semantics.
