import { useEffect, useState, type FormEvent } from 'react'
import { Clock } from 'lucide-react'
import { useAgentUi } from '@/context/AgentUiContext'
import { openSignIn } from '@/lib/sign-in'
import { useContextAgentStore } from '@/stores/contextAgentStore'
import { usePanelAgentStore } from '@/stores/panelAgentStore'
import { specialistChoices } from '@/lib/panel-agents'
import {
  agoLabel, cadenceLabel, defaultCadence, runStatusLabel, WEEKDAYS, whenLabel,
  type AgentCadence, type ScheduleEvery, type SpecialistAgent,
} from '@/lib/context-api'
import { cn } from '@/utils/cn'
import { field, ghostButton, mutedText, primaryButton, sectionLabel } from './contextUi'
import { RecentRuns, useReviewRun } from './AgentRuns'

/** Open the Agent Panel in a new chat with this specialist (on the default model) and send the task to it. */
export function chatWithSpecialist(agent: SpecialistAgent, task: string, send: (prompt: string) => void) {
  usePanelAgentStore.getState().requestAgent(specialistChoices([agent])[0])
  send(task)
  useContextAgentStore.getState().yieldToPanel()
}

/** Recommendations from the Context Agent (Build = approve → it writes the specialist and saves it), saved specialists and their runs. */
export function ContextAgents() {
  const recommendations = useContextAgentStore((state) => state.recommendations)
  const agents = useContextAgentStore((state) => state.agents)
  const signInRequired = useContextAgentStore((state) => state.agentsSignInRequired)
  const building = useContextAgentStore((state) => state.building)
  const { approve, dismiss, refreshAgents, refreshRuns } = useContextAgentStore.getState()
  const { sendToAgentPanel } = useAgentUi()

  useEffect(() => { void refreshAgents(); void refreshRuns() }, [refreshAgents, refreshRuns])

  return <div className="h-full space-y-5 overflow-y-auto px-4 py-3">
    <RecentRuns />

    <section aria-label="Recommended agents" className="space-y-2">
      <h3 className={sectionLabel}>Recommended</h3>
      {!recommendations.length && <p className={mutedText}>Ren suggests agents here as it learns what you do often.</p>}
      {recommendations.map((recommendation) => <article key={recommendation.id} data-testid="agent-recommendation" className="rounded-xl border border-surface-200 p-3 dark:border-surface-800">
        <p className="text-[13px] font-semibold text-ink dark:text-ink-inverse">{recommendation.name}</p>
        <p className={mutedText}>{recommendation.description}</p>
        <p className="mt-1 text-[11px] text-ink-muted dark:text-ink-inverse-muted">{recommendation.rationale}</p>
        <div className="mt-2 flex justify-end gap-1">
          <button type="button" disabled={Boolean(building)} onClick={() => dismiss(recommendation.id)} className={ghostButton}>Not now</button>
          {signInRequired
            ? <button type="button" onClick={() => openSignIn()} className={primaryButton}>Sign in to build</button>
            : <button type="button" disabled={Boolean(building)} onClick={() => void approve(recommendation)} className={primaryButton}>
              {building === recommendation.id ? 'Building…' : 'Build'}</button>}
        </div>
      </article>)}
    </section>

    <section aria-label="Your agents" className="space-y-2">
      <h3 className={sectionLabel}>Your agents</h3>
      {signInRequired && <p className={mutedText}><button type="button" className="underline underline-offset-2" onClick={() => openSignIn()}>Sign in</button> to build and keep agents.</p>}
      {!signInRequired && !agents.length && <p className={mutedText}>No agents yet.</p>}
      {agents.map((agent) => <SavedAgent key={agent.id} agent={agent} onUse={(task) => chatWithSpecialist(agent, task, sendToAgentPanel)} />)}
    </section>
  </div>
}

function SavedAgent({ agent, onUse }: { agent: SpecialistAgent; onUse: (task: string) => void }) {
  const [task, setTask] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onUse(task.trim() || agent.description || `Do what you do for me now and report back.`)
    setTask('')
  }
  return <article data-testid="saved-agent" aria-label={agent.name} className="rounded-xl border border-surface-200 p-3 dark:border-surface-800">
    <p className="truncate text-[13px] font-semibold text-ink dark:text-ink-inverse">{agent.name}</p>
    <p className={`line-clamp-2 ${mutedText}`}>{agent.description}</p>
    <form onSubmit={submit} className="mt-2 flex items-center gap-1.5">
      <input aria-label={`Task for ${agent.name}`} value={task} onChange={(event) => setTask(event.target.value)} placeholder="Task (optional)" className={field} />
      <button type="submit" title={`Chat with ${agent.name} in the Agent Panel`} className={primaryButton}>Chat</button>
    </form>
    <AgentSchedule agent={agent} />
  </article>
}

type Mode = 'off' | ScheduleEvery
const MODES: { id: Mode; label: string }[] = [
  { id: 'off', label: 'Only when I start it' },
  { id: 'hours', label: 'Every few hours' },
  { id: 'day', label: 'Every day' },
  { id: 'weekdays', label: 'Every weekday' },
  { id: 'week', label: 'Every week' },
]

/** When the specialist runs on its own, Run now, and its latest run. */
function AgentSchedule({ agent }: { agent: SpecialistAgent }) {
  const saving = useContextAgentStore((state) => state.scheduling === agent.id)
  const starting = useContextAgentStore((state) => state.starting === agent.id)
  const lastRun = useContextAgentStore((state) => state.runs.find((run) => run.agent_id === agent.id))
  const { saveSchedule, runNow } = useContextAgentStore.getState()
  const review = useReviewRun()
  const schedule = agent.schedule ?? null
  const [editing, setEditing] = useState(false)
  const [mode, setMode] = useState<Mode>('off')
  const [cadence, setCadence] = useState<AgentCadence>(() => defaultCadence(''))
  const [task, setTask] = useState('')
  const running = lastRun?.status === 'running'

  const edit = () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    setMode(schedule?.cadence.every ?? 'day')
    setCadence(schedule ? { ...schedule.cadence, timezone: zone } : defaultCadence(zone))
    setTask(schedule?.task ?? '')
    setEditing(true)
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    await saveSchedule(agent, mode === 'off' ? null : { ...cadence, every: mode }, task)
    setEditing(false)
  }
  const patch = (next: Partial<AgentCadence>) => setCadence((current) => ({ ...current, ...next }))

  return <div className="mt-2.5 space-y-1.5 border-t border-surface-200 pt-2.5 dark:border-surface-800">
    {!editing && <div className="flex items-center gap-2">
      <Clock aria-hidden className="h-3.5 w-3.5 flex-shrink-0 text-ink-muted dark:text-ink-inverse-muted" />
      <p data-testid="agent-schedule" className={`min-w-0 flex-1 truncate ${mutedText}`}>
        {schedule
          ? <>{cadenceLabel(schedule.cadence)}{schedule.next_run_at ? <> · next {whenLabel(schedule.next_run_at)}</> : null}</>
          : 'Runs only when you start it'}
      </p>
      <button type="button" onClick={edit} className={ghostButton}>{schedule ? 'Edit schedule' : 'Schedule'}</button>
      <button type="button" disabled={starting || running} onClick={() => void runNow(agent)} title={`Run ${agent.name} now; Ren lets you know when it finishes`} className={ghostButton}>
        {starting ? 'Starting…' : running ? 'Running…' : 'Run now'}</button>
    </div>}

    {editing && <form onSubmit={save} aria-label={`Schedule for ${agent.name}`} className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <select aria-label="How often" value={mode} onChange={(event) => setMode(event.target.value as Mode)} className={cn(field, 'w-auto')}>
          {MODES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select>
        {mode === 'hours' && <label className="flex items-center gap-1.5 text-[12px] text-ink-secondary dark:text-ink-inverse-secondary">
          every
          <input type="number" aria-label="Hours between runs" min={1} max={168} value={cadence.hours}
            onChange={(event) => patch({ hours: Math.min(168, Math.max(1, Number(event.target.value) || 1)) })} className={cn(field, 'w-16')} />
          hours
        </label>}
        {mode === 'week' && <select aria-label="Day of the week" value={cadence.weekday} onChange={(event) => patch({ weekday: Number(event.target.value) })} className={cn(field, 'w-auto')}>
          {WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}
        </select>}
        {(mode === 'day' || mode === 'weekdays' || mode === 'week') && <label className="flex items-center gap-1.5 text-[12px] text-ink-secondary dark:text-ink-inverse-secondary">
          at
          <input type="time" aria-label="Time of day" required value={cadence.time} onChange={(event) => patch({ time: event.target.value })} className={cn(field, 'w-auto')} />
        </label>}
      </div>
      {mode !== 'off' && <input aria-label="What to do on each run" value={task} onChange={(event) => setTask(event.target.value)} maxLength={4000}
        placeholder={`Each run (optional): ${agent.description || 'its recurring work'}`} className={field} />}
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] text-ink-muted dark:text-ink-inverse-muted">{mode !== 'off' && cadence.timezone ? `Your time zone: ${cadence.timezone}` : ''}</p>
        <div className="flex gap-1">
          <button type="button" onClick={() => setEditing(false)} className={ghostButton}>Cancel</button>
          <button type="submit" disabled={saving} className={primaryButton}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </form>}

    {lastRun && !editing && <div className="flex items-center gap-2 pl-[22px]">
      <p className={`min-w-0 flex-1 truncate ${mutedText}`}>
        Last run: {runStatusLabel(lastRun.status).toLowerCase()} · {agoLabel(lastRun.finished_at ?? lastRun.started_at, Date.now())}
      </p>
      <button type="button" onClick={() => review(lastRun)} className={ghostButton}>{running ? 'Watch' : 'Review'}</button>
    </div>}
  </div>
}
