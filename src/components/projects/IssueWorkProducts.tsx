import { ArrowUpRight, ChevronRight, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

const SUMMARY = 'flex cursor-pointer list-none items-center gap-2 break-words focus-visible:outline-none [&::-webkit-details-marker]:hidden'

const httpsUrl = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : undefined } catch { return undefined }
}

export function IssueWorkProducts({ products }: { products: Record<string, unknown>[] }) {
  return <section className="space-y-3"><h3 className="font-display text-lg font-bold leading-tight tracking-tight text-ink dark:text-ink-inverse">Attachments & work products</h3>
    {!products.length && <p className="text-[13px] text-ink-muted dark:text-ink-inverse-muted">No saved work products yet.</p>}
    {products.map((product, index) => {
      const title = typeof product.title === 'string' ? product.title : `Attachment ${index + 1}`
      const content = typeof product.content === 'string' ? product.content : JSON.stringify(product, null, 2)
      const url = httpsUrl(product.url)
      const images = Array.isArray(product.images) ? product.images : []
      return <details key={typeof product.id === 'string' ? product.id : index} className="group/product rounded-xl border border-surface-200 text-ink transition-colors duration-150 open:border-surface-300 hover:border-surface-300 dark:border-surface-800 dark:text-ink-inverse dark:open:border-surface-700 dark:hover:border-surface-700">
        <summary className={`${SUMMARY} rounded-xl px-3.5 py-2.5 text-[13.5px] font-semibold focus-visible:ring-2 focus-visible:ring-blurple-600/70 dark:focus-visible:ring-blurple-400/70`}>
          <ChevronRight className="size-3.5 shrink-0 text-ink-muted transition-transform duration-150 group-open/product:rotate-90 dark:text-ink-inverse-muted" aria-hidden />
          <span className="min-w-0 break-words">{title}</span>
        </summary>
        <div className="space-y-3 border-t border-surface-200 px-3.5 pb-3.5 pt-3 dark:border-surface-800">
          {url && <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all text-[12.5px] font-medium text-blurple-600 underline-offset-2 hover:text-blurple-700 hover:underline dark:text-blurple-400 dark:hover:text-blurple-300">Open source<ArrowUpRight className="size-3 shrink-0" /></a>}
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-100/70 p-3 font-mono text-[12px] leading-relaxed text-ink-secondary dark:bg-surface-850 dark:text-ink-inverse-secondary">{content}</pre>
          {images.map((image, imageIndex) => {
            const src = httpsUrl(typeof image === 'string' ? image : image?.url)
            return src ? <details key={imageIndex} className="group/image rounded-lg border border-surface-200 dark:border-surface-800"><summary className={`${SUMMARY} rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-ink-secondary focus-visible:ring-2 focus-visible:ring-blurple-600/70 dark:text-ink-inverse-secondary dark:focus-visible:ring-blurple-400/70`}><ChevronRight className="size-3 shrink-0 transition-transform duration-150 group-open/image:rotate-90" aria-hidden />Image preview {imageIndex + 1}</summary><img src={src} alt={`${title} — image ${imageIndex + 1}`} loading="lazy" referrerPolicy="no-referrer" className="mx-2.5 mb-2.5 mt-1 max-h-64 max-w-[calc(100%-1.25rem)] rounded-md object-contain" /></details> : null
          })}
          <Button type="button" variant="outline" size="sm"
            className="h-8 gap-1.5 rounded-lg border-surface-200 bg-surface-0 px-3 text-[13px] font-semibold text-ink shadow-none transition-colors duration-150 ease-out hover:bg-surface-50 hover:text-ink dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse dark:hover:bg-surface-850 dark:hover:text-ink-inverse [&_svg]:size-3.5"
            onClick={() => {
            const href = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
            const anchor = document.createElement('a'); anchor.href = href
            anchor.download = `${title.replace(/[^a-z0-9._-]/gi, '_').slice(0, 100)}.txt`
            anchor.click(); setTimeout(() => URL.revokeObjectURL(href), 1000)
          }}><Download aria-hidden />Download saved content</Button>
        </div>
      </details>
    })}
  </section>
}