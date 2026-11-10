/**
 * Every command Ren ran in this conversation, as one terminal session (AI Elements Terminal), with the latest
 * test run summarised above it (AI Elements TestResults) when a command's output carried a runner's summary.
 * The terminal follows new output only while the reader is at its bottom, and nothing shows as running once the
 * run has stopped or paused.
 */
import { useState } from 'react'
import { SquareTerminal } from 'lucide-react'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { Terminal, TerminalActions, TerminalContent, TerminalCopyButton, TerminalHeader, TerminalStatus, TerminalTitle } from '@/components/ai-elements/terminal'
import { Test, TestResults, TestResultsContent, TestResultsDuration, TestResultsHeader, TestResultsProgress, TestResultsSummary } from '@/components/ai-elements/test-results'
import { consoleTranscript, type BuildCommand, type BuildTestSummary } from '@/lib/build-insights'
import { StudioEmpty } from './shared'

/** How close to the bottom (px) still counts as reading the latest output. */
const FOLLOW_SLACK = 48

export function ConsolePane({ commands, tests, working }: {
  commands: BuildCommand[]
  tests: BuildTestSummary | null
  /** True while Ren's run is active; a command without a result is only "running" then. */
  working: boolean
}) {
  const [follow, setFollow] = useState(true)
  if (!commands.length) return (
    <StudioEmpty icon={SquareTerminal} title="No commands yet">
      Installs, builds, servers and test runs show up here with their output as Ren runs them.
    </StudioEmpty>
  )
  const running = working && commands.some((command) => command.state === 'running')
  const failed = commands.filter((command) => command.state === 'failed').length
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      {tests && (
        <TestResults className="shrink-0 overflow-hidden rounded-xl border-surface-200 bg-surface-0 dark:border-surface-800 dark:bg-surface-900"
          summary={{ passed: tests.passed, failed: tests.failed, skipped: tests.skipped, total: tests.total, duration: tests.duration }}>
          <TestResultsHeader className="gap-3 border-surface-200/80 px-3.5 py-2.5 dark:border-surface-800">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="tag-label">{tests.runner}</span>
              <TestResultsSummary className="gap-1.5 [&>*]:h-5 [&>*]:text-[11px]" />
            </div>
            <TestResultsDuration className="font-mono text-[11px]" />
          </TestResultsHeader>
          {tests.total > 0 && <TestResultsProgress className="px-3.5 py-2.5 text-[11px] [&_.rounded-full]:h-1.5" />}
          {tests.failures.length > 0 && (
            <TestResultsContent className="max-h-36 space-y-0 overflow-auto border-t border-surface-200/80 p-1.5 dark:border-surface-800">
              {tests.failures.map((name) => <Test key={name} name={name} status="failed" className="rounded-md px-2 py-1.5 font-mono text-[12px]" />)}
            </TestResultsContent>
          )}
        </TestResults>
      )}
      {/* Always dark, in every appearance; Shimmer (AI Elements) reads shadcn v4 colour variables, mapped here. */}
      <Terminal output={consoleTranscript(commands, working)} isStreaming={running} autoScroll={follow}
        className="min-h-0 flex-1 rounded-xl border-white/5 bg-[#0A0A0A] text-[#EDEDED] shadow-float [--color-background:#EDEDED] [--color-muted-foreground:#8F8F8F]">
        <TerminalHeader className="border-white/10 px-3.5 py-2">
          <TerminalTitle className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#8F8F8F]">
            {commands.length} command{commands.length === 1 ? '' : 's'}{failed ? ` · ${failed} failed` : ''}
          </TerminalTitle>
          <div className="flex items-center gap-1">
            <TerminalStatus><Shimmer as="span" className="font-mono text-[11px] uppercase tracking-[0.12em]">Running</Shimmer></TerminalStatus>
            <TerminalActions>
              <TerminalCopyButton aria-label="Copy console output" title="Copy console output" className="h-7 w-7 text-[#8F8F8F] hover:bg-white/10 hover:text-white" />
            </TerminalActions>
          </div>
        </TerminalHeader>
        <TerminalContent className="max-h-none min-h-0 flex-1 px-4 py-3 text-[12.5px] leading-[1.65] scrollbar-thin"
          onScroll={(event) => {
            const element = event.currentTarget
            setFollow(element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_SLACK)
          }} />
      </Terminal>
    </div>
  )
}
