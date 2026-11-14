/**
 * Ren's destinations, shared by the sidebar and the home page's environment dock so both open a
 * destination the same way. Home (the search page) and Discover render on `ron://home`, picked by the
 * persisted `activeTab`; Execute and Build have their own internal URLs; Documents is the library.
 */
import { Calendar, Columns3, Compass, FileText, Hammer, Home, Music2 } from 'lucide-react'
import { useNavigationStore, type HomeTab } from '@/stores/navigationStore'
import { documentsLibraryUrl } from '@/lib/project-documents'
import { openInternalUrl } from '@/components/board/task-detail/editor/extensions/blocks/workspace'

export interface Destination { id: HomeTab; label: string; icon: typeof Compass; hint: string }

export const DESTINATIONS: readonly Destination[] = [
  { id: 'home', label: 'Home', icon: Home, hint: 'Search and your favorites' },
  { id: 'discover', label: 'Discover', icon: Compass, hint: 'Stories from your interests' },
  { id: 'execute', label: 'Execute', icon: Columns3, hint: 'Projects and issues' },
  { id: 'documents', label: 'Documents', icon: FileText, hint: 'Your pages' },
  { id: 'calendar', label: 'Calendar', icon: Calendar, hint: 'Dates and schedule' },
  { id: 'vibe', label: 'Vibe', icon: Music2, hint: 'Talk with Ren' },
  { id: 'build', label: 'Build', icon: Hammer, hint: 'Build Agent workbench' },
]

/** Switch the active tab to a destination. */
export function openDestination(id: HomeTab) {
  useNavigationStore.getState().setActiveTab(id)
  openInternalUrl(id === 'execute' ? 'ron://execute' : id === 'documents' ? documentsLibraryUrl() : id === 'build' ? 'ron://build' : 'ron://home')
}
