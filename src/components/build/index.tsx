/**
 * Build Workbench - placeholder entry point.
 *
 * The full Build Workbench UI is not yet implemented in this repository.
 * This placeholder satisfies the import path `@/components/build` referenced
 * from `App.tsx` and `HomePage.tsx` so the app can boot. Replace this file
 * when the real workbench is reintroduced.
 */

import { useBuildStore } from '@/stores/buildStore'

export * from './types'

export function BuildWorkbenchPage() {
  const activeAgentId = useBuildStore((state) => state.activeAgentId)
  const agents = useBuildStore((state) => state.agents)
  const activeAgent = agents.find((agent) => agent.id === activeAgentId)

  return (
    <div className="h-full w-full flex items-center justify-center bg-surface-0 dark:bg-surface-900">
      <div className="max-w-xl text-center px-6">
        <h1 className="font-serif text-3xl text-ron-black dark:text-ron-white">
          Build Workbench
        </h1>
        <p className="mt-4 text-sm text-ron-black/70 dark:text-ron-white/70">
          The Build Workbench is not yet wired up in this build. The underlying
          store and types are scaffolded, but the UI surface is intentionally a
          placeholder.
        </p>
        {activeAgent && (
          <p className="mt-6 text-xs uppercase tracking-wider text-ron-black/50 dark:text-ron-white/50">
            Active agent: {activeAgent.name}
          </p>
        )}
      </div>
    </div>
  )
}

export default BuildWorkbenchPage
