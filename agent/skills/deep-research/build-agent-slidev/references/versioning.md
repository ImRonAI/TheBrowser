# Versioning and trustworthy references

## Grounding snapshot

- Official docs: <https://sli.dev/llms.txt> and individual pages linked in this directory, labeled English **v52.19.1**, read 2026-11-14.
- Current package found for integration: **`@slidev/cli@53.1.0`**, which requires **Node.js `>=22.22.0`**. The v52 website said `>=22.12.0`, demonstrating why the selected artifact matters.
- API source checked at <https://github.com/slidevjs/slidev/tree/v53.1.0>, especially `packages/types/src/frontmatter.ts`, `config.ts`, and client composables.

Do not silently combine syntax or engine claims from different versions. A newer package may contain features not in the website snapshot; an existing deck may be much older. Use the feature's minimum version where one is given.

## On every task

1. Inspect `package.json`, the lockfile, and installed dependency versions before authoring.
2. Run the project's local CLI, not an accidental global or `npx slidev` package. The binary is named `slidev` but the package is `@slidev/cli`.
3. Resolve exact versions: `pnpm why @slidev/cli @slidev/theme-default`, `npm ls @slidev/cli @slidev/theme-default`, or the equivalent for the existing manager.
4. Compare `node -v` with the **selected package's** `engines`. New projects should use a current Node LTS satisfying it; v53.1.0 needs 22.22 or later.
5. Consult `<https://sli.dev>` for current docs and the installed package/source for exact syntax. Prefer release-tagged source to `main` for reproducible behavior.
6. If features or defaults appear contradictory, reproduce a small case in the selected CLI and `--help`, record the result, and prefer verified reality.
7. Upgrade intentionally, after a successful baseline build/export. Run validation/screenshots again. Do not bump a user's dependencies as a side effect of a copy edit.

```sh
npm view @slidev/cli version engines --json
npm view @slidev/theme-default version peerDependencies --json
pnpm exec slidev --help
pnpm exec slidev export --help
```

## Why pin?

A pin makes a deck build reproducible and visual QA meaningful. Use exact CLI and theme/addon versions in the scaffold, commit the resulting lockfile, and keep the package's Node engine and CI image aligned. Pinning does not mean never upgrading; it means upgrades are visible and tested. It does not eliminate the security need to review updates and asset sources.

## Sources with few or no rendered documentation links

The upstream machine-readable documentation intentionally omits some inline links/icons. Where those gaps matter, each local guide points to the canonical HTML anchor or source API and labels its inference. Never invent API props to fill a documentation gap.

- Navigation API source: <https://github.com/slidevjs/slidev/blob/v53.1.0/packages/client/composables/useNav.ts>
- Config types: <https://github.com/slidevjs/slidev/blob/v53.1.0/packages/types/src/frontmatter.ts>
- Vite: <https://vite.dev/config/>
- UnoCSS: <https://unocss.dev/config/>
- Vue: <https://vuejs.org/api/>
- Shiki: <https://shiki.style/>
- Monaco: <https://microsoft.github.io/monaco-editor/>
- Mermaid: <https://mermaid.js.org/>
- KaTeX: <https://katex.org/docs/supported>
