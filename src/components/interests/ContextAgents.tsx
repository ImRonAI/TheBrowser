import { useEffect, useState, type FormEvent } from 'react'
import { RenIcon } from '@/components/brand'
import { CpuChipIcon } from '@heroicons/react/24/outline'
import { useAgentUi } from '@/context/AgentUiContext'
import { openSignIn } from '@/lib/sign-in'
import { useContextAgentStore } from '@/stores/contextAgentStore'
import { usePanelAgentStore } from '@/stores/panelAgentStore'
import { specialistChoices } from '@/lib/panel-agents'
import type { SpecialistAgent } from '@/lib/context-api'

/** Open the Agent Panel in a new chat with this specialist (agent → its own model) and send the task to it. */
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

  return <div className="h-full space-y-4 overflow-y-auto px-3 py-3">
    <section aria-label="Recommended agents" className="space-y-2">
      <h3 className="text-[11px] font-raleway font-raleway-bold uppercase tracking-wide text-ron-text/50 dark:text-white/50">Recommended for you</h3>
      {!recommendations.length && <p className="text-xs text-ron-text/50 dark:text-white/50">
        As Ren learns what you care about from your browsing and saved context, it will suggest agents that do recurring work for those interests.</p>}
      {recommendations.map((recommendation) => <article key={recommendation.id} data-testid="agent-recommendation" className="space-y-1.5 rounded-lg border border-royal/20 bg-royal/5 p-3 dark:border-royal-light/20 dark:bg-royal-light/5">
        <div className="flex items-start gap-2">
          <RenIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-royal dark:text-royal-light" />
          <div className="min-w-0">
            <p className="text-sm font-raleway font-raleway-bold text-ron-text dark:text-white">{recommendation.name}</p>
            <p className="text-xs text-ron-text/70 dark:text-white/70">{recommendation.description}</p>
            <p className="mt-1 text-[11px] italic text-ron-text/50 dark:text-white/50">{recommendation.rationale}</p>
          </div>
        </div>
        {(recommendation.tools.length > 0 || recommendation.skills.length > 0) && <div className="flex flex-wrap gap-1">
          {[...recommendation.tools, ...recommendation.skills].slice(0, 8).map((name) => <span key={name} className="rounded bg-royal/10 px-1.5 py-0.5 text-[10px] text-royal dark:text-royal-light">{name}</span>)}
        </div>}
        <div className="flex justify-end gap-1.5">
          <button type="button" disabled={Boolean(building)} onClick={() => dismiss(recommendation.id)} className="rounded-md px-2 py-1 text-[11px] text-ron-text/60 hover:bg-zinc-100 disabled:opacity-40 dark:text-white/60 dark:hover:bg-white/5">Not now</button>
          {signInRequired
            ? <button type="button" onClick={() => openSignIn()} className="rounded-md bg-royal px-2 py-1 text-[11px] font-raleway font-raleway-bold text-white dark:bg-royal-light">Sign in to build</button>
            : <button type="button" disabled={Boolean(building)} onClick={() => void approve(recommendation)} className="rounded-md bg-royal px-2 py-1 text-[11px] font-raleway font-raleway-bold text-white disabled:opacity-40 dark:bg-royal-light">
              {building === recommendation.id ? 'Building…' : 'Build this agent'}</button>}
        </div>
      </article>)}
    </section>

    <section aria-label="Your agents" className="space-y-2">
      <h3 className="text-[11px] font-raleway font-raleway-bold uppercase tracking-wide text-ron-text/50 dark:text-white/50">Your agents</h3>
      {signInRequired && <p className="text-xs text-ron-text/50 dark:text-white/50">Agents are saved to your account. <button type="button" className="underline" onClick={() => openSignIn()}>Sign in</button> to build and keep them.</p>}
      {!signInRequired && !agents.length && <p className="text-xs text-ron-text/50 dark:text-white/50">No agents yet.</p>}
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
  return <form onSubmit={submit} data-testid="saved-agent" className="space-y-1.5 rounded-lg border border-zinc-200 p-2.5 dark:border-white/10">
    <div className="flex items-start gap-2">
      <CpuChipIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-royal dark:text-royal-light" />
      <div className="min-w-0">
        <p className="text-xs font-raleway font-raleway-bold text-ron-text dark:text-white">{name}</p>
        <p className="line-clamp-2 text-[11px] text-ron-text/60 dark:text-white/60">{description}</p>
      </div>
    </div>
    <div className="flex gap-1.5">
      <input aria-label={`Task for ${name}`} value={task} onChange={(event) => setTask(event.target.value)} placeholder="What should it do? (optional)"
        className="w-full rounded-md border border-zinc-200 bg-white/70 px-2 py-1 text-[11px] text-ron-text outline-none focus:border-royal dark:border-white/10 dark:bg-white/5 dark:text-white" />
      <button type="submit" title={`Chat with ${name} in the Agent Panel`} className="rounded-md bg-royal px-2 text-[11px] font-raleway font-raleway-bold text-white dark:bg-royal-light">Chat</button>
    </div>
  </form>
}
