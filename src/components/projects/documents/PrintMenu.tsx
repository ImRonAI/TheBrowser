import { useState } from 'react'
import { ChevronDown, FileCode2, FileText, FileType2, Loader2, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { documentErrorMessage, exportDocument, type DocumentExportFormat, type ExportedDocument } from '@/lib/project-documents'
import type { ProjectsRequest } from '@/lib/projects-api'
import { cn } from '@/lib/utils'

const FORMATS = [
  { id: 'pdf', label: 'Print to PDF', icon: FileText },
  { id: 'html', label: 'Print to HTML', icon: FileCode2 },
  { id: 'docx', label: 'Print to Doc', icon: FileType2 },
] as const satisfies readonly { id: DocumentExportFormat; label: string; icon: typeof FileText }[]

const menu = 'z-[120] min-w-[190px] rounded-xl border-surface-200 bg-surface-0 p-1.5 shadow-medium dark:border-surface-700 dark:bg-surface-850 dark:shadow-dark-medium'
const menuItem = 'gap-2.5 rounded-lg px-2.5 py-2 text-ink focus:bg-surface-100 dark:text-ink-inverse dark:focus:bg-surface-800'

function download(file: ExportedDocument) {
  const bytes = Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: file.media_type }))
  const link = document.createElement('a')
  link.href = url
  link.download = file.filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Print the open page as a PDF, an HTML page or a Word document. `pageId` saves pending edits first and answers the
 * saved page's id, so the file is the page as it reads now.
 */
export function PrintMenu({ request, pageId, disabled }: {
  request: ProjectsRequest | null
  pageId: () => Promise<string | null>
  disabled?: boolean
}) {
  const [printing, setPrinting] = useState<DocumentExportFormat | null>(null)
  const [error, setError] = useState('')

  const print = async (format: DocumentExportFormat) => {
    if (!request) return
    setPrinting(format)
    setError('')
    try {
      const id = await pageId()
      if (id) download(await exportDocument(request, id, format))
    } catch (err) {
      setError(documentErrorMessage(err, 'The page could not be printed.'))
    } finally {
      setPrinting(null)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="ghost" disabled={disabled || !request || printing !== null}
          className={cn('h-8 gap-1.5 rounded-full text-ink-muted', error && 'text-danger')}
          title={error || 'Print this page to PDF, HTML or Word'} aria-label="Print page">
          {printing ? <Loader2 className="animate-spin" /> : <Printer />}Print<ChevronDown className="!size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={menu}>
        {FORMATS.map((item) => (
          <DropdownMenuItem key={item.id} className={menuItem} onSelect={() => void print(item.id)}>
            <item.icon />{item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
