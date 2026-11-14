/**
 * Context attached to a search on the home page, handed to the results page.
 *
 * `ron://search` carries only `q`, `level` and, when context is attached, `ctx=<id>`: the attachments
 * themselves (up to 400k characters, `ATTACHMENTS_TOTAL_MAX`) are too large for a URL, so they are kept
 * here under that id and sent as `prompt_attachments` with `POST /search/stream`. Kept in sessionStorage,
 * so a reload of the results tab still finds them; the newest `MAX_ENTRIES` searches are kept.
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { PromptAttachment } from '@/lib/prompt-attachments'

const MAX_ENTRIES = 8

interface SearchAttachmentsState {
  entries: Record<string, { attachments: PromptAttachment[]; at: number }>
  /** Store a search's attachments and return the id its URL carries. */
  save: (attachments: PromptAttachment[]) => string
}

export const useSearchAttachmentsStore = create<SearchAttachmentsState>()(
  persist(
    (set) => ({
      entries: {},
      save: (attachments) => {
        const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
        set((state) => {
          const kept = Object.entries(state.entries).sort(([, a], [, b]) => b.at - a.at).slice(0, MAX_ENTRIES - 1)
          return { entries: { ...Object.fromEntries(kept), [id]: { attachments, at: Date.now() } } }
        })
        return id
      },
    }),
    { name: 'ron-search-attachments', storage: createJSONStorage(() => sessionStorage), version: 1 },
  ),
)

/** The attachments saved under `id`; `null` when the id is unknown (another window, or dropped as old). */
export function searchAttachments(id: string): PromptAttachment[] | null {
  return useSearchAttachmentsStore.getState().entries[id]?.attachments ?? null
}
