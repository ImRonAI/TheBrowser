/**
 * Ren's plan for this build (its latest `todo_write`) and the files it created or edited, newest first.
 * Plan rows use AI Elements Queue items; a changed file opens in the Code tab. The step in progress shimmers only
 * while the run is active; otherwise it says where Ren stopped or is waiting.
 */
import { ListChecks } from 'lucide-react'
import { QueueItem, QueueItemContent, QueueItemIndicator } from '@/components/ai-elements/queue'
import { Shimmer } from '@/components/ai-elements/shimmer'
import type { BuildFileChange, BuildTodo } from '@/lib/build-insights'
import { cn } from '@/utils/cn'
import { StudioEmpty } from './shared'

const ACTION_LABEL: Record<string, string> = { create: 'Created', str_replace: 'Edited', insert: 'Edited', write: 'Wrote', undo_edit: 'Reverted', edit: 'Edited' }

/** Ren's run: active, paused for the user (an answer or a checkpoint resume), or over. */
export type PlanRun = 'working' | 'waiting' | 'stopped'

export function PlanPane({ todos, changes, run, relative, onOpenFile }: {
  todos: BuildTodo[]
  changes: BuildFileChange[]
  run: PlanRun
  /** A tool path as a workspace path, or null when it is outside the workspace. */
  relative: (path: string) => string | null
  onOpenFile: (path: string) => void
}) {
  if (!todos.length && !changes.length) return (
    <StudioEmpty icon={ListChecks} title="No plan yet">
      When Ren takes on a build it writes its plan here and ticks steps off as it goes.
    </StudioEmpty>
  )
  const done = todos.filter((todo) => todo.status === 'completed').length
  const latest = new Map<string, BuildFileChange>()
  for (const change of changes) latest.set(change.path, change)
  const files = [...latest.values()].reverse()
  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-[760px] px-5 py-6">
        {todos.length > 0 && (
          <section aria-labelledby="build-plan">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="tag-label tag-label-slash">Plan</p>
                <h3 id="build-plan" className="mt-2 font-display text-[22px] font-extrabold tracking-[-0.03em] text-ink dark:text-ink-inverse">
                  {done === todos.length ? 'All done.' : `${done} of ${todos.length} done`}
                </h3>
              </div>
              <span className="font-mono text-[12px] tabular-nums text-ink-muted dark:text-ink-inverse-muted">{Math.round((done / todos.length) * 100)}%</span>
            </div>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-100 dark:bg-surface-800" role="progressbar"
              aria-valuemin={0} aria-valuemax={todos.length} aria-valuenow={done} aria-label="Plan progress">
              <div className="h-full rounded-full bg-volt transition-[width] duration-500 ease-out" style={{ width: `${(done / todos.length) * 100}%` }} />
            </div>
            <ol className="mt-4 space-y-0.5">
              {todos.map((todo, index) => {
                const completed = todo.status === 'completed'
                const current = todo.status === 'in_progress'
                const working = current && run === 'working'
                const waiting = current && run === 'waiting'
                return (
                  <QueueItem key={`${index}-${todo.content}`} aria-current={current ? 'step' : undefined}
                    className={cn('flex-row items-start gap-3 rounded-lg px-2.5 py-2', working && 'bg-blurple-50/80 dark:bg-blurple-950/40')}>
                    <QueueItemIndicator completed={completed}
                      className={cn('mt-[5px] size-3 shrink-0', completed && 'border-volt bg-volt', working && 'border-volt', waiting && 'border-amber-500')} />
                    <QueueItemContent completed={completed}
                      className={cn('line-clamp-none text-[13.5px] leading-snug', !completed && 'text-ink dark:text-ink-inverse')}>
                      {/* Shimmer paints through a clipped gradient of shadcn v4 colour variables: volt text, swept with the surface. */}
                      {working ? <Shimmer as="span" className="[--color-muted-foreground:rgb(var(--ren-volt))]">{todo.activeForm}</Shimmer> : todo.content}
                      {current && !working && (
                        <span className={cn('ml-2 inline-flex h-[18px] items-center rounded-full border px-1.5 align-middle text-[10.5px] font-medium',
                          waiting ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-200'
                            : 'border-surface-200 text-ink-muted dark:border-surface-700 dark:text-ink-inverse-muted')}>
                          {waiting ? 'Waiting for you' : 'Stopped here'}
                        </span>
                      )}
                    </QueueItemContent>
                  </QueueItem>
                )
              })}
            </ol>
          </section>
        )}
        {files.length > 0 && (
          <section aria-labelledby="build-files" className={cn(todos.length > 0 && 'mt-9')}>
            <p id="build-files" className="tag-label tag-label-slash">Files changed · {files.length}</p>
            <ul className="mt-3 divide-y divide-surface-200/80 overflow-hidden rounded-xl border border-surface-200 bg-surface-0 dark:divide-surface-800 dark:border-surface-800 dark:bg-surface-900">
              {files.map((change) => {
                const path = relative(change.path)
                return (
                  <li key={change.path}>
                    <button type="button" disabled={!path} onClick={() => path && onOpenFile(path)}
                      className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors enabled:hover:bg-surface-50 disabled:cursor-default dark:enabled:hover:bg-surface-850">
                      <span className="min-w-0 truncate font-mono text-[12.5px] text-ink dark:text-ink-inverse">{path ?? change.path}</span>
                      <span className="shrink-0 text-[11px] font-medium text-ink-muted dark:text-ink-inverse-muted">{ACTION_LABEL[change.action] ?? change.action}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
