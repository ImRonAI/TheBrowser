import { Button } from '@/components/ui/button'

const httpsUrl = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : undefined } catch { return undefined }
}

export function IssueWorkProducts({ products }: { products: Record<string, unknown>[] }) {
  return <section className="space-y-3"><h3 className="font-semibold">Attachments & work products</h3>
    {!products.length && <p className="text-sm text-ink-muted">No saved work products.</p>}
    {products.map((product, index) => {
      const title = typeof product.title === 'string' ? product.title : `Attachment ${index + 1}`
      const content = typeof product.content === 'string' ? product.content : JSON.stringify(product, null, 2)
      const url = httpsUrl(product.url)
      const images = Array.isArray(product.images) ? product.images : []
      return <details key={typeof product.id === 'string' ? product.id : index} className="rounded-xl border border-surface-200 dark:border-surface-800 p-3">
        <summary className="cursor-pointer break-words font-medium">{title}</summary>
        <div className="mt-3 space-y-3">
          {url && <a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-indigo-500">Open source</a>}
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{content}</pre>
          {images.map((image, imageIndex) => {
            const src = httpsUrl(typeof image === 'string' ? image : image?.url)
            return src ? <details key={imageIndex} className="rounded-lg border border-surface-200 p-2"><summary className="cursor-pointer text-sm">Image preview {imageIndex + 1}</summary><img src={src} alt={`${title} — image ${imageIndex + 1}`} loading="lazy" referrerPolicy="no-referrer" className="mt-2 max-h-64 max-w-full rounded object-contain" /></details> : null
          })}
          <Button type="button" variant="outline" size="sm" onClick={() => {
            const href = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
            const anchor = document.createElement('a'); anchor.href = href
            anchor.download = `${title.replace(/[^a-z0-9._-]/gi, '_').slice(0, 100)}.txt`
            anchor.click(); setTimeout(() => URL.revokeObjectURL(href), 1000)
          }}>Download saved content</Button>
        </div>
      </details>
    })}
  </section>
}