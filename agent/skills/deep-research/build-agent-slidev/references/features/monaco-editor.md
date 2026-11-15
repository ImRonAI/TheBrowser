<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: monaco-editor

- **Category:** Code
- **Curated practice:** Reserve editor weight for actual live editing; a static Shiki block is faster and more faithful for read-only code.
- **Deep-dive workflow:** [code.md](../code.md)
- **Canonical documentation:** https://sli.dev/features/monaco-editor.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/monaco-editor.md
description: >
  Turn code blocks into fully-featured editors, or generate a diff between two
  code blocks.
---

# Monaco Editor

Whenever you want to do some modification in the presentation, simply add `{monaco}` after the language id — it turns the block into a fully-featured Monaco editor!

````md
```ts {monaco}
console.log('HelloWorld')
```
````

Learn more about [Configuring Monaco](https://sli.dev/custom/config-monaco).

## Diff Editor

Monaco can also generate a diff between two code blocks. Use `{monaco-diff}` to turn the block into a [Monaco diff editor](https://microsoft.github.io/monaco-editor/playground.html?source=v0.36.1#example-creating-the-diffeditor-multi-line-example) and use `~~~` to separate the original and modified code!

````md
```ts {monaco-diff}
console.log('Original text')
~~~
console.log('Modified text')
```
````

## Editor Height

By default, the Monaco editor has a fixed height based on the initial content. If you start with an empty or small code block and want the editor to automatically grow as you type more code, you can set `{height:'auto'}`.

````md
```ts {monaco} {height:'auto'}
// The editor will automatically grow as you type more code
console.log('Hello, World!')
```
````

You can also set a specific height using CSS units like `{height:'300px'}` or `{height:'100%'}`.

## Line Numbers

Like other code blocks, the Monaco editor respects the global `lineNumbers` headmatter. You can also toggle line numbers for a single editor with `{lines:true}` while keeping it editable.

````md
```ts {monaco} {lines:true}
console.log('HelloWorld')
```
````
