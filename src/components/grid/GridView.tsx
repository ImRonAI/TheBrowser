/**
 * A spreadsheet in a page: what its sheets show, and the spreadsheet itself over the whole screen once it is opened
 * (`engine.ts`, which loads then). Documents' grid block and a Squad DataGrid run's page both draw it.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { IWorkbookData } from '@univerjs/core'
import { Download, Loader2, Maximize2, Sheet } from 'lucide-react'
import { BlockHeader } from '@/components/board/task-detail/editor/extensions/blocks/ui'
import { Button } from '@/components/ui/button'
import { gridDisplay, gridWorkbook, readGrid, sheetCsv, type GridValue } from '@/lib/grid'
import { documentErrorMessage, exportGrid, saveExported, saveFile } from '@/lib/project-documents'
import { cn } from '@/lib/utils'
import { getProjectsState, projectsRequestFor } from '@/stores/projectsStore'
import type { GridEngine, GridReading } from './engine'

/** The rows a page shows of a sheet, its header among them; the rest are in the open spreadsheet. */
const PREVIEW_ROWS = 9

/** A cell that reads as a number, a date or an amount sits right, as a spreadsheet sets it. */
const numeric = (shown: string | undefined) => !!shown && /\d/.test(shown) && !/[a-z]/i.test(shown)

/** One spreadsheet at a time calculates off screen. */
let calculating: Promise<unknown> = Promise.resolve()

/** `workbook` once its formulas have calculated, read from a spreadsheet opened off screen. */
function calculate(workbook: Partial<IWorkbookData>): Promise<GridReading> {
  const reading = calculating.then(async () => {
    const { openGrid } = await import('./engine')
    const host = document.createElement('div')
    host.inert = true
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:600px'
    document.body.appendChild(host)
    let engine: GridEngine | null = null
    try {
      engine = openGrid(host, workbook, false)
      return await engine.read()
    } finally {
      engine?.dispose()
      host.remove()
    }
  })
  calculating = reading.catch(() => undefined)
  return reading
}

export function GridView({ value, editable, onChange, children }: {
  value: GridValue
  /** Whether the open spreadsheet can be changed. */
  editable: boolean
  /** The grid once a spreadsheet has calculated it, and after each change made in the open spreadsheet (`edited`). */
  onChange?: ((value: GridValue, edited: boolean) => void) | undefined
  /** The block's own actions, beside the title. */
  children?: ReactNode
}) {
  const [current, setCurrent] = useState(value)
  useEffect(() => setCurrent(value), [value])
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState(0)
  const changed = useRef(onChange)
  changed.current = onChange

  // A grid as an agent wrote it shows as written until a spreadsheet has calculated it: formulas as their results,
  // numbers in their formats.
  useEffect(() => {
    if (current.display) return undefined
    let stale = false
    calculate(gridWorkbook(current.grid)).then((reading) => {
      if (stale) return
      const next = { ...current, display: readGrid(current.grid.title, reading.sheets).display }
      setCurrent(next)
      changed.current?.(next, false)
    }, () => undefined)
    return () => { stale = true }
  }, [current])

  const sheets = current.display ?? gridDisplay(current.grid)
  const sheet = sheets[Math.min(tab, sheets.length - 1)]
  const rows = sheet?.rows ?? []
  const shown = rows.slice(0, PREVIEW_ROWS)
  const more = rows.length - PREVIEW_ROWS
  // A header sits with its column's first cell.
  const right = (rows[1] ?? []).map(numeric)
  // The open spreadsheet is a step in the tab's history, so Back closes it.
  const show = () => {
    window.history.pushState(null, '')
    setOpen(true)
  }

  return <>
    <BlockHeader icon={<Sheet className="size-4" />} title={current.grid.title}
      subtitle={`${sheets.length === 1 ? '' : `${sheets.length} sheets · `}${Math.max(0, rows.length - 1)} ${rows.length === 2 ? 'row' : 'rows'}`}>
      {children}
    </BlockHeader>
    {sheets.length > 1 && (
      <div role="tablist" aria-label="Sheets" className="flex gap-1 overflow-x-auto border-b border-surface-200 px-2 py-1.5 scrollbar-none dark:border-surface-800">
        {sheets.map((sheet, index) => (
          <button key={sheet.name} type="button" role="tab" aria-selected={index === tab} onClick={() => setTab(index)}
            className={cn('h-7 shrink-0 rounded-md px-2.5 text-[12px] font-medium transition-colors duration-150',
              index === tab
                ? 'bg-surface-100 text-ink dark:bg-surface-800 dark:text-ink-inverse'
                : 'text-ink-muted hover:text-ink dark:text-ink-inverse-muted dark:hover:text-ink-inverse')}>
            {sheet.name}
          </button>
        ))}
      </div>
    )}
    <div className="cursor-pointer overflow-x-auto scrollbar-thin" onClick={show}>
      {rows.length > 0
        ? (
          // A grid of its own, not a <table>: inside the editor a table takes the editor's table styles.
          <div role="table" aria-label={sheet?.name} className="grid w-max min-w-full text-[12.5px] leading-5 tabular-nums"
            style={{ gridTemplateColumns: `repeat(${rows[0]?.length ?? 0}, auto)` }}>
            {shown.map((row, r) => (
              <div key={r} role="row" className="contents">
                {row.map((cell, c) => (
                  <div key={c} role={r === 0 ? 'columnheader' : 'cell'}
                    className={cn('min-h-8 max-w-60 truncate px-3 py-1.5', r < shown.length - 1 && 'border-b border-surface-200 dark:border-surface-800',
                      (r === 0 ? right[c] : numeric(cell)) ? 'text-right' : 'text-left',
                      r === 0 ? 'font-semibold text-ink dark:text-ink-inverse' : 'text-ink-secondary dark:text-ink-inverse-secondary')}>
                    {cell}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )
        : <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">This sheet is empty.</p>}
    </div>
    <div className="flex items-center justify-between gap-2 border-t border-surface-200 px-3 py-1.5 dark:border-surface-800">
      <p className="truncate text-[12px] text-muted-foreground">{more > 0 ? `${more} more ${more === 1 ? 'row' : 'rows'}` : ''}</p>
      <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 gap-1.5 rounded-full" onClick={show}>
        <Maximize2 className="!size-3.5" />Open spreadsheet
      </Button>
    </div>
    {open && (
      <OpenGrid value={current} editable={editable} onClose={(reading, title) => {
        setOpen(false)
        if (!reading) return
        const { grid, display } = readGrid(title, reading.sheets)
        const next = { grid, display, workbook: reading.workbook }
        setCurrent(next)
        changed.current?.(next, true)
      }} />
    )}
  </>
}

/**
 * The spreadsheet over the whole screen, under Univer's own menus (its z-indexes start at 1001). Done and Back both
 * close it; an editable one then answers what it holds and the title it was given.
 */
function OpenGrid({ value, editable, onClose }: {
  value: GridValue
  editable: boolean
  onClose: (reading: GridReading | null, title: string) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const engine = useRef<GridEngine | null>(null)
  const [title, setTitle] = useState(value.grid.title)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState<'csv' | 'xlsx' | 'closing' | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let closed = false
    import('./engine').then(({ openGrid }) => {
      if (closed || !host.current) return
      engine.current = openGrid(host.current, value.workbook ?? gridWorkbook(value.grid, value.display), editable)
      setReady(true)
    }).catch(() => setError('The spreadsheet could not open.'))
    return () => {
      closed = true
      const opened = engine.current
      engine.current = null
      // Univer unmounts a React root of its own, which React refuses while it is rendering this one.
      if (opened) queueMicrotask(() => opened.dispose())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opened once, on what the grid held then
  }, [])

  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const back = () => {
      const opened = engine.current
      if (!editable || !opened) return close.current(null, title)
      setBusy('closing')
      opened.read().then((reading) => close.current(reading, title), () => {
        // What the spreadsheet holds is not in the page yet, so it stays open.
        window.history.pushState(null, '')
        setBusy(null)
        setError('The spreadsheet could not be saved to the page.')
      })
    }
    window.addEventListener('popstate', back)
    return () => window.removeEventListener('popstate', back)
  }, [editable, title])

  const download = async (format: 'csv' | 'xlsx') => {
    const opened = engine.current
    if (!opened) return
    setBusy(format)
    setError('')
    try {
      const reading = await opened.read()
      const { grid, values, display } = readGrid(title, reading.sheets)
      const sheet = display[reading.active]
      if (format === 'csv') {
        saveFile(`${display.length > 1 && sheet ? `${grid.title} - ${sheet.name}` : grid.title}.csv`,
          // The byte order mark tells Excel the file is UTF-8.
          new Blob(['﻿', sheetCsv(sheet?.rows ?? [])], { type: 'text/csv;charset=utf-8' }))
      } else {
        const userId = getProjectsState().userId
        if (!userId) throw new Error()
        saveExported(await exportGrid(projectsRequestFor(userId), grid, values))
      }
    } catch (err) {
      setError(documentErrorMessage(err, 'The spreadsheet could not be downloaded.'))
    } finally {
      setBusy(null)
    }
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title}
      className="fixed inset-0 z-[1000] flex flex-col bg-surface-0 font-sans text-ink dark:bg-surface-900 dark:text-ink-inverse">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-surface-200 px-2 dark:border-surface-800">
        {editable
          ? <input aria-label="Spreadsheet title" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)}
              className="min-w-0 flex-1 truncate rounded-md bg-transparent px-1.5 py-1 text-sm font-semibold outline-none focus:bg-surface-100 dark:focus:bg-surface-800" />
          : <p className="min-w-0 flex-1 truncate px-1.5 text-sm font-semibold">{title}</p>}
        {error && <p role="alert" className="min-w-0 truncate text-[12px] text-red-600 dark:text-red-400">{error}</p>}
        {(['csv', 'xlsx'] as const).map((format) => (
          <Button key={format} type="button" size="sm" variant="ghost" className="h-8 gap-1.5 rounded-full px-2.5"
            disabled={!ready || busy !== null} onClick={() => void download(format)}
            title={format === 'csv' ? 'Download the sheet in view as CSV' : 'Download every sheet as an Excel file, formulas included'}>
            {busy === format ? <Loader2 className="animate-spin" /> : <Download />}{format === 'csv' ? 'CSV' : 'Excel'}
          </Button>
        ))}
        <Button type="button" size="sm" className="h-8 rounded-full" disabled={busy !== null} onClick={() => window.history.back()}>
          {busy === 'closing' ? <Loader2 className="animate-spin" /> : null}{editable ? 'Done' : 'Close'}
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={host} className="absolute inset-0" />
        {!ready && !error && <Loader2 className="absolute left-1/2 top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>
    </div>,
    document.body,
  )
}
