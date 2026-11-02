/**
 * Entry of the native repair surface (electron/repair-surface.ts): a trusted WebContentsView above
 * the tab views that shows one tool-repair investigation and takes the user's decision. It is NOT
 * another `App`: no auth, tabs, stores or backend access -- the shell renderer mirrors the state in
 * and performs the decisions out (`window.repairSurface`). It reuses the panel's `RepairPanel`.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/inter/opsz.css'
import './index.css'
import { RepairPanel } from './components/agent-panel/RepairPanel'
import type { RepairInvestigation } from './lib/panel-stream'

type Decision = 'approve' | 'decline' | 'cancel' | 'rollback' | 'open' | 'dismiss'

declare global {
  interface Window {
    repairSurface?: {
      onState: (callback: (state: unknown) => void) => () => void
      decide: (decision: Decision, rev: string) => void
      resize: (height: number) => void
    }
  }
}

function Surface() {
  const [repair, setRepair] = useState<RepairInvestigation | null>(null)
  const [busy, setBusy] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => window.repairSurface?.onState((state) => {
    const next = (state && typeof state === 'object' ? (state as { repair?: RepairInvestigation | null }).repair : null) ?? null
    setRepair(next)
    setBusy(false)
  }) ?? undefined, [])

  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const report = () => window.repairSurface?.resize(Math.ceil(element.getBoundingClientRect().height) + 2)
    report()
    const observer = new ResizeObserver(report)
    observer.observe(element)
    return () => observer.disconnect()
  }, [repair?.rev, repair?.state])

  if (!repair) return null
  const decide = (decision: Decision) => () => { setBusy(true); window.repairSurface?.decide(decision, repair.rev) }
  return <div ref={root} className="p-2 text-ink dark:text-ink-inverse">
    <div className="rounded-2xl border border-surface-200/80 dark:border-surface-700 bg-surface-0/95 dark:bg-surface-900/95 shadow-xl backdrop-blur">
      <RepairPanel repair={repair} busy={busy} compact
        onApprove={decide('approve')} onDecline={decide('decline')} onCancel={decide('cancel')}
        onRollback={decide('rollback')} onDismiss={decide('dismiss')} onOpen={decide('open')} />
    </div>
  </div>
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Surface />
  </React.StrictMode>,
)
