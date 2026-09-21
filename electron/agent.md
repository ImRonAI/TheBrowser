# Electron Process Context Runbook

This directory contains the main and preload processes of the Electron application.

## Core Rules

1. **Automation Boundary**: The preload script must only expose UI actions, theme changes, tab management, and window controls to the renderer. All automation capabilities (e.g. CDP, Playwright commands) are served by `electron-playwright-mcp` over localhost API endpoints, preventing renderer sandbox escape.
2. **Tab Isolation**: External tabs are generated as `WebContentsView` elements, isolating web content and cookies per user session using partition keys.
3. **Active WebContents supplier**: The active tab's `WebContentsView` is registered dynamically to the `electron-playwright-mcp` server using `setActiveWebContentsSupplier` inside `main.ts` so the automation tools always execute against the active foreground tab.
4. **Tab controller**: `setTabController` maps list / create / select / close / navigate onto `TabsManager` — the same list as the chrome tab bar. CDP target HTTP and Electron `BrowserWindow` loaders are not agent tab tools.
5. **Page chrome**: `WebContentsView` bounds sit below the toolbar/tabs/nav drawer and left of the agent panel. Page context menus use `webContents` `context-menu` + `Menu`.
