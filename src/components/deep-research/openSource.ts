/**
 * Open a research source URL in a new browser tab so the Deep Research workbench stays mounted.
 * Uses `window.electron.tabs.create` in the desktop shell and falls back to `window.open`.
 */
export function openSourceInNewTab(url: string): void {
  if (!url || typeof window === 'undefined') return
  const trimmed = url.trim()
  if (!trimmed) return
  if (window.electron?.tabs?.create) {
    void window.electron.tabs.create(trimmed)
    return
  }
  window.open(trimmed, '_blank', 'noopener,noreferrer')
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return url
  }
}

