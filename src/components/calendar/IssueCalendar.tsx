import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Ban, CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { useProjectsStore } from '@/stores/projectsStore'
import { ISSUE_STATUS_CONFIG, type Issue, type IssueStatus } from '@/types/projects'
import { calendarDay } from '@/lib/project-issue-utils'
import {
  CALENDAR_MODES, CALENDAR_MODE_LABELS, formatMinutes, isCurrentPeriod, issuesInRange, issuesOnDay, layoutOverlaps,
  monthWeeks, periodLabel, periodRange, placeIssuesOnDay, quarterMonths, sameDay, startOfDay, stepDate,
  unscheduledIssues, weekDays, type CalendarMode, type PositionedBlock,
} from '@/lib/calendar'
import { cn } from '@/utils/cn'
import { useIssueBlocking } from '@/hooks/useIssueBlocking'
import { BlockedTag } from '@/components/projects/BlockedTag'

/**
 * Issue calendar with Day, Week, Month and Quarter views (Month by default).
 * Issues are placed by their real start/end/due timestamps; nothing is invented.
 */

interface IssueCalendarProps {
  issues: Issue[]
  onIssueSelect: (issueId: string) => void
  /** Controlled view. Omit to let the calendar own it (starts on Month). */
  mode?: CalendarMode
  onModeChange?: (mode: CalendarMode) => void
  className?: string
}

const HOUR_HEIGHT = 48
const MONTH_CHIPS = 3
const STATUS_DOT: Record<IssueStatus, string> = {
  backlog: 'bg-surface-400',
  'in-progress': 'bg-accent dark:bg-accent-light',
  review: 'bg-info',
  blocked: 'bg-danger',
  done: 'bg-success',
}
const HAIRLINE = 'border-surface-200 dark:border-surface-700'
/** Blocked issues read rose in every view: tinted chip, stop mark, hazard-striped time block. */
const BLOCKED_CHIP = 'bg-rose-500/[0.08] ring-1 ring-inset ring-rose-500/25 dark:bg-rose-400/10 dark:ring-rose-300/20 hover:bg-rose-500/[0.14] dark:hover:bg-rose-400/[0.16]'
const BLOCKED_BLOCK = 'border-rose-300/80 dark:border-rose-400/30 bg-[repeating-linear-gradient(135deg,rgba(244,63,94,0.07)_0_6px,transparent_6px_12px)] dark:bg-[repeating-linear-gradient(135deg,rgba(251,113,133,0.10)_0_6px,transparent_6px_12px)]'

function BlockedMark() {
  return <Ban aria-hidden className="h-3 w-3 shrink-0 text-rose-500 dark:text-rose-300" strokeWidth={2.5} />
}
const TODAY_CIRCLE = 'bg-ink text-surface-0 dark:bg-ink-inverse dark:text-surface-900'
const PERIOD_NOUN: Record<CalendarMode, string> = { day: 'day', week: 'week', month: 'month', quarter: 'quarter' }

type KeyFor = (issue: Issue) => string

function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

export function IssueCalendar({ issues, onIssueSelect, mode: controlledMode, onModeChange, className }: IssueCalendarProps) {
  const [ownMode, setOwnMode] = useState<CalendarMode>('month')
  const mode = controlledMode ?? ownMode
  const setMode = (next: CalendarMode) => {
    if (controlledMode === undefined) setOwnMode(next)
    onModeChange?.(next)
  }
  const [cursor, setCursor] = useState(() => startOfDay(new Date()))
  const now = useNow()
  const reduceMotion = useReducedMotion()
  const { projects } = useProjectsStore()
  const blockingFor = useIssueBlocking()
  const [showUnscheduled, setShowUnscheduled] = useState(false)

  const keyFor = useMemo<KeyFor>(() => {
    const keys = new Map(projects.map((project) => [project.id, project.key]))
    return (issue) => `${keys.get(issue.projectId) ?? 'ISSUE'}-${issue.number}`
  }, [projects])

  const range = periodRange(cursor, mode)
  const rangeKey = `${mode}:${calendarDay(range.start)}`
  const scheduled = issuesInRange(issues, range.start, range.end)
  const unscheduled = useMemo(() => unscheduledIssues(issues), [issues])
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const onCurrentPeriod = isCurrentPeriod(cursor, mode, now)
  const noun = PERIOD_NOUN[mode]

  const openDay = (day: Date) => { setCursor(startOfDay(day)); setMode('day') }
  const openMonth = (month: Date) => { setCursor(startOfDay(month)); setMode('month') }

  const shared = { issues, keyFor, onIssueSelect, now }

  return (
    <section
      aria-label="Issue calendar"
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-[20px] border',
        HAIRLINE,
        'bg-surface-0 dark:bg-surface-850 text-ink dark:text-ink-inverse shadow-soft dark:shadow-dark-soft',
        className
      )}
    >
      <header className={cn('flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3 border-b px-6 py-4', HAIRLINE)}>
        <div className="mr-auto min-w-0">
          <h2 className="truncate font-display text-2xl leading-tight text-ink dark:text-ink-inverse">
            {periodLabel(cursor, mode)}
          </h2>
          <p className="mt-1 text-xs text-ink-muted dark:text-ink-inverse-muted">
            {scheduled.length === 1 ? '1 scheduled issue' : `${scheduled.length} scheduled issues`} · Times in {timeZone}
          </p>
        </div>
        <DateStepper
          noun={noun}
          onPrev={() => setCursor(stepDate(cursor, mode, -1))}
          onNext={() => setCursor(stepDate(cursor, mode, 1))}
          onToday={() => setCursor(startOfDay(new Date()))}
          todayDisabled={onCurrentPeriod && (mode !== 'day' || sameDay(cursor, now))}
        />
        <ModeSwitch mode={mode} onChange={setMode} />
      </header>

      <div className="relative min-h-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={rangeKey}
            className="absolute inset-0"
            initial={{ opacity: 0, y: reduceMotion ? 0 : 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            {mode === 'month' && <MonthView cursor={cursor} onOpenDay={openDay} {...shared} />}
            {mode === 'week' && <TimeGrid days={weekDays(cursor)} onOpenDay={openDay} {...shared} />}
            {mode === 'day' && <TimeGrid days={[cursor]} {...shared} />}
            {mode === 'quarter' && <QuarterView cursor={cursor} onOpenDay={openDay} onOpenMonth={openMonth} {...shared} />}
          </motion.div>
        </AnimatePresence>
        {scheduled.length === 0 && mode !== 'quarter' && <EmptyState noun={noun} />}
      </div>

      {unscheduled.length > 0 && (
        <footer className={cn('shrink-0 border-t px-6 py-3', HAIRLINE)}>
          <button
            type="button"
            aria-expanded={showUnscheduled}
            onClick={() => setShowUnscheduled((open) => !open)}
            className="inline-flex items-center gap-2 rounded-full px-2 py-1 -mx-2 text-xs font-medium text-ink-secondary dark:text-ink-inverse-secondary hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
          >
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showUnscheduled ? 'rotate-0' : '-rotate-90')} />
            Unscheduled
            <span className="rounded-full bg-surface-100 dark:bg-surface-800 px-1.5 text-[11px] tabular-nums text-ink-muted dark:text-ink-inverse-muted">
              {unscheduled.length}
            </span>
          </button>
          {showUnscheduled && (
            <div className="mt-2 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
              {unscheduled.map((issue) => { const blocking = blockingFor(issue); return (
                <button
                  key={issue.id}
                  type="button"
                  onClick={() => onIssueSelect(issue.id)}
                  title={blocking.label || undefined}
                  className={cn(
                    'inline-flex max-w-[18rem] items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                    HAIRLINE,
                    'hover:border-surface-300 dark:hover:border-surface-600 hover:bg-surface-50 dark:hover:bg-surface-800',
                    blocking.blocked && cn('border-transparent', BLOCKED_CHIP),
                    issue.status === 'done' && 'opacity-60'
                  )}
                >
                  {blocking.blocked ? <BlockedMark /> : <StatusDot status={issue.status} />}
                  <span className="shrink-0 tabular-nums text-ink-muted dark:text-ink-inverse-muted">{keyFor(issue)}</span>
                  <span className="truncate text-ink dark:text-ink-inverse">{issue.title}</span>
                </button>
              )})}
            </div>
          )}
        </footer>
      )}
    </section>
  )
}

// ─── Header controls ─────────────────────────────────────────────────────────

function DateStepper({ noun, onPrev, onNext, onToday, todayDisabled }: {
  noun: string; onPrev: () => void; onNext: () => void; onToday: () => void; todayDisabled: boolean
}) {
  const icon = cn(
    'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
    'text-ink-secondary dark:text-ink-inverse-secondary hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-ink dark:hover:text-ink-inverse',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60'
  )
  return (
    <div className={cn('inline-flex h-9 items-center rounded-full border p-0.5 bg-surface-0 dark:bg-surface-850', HAIRLINE)}>
      <button type="button" aria-label={`Previous ${noun}`} onClick={onPrev} className={icon}>
        <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onToday}
        disabled={todayDisabled}
        className={cn(
          'h-8 rounded-full px-3 text-xs font-semibold transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
          todayDisabled
            ? 'cursor-default text-ink-muted dark:text-ink-inverse-muted'
            : 'text-ink dark:text-ink-inverse hover:bg-surface-100 dark:hover:bg-surface-800'
        )}
      >
        Today
      </button>
      <button type="button" aria-label={`Next ${noun}`} onClick={onNext} className={icon}>
        <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
      </button>
    </div>
  )
}

function ModeSwitch({ mode, onChange }: { mode: CalendarMode; onChange: (mode: CalendarMode) => void }) {
  const indicator = useId()
  return (
    <div
      role="group"
      aria-label="Calendar view"
      className={cn('relative inline-flex h-9 items-center rounded-full border p-1 bg-surface-100 dark:bg-surface-800', HAIRLINE)}
    >
      {CALENDAR_MODES.map((option) => {
        const active = option === mode
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option)}
            className={cn(
              'relative h-7 rounded-full px-3.5 text-xs transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
              active
                ? 'font-semibold text-ink dark:text-ink-inverse'
                : 'font-medium text-ink-secondary dark:text-ink-inverse-secondary hover:text-ink dark:hover:text-ink-inverse'
            )}
          >
            {active && (
              <motion.span
                layoutId={indicator}
                className="absolute inset-0 rounded-full bg-surface-0 dark:bg-surface-700 shadow-subtle dark:shadow-dark-subtle"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative">{CALENDAR_MODE_LABELS[option]}</span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Shared pieces ───────────────────────────────────────────────────────────

function StatusDot({ status, className }: { status: IssueStatus; className?: string }) {
  return (
    <span
      aria-hidden
      title={ISSUE_STATUS_CONFIG[status]?.label}
      className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[status] ?? 'bg-surface-400', className)}
    />
  )
}

function IssueChip({ issue, keyFor, onSelect, tinted }: { issue: Issue; keyFor: KeyFor; onSelect: (id: string) => void; tinted?: boolean }) {
  const blocking = useIssueBlocking()(issue)
  return (
    <button
      type="button"
      onClick={() => onSelect(issue.id)}
      title={`${keyFor(issue)} · ${issue.title}${blocking.blocked ? ` · ${blocking.label}` : ''}`}
      className={cn(
        'flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-[3px] text-left text-[11px] leading-4 transition-colors',
        blocking.blocked ? BLOCKED_CHIP : cn(tinted ? 'bg-surface-100 dark:bg-surface-800' : '', 'hover:bg-surface-200/70 dark:hover:bg-surface-700'),
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        issue.status === 'done' && 'opacity-60'
      )}
    >
      {blocking.blocked ? <BlockedMark /> : <StatusDot status={issue.status} />}
      <span className="shrink-0 tabular-nums text-ink-muted dark:text-ink-inverse-muted">{keyFor(issue)}</span>
      <span className="truncate font-medium text-ink dark:text-ink-inverse">{issue.title}</span>
    </button>
  )
}

function EmptyState({ noun }: { noun: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <div className={cn(
        'pointer-events-auto max-w-[340px] rounded-[18px] border p-5 text-center',
        HAIRLINE,
        'bg-surface-0/95 dark:bg-surface-850/95 shadow-medium dark:shadow-dark-medium backdrop-blur-sm'
      )}>
        <div className={cn('mx-auto flex h-11 w-11 items-center justify-center rounded-[14px] border bg-surface-50 dark:bg-surface-800', HAIRLINE)}>
          <CalendarDays className="h-5 w-5 text-ink-secondary dark:text-ink-inverse-secondary" strokeWidth={1.5} />
        </div>
        <p className="mt-4 text-[15px] font-semibold text-ink dark:text-ink-inverse">No scheduled issues this {noun}</p>
        <p className="mt-1.5 text-xs text-ink-secondary dark:text-ink-inverse-secondary">
          Issues with a start, end or due date appear here.
        </p>
      </div>
    </div>
  )
}

const weekdayNames = (format: 'short' | 'narrow') =>
  weekDays(new Date()).map((day) => day.toLocaleDateString(undefined, { weekday: format }))

// ─── Month ───────────────────────────────────────────────────────────────────

interface ViewProps {
  issues: Issue[]
  keyFor: KeyFor
  onIssueSelect: (id: string) => void
  now: Date
}

function MonthView({ cursor, issues, keyFor, onIssueSelect, onOpenDay, now }: ViewProps & { cursor: Date; onOpenDay: (day: Date) => void }) {
  const weeks = monthWeeks(cursor)
  const days = weeks.flat()
  return (
    <div className="flex h-full flex-col">
      <div className={cn('grid shrink-0 grid-cols-7 border-b', HAIRLINE)}>
        {weekdayNames('short').map((name) => (
          <div key={name} className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted dark:text-ink-inverse-muted">
            {name}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7" style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }}>
        {days.map((day, index) => {
          const inMonth = day.getMonth() === cursor.getMonth()
          const isToday = sameDay(day, now)
          const dayIssues = issuesOnDay(issues, day)
          const extra = dayIssues.length - MONTH_CHIPS
          const lastRow = index >= days.length - 7
          return (
            <div
              key={day.toISOString()}
              className={cn(
                'flex min-h-0 flex-col gap-0.5 overflow-hidden p-1.5',
                HAIRLINE,
                !lastRow && 'border-b',
                index % 7 !== 6 && 'border-r',
                !inMonth && 'bg-surface-50/70 dark:bg-surface-900/40'
              )}
            >
              <button
                type="button"
                aria-label={`Open ${day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}`}
                onClick={() => onOpenDay(day)}
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs tabular-nums transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                  isToday
                    ? cn(TODAY_CIRCLE, 'font-semibold')
                    : inMonth
                      ? 'font-medium text-ink dark:text-ink-inverse hover:bg-surface-100 dark:hover:bg-surface-800'
                      : 'text-ink-muted/70 dark:text-ink-inverse-muted/70 hover:bg-surface-100 dark:hover:bg-surface-800'
                )}
              >
                {day.getDate()}
              </button>
              {dayIssues.slice(0, MONTH_CHIPS).map((issue) => (
                <IssueChip key={issue.id} issue={issue} keyFor={keyFor} onSelect={onIssueSelect} />
              ))}
              {extra > 0 && (
                <button
                  type="button"
                  onClick={() => onOpenDay(day)}
                  className="self-start rounded-md px-1.5 py-[3px] text-[11px] font-medium text-ink-muted dark:text-ink-inverse-muted hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-ink dark:hover:text-ink-inverse"
                >
                  +{extra} more
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Week & Day (time grid) ──────────────────────────────────────────────────

function blockLabel(block: PositionedBlock) {
  if (block.kind === 'span') return `${formatMinutes(block.startMinutes)} – ${formatMinutes(block.endMinutes)}`
  if (block.kind === 'due') return `Due ${formatMinutes(block.startMinutes)}`
  if (block.kind === 'start') return `Starts ${formatMinutes(block.startMinutes)}`
  return `Ends ${formatMinutes(block.startMinutes)}`
}

function TimeGrid({ days, issues, keyFor, onIssueSelect, onOpenDay, now }: ViewProps & { days: Date[]; onOpenDay?: (day: Date) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const placements = days.map((day) => placeIssuesOnDay(issues, day))
  const hasAllDay = placements.some((placement) => placement.allDay.length > 0)
  const columns: CSSProperties = { gridTemplateColumns: `4.5rem repeat(${days.length}, minmax(0, 1fr))` }
  const single = days.length === 1
  const firstDay = days[0].getTime()
  const earliest = Math.min(Infinity, ...placements.flatMap(({ timed }) => timed.map((block) => block.startMinutes)))

  // Open on the first scheduled block; with none, on the current time today, else 7 AM.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const current = new Date()
    const showingToday = days.some((day) => sameDay(day, current))
    const focusMinutes = Number.isFinite(earliest)
      ? earliest - 60
      : showingToday ? current.getHours() * 60 + current.getMinutes() - 90 : 7 * 60
    // Stop half a label above the hour line so the first visible hour label is not clipped.
    el.scrollTop = Math.max(0, (focusMinutes / 60) * HOUR_HEIGHT - 12)
  }, [firstDay, days.length, earliest])

  return (
    <div className="flex h-full flex-col">
      <div className={cn('grid shrink-0 border-b', HAIRLINE)} style={columns}>
        <div />
        {days.map((day) => {
          const isToday = sameDay(day, now)
          const label = (
            <>
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted dark:text-ink-inverse-muted">
                {day.toLocaleDateString(undefined, { weekday: single ? 'long' : 'short' })}
              </span>
              <span className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full text-sm tabular-nums',
                isToday ? cn(TODAY_CIRCLE, 'font-semibold') : 'font-medium text-ink dark:text-ink-inverse'
              )}>
                {day.getDate()}
              </span>
            </>
          )
          return (
            <div key={day.toISOString()} className={cn('flex justify-center border-l py-2', HAIRLINE)}>
              {onOpenDay ? (
                <button
                  type="button"
                  aria-label={`Open ${day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}`}
                  onClick={() => onOpenDay(day)}
                  className="flex flex-col items-center gap-1 rounded-[10px] px-3 py-1 transition-colors hover:bg-surface-100 dark:hover:bg-surface-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  {label}
                </button>
              ) : (
                <div className="flex flex-col items-center gap-1 px-3 py-1">{label}</div>
              )}
            </div>
          )
        })}
      </div>

      {hasAllDay && (
        <div className={cn('grid shrink-0 border-b', HAIRLINE)} style={columns}>
          <div className="px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted dark:text-ink-inverse-muted">
            All day
          </div>
          {placements.map(({ allDay }, index) => (
            <div key={days[index].toISOString()} className={cn('flex min-w-0 flex-col gap-0.5 border-l p-1', HAIRLINE)}>
              {allDay.slice(0, 3).map((issue) => (
                <IssueChip key={issue.id} issue={issue} keyFor={keyFor} onSelect={onIssueSelect} tinted />
              ))}
              {allDay.length > 3 && onOpenDay && (
                <button
                  type="button"
                  onClick={() => onOpenDay(days[index])}
                  className="self-start rounded-md px-1.5 text-[11px] font-medium text-ink-muted dark:text-ink-inverse-muted hover:text-ink dark:hover:text-ink-inverse"
                >
                  +{allDay.length - 3} more
                </button>
              )}
              {allDay.length > 3 && !onOpenDay && allDay.slice(3).map((issue) => (
                <IssueChip key={issue.id} issue={issue} keyFor={keyFor} onSelect={onIssueSelect} tinted />
              ))}
            </div>
          ))}
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="relative grid" style={{ ...columns, height: 24 * HOUR_HEIGHT }}>
          <div className="relative">
            {Array.from({ length: 23 }, (_, i) => i + 1).map((hour) => (
              <span
                key={hour}
                className="absolute right-3 -translate-y-1/2 text-[11px] tabular-nums text-ink-muted dark:text-ink-inverse-muted"
                style={{ top: hour * HOUR_HEIGHT }}
              >
                {formatMinutes(hour * 60)}
              </span>
            ))}
          </div>
          {days.map((day, index) => {
            const isToday = sameDay(day, now)
            const blocks = layoutOverlaps(placements[index].timed)
            return (
              <div
                key={day.toISOString()}
                className={cn('relative border-l', HAIRLINE, isToday && 'bg-surface-50/60 dark:bg-surface-800/25')}
              >
                {Array.from({ length: 23 }, (_, i) => i + 1).map((hour) => (
                  <div
                    key={hour}
                    aria-hidden
                    className="absolute inset-x-0 border-t border-surface-100 dark:border-surface-800"
                    style={{ top: hour * HOUR_HEIGHT }}
                  />
                ))}
                {blocks.map((block) => (
                  <TimedBlock key={`${block.issue.id}:${block.kind}`} block={block} keyFor={keyFor} onSelect={onIssueSelect} />
                ))}
                {isToday && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 z-10"
                    style={{ top: ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_HEIGHT }}
                  >
                    <div className="relative h-px bg-accent dark:bg-accent-light">
                      <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-accent dark:bg-accent-light" />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function TimedBlock({ block, keyFor, onSelect }: { block: PositionedBlock; keyFor: KeyFor; onSelect: (id: string) => void }) {
  const top = (block.startMinutes / 60) * HOUR_HEIGHT
  const height = Math.max(((block.endMinutes - block.startMinutes) / 60) * HOUR_HEIGHT - 2, 22)
  const width = 100 / block.columns
  const compact = height < 44
  const blocking = useIssueBlocking()(block.issue)
  return (
    <button
      type="button"
      onClick={() => onSelect(block.issue.id)}
      title={`${blockLabel(block)} · ${keyFor(block.issue)} · ${block.issue.title}${blocking.blocked ? ` · ${blocking.label}` : ''}`}
      className={cn(
        'absolute z-[1] flex overflow-hidden rounded-lg border text-left transition-colors',
        HAIRLINE,
        'bg-surface-0 dark:bg-surface-850 shadow-subtle dark:shadow-dark-subtle',
        'hover:border-surface-300 dark:hover:border-surface-600 hover:bg-surface-50 dark:hover:bg-surface-800',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        blocking.blocked && BLOCKED_BLOCK,
        block.issue.status === 'done' && 'opacity-60'
      )}
      style={{ top: top + 1, height, left: `calc(${block.column * width}% + 2px)`, width: `calc(${width}% - 4px)` }}
    >
      <span aria-hidden className={cn('w-[3px] shrink-0', blocking.blocked ? 'bg-rose-500 dark:bg-rose-400' : STATUS_DOT[block.issue.status] ?? 'bg-surface-400')} />
      <span className={cn('flex min-w-0 flex-1 px-2', compact ? 'items-center gap-1.5' : 'flex-col justify-start gap-0.5 py-1.5')}>
        <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-medium tabular-nums text-ink-muted dark:text-ink-inverse-muted">
          {blocking.blocked && compact && <BlockedMark />}
          {blockLabel(block)}
          {blocking.blocked && !compact && <BlockedTag label={blocking.label} />}
        </span>
        <span className="truncate text-[11px] leading-4">
          <span className="tabular-nums text-ink-muted dark:text-ink-inverse-muted">{keyFor(block.issue)} </span>
          <span className="font-medium text-ink dark:text-ink-inverse">{block.issue.title}</span>
        </span>
      </span>
    </button>
  )
}

// ─── Quarter ─────────────────────────────────────────────────────────────────

const QUARTER_LIST = 5

function QuarterView({ cursor, issues, keyFor, onIssueSelect, onOpenDay, onOpenMonth, now }: ViewProps & {
  cursor: Date; onOpenDay: (day: Date) => void; onOpenMonth: (month: Date) => void
}) {
  const narrow = weekdayNames('narrow')
  return (
    <div className="grid h-full grid-cols-1 gap-4 overflow-y-auto p-5 lg:grid-cols-3">
      {quarterMonths(cursor).map((month) => {
        const { start, end } = periodRange(month, 'month')
        const monthIssues = issuesInRange(issues, start, end)
        return (
          <section key={month.toISOString()} className={cn('flex min-h-0 flex-col rounded-[16px] border p-4', HAIRLINE)}>
            <div className="flex items-baseline justify-between gap-2">
              <button
                type="button"
                onClick={() => onOpenMonth(month)}
                className="rounded-md font-display text-lg text-ink dark:text-ink-inverse hover:text-accent dark:hover:text-accent-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                {month.toLocaleDateString(undefined, { month: 'long' })}
              </button>
              <span className="text-[11px] tabular-nums text-ink-muted dark:text-ink-inverse-muted">
                {monthIssues.length} scheduled
              </span>
            </div>

            <div className="mt-3 grid grid-cols-7 text-center">
              {narrow.map((name, index) => (
                <span key={index} className="pb-1 text-[10px] font-semibold uppercase text-ink-muted dark:text-ink-inverse-muted">{name}</span>
              ))}
              {monthWeeks(month).flat().map((day) => {
                if (day.getMonth() !== month.getMonth()) return <span key={day.toISOString()} />
                const count = issuesOnDay(issues, day).length
                const isToday = sameDay(day, now)
                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    aria-label={`Open ${day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}${count ? `, ${count} issue${count === 1 ? '' : 's'}` : ''}`}
                    onClick={() => onOpenDay(day)}
                    className="group flex h-9 flex-col items-center justify-center rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  >
                    <span className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-full text-xs tabular-nums transition-colors',
                      isToday
                        ? cn(TODAY_CIRCLE, 'font-semibold')
                        : 'text-ink dark:text-ink-inverse group-hover:bg-surface-100 dark:group-hover:bg-surface-800'
                    )}>
                      {day.getDate()}
                    </span>
                    <span className="mt-0.5 flex h-1 gap-0.5">
                      {Array.from({ length: Math.min(count, 3) }, (_, i) => (
                        <span key={i} className="h-1 w-1 rounded-full bg-ink-secondary/70 dark:bg-ink-inverse-secondary/70" />
                      ))}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className={cn('mt-3 flex min-h-0 flex-col gap-0.5 border-t pt-3', HAIRLINE)}>
              {monthIssues.length === 0 && (
                <p className="px-1.5 text-[11px] text-ink-muted dark:text-ink-inverse-muted">Nothing scheduled.</p>
              )}
              {monthIssues.slice(0, QUARTER_LIST).map((issue) => (
                <div key={issue.id} className="flex items-center gap-2">
                  <span className="w-12 shrink-0 text-[11px] tabular-nums text-ink-muted dark:text-ink-inverse-muted">
                    {firstDayIn(issue, start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                  <div className="min-w-0 flex-1">
                    <IssueChip issue={issue} keyFor={keyFor} onSelect={onIssueSelect} />
                  </div>
                </div>
              ))}
              {monthIssues.length > QUARTER_LIST && (
                <button
                  type="button"
                  onClick={() => onOpenMonth(month)}
                  className="self-start rounded-md px-1.5 py-[3px] text-[11px] font-medium text-ink-muted dark:text-ink-inverse-muted hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-ink dark:hover:text-ink-inverse"
                >
                  +{monthIssues.length - QUARTER_LIST} more in {month.toLocaleDateString(undefined, { month: 'long' })}
                </button>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/** The first day in the month the issue appears on; a span already running when the month opens shows the 1st. */
function firstDayIn(issue: Issue, monthStart: Date) {
  const day = (value?: string) => (value ? startOfDay(new Date(value)) : null)
  const spanStart = day(issue.startDate)
  const spanEnd = day(issue.endDate) ?? spanStart
  if (spanStart && spanEnd && spanStart < monthStart && spanEnd >= monthStart) return monthStart
  const inMonth = [spanStart, day(issue.endDate), day(issue.dueDate)]
    .filter((value): value is Date => value !== null && value >= monthStart)
    .sort((a, b) => a.getTime() - b.getTime())
  return inMonth[0] ?? monthStart
}
