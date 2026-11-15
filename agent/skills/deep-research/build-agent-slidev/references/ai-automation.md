# AI automation with Slidev MCP, editors, and this skill

Sources: [work with AI](https://sli.dev/guide/work-with-ai.html), [MCP](features/mcp.md), [side editor](features/side-editor.md), [VS Code extension](features/vscode-extension.md), [Prettier](features/prettier-plugin.md).

## Built-in MCP

With the dev server running, Slidev exposes streamable HTTP MCP at `http://localhost:<port>/__mcp`. Set `mcp: false` in headmatter to disable this endpoint. Register only when useful and authorized:

```sh
claude mcp add --transport http slidev http://localhost:3030/__mcp
# Standalone, direct file operations over stdio:
slidev mcp slides.md
```

Do not copy documentation's `npx slidev` stdio example blindly: upstream CLI warns the package is `@slidev/cli`, not `slidev`. Prefer the project's pinned `pnpm exec slidev mcp slides.md` or an explicit locally resolved executable.

Tools: `slidev-get-info`, `slidev-list-slides`, `slidev-get-slide`, `slidev-update-slide`, `slidev-insert-slide`, `slidev-remove-slide`, `slidev-move-slide`, and dev-server-only `slidev-goto-slide`. Rendered slide addresses are 1-based and match visible numbering. Structured insert/update/move still changes source; inspect a diff, content/notes/frontmatter, includes, aliases, and link targets. Removing or reordering may invalidate hard-coded slide `<Link>` targets and image captions.

## Editor tooling

The [VS Code extension](https://marketplace.visualstudio.com/items?itemName=antfu.slidev) offers project/slide tree, preview, navigation, and Copilot/language model tools. [Integrated side editor](features/side-editor.md) writes slide source during development. [Prettier plugin](features/prettier-plugin.md) requires `prettier` and `prettier-plugin-slidev`, and parser `slidev` under file overrides for `slides.md`/`pages/*.md`; merely including the plugin is insufficient. Review formatted source because Slidev Markdown differs from generic Markdown.

These conveniences do not establish visual correctness. Custom preparser modifications can break editor source mappings. Rebuild/render after every automated batch and verify installed-version support.

## Security and working agreement

- HTTP MCP and editor endpoints can inspect/edit source and drive browsers. Bind only trusted interfaces; disable in public/untrusted hosting.
- Avoid embedding an MCP password/token in logs or URLs committed to git.
- Do not run untrusted Monaco runner code or permit writable Monaco via public remote access.
- Keep existing user edits; use small meaningful changes and ensure any automated formatting is intentional.
- Prefer direct file tools when they are auditable; MCP is not mandatory for using this skill. Structured tools are helpful, not a replacement for judgement.
- After any agent action: inspect `git diff`, run static source validation/build, capture changed slides and click states, and explicitly report output. A model saying “perfect” is not a validation signal.

## Reference maintenance

`python3 scripts/sync-references.py --update` deliberately fetches all manifest feature pages from `https://sli.dev`; without `--update` it checks. `--snapshot-dir` supports a saved docs tree for reproducible builds. It updates only `references/features/*.md` and generated atlas rows, protects curated guides, and preserves MIT notice/source links. Review diffs and update `coverage.json` only after checking the official index for added/removed features. Pin/report the new docs/package versions rather than silently blending dates.
