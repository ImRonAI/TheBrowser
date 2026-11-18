import type { IssueStatus } from '@/types/projects'

/**
 * One quiet tone scale for issue status, shared by board columns and the calendar (cards: `.ren-issue-card`).
 * Ink carries everything; volt marks work in motion; the deepest blurple marks what is stuck. Nothing else takes a colour.
 *
 * The heavy rule under a board column's heading.
 */
export const STATUS_RULE: Record<IssueStatus, string> = {
  backlog: 'bg-ink/80 dark:bg-ink-inverse/70',
  'in-progress': 'bg-volt',
  review: 'bg-ink/80 dark:bg-ink-inverse/70',
  blocked: 'bg-blurple-900 dark:bg-blurple-200',
  done: 'bg-ink/25 dark:bg-ink-inverse/25',
}

/** Calendar bars: a whisper of tone behind ink type, never a filled swatch. */
export const STATUS_BAR: Record<IssueStatus, string> = {
  backlog: 'bg-ink/[0.05] text-ink dark:bg-ink-inverse/[0.07] dark:text-ink-inverse',
  'in-progress': 'bg-[rgb(var(--ren-volt)/0.12)] text-ink dark:bg-[rgb(var(--ren-volt)/0.2)] dark:text-ink-inverse',
  review: 'bg-ink/[0.08] text-ink dark:bg-ink-inverse/[0.1] dark:text-ink-inverse',
  blocked: 'bg-blurple-900/[0.1] text-blurple-900 dark:bg-blurple-300/[0.14] dark:text-blurple-200',
  done: 'bg-ink/[0.03] text-ink-muted line-through decoration-ink/20 dark:bg-ink-inverse/[0.04] dark:text-ink-inverse-muted dark:decoration-ink-inverse/20',
}

/** The 2px leading edge of a bar or time block. */
export const STATUS_EDGE: Record<IssueStatus, string> = {
  backlog: 'bg-ink/30 dark:bg-ink-inverse/30',
  'in-progress': 'bg-volt',
  review: 'bg-ink/70 dark:bg-ink-inverse/70',
  blocked: 'bg-blurple-900 dark:bg-blurple-200',
  done: 'bg-ink/15 dark:bg-ink-inverse/15',
}
