# Electron Process Context Runbook

This directory contains the main and preload processes of the Electron application.

## Core Rules

1. **Automation Boundary**: The preload script must only expose UI actions, theme changes, tab management, and window controls to the renderer. All automation capabilities (e.g. CDP, Playwright commands) are served by `electron-playwright-mcp` over localhost API endpoints, preventing renderer sandbox escape.
2. **Tab Isolation**: External tabs are generated as `WebContentsView` elements, isolating web content and cookies per user session using partition keys.
3. **Active WebContents supplier**: The active tab's `WebContentsView` is registered dynamically to the `electron-playwright-mcp` server using `setActiveWebContentsSupplier` inside `main.ts` so the automation tools always execute against the active foreground tab.
4. **Tab controller**: `setTabController` maps list / create / select / close / navigate onto `TabsManager` — the same list as the chrome tab bar. CDP target HTTP and Electron `BrowserWindow` loaders are not agent tab tools.
5. **Page chrome**: `WebContentsView` bounds sit below the toolbar/tabs/nav drawer and left of the agent panel. Page context menus use `webContents` `context-menu` + `Menu`.
   Double-clicking non-editable page text also shows a small native Ask Ron menu.
   Selection is read in an isolated world after Chromium handles the mouse event;
   only choosing the menu item emits `agent:ask-ron`. Navigation/active-tab checks
   discard stale results. This is UI selection handling, not an automation bridge.

6. **Tab visibility contract**: `automationTabs()` must report `visible` = the tab's `WebContentsView` is attached to `mainWindow.contentView`. Internal `ron://` tabs and views materialized for automation but not yet attached are `visible: false`; `electron-playwright-mcp` refuses screenshots on them (400, actionable error). Never attach a blank view just to satisfy a screenshot.
