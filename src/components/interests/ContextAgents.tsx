import { useEffect, useState, type FormEvent } from 'react'
import { useAgentUi } from '@/context/AgentUiContext'
import { openSignIn } from '@/lib/sign-in'
import { useContextAgentStore } from '@/stores/contextAgentStore'
import { usePanelAgentStore } from '@/stores/panelAgentStore'
import { specialistChoices } from '@/lib/panel-agents'
import type { SpecialistAgent } from '@/lib/context-api'
import { field, ghostButton, mutedText, primaryButton, sectionLabel } from './contextUi'

/** Open the Agent Panel in a new chat with this specialist (on the default model) and send the task to it. */
export function chatWithSpecialist(agent: SpecialistAgent, task: string, send: (prompt: string) => void) {
  usePanelAgentStore.getState().requestAgent(specialistChoices([agent])[0])
  send(task)
  useContextAgentStore.getState().yieldToPanel()
}

/** Recommendations from the Context Agent (Build = approve → it writes the specialist and saves it) and saved specialists. */
export function ContextAgents() {
  const recommendations = useContextAgentStore((state) => state.recommendations)
  const agents = useContextAgentStore((state) => state.agents)
  const signInRequired = useContextAgentStore((state) => state.agentsSignInRequired)
  const building = useContextAgentStore((state) => state.building)
  const { approve, dismiss, refreshAgents } = useContextAgentStore.getState()
  const { sendToAgentPanel } = useAgentUi()

  useEffect(() => { void refreshAgents() }, [refreshAgents])

  return <div className="h-full space-y-5 overflow-y-auto px-4 py-3">
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
      {agents.map((agent) => <UseAgent key={agent.id} name={agent.name} description={agent.description}
        onUse={(task) => chatWithSpecialist(agent, task, sendToAgentPanel)} />)}
    </section>
  </div>
}

function UseAgent({ name, description, onUse }: { name: string; description: string; onUse: (task: string) => void }) {
  const [task, setTask] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onUse(task.trim() || description || `Do what you do for me now and report back.`)
    setTask('')
  }
  return <form onSubmit={submit} data-testid="saved-agent" className="rounded-xl border border-surface-200 p-3 dark:border-surface-800">
    <p className="truncate text-[13px] font-semibold text-ink dark:text-ink-inverse">{name}</p>
    <p className={`line-clamp-2 ${mutedText}`}>{description}</p>
    <div className="mt-2 flex items-center gap-1.5">
      <input aria-label={`Task for ${name}`} value={task} onChange={(event) => setTask(event.target.value)} placeholder="Task (optional)" className={field} />
      <button type="submit" title={`Chat with ${name} in the Agent Panel`} className={primaryButton}>Chat</button>
    </div>
  </form>
}
