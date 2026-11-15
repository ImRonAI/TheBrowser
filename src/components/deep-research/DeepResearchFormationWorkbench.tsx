/**
 * The Formation tab of a Deep Research run: the status strip, then the formation as a graph
 * (`FormationGraph`) or as the stage list, switched from the strip.
 */
import { List, Workflow } from 'lucide-react'
import type { DeepResearchSnapshot, FormationTopology } from '@/lib/deep-research-api'
import { cn } from '@/utils/cn'
import { FormationStageList, FormationTelemetry } from './DeepResearchFormationView'
import { FormationGraph } from './FormationGraph'

export type FormationViewMode = 'graph' | 'list'

const MODES = [
  ['graph', 'Graph', Workflow],
  ['list', 'List', List],
] as const

export interface DeepResearchFormationWorkbenchProps {
  snapshot: DeepResearchSnapshot
  topology: FormationTopology
  view: FormationViewMode
  onViewChange: (view: FormationViewMode) => void
  onCancel: () => void
}

export function DeepResearchFormationWorkbench({
  snapshot,
  topology,
  view,
  onViewChange,
  onCancel,
}: DeepResearchFormationWorkbenchProps) {
  return (
    <section
      aria-label="Formation"
      className="flex h-full min-h-0 flex-col bg-surface-50/50 font-sans dark:bg-surface-900"
    >
      <FormationTelemetry
        snapshot={snapshot}
        onCancel={onCancel}
        actions={
          <div
            role="radiogroup"
            aria-label="Formation view"
            className="inline-flex items-center rounded-full bg-surface-100 p-0.5 dark:bg-surface-800"
          >
            {MODES.map(([id, label, Icon]) => {
              const selected = view === id
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onViewChange(id)}
                  className={cn(
                    'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 font-sans text-[11.5px] font-semibold transition-colors',
                    selected
                      ? 'bg-surface-0 text-ink shadow-sm dark:bg-surface-900 dark:text-ink-inverse'
                      : 'text-ink-muted hover:text-ink dark:text-ink-inverse-muted dark:hover:text-ink-inverse',
                  )}
                >
                  <Icon className={cn('h-3 w-3', selected && 'text-volt')} aria-hidden />
                  {label}
                </button>
              )
            })}
          </div>
        }
      />

      {view === 'graph' ? (
        <div className="min-h-0 flex-1">
          {/* Keyed by run: a different run starts at its root graph with every agent closed. */}
          <FormationGraph key={snapshot.session_id} snapshot={snapshot} topology={topology} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <FormationStageList
            snapshot={snapshot}
            topology={topology}
            className="mx-auto w-full max-w-3xl flex-none overflow-visible"
          />
        </div>
      )}
    </section>
  )
}
