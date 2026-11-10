/**
 * The workspace's own git repository (AI Elements Commit): branch, uncommitted changes and the newest commits with
 * the files each touched. Read-only; Ren commits through its shell like any developer would. A commit's summary is
 * a button that shows its body and files; a failed refresh keeps the history already read.
 */
import { ChevronRight, GitBranch } from 'lucide-react'
import { Commit, CommitActions, CommitContent, CommitCopyButton, CommitFile, CommitFileAdditions, CommitFileChanges, CommitFileDeletions,
  CommitFileIcon, CommitFileInfo, CommitFilePath, CommitFileStatus, CommitFiles, CommitHash, CommitMessage, CommitSeparator,
  CommitTimestamp } from '@/components/ai-elements/commit'
import { CollapsibleTrigger } from '@/components/ui/collapsible'
import type { BuildCommit, BuildGit } from '@/lib/build-api'
import { relativeTime } from '@/lib/threads-api'
import { StudioEmpty, StudioNotice, barButton, pillButton } from './shared'

const FILE_STATUS: Record<string, 'added' | 'modified' | 'deleted' | 'renamed'> = { A: 'added', D: 'deleted', R: 'renamed', C: 'added' }
const DIRTY_LABEL = (code: string) => code === '??' ? 'new' : code.includes('D') ? 'deleted' : code.includes('A') ? 'added' : code.includes('R') ? 'renamed' : 'modified'

/** Subject, hash, author and time: phrasing content only, because it sits inside the commit's toggle button. */
function CommitSummary({ commit }: { commit: BuildCommit }) {
  const date = new Date(commit.date)
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <CommitMessage className="truncate text-[13.5px] text-ink dark:text-ink-inverse" title={commit.message}>{commit.message}</CommitMessage>
      <span className="mt-1 flex min-w-0 items-center gap-2 text-[11.5px] text-ink-muted dark:text-ink-inverse-muted">
        <CommitHash className="shrink-0 text-volt">{commit.short}</CommitHash>
        <CommitSeparator aria-hidden />
        <span className="truncate">{commit.author}</span>
        <CommitSeparator aria-hidden />
        <CommitTimestamp date={date} title={date.toLocaleString()} className="shrink-0 whitespace-nowrap text-[11.5px]">{relativeTime(commit.date)}</CommitTimestamp>
      </span>
    </span>
  )
}

export function GitPane({ git, error, loading, askBlocked, onAsk, onRetry }: {
  git: BuildGit | null
  error: string
  loading: boolean
  /** Why Ren can't take a message right now (it is working, or waiting for the user in the chat); empty when it can. */
  askBlocked: string
  /** Send Ren a message. */
  onAsk: (prompt: string) => void
  /** Read the repository again. */
  onRetry: () => void
}) {
  if (!git) return error
    ? <StudioEmpty icon={GitBranch} title="Git is unavailable" action={<button type="button" className={pillButton} onClick={onRetry}>Try again</button>}>{error}</StudioEmpty>
    : <StudioEmpty icon={GitBranch} title={loading ? 'Reading history…' : 'No history yet'} />
  const notice = error
    ? <StudioNotice action={<button type="button" className={barButton} onClick={onRetry}>Retry</button>}>Couldn’t refresh git: {error}</StudioNotice>
    : null
  if (!git.repo) return (
    <div className="flex h-full flex-col">
      {notice}
      <StudioEmpty icon={GitBranch} title="Not a git repository yet" className="min-h-0 flex-1"
        action={<div className="flex flex-col items-center gap-2">
          <button type="button" className={pillButton} disabled={Boolean(askBlocked)}
            onClick={() => onAsk('Initialise a git repository here and commit what you have so far, then keep committing as you go.')}>
            Ask Ren to start one</button>
          {askBlocked && <p className="max-w-[40ch] text-[12px] leading-snug text-ink-muted dark:text-ink-inverse-muted">{askBlocked}</p>}
        </div>}>
        With git, every step Ren takes is a commit you can read here.
      </StudioEmpty>
    </div>
  )
  return (
    <div className="flex h-full flex-col">
      {notice}
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-[820px] space-y-6 px-5 py-6">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="sticker sticker-flat"><GitBranch className="h-3 w-3" />{git.branch ?? 'detached'}</span>
            <span className="text-[12px] text-ink-muted dark:text-ink-inverse-muted">
              {git.commits.length} commit{git.commits.length === 1 ? '' : 's'}{git.dirty.length ? ` · ${git.dirty.length} uncommitted` : ' · clean'}
            </span>
          </div>
          {git.dirty.length > 0 && (
            <section aria-labelledby="git-dirty">
              <p id="git-dirty" className="tag-label tag-label-slash">Uncommitted</p>
              <ul className="mt-2.5 overflow-hidden rounded-xl border border-surface-200 bg-surface-0 dark:border-surface-800 dark:bg-surface-900">
                {git.dirty.map((change) => (
                  <li key={change.path} className="flex items-center justify-between gap-3 border-b border-surface-200/70 px-3.5 py-2 last:border-0 dark:border-surface-800">
                    <span className="min-w-0 truncate font-mono text-[12.5px] text-ink dark:text-ink-inverse">{change.path}</span>
                    <span className="shrink-0 font-mono text-[11px] text-ink-muted dark:text-ink-inverse-muted">{DIRTY_LABEL(change.status)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {git.commits.length > 0 && (
            <section aria-labelledby="git-log">
              <p id="git-log" className="tag-label tag-label-slash">History</p>
              <div className="mt-2.5 space-y-2">
                {git.commits.map((commit) => {
                  // Merges and empty commits list no files; their body (when there is one) still opens.
                  const expandable = commit.files.length > 0 || Boolean(commit.body)
                  return (
                    <Commit key={commit.hash} className="group rounded-xl border-surface-200 bg-surface-0 dark:border-surface-800 dark:bg-surface-900">
                      <div className="flex items-center gap-2 py-1.5 pl-1.5 pr-3">
                        {expandable ? (
                          <CollapsibleTrigger asChild>
                            <button type="button" className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-50 dark:hover:bg-surface-850">
                              <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-ink-muted transition-transform group-data-[state=open]:rotate-90 dark:text-ink-inverse-muted" />
                              <CommitSummary commit={commit} />
                            </button>
                          </CollapsibleTrigger>
                        ) : (
                          <div className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5">
                            <span aria-hidden className="h-4 w-4 shrink-0" />
                            <CommitSummary commit={commit} />
                          </div>
                        )}
                        <CommitActions><CommitCopyButton hash={commit.hash} title="Copy commit hash" aria-label="Copy commit hash" /></CommitActions>
                      </div>
                      {expandable && (
                        <CommitContent className="border-t border-surface-200/80 px-2 py-2 dark:border-surface-800">
                          {commit.body && <p className="whitespace-pre-wrap px-2 pb-2 text-[12.5px] leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary">{commit.body}</p>}
                          {commit.files.length > 0 && (
                            <CommitFiles>
                              {commit.files.map((file) => (
                                <CommitFile key={file.path}>
                                  <CommitFileInfo>
                                    <CommitFileStatus status={FILE_STATUS[file.status] ?? 'modified'} />
                                    <CommitFileIcon />
                                    <CommitFilePath title={file.old_path ? `${file.old_path} → ${file.path}` : file.path}>{file.path}</CommitFilePath>
                                  </CommitFileInfo>
                                  <CommitFileChanges>
                                    {file.additions > 0 && <CommitFileAdditions count={file.additions} />}
                                    {file.deletions > 0 && <CommitFileDeletions count={file.deletions} />}
                                  </CommitFileChanges>
                                </CommitFile>
                              ))}
                            </CommitFiles>
                          )}
                        </CommitContent>
                      )}
                    </Commit>
                  )
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
