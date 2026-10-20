import { useEffect, useRef } from 'react'
import { useRepairStore } from '@/stores/repairStore'
import { useAgentUi } from '@/context/AgentUiContext'
import { repairNotification } from '@/lib/repair-api'
import type { RepairInvestigation } from '@/lib/panel-stream'

/**
 * Shell-side half of the native repair surface. Mounted by `BrowserLayout` (independent of the
 * agent panel, so it works with the panel closed and over external websites):
 *
 * - mirrors the current investigation (`repairStore`) into Electron (`setRepairSurface`), with
 *   the native notification text for state transitions;
 * - performs the decisions the surface relays back (`onRepairAction`) through the owning panel
 *   chat's `decide` (the shell is the only process with authenticated backend access);
 * - `open` focuses the full review in the Agent Panel; it never approves.
 */
export function RepairBridge() {
  const repair = useRepairStore((store) => store.repair)
  const { openPanel } = useAgentUi()
  const previous = useRef<RepairInvestigation | undefined>(undefined)

  useEffect(() => {
    const api = window.electron?.browser
    if (!api?.setRepairSurface) return
    const notification = repair ? repairNotification(previous.current, repair) : null
    previous.current = repair
    void api.setRepairSurface({ repair: repair ?? null, notification })
  }, [repair])

  useEffect(() => {
    const api = window.electron?.browser
    if (!api?.onRepairAction) return
    return api.onRepairAction((action) => {
      const current = useRepairStore.getState()
      if (!current.repair || current.repair.rev !== action.rev) return
      if (action.type === 'open') { openPanel(); return }
      void current.decide?.(action.type, current.repair)
    })
  }, [openPanel])

  useEffect(() => () => { void window.electron?.browser?.setRepairSurface?.({ repair: null }) }, [])
  return null
}
