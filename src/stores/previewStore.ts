/**
 * Preview Store - Global state for artifact preview panel
 * 
 * Manages preview state for browser automation and code project previews.
 * Triggered automatically when specific MCP tools are used.
 */

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type PreviewType = 'browser' | 'project' | 'code' | 'none'

export interface BrowserPreviewData {
  url?: string
  screenshot?: string // Base64 or file path
  title?: string
  isLive?: boolean
}

export interface ProjectPreviewData {
  url?: string // Dev server URL (e.g., http://localhost:3000)
  name?: string
  status: 'starting' | 'running' | 'stopped' | 'error'
  logs?: string[]
  consoleOutput?: Array<{
    level: 'log' | 'warn' | 'error'
    message: string
    timestamp: Date
  }>
}

export interface CodePreviewData {
  code: string
  language: string
  filename?: string
}

export interface PreviewState {
  // State
  isOpen: boolean
  isFullscreen: boolean
  previewType: PreviewType
  
  // Preview Data
  browserData: BrowserPreviewData | null
  projectData: ProjectPreviewData | null
  codeData: CodePreviewData | null
  
  // Actions
  openBrowserPreview: (data: BrowserPreviewData) => void
  openProjectPreview: (data: ProjectPreviewData) => void
  openCodePreview: (data: CodePreviewData) => void
  
  updateBrowserPreview: (data: Partial<BrowserPreviewData>) => void
  updateProjectPreview: (data: Partial<ProjectPreviewData>) => void
  
  closePreview: () => void
  toggleFullscreen: () => void
  setFullscreen: (isFullscreen: boolean) => void
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Detection Helpers
// ─────────────────────────────────────────────────────────────────────────────

// Tool names that should trigger browser preview
export const BROWSER_TOOLS = [
  'playwright_',
  'electron_',
  'cdp_',
  'playwright_navigate',
  'playwright_screenshot',
  'playwright_click',
  'playwright_type',
  'playwright_scroll',
  'playwright_fill',
  'browser_navigate',
  'browser_click',
  'browser_screenshot',
  'navigate',
  'screenshot',
  'scrape',
]

// Tool names that should trigger project preview
export const PROJECT_TOOLS = [
  'run_project',
  'start_dev_server',
  'npm_run',
  'pnpm_run',
  'yarn_run',
  // Note: 'shell' removed - handled by explicit isDevServerCommand check in chain-of-thought-message.tsx
]

// Check if a tool name matches browser tools
export function isBrowserTool(toolName: string): boolean {
  const lowerName = toolName.toLowerCase()
  return BROWSER_TOOLS.some(t => lowerName.includes(t.toLowerCase()))
}

// Check if a tool name matches project tools  
export function isProjectTool(toolName: string): boolean {
  const lowerName = toolName.toLowerCase()
  return PROJECT_TOOLS.some(t => lowerName.includes(t.toLowerCase()))
}

// Check if shell command is running a dev server
export function isDevServerCommand(input: unknown): boolean {
  if (typeof input !== 'object' || input === null) return false
  
  const command = (input as Record<string, unknown>).command
  if (typeof command !== 'string') return false
  
  const devPatterns = [
    'npm run dev',
    'npm start',
    'pnpm dev',
    'yarn dev',
    'vite',
    'next dev',
    'remix dev',
    'nuxt dev',
    'astro dev',
  ]
  
  return devPatterns.some(pattern => command.toLowerCase().includes(pattern.toLowerCase()))
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export const usePreviewStore = create<PreviewState>()(
  subscribeWithSelector((set) => ({
    // Initial state
    isOpen: false,
    isFullscreen: false,
    previewType: 'none',
    browserData: null,
    projectData: null,
    codeData: null,
    
    // Open browser preview
    openBrowserPreview: (data) => set({
      isOpen: true,
      previewType: 'browser',
      browserData: data,
      projectData: null,
      codeData: null,
    }),
    
    // Open project preview
    openProjectPreview: (data) => set({
      isOpen: true,
      previewType: 'project',
      projectData: data,
      browserData: null,
      codeData: null,
    }),
    
    // Open code preview
    openCodePreview: (data) => set({
      isOpen: true,
      previewType: 'code',
      codeData: data,
      browserData: null,
      projectData: null,
    }),
    
    // Update browser preview data
    updateBrowserPreview: (data) => set((state) => ({
      browserData: state.browserData 
        ? { ...state.browserData, ...data }
        : data as BrowserPreviewData,
    })),
    
    // Update project preview data
    updateProjectPreview: (data) => set((state) => ({
      projectData: state.projectData
        ? { ...state.projectData, ...data }
        : { status: 'starting', ...data } as ProjectPreviewData,
    })),
    
    // Close preview
    closePreview: () => set({
      isOpen: false,
      isFullscreen: false,
      previewType: 'none',
      browserData: null,
      projectData: null,
      codeData: null,
    }),
    
    // Toggle fullscreen
    toggleFullscreen: () => set((state) => ({
      isFullscreen: !state.isFullscreen,
    })),
    
    // Set fullscreen explicitly
    setFullscreen: (isFullscreen) => set({ isFullscreen }),
  }))
)

// ─────────────────────────────────────────────────────────────────────────────
// Selectors
// ─────────────────────────────────────────────────────────────────────────────

export const selectIsPreviewOpen = (state: PreviewState) => state.isOpen
export const selectPreviewType = (state: PreviewState) => state.previewType
export const selectIsFullscreen = (state: PreviewState) => state.isFullscreen
