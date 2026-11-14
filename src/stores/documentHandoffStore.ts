import { create } from 'zustand'
import type { PromptAttachment } from '@/lib/prompt-attachments'

export interface DocumentContextHandoff {
  id: string
  mode: 'new' | 'existing'
  /** Target project for a new document (`null` = personal `My documents`), or the existing document's project. */
  projectId: string | null
  /** Target document id when `mode === 'existing'`. */
  documentId: string | null
  /** Suggested document title when `mode === 'new'`. */
  title: string
  /** What the user wants documented / accomplished. */
  prompt: string
  /** Attached reference context cards (`src/components/ai-elements/attachments.tsx` / `PromptAttachmentCard`). */
  attachments: PromptAttachment[]
  /** Start drafting immediately once the Document workspace and editor are ready. */
  autoSend: boolean
  /** Automatically write and save the completed draft into the page (`true` when creating a brand-new document). */
  autoApply?: boolean
}

interface DocumentHandoffState {
  pending: DocumentContextHandoff | null
  setHandoff: (handoff: DocumentContextHandoff) => void
  consumeHandoff: () => DocumentContextHandoff | null
  clearHandoff: () => void
}

export const useDocumentHandoffStore = create<DocumentHandoffState>((set, get) => ({
  pending: null,
  setHandoff: (handoff) => set({ pending: handoff }),
  consumeHandoff: () => {
    const current = get().pending
    if (current) set({ pending: null })
    return current
  },
  clearHandoff: () => set({ pending: null }),
}))

