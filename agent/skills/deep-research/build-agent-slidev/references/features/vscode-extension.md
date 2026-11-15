<!-- Official upstream snapshot (MIT; see ../../THIRD_PARTY_NOTICES.md). Retrieved 2026-11-14. -->
# Deckcraft guide: vscode-extension

- **Category:** Tooling
- **Curated practice:** Use visual/navigation editor tools when available; a preview is not a substitute for production build/export validation.
- **Deep-dive workflow:** [operations.md](../operations.md)
- **Canonical documentation:** https://sli.dev/features/vscode-extension.html
- **Local siblings:** [feature atlas](../INDEX.md)

The preserved upstream reference below is labeled for the documentation version in
`coverage.json`; verify features and defaults against your installed Slidev version.
Do not copy the upstream YAML document frontmatter into a slide.

---

---
url: /features/vscode-extension.md
description: |
  Help you better organize your slides and have a quick overview of them.
---

# VS Code Extension

The VS Code extension provides some features to help you better organize your slides and have a quick overview of them.

### Features

* Preview slides in the side panel
* Slides tree view with slide numbers
* Re-ordering slides via drag and drop
* Folding for slide blocks
* Multiple slides project support
* Start the dev server with one click
* AI/Copilot integration via Language Model Tools

![](https://github.com/slidevjs/slidev/assets/63178754/2c9ba01a-d21f-4b33-b6b6-4e249873f865)

### Installation

You can install the extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=antfu.slidev) or the [Open VSX Registry](https://open-vsx.org/extension/antfu/slidev).

### Usage

Click the `Slidev` icon in the activity bar to open the **Slidev panel**. In the Slidev panel, you can see the projects tree view, slides tree view, and the preview webview.

In the **projects tree view**, you can see all the Slidev projects in your workspace. You can click the item to open the corresponding file, and click the  icon over it to switch the active project. The  icon allows you to load a slides project that wasn't scanned automatically.

In the **slides tree view**, you can see all the slides in the active project. You can click the item to move your cursor to the slide in the editor, and drag and drop to reorder the slides.

In the **preview webview**, you can click the  icon to start the dev server and click the  icon to open the slides in the browser. Toggle  icon to sync/unsync the preview navigation with the editor cursor.

There are also some **commands** you can use. Type `Slidev` in the command palette to see them.

You can add glob patterns to the `slidev.include` configuration to include files as Slidev entries. The default value is `["**/*.md"]`. Example:

```json
{
  "slidev.include": ["**/presentation.md"]
}
```

#### Dev Command {#dev-command}

You can customize the command to start dev server by setting the `slidev.dev-command` configuration. The default value is `npm exec -c 'slidev ${args}'`.

The configured command can contain placeholders:

* `${args}`: All CLI arguments. e.g. `slides.md --port 3000 --remote`
* `${port}`: The port number. e.g. `3000`

Examples:

* Global installation: `slidev ${args}`
* For PNPM users, you can set it to `pnpm slidev ${args}`.
* For [code-server](https://coder.com/docs/code-server/) users, you can set it to `pnpm slidev ${args} --base /proxy/${port}/`. This will make the dev server accessible at `http://localhost:8080/proxy/3000/`.

#### Slides Tree View {#slides-tree}

> Available since v0.52.0

The slides tree view shows all slides in your presentation with their slide numbers and titles. Each slide is displayed as `{slideNo}. {title}` making it easy to navigate to specific slides.

#### AI/Copilot Integration {#ai-integration}

> Available since v0.52.0

The extension provides Language Model Tools that allow VSCode's Copilot and other AI assistants to interact with your Slidev project. The following tools are available:

* `slidev_getActiveSlide` - Get information about the current active slide and project
* `slidev_getSlideContent` - Retrieve the content of a specific slide by number
* `slidev_getAllSlideTitles` - List all slide titles in the presentation
* `slidev_findSlideNoByTitle` - Find a slide number by its title
* `slidev_listEntries` - List all loaded Slidev project entries
* `slidev_getPreviewPort` - Get the preview server port for a project
* `slidev_chooseEntry` - Switch the active Slidev entry

These tools enable AI assistants to help you navigate, edit, and understand your slides more effectively.
