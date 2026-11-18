import { useEffect, useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import { AppWindow, Clock, FolderKanban, MessageSquareReply, Smartphone, X } from 'lucide-react'
import { RenMark } from '@/components/brand'
import { useAgentUi } from '@/context/AgentUiContext'
import { openSignIn } from '@/lib/sign-in'
import { useContextAgentStore } from '@/stores/contextAgentStore'
import { useInterestsStore } from '@/stores/interestsStore'
import { usePanelAgentStore } from '@/stores/panelAgentStore'
import { specialistChoices } from '@/lib/panel-agents'
import {
  agoLabel, cadenceLabel, defaultCadence, runStatusLabel, WEEKDAYS, whenLabel,
  type AgentCadence, type AgentRecommendation, type ReplyDraft, type ScheduleEvery, type SpecialistAgent,
} from '@/lib/context-api'
import { cn } from '@/utils/cn'
import { field, ghostButton, iconButton, mutedText, primaryButton, sectionLabel } from './contextUi'
import { RecentRuns, useReviewRun } from './AgentRuns'

const EASE = [0.19, 1, 0.22, 1] as const

/** Open the Agent Panel in a new chat with this specialist (on the default model) and send the task to it. */
export function chatWithSpecialist(agent: SpecialistAgent, task: string, send: (prompt: string) => void) {
  usePanelAgentStore.getState().requestAgent(specialistChoices([agent])[0])
  send(task)
  useContextAgentStore.getState().yieldToPanel()
}

/** Recommendations from the Context Agent (Build/Create = approve), drafted replies (Send = approval first), saved specialists and their runs. */
export function ContextAgents() {
  const replyDrafts = useContextAgentStore((state) => state.replyDrafts)
  const recommendations = useContextAgentStore((state) => state.recommendations)
  const agents = useContextAgentStore((state) => state.agents)
  const signInRequired = useContextAgentStore((state) => state.agentsSignInRequired)
  const building = useContextAgentStore((state) => state.building)
  const { approve, dismiss, refreshAgents, refreshRuns } = useContextAgentStore.getState()
  const { sendToAgentPanel } = useAgentUi()

  useEffect(() => { void refreshAgents(); void refreshRuns() }, [refreshAgents, refreshRuns])

  return <div className="h-full space-y-5 overflow-y-auto px-4 py-3">
    {replyDrafts.length > 0 && <section aria-label="Drafted replies" className="space-y-2">
      <h3 className={sectionLabel}>Drafted replies</h3>
      {replyDrafts.map((draft) => <ReplyDraftCard key={draft.id} draft={draft} />)}
    </section>}

    <RecentRuns />

    <section aria-label="Recommended agents" className="space-y-2">
      <h3 className={sectionLabel}>Recommended</h3>
      {!recommendations.length && <p className={mutedText}>Ren suggests projects, apps and agents here as it learns what you do often.</p>}
      {recommendations.map((recommendation) => {
        const isProject = recommendation.kind === 'project'
        const actionLabel = isProject ? (building === recommendation.id ? 'Creating…' : 'Create') : (building === recommendation.id ? 'Building…' : 'Build')
        return <article key={recommendation.id} data-testid="agent-recommendation" className="rounded-xl border border-surface-200 p-3 dark:border-surface-800">
          <RecommendationKindLabel kind={recommendation.kind} />
          <p className="text-[13px] font-semibold text-ink dark:text-ink-inverse">{recommendation.name}</p>
          <p className={mutedText}>{recommendation.description}</p>
          {recommendation.issues && recommendation.issues.length > 0 && <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] text-ink-secondary dark:text-ink-inverse-secondary">
            {recommendation.issues.slice(0, 4).map((issue) => <li key={issue}>{issue}</li>)}
          </ul>}
          <p className="mt-1 text-[11px] text-ink-muted dark:text-ink-inverse-muted">{recommendation.rationale}</p>
          <div className="mt-2 flex justify-end gap-1">
            <button type="button" disabled={Boolean(building)} onClick={() => dismiss(recommendation.id)} className={ghostButton}>Not now</button>
            {signInRequired && !isProject
              ? <button type="button" onClick={() => openSignIn()} className={primaryButton}>Sign in to build</button>
              : <button type="button" disabled={Boolean(building)} onClick={() => void approve(recommendation)} className={primaryButton}>
                {actionLabel}</button>}
          </div>
        </article>
      })}
    </section>

    <section aria-label="Your agents" className="space-y-2">
      <h3 className={sectionLabel}>Your agents</h3>
      {signInRequired && <p className={mutedText}><button type="button" className="underline underline-offset-2" onClick={() => openSignIn()}>Sign in</button> to build and keep agents.</p>}
      {!signInRequired && !agents.length && <p className={mutedText}>No agents yet.</p>}
      {agents.map((agent) => <SavedAgent key={agent.id} agent={agent} onUse={(task) => chatWithSpecialist(agent, task, sendToAgentPanel)} />)}
    </section>
  </div>
}

/** Floating notice above the orb for the newest drafted reply: edit if wanted, then Send (approval first). */
export function ReplyDraftNotice() {
  const drafts = useContextAgentStore((state) => state.replyDrafts)
  const sending = useContextAgentStore((state) => state.sendingReply)
  const draft = drafts[0]
  const [text, setText] = useState(draft?.draft ?? '')
  useEffect(() => { if (draft) setText(draft.draft) }, [draft])
  if (!draft) return null
  const more = drafts.length - 1
  const { sendReply, dismissReply, setTab } = useContextAgentStore.getState()
  const openAll = () => { setTab('agents'); useInterestsStore.getState().setExpanded(true) }

  return (
    <motion.div
      key={draft.id}
      role="status"
      aria-live="polite"
      aria-label={`Draft reply to ${draft.sender} in ${draft.app}`}
      data-testid="reply-draft-notice"
      initial={{ y: 8, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 8, opacity: 0 }}
      transition={{ duration: 0.22, ease: EASE }}
      className="fixed bottom-[84px] right-5 z-40 w-[300px]"
    >
      <div className="ron-glass-panel rounded-xl border border-surface-200 bg-surface-0 p-3 text-ink shadow-float dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse">
        <div className="flex items-start gap-2.5">
          <RenMark className="mt-0.5 h-6 w-6 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold">{draft.sender} · {draft.app}</p>
            {draft.incoming && <p className={cn('line-clamp-2', mutedText)}>{draft.incoming}</p>}
          </div>
          <button type="button" onClick={() => dismissReply(draft.id)} aria-label="Dismiss reply draft" title="Dismiss" className={cn(iconButton, '-mr-1 -mt-1')}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <textarea aria-label={`Reply to ${draft.sender}`} value={text} onChange={(event) => setText(event.target.value)}
          rows={2} className={cn(field, 'mt-2 h-auto resize-none py-1.5')} />
        <div className="mt-2 flex items-center justify-between gap-2">
          {more > 0
            ? <button type="button" onClick={openAll} className="text-[12px] font-medium text-ink-secondary underline-offset-2 hover:underline dark:text-ink-inverse-secondary">{more} more</button>
            : <span />}
          <div className="flex gap-1">
            <button type="button" disabled={Boolean(sending)} onClick={() => dismissReply(draft.id)} className={ghostButton}>Not now</button>
            <button type="button" disabled={Boolean(sending) || !text.trim()} onClick={() => void sendReply(draft, text)} className={primaryButton}>
              {sending === draft.id ? 'Sending…' : 'Send'}</button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function ReplyDraftCard({ draft }: { draft: ReplyDraft }) {
  const sending = useContextAgentStore((state) => state.sendingReply === draft.id)
  const { sendReply, dismissReply } = useContextAgentStore.getState()
  const [text, setText] = useState(draft.draft)
  return <article data-testid="reply-draft" className="rounded-xl border border-surface-200 p-3 dark:border-surface-800">
    <p className="mb-1 flex items-center gap-1 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-volt">
      <MessageSquareReply className="h-3 w-3" strokeWidth={2} aria-hidden />{draft.app}
    </p>
    <p className="text-[13px] font-semibold text-ink dark:text-ink-inverse">{draft.sender}</p>
    {draft.incoming && <p className={mutedText}>{draft.incoming}</p>}
    <textarea aria-label={`Reply to ${draft.sender}`} value={text} onChange={(event) => setText(event.target.value)}
      rows={2} className={cn(field, 'mt-2 h-auto resize-none py-1.5')} />
    <div className="mt-2 flex justify-end gap-1">
      <button type="button" disabled={sending} onClick={() => dismissReply(draft.id)} className={ghostButton}>Not now</button>
      <button type="button" disabled={sending || !text.trim()} onClick={() => void sendReply(draft, text)} className={primaryButton}>
        {sending ? 'Sending…' : 'Send'}</button>
    </div>
  </article>
}

/** An app or project recommendation says which kind it is; an agent's needs no label. */
function RecommendationKindLabel({ kind }: { kind: AgentRecommendation['kind'] | undefined }) {
  if (kind !== 'web' && kind !== 'android' && kind !== 'project') return null
  const Icon = kind === 'project' ? FolderKanban : kind === 'web' ? AppWindow : Smartphone
  const label = kind === 'project' ? 'Project' : kind === 'web' ? 'Web app' : 'Android app'
  return <p className="mb-1 flex items-center gap-1 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-volt">
    <Icon className="h-3 w-3" strokeWidth={2} aria-hidden />{label}
  </p>
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
