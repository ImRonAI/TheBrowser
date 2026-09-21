import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { AgentDestination, ArticleAttachment } from '@/lib/articles'

interface Draft { text: string; articles: ArticleAttachment[] }
interface ArticleDraftState {
  drafts: Record<string, Draft>
  activeDestination: AgentDestination
  setDestination: (destination: AgentDestination) => void
  setText: (key: string, text: string) => void
  attach: (key: string, article: ArticleAttachment) => boolean
  remove: (key: string, id: string) => void
  clearSent: (key: string, text: string, ids: string[]) => void
}
export const EMPTY_ARTICLE_DRAFT: Draft = { text: '', articles: [] }
export const articleDraftKey = (user: string, destination: AgentDestination) => `${user}:${destination}`

export const useArticleDraftStore = create<ArticleDraftState>()(persist((set, get) => ({
  drafts: {}, activeDestination: 'panel',
  setDestination: (activeDestination) => set({ activeDestination }),
  setText: (key, text) => set((state) => ({ drafts: { ...state.drafts,
    [key]: { ...(state.drafts[key] || EMPTY_ARTICLE_DRAFT), text } } })),
  attach: (key, article) => {
    const draft = get().drafts[key] || EMPTY_ARTICLE_DRAFT
    const articles = draft.articles.filter((item) => item.url !== article.url)
    if (articles.length >= 3) return false
    set((state) => ({ drafts: { ...state.drafts, [key]: { ...draft, articles: [...articles, article] } } }))
    return true
  },
  remove: (key, id) => set((state) => ({ drafts: { ...state.drafts,
    [key]: { ...(state.drafts[key] || EMPTY_ARTICLE_DRAFT), articles: (state.drafts[key]?.articles || []).filter((article) => article.id !== id) } } })),
  clearSent: (key, text, ids) => set((state) => {
    const draft = state.drafts[key] || EMPTY_ARTICLE_DRAFT
    return { drafts: { ...state.drafts, [key]: { text: draft.text === text ? '' : draft.text,
      articles: draft.articles.filter((article) => !ids.includes(article.id)) } } }
  }),
}), { name: 'ron-article-drafts', storage: createJSONStorage(() => sessionStorage), version: 1 }))