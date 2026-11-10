import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import type { AgentDestination, ArticleAttachment } from '@/lib/articles'
import type { PromptAttachment } from '@/lib/prompt-attachments'

/** A paste that became an attachment card; `clippedFrom` is the paste's full length when it was cut. */
export type PastedDraft = PromptAttachment & { kind: 'pasted'; clippedFrom?: number }
interface Draft { text: string; articles: ArticleAttachment[]; pasted: PastedDraft[] }
interface ArticleDraftState {
  drafts: Record<string, Draft>
  activeDestination: AgentDestination
  setDestination: (destination: AgentDestination) => void
  setText: (key: string, text: string) => void
  attach: (key: string, article: ArticleAttachment) => boolean
  remove: (key: string, id: string) => void
  addPasted: (key: string, pasted: PastedDraft) => void
  /** Changes one paste (its edited text, or the title model's name); a paste removed meanwhile stays removed. */
  updatePasted: (key: string, id: string, update: Partial<Pick<PastedDraft, 'title' | 'text'>>) => void
  removePasted: (key: string, id: string) => void
  /** What a new chat starts without: the typed text and the pastes. */
  resetComposer: (key: string) => void
  clearSent: (key: string, text: string, ids: string[]) => void
}
export const EMPTY_ARTICLE_DRAFT: Draft = { text: '', articles: [], pasted: [] }
/** `scope` separates drafts of one destination per subject (an issue chat's draft per issue). */
export const articleDraftKey = (user: string, destination: AgentDestination, scope?: string) =>
  scope ? `${user}:${destination}:${scope}` : `${user}:${destination}`

const draftOf = (drafts: Record<string, Draft>, key: string): Draft => ({ ...EMPTY_ARTICLE_DRAFT, ...drafts[key] })

/** Session storage that never throws: a draft too large for the quota stays in memory for this session. */
const sessionDrafts: StateStorage = {
  getItem: (name) => { try { return sessionStorage.getItem(name) } catch { return null } },
  setItem: (name, value) => {
    try { sessionStorage.setItem(name, value) } catch (error) { console.warn('Draft not saved to session storage', error) }
  },
  removeItem: (name) => { try { sessionStorage.removeItem(name) } catch { /* storage unavailable */ } },
}

export const useArticleDraftStore = create<ArticleDraftState>()(persist((set, get) => ({
  drafts: {}, activeDestination: 'panel',
  setDestination: (activeDestination) => set({ activeDestination }),
  setText: (key, text) => set((state) => ({ drafts: { ...state.drafts, [key]: { ...draftOf(state.drafts, key), text } } })),
  attach: (key, article) => {
    const draft = draftOf(get().drafts, key)
    const articles = draft.articles.filter((item) => item.url !== article.url)
    if (articles.length >= 3) return false
    set((state) => ({ drafts: { ...state.drafts, [key]: { ...draft, articles: [...articles, article] } } }))
    return true
  },
  remove: (key, id) => set((state) => {
    const draft = draftOf(state.drafts, key)
    return { drafts: { ...state.drafts, [key]: { ...draft, articles: draft.articles.filter((article) => article.id !== id) } } }
  }),
  addPasted: (key, pasted) => set((state) => {
    const draft = draftOf(state.drafts, key)
    return { drafts: { ...state.drafts, [key]: { ...draft, pasted: [...draft.pasted, pasted] } } }
  }),
  updatePasted: (key, id, update) => set((state) => {
    const draft = draftOf(state.drafts, key)
    if (!draft.pasted.some((item) => item.id === id)) return state
    return { drafts: { ...state.drafts, [key]: { ...draft, pasted: draft.pasted.map((item) => item.id === id ? { ...item, ...update } : item) } } }
  }),
  removePasted: (key, id) => set((state) => {
    const draft = draftOf(state.drafts, key)
    return { drafts: { ...state.drafts, [key]: { ...draft, pasted: draft.pasted.filter((item) => item.id !== id) } } }
  }),
  resetComposer: (key) => set((state) => ({ drafts: { ...state.drafts, [key]: { ...draftOf(state.drafts, key), text: '', pasted: [] } } })),
  clearSent: (key, text, ids) => set((state) => {
    const draft = draftOf(state.drafts, key)
    return { drafts: { ...state.drafts, [key]: { text: draft.text === text ? '' : draft.text,
      articles: draft.articles.filter((article) => !ids.includes(article.id)),
      pasted: draft.pasted.filter((item) => !ids.includes(item.id)) } } }
  }),
}), {
  name: 'ron-article-drafts', storage: createJSONStorage(() => sessionDrafts), version: 2,
  // v1 drafts had no pastes.
  migrate: (persisted, version) => {
    const state = persisted as { drafts?: Record<string, Partial<Draft>> } | undefined
    if (version < 2 && state?.drafts) {
      for (const key of Object.keys(state.drafts)) state.drafts[key] = { ...EMPTY_ARTICLE_DRAFT, ...state.drafts[key] }
    }
    return state as ArticleDraftState
  },
}))
