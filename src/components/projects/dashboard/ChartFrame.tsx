import { useId, useState, type ReactNode } from 'react'
import { Info, Table2, LineChart as LineChartIcon } from 'lucide-react'
import { cn } from '@/utils/cn'

export interface LegendEntry { label: string; color: string; mark?: 'rect' | 'line' | 'dot'; value?: string }

/** Legend that mirrors the mark (rect for areas and bars, line for lines, dot for points); text in ink, never the series color. */
export function Legend({ entries }: { entries: LegendEntry[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-body-xs text-ink-secondary dark:text-ink-inverse-secondary">
      {entries.map((entry) => (
        <li key={entry.label} className="flex items-center gap-1.5">
          <span aria-hidden className={cn('inline-block shrink-0',
            entry.mark === 'line' ? 'h-0.5 w-3.5 rounded-full' : entry.mark === 'dot' ? 'size-2 rounded-full' : 'size-2.5 rounded-[3px]')}
            style={{ background: entry.color }} />
          <span>{entry.label}</span>
          {entry.value !== undefined && <span className="font-semibold text-ink dark:text-ink-inverse tabular-nums">{entry.value}</span>}
        </li>
      ))}
    </ul>
  )
}

export interface TooltipRow { label: string; value: string; color?: string; mark?: 'line' | 'dot' }

/** One readout for every series at the hovered position: values lead, labels follow, line keys. */
export function TooltipCard({ title, rows, note }: { title: string; rows: TooltipRow[]; note?: string }) {
  return (
    <div role="status" aria-live="assertive"
      className="min-w-[10rem] max-w-[16rem] rounded-xl border border-black/10 dark:border-white/10 bg-surface-0/95 dark:bg-surface-850/95 px-3 py-2 shadow-soft backdrop-blur">
      <p className="text-[11px] font-medium text-ink-muted dark:text-ink-inverse-muted">{title}</p>
      <ul className="mt-1 space-y-0.5">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-2 text-body-xs">
            {row.color && <span aria-hidden className={row.mark === 'dot' ? 'size-2 rounded-full' : 'h-0.5 w-3 rounded-full'} style={{ background: row.color }} />}
            <span className="font-semibold tabular-nums text-ink dark:text-ink-inverse">{row.value}</span>
            <span className="truncate text-ink-secondary dark:text-ink-inverse-secondary">{row.label}</span>
          </li>
        ))}
      </ul>
      {note && <p className="mt-1 text-[11px] text-ink-muted dark:text-ink-inverse-muted">{note}</p>}
    </div>
  )
}

export interface ChartTable { caption: string; columns: string[]; rows: ReactNode[][] }

/**
 * A chart card: what it answers, the takeaway (also its accessible description),
 * the chart or its table twin, and a one-line "how to read this".
 */
export function ChartCard({ title, question, takeaway, howToRead, legend, empty, table, className, children }: {
  title: string
  question: string
  takeaway: string
  howToRead: string
  legend?: ReactNode
  /** What data is missing; replaces the chart when set. */
  empty?: string | null
  table: ChartTable
  className?: string
  children: ReactNode
}) {
  const [showTable, setShowTable] = useState(false)
  const id = useId()
  return (
    <section aria-labelledby={`${id}-title`} className={cn('min-w-0 rounded-3xl glass-card border border-white/10 p-4 sm:p-5 shadow-soft flex flex-col gap-3', className)}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="text-body-sm font-semibold text-ink dark:text-ink-inverse">{title}</h3>
          <p className="mt-0.5 text-body-xs text-ink-muted dark:text-ink-inverse-muted">{question}</p>
        </div>
        {!empty && (
          <button type="button" onClick={() => setShowTable((value) => !value)} aria-pressed={showTable}
            className="shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-ink-muted dark:text-ink-inverse-muted glass-subtle border border-black/5 dark:border-white/10 hover:text-ink dark:hover:text-ink-inverse transition-colors">
            {showTable ? <LineChartIcon className="size-3.5" /> : <Table2 className="size-3.5" />}
            {showTable ? 'Chart' : 'Table'}
          </button>
        )}
      </header>
      {empty ? (
        <div className="flex min-h-[10rem] flex-1 items-center justify-center rounded-2xl border border-dashed border-black/10 dark:border-white/10 px-4 py-6 text-center">
          <p className="max-w-xs text-body-xs text-ink-muted dark:text-ink-inverse-muted">{empty}</p>
        </div>
      ) : (
        <>
          <p id={`${id}-takeaway`} className="text-body-sm text-ink dark:text-ink-inverse">{takeaway}</p>
          {showTable ? (
            <div className="max-h-[17rem] overflow-auto rounded-xl border border-black/5 dark:border-white/10">
              <table className="w-full text-left text-body-xs">
                <caption className="sr-only">{table.caption}</caption>
                <thead className="sticky top-0 bg-surface-50 dark:bg-surface-800">
                  <tr>{table.columns.map((column) => <th key={column} scope="col" className="px-3 py-2 font-semibold text-ink-secondary dark:text-ink-inverse-secondary">{column}</th>)}</tr>
                </thead>
                <tbody>
                  {table.rows.map((row, index) => (
                    <tr key={index} className="border-t border-black/5 dark:border-white/5">
                      {row.map((cell, cellIndex) => <td key={cellIndex} className="px-3 py-1.5 tabular-nums text-ink dark:text-ink-inverse">{cell}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              {legend}
              <figure role="group" aria-label={title} aria-describedby={`${id}-takeaway`} className="m-0 min-w-0 [&_*:focus:not(:focus-visible)]:outline-none">
                {children}
              </figure>
            </>
          )}
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-muted dark:text-ink-inverse-muted">
            <Info aria-hidden className="mt-0.5 size-3 shrink-0" />
            <span>{howToRead}</span>
          </p>
        </>
      )}
    </section>
  )
}
