# Code, diagrams of logic, and live execution

Sources: [Shiki](https://sli.dev/custom/config-highlighter.html), [Monaco](https://sli.dev/custom/config-monaco.html), [code runners](https://sli.dev/custom/config-code-runners.html), and exact local feature references below.

## Code that teaches

Show the minimum working concept, import tested source, and highlight the line being explained. Ordinary code uses Shiki; Prism is removed since v0.50. Use a language identifier and four-backtick outer fences when documenting triple-backtick code.

````md
```ts {2|3-4|all}{lines:true,startLine:10,maxHeight:'300px'}
const answer = compute()
console.log(answer)
// explain the next meaningful line
```
````

Exact syntax and options:

- [Line highlighting](features/line-highlighting.md): `{2,3}`, `{2-3|5|all}`, `{hide|none}`; code option `{at:'+5'}` can control position as described in animations.
- [Line numbers](features/code-block-line-numbers.md): global `lineNumbers: true`, local `{lines:true}`, optional `{startLine:5}`. `{*}` can stand for highlight stages.
- [Max height](features/code-block-max-height.md): `{maxHeight:'100px'}` enables scrolling. Do not turn unreadable walls of source into a small scrolling box by default.
- [Code groups](features/code-groups.md): `::code-group` requires `comark: true`; titled fences `[npm]` supply tabs/icons. Install `@iconify-json/vscode-icons` for documented title icon matching.
- [Imported snippets](features/import-snippet.md): `<<< @/snippets/example.ts` and applicable region/range/highlight/editor options. `@` resolves project root. Prefer explicit maintained snippet regions over fragile line ranges when available.
- [Magic Move](features/shiki-magic-move.md): four-backtick ````md magic-move` block with successive inner fences; each subsequent code state advances with clicks. First fence options apply to later ones; add `at` later when an explicit offset is needed. `magicMoveCopy: final|always|true` controls copy affordance. Shiki Magic Move does not support transformers.
- [TwoSlash](features/twoslash.md): after language id (for example ```` ```ts twoslash ````) adds TypeScript hover/type output. Use TypeScript compiler markers and config supported by installed version. Hover-only information needs an export/verbal alternative.

## Shiki setup

`setup/shiki.ts` returns themes, langs, and transformers via `defineShikiSetup` from `@slidev/types`:

```ts
import { defineShikiSetup } from '@slidev/types'

export default defineShikiSetup(() => ({
  themes: { dark: 'min-dark', light: 'min-light' },
  langs: ['ts', 'python'],
  transformers: [],
}))
```

Custom TextMate grammars/themes can be imported JSON. Use Shiki's [theme/language lists](https://shiki.style). Do not assume every VS Code theme/grammar loads without registration. Test dark/light token contrast and filenames/line-number rendering in export.

## Monaco editor and diff

[Monaco editor](features/monaco-editor.md) is useful only for live editing:

````md
```ts {monaco} {height:'auto',lines:true}
console.log('Editable')
```

```ts {monaco-diff}
console.log('Original')
~~~
console.log('Modified')
```
````

`height` accepts `auto` or CSS units. Global `lineNumbers` applies and `{lines:true}` controls one editor. [Configuration](https://sli.dev/custom/config-monaco.html) supports `setup/monaco.ts` using `defineMonacoSetup`, editor options, and additional types. `monacoTypesSource: local|cdn|none`, `monacoTypesAdditionalPackages`, and `monaco: true|dev|build|false` control payload/network surfaces. `cdn` creates a production network dependency; local/none need intentional type coverage.

[Writable Monaco](features/monaco-write.md) combines imported code with `{monaco-write}` and saves edits back to files through development APIs. Treat it as a trusted local development tool. It can overwrite displayed source and may adjust optional dependency/editor conditions; inspect its exact upstream note, make backups, and never expose it as a public workshop endpoint.

## Code runners: trusted code only

[Monaco Run](features/monaco-run.md) supports JavaScript/TypeScript in the browser:

````md
```ts {monaco-run} {autorun:false,showOutputAt:'+1'}
console.log('Run only when the audience is ready')
```
````

`autorun` defaults true; explicit false is safer for a rehearsed action. Output can be click-timed. **Built-in runners execute browser code without a sandbox.** Never run audience/untrusted code, import unexpected remote modules, or put credentials in its environment. Prepare a known-good output screenshot/transcript.

Custom `setup/code-runners.ts` can use Web Workers or an authenticated remote execution service. Return `{ text }`, sanitized `{ html }`, or an element according to [CodeRunner types](https://github.com/slidevjs/slidev/blob/v53.1.0/packages/types/src/code-runner.ts). The context provides `options`, `highlight`, and `run`; `runnerOptions` passes code-fence options. `monacoRunAdditionalDeps` entries resolve relative to `snippets/` and names must match actual imports. Remote execution needs resource limits, authentication, validation/sandboxing, network timeouts, and a recovery plan; “running in Monaco” is not a security boundary.

## Code-specific QA

Build and run actual imported code separately. Capture every Magic Move/highlight state in forward/backward navigation, inspect final export, and test copy versus editor behavior. Hover and live execution require web delivery; image PPTX/PDF are not interactive. Final code must be visible even if earlier states are hidden. Editors can be heavy: do not preload dozens on adjacent slides.
