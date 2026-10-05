/**
 * Open a search result. Results always open in a NEW browser tab so the results
 * page itself stays alive; falls back to navigating the current tab outside Electron.
 */
export function openResult(url: string): void {
  if (!url) return
  if (typeof window === 'undefined') return
  const electron = window.electron
  if (electron?.tabs?.create) {
    void electron.tabs.create(url)
    return
  }
  if (electron?.browser?.navigate) {
    void electron.browser.navigate(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
