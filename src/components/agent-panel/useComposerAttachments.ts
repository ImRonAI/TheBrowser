import { useCallback, useRef, useState, type ClipboardEvent } from 'react'
import { API_BASE_URL } from '@/lib/api-base'
import type { ContextItem } from '@/lib/chat-context'
import { contextItemAttachment, contextText } from '@/lib/context-attachments'
import {
  ATTACHMENT_TEXT_MAX, ATTACHMENTS_MAX, ATTACHMENTS_TOTAL_MAX, PASTED_PROMPT_INSTRUCTION, clipAttachmentText, isLongPaste,
  messageForPastedPrompt, requestPasteTitle, titleFromPastedText, uniqueAttachmentName, type PromptAttachment,
} from '@/lib/prompt-attachments'
import { useArticleDraftStore, type PastedDraft } from '@/stores/articleDraftStore'

const NO_PASTES: PastedDraft[] = []
const NUMBER = new Intl.NumberFormat('en-US')

/** A context item's text as last read for its preview; `version` changes when a re-read brings different text. */
export interface ContextPreview { text: string; version: number }

/**
 * The composer's prompt attachments (`src/lib/prompt-attachments.ts`):
 *
 * - a paste longer than 300 characters leaves the textarea and becomes a card at once (kept in the draft store, so
 *   it survives closing the panel), named from its text and renamed when `POST /attachments/title` answers;
 * - every item picked in the context menu or with `@` is a card whose text is read when its preview opens and
 *   again at send, unless the user edited it in the preview (then the edit is what is sent).
 *
 * `forSend` turns them into what `POST /chat` carries as `prompt_attachments`.
 */
export function useComposerAttachments(draftKey: string, userId: string) {
  const pasted = useArticleDraftStore((state) => state.drafts[draftKey]?.pasted ?? NO_PASTES)
  const [contexts, setContextState] = useState<ContextItem[]>([])
  const [edits, setEditState] = useState<Record<string, string>>({})
  const [previews, setPreviews] = useState<Record<string, ContextPreview>>({})
  const [naming, setNaming] = useState<ReadonlySet<string>>(() => new Set())
  const [notice, setNotice] = useState('')
  // Read by async work (a preview read, a send) that must see the latest selection and edits.
  const contextsRef = useRef(contexts)
  const editsRef = useRef(edits)
  const reading = useRef(new Set<string>())

  const writeEdits = useCallback((next: Record<string, string>) => { editsRef.current = next; setEditState(next) }, [])
  const pastesNow = useCallback(() => useArticleDraftStore.getState().drafts[draftKey]?.pasted ?? NO_PASTES, [draftKey])

  /** The picked items (the context menu's selection); at most `ATTACHMENTS_MAX` attachments in all. */
  const setContexts = useCallback((next: ContextItem[]) => {
    const room = Math.max(0, ATTACHMENTS_MAX - pastesNow().length)
    const kept = next.slice(0, room)
    setNotice(kept.length < next.length ? `One message carries at most ${ATTACHMENTS_MAX} attachments.` : '')
    const ids = new Set(kept.map((item) => item.id))
    contextsRef.current = kept
    setContextState(kept)
    writeEdits(Object.fromEntries(Object.entries(editsRef.current).filter(([id]) => ids.has(id))))
    setPreviews((all) => Object.keys(all).every((id) => ids.has(id)) ? all
      : Object.fromEntries(Object.entries(all).filter(([id]) => ids.has(id))))
  }, [pastesNow, writeEdits])
  const addContext = useCallback((item: ContextItem) => {
    if (!contextsRef.current.some((context) => context.id === item.id)) setContexts([...contextsRef.current, item])
  }, [setContexts])
  const removeContext = useCallback((id: string) => setContexts(contextsRef.current.filter((item) => item.id !== id)), [setContexts])
  const editContext = useCallback((id: string, text: string) => writeEdits({ ...editsRef.current, [id]: text }), [writeEdits])

  /** Reads an unedited item's text for its preview (each time it opens, so it shows the record as it is now). */
  const loadPreview = useCallback((item: ContextItem) => {
    if (editsRef.current[item.id] !== undefined || reading.current.has(item.id)) return
    reading.current.add(item.id)
    void contextText(item, userId)
      .catch((error: unknown) => `Could not load this ${item.type}: ${error instanceof Error ? error.message : String(error)}`)
      .then((text) => {
        reading.current.delete(item.id)
        if (editsRef.current[item.id] !== undefined || !contextsRef.current.some((context) => context.id === item.id)) return
        setPreviews((all) => all[item.id]?.text === text ? all : { ...all, [item.id]: { text, version: (all[item.id]?.version ?? 0) + 1 } })
      })
  }, [userId])

  /** A long paste becomes a card instead of text in the box; the box gets the instruction when it was empty. */
  const onPaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = event.clipboardData.getData('text/plain')
    if (!isLongPaste(text)) return
    event.preventDefault()
    const store = useArticleDraftStore.getState()
    const draft = store.drafts[draftKey]
    const existing = draft?.pasted ?? NO_PASTES
    if (existing.length + contextsRef.current.length >= ATTACHMENTS_MAX) {
      setNotice(`One message carries at most ${ATTACHMENTS_MAX} attachments. Remove one to attach this paste.`)
      return
    }
    const room = Math.min(ATTACHMENT_TEXT_MAX, ATTACHMENTS_TOTAL_MAX - existing.reduce((sum, item) => sum + item.text.length, 0))
    if (room <= 0) {
      setNotice(`These pastes already carry ${NUMBER.format(ATTACHMENTS_TOTAL_MAX)} characters, the most one message takes.`)
      return
    }
    const { text: kept, clipped, total } = clipAttachmentText(text, room)
    const id = `pasted-${crypto.randomUUID()}`
    store.addPasted(draftKey, { id, kind: 'pasted', text: kept, ...(clipped ? { clippedFrom: total } : {}),
      title: uniqueAttachmentName(titleFromPastedText(kept), existing.map((item) => item.title)) })
    if (!draft?.text.trim()) store.setText(draftKey, PASTED_PROMPT_INSTRUCTION)
    setNotice('')
    setNaming((current) => new Set(current).add(id))
    void requestPasteTitle(API_BASE_URL, kept).then((title) => {
      setNaming((current) => { const next = new Set(current); next.delete(id); return next })
      const latest = pastesNow()
      // Removed or already sent: nothing left to rename.
      if (!title || !latest.some((item) => item.id === id)) return
      useArticleDraftStore.getState().updatePasted(draftKey, id,
        { title: uniqueAttachmentName(title, latest.filter((item) => item.id !== id).map((item) => item.title)) })
    })
  }, [draftKey, pastesNow])

  const editPasted = useCallback((id: string, text: string) => useArticleDraftStore.getState().updatePasted(draftKey, id, { text }), [draftKey])
  /** Removing the last paste also clears the instruction it put in an otherwise empty box. */
  const removePasted = useCallback((id: string) => {
    const store = useArticleDraftStore.getState()
    store.removePasted(draftKey, id)
    const draft = useArticleDraftStore.getState().drafts[draftKey]
    if (!draft?.pasted.length && draft?.text.trim() === PASTED_PROMPT_INSTRUCTION) store.setText(draftKey, '')
    setNotice('')
  }, [draftKey, pastesNow])

  /** The attachments as `POST /chat` carries them: pastes as edited, then every picked item's text read now. */
  const forSend = useCallback(async (): Promise<PromptAttachment[]> => {
    const pastes = pastesNow().filter((item) => item.text.trim())
      .map((item): PromptAttachment => ({ id: item.id, kind: 'pasted', title: item.title, text: clipAttachmentText(item.text).text }))
    const picked = await Promise.all(contextsRef.current.map((item) => contextItemAttachment(item, userId, editsRef.current[item.id])))
    const all = [...pastes, ...picked]
    const total = all.reduce((sum, item) => sum + item.text.length, 0)
    if (total > ATTACHMENTS_TOTAL_MAX) {
      throw new Error(`These attachments carry ${NUMBER.format(total)} characters; one message takes at most ${NUMBER.format(ATTACHMENTS_TOTAL_MAX)}. Remove or shorten one.`)
    }
    return all
  }, [pastesNow, userId])

  /** After a send is accepted: drop what it carried (anything added meanwhile stays). */
  const clearContexts = useCallback((ids?: string[]) => {
    setContexts(ids ? contextsRef.current.filter((item) => !ids.includes(item.id)) : [])
  }, [setContexts])

  return {
    pasted, contexts, edits, previews, naming, notice, count: pasted.length + contexts.length,
    setContexts, addContext, removeContext, editContext, loadPreview, onPaste, editPasted, removePasted, forSend, clearContexts,
    /** The message text: the typed text, with the pasted-prompt instruction while a paste is attached. */
    messageFor: (input: string) => messageForPastedPrompt(input, pasted.length > 0),
  }
}

export type ComposerAttachmentsState = ReturnType<typeof useComposerAttachments>
