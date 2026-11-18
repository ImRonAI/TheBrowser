import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { openInternalUrl } from '@/components/board/task-detail/editor/extensions/blocks/workspace'
import { useTabStore } from '@/stores/tabStore'

export interface TabPaneContextValue {
  tabId: string | null
  url: string | null
  isSplitPane: boolean
}

const TabPaneContext = createContext<TabPaneContextValue>({
  tabId: null,
  url: null,
  isSplitPane: false,
})

export function TabPaneProvider({
  tabId,
  url,
  isSplitPane,
  children,
}: {
  tabId: string | null
  url: string | null
  isSplitPane: boolean
  children: ReactNode
}) {
  const value = useMemo<TabPaneContextValue>(
    () => ({ tabId, url, isSplitPane }),
    [tabId, url, isSplitPane],
  )
  return <TabPaneContext.Provider value={value}>{children}</TabPaneContext.Provider>
}

export function useTabPane(): TabPaneContextValue {
  return useContext(TabPaneContext)
}

/**
 * Navigate a specific `tabId` (when mounted inside a split pane) without clobbering
 * whichever sibling pane currently holds focus, falling back to `openInternalUrl(url)`.
 */
export function navigateTabByIdOrActive(tabId: string | null | undefined, url: string): void {
  if (tabId) {
    const navigateTab = typeof window !== 'undefined' ? window.electron?.tabs?.navigateTab : undefined
    if (navigateTab) {
      void navigateTab(tabId, url)
      return
    }
    useTabStore.getState().updateTab(tabId, { url })
    return
  }
  openInternalUrl(url)
}
