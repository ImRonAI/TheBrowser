/**
 * Build's empty state: the poster headline above the composer and starter prompts under it
 * (AgentWorkspace `hero` / `heroFooter`). Starters only fill the composer; nothing is sent until the user does.
 */
import { Code2, GitBranch, MonitorPlay, SquareTerminal, TestTubeDiagonal } from 'lucide-react'
import { Marker } from '@/components/brand'
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion'

const CAPABILITIES = [
  { label: 'Editor', icon: Code2 },
  { label: 'Live preview', icon: MonitorPlay },
  { label: 'Terminal', icon: SquareTerminal },
  { label: 'Tests', icon: TestTubeDiagonal },
  { label: 'Git', icon: GitBranch },
]

const STARTERS = [
  'A one-page site for my coffee pop-up, big type, one scroll',
  'A focus timer with sounds and a daily streak',
  'A kanban board that saves to this browser',
  'A script that renames photos by the date they were taken',
  'A JSON feed of the Hacker News front page, with tests',
]

export function BuildHero() {
  return (
    <section className="relative">
      <div aria-hidden className="halftone pointer-events-none absolute -left-24 -top-20 h-64 w-[34rem] opacity-80 dark:opacity-60" />
      <div className="relative flex items-center gap-3">
        <span className="tag-label tag-label-slash">Build</span>
        <span className="sticker">Local-first</span>
      </div>
      <h1 className="ren-display relative mt-5 text-[clamp(52px,6.4vw,88px)] text-ink dark:text-ink-inverse">
        Let Ren <span className="spray-halo inline-block"><Marker>cook.</Marker></span>
      </h1>
      <p className="relative mt-5 max-w-[34rem] text-[15.5px] leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary">
        Say what you want. Ren writes the code, runs it, tests it and shows it live, with every file, command and commit beside the chat.
      </p>
      <ul className="relative mt-6 flex flex-wrap gap-x-5 gap-y-2" aria-label="What the Build studio includes">
        {CAPABILITIES.map(({ label, icon: Icon }) => (
          <li key={label} className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted dark:text-ink-inverse-muted">
            <Icon aria-hidden className="h-3.5 w-3.5 text-volt" strokeWidth={2.25} />{label}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function BuildStarters({ pick }: { pick: (prompt: string) => void }) {
  return (
    <div className="mt-5">
      <p className="tag-label mb-2.5 px-0.5">Or start from</p>
      <Suggestions className="w-full flex-wrap gap-2">
        {STARTERS.map((starter) => (
          <Suggestion key={starter} suggestion={starter} onClick={pick}
            className="h-8 border-surface-200 bg-surface-0/80 px-3.5 text-[12.5px] font-medium text-ink-secondary shadow-none transition-colors hover:border-blurple-300 hover:bg-blurple-50 hover:text-ink dark:border-surface-800 dark:bg-surface-900/80 dark:text-ink-inverse-secondary dark:hover:border-blurple-800 dark:hover:bg-blurple-950/50 dark:hover:text-ink-inverse" />
        ))}
      </Suggestions>
    </div>
  )
}
