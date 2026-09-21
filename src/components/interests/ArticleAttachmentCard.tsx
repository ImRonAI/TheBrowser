import { FileText, X } from 'lucide-react'
import type { ArticleAttachment } from '@/lib/articles'

export function ArticleAttachmentCard({ article, onRemove }: { article: ArticleAttachment; onRemove?: () => void }) {
  return <div className="relative my-2 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 text-ink dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-ink-inverse">
    {onRemove && <button type="button" aria-label={`Remove ${article.title}`} onClick={onRemove}
      className="absolute right-2 top-2 rounded p-1 hover:bg-indigo-100 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-indigo-900"><X size={14} /></button>}
    <details>
      <summary className="cursor-pointer list-none pr-6 focus-visible:outline-indigo-500">
        <span className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-300"><FileText size={13} />{article.status === 'preview' ? 'Preview only' : 'Article text'}</span>
        <span className="block text-sm font-medium leading-snug">{article.title}</span>
        <span className="mt-1 block text-xs opacity-60">{article.source} · {article.text.split(/\s+/).length.toLocaleString()} words · Inspect</span>
      </summary>
      <div className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap break-words border-t border-indigo-200 pt-3 text-xs leading-relaxed dark:border-indigo-800">{article.text}</div>
      <a href={article.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs underline">Open original source ↗</a>
    </details>
  </div>
}