import { AgentWorkspace } from '@/components/agent-panel/AgentPanel'
export * from './types'

export function BuildWorkbenchPage() {
  return <div className="h-full min-h-0"><AgentWorkspace destination="build" /></div>
}
export default BuildWorkbenchPage