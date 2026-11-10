import type { RepairInvestigation } from '@/lib/panel-stream'
import { displayValue } from '@/lib/panel-stream'
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from '@catalyst/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@catalyst/table'

const smallButton = 'rounded-lg border border-surface-200 dark:border-surface-700 px-3 py-1.5 text-xs font-medium hover:bg-surface-100 dark:hover:bg-surface-800 disabled:opacity-50'
const primaryButton = `${smallButton} bg-ink text-surface-0 hover:bg-ink/85 dark:bg-ink-inverse dark:text-surface-900`

export interface RepairPanelProps {
  repair: RepairInvestigation
  busy: boolean
  onApprove: () => void
  onDecline: () => void
  onCancel: () => void
  onRollback: () => void
  onDismiss: () => void
  /** Native surface only: focus the shell and open the full review in the Agent Panel. */
  onOpen?: () => void
  /** Native surface: an inline card (no dialog portal), diff and table collapsed behind "Open in Ron". */
  compact?: boolean
}

/** Headline for one investigation state. */
export function repairHeadline(repair: RepairInvestigation): string {
  const applied = Boolean(repair.applied) || repair.status === 'active'
  if (repair.state === 'investigating') return `${repair.tool} failed${repair.count ? ` (${repair.count}× ${repair.exceptionClass || 'error'})` : ''} — investigating`
  if (repair.state === 'approval') return `${repair.tool}: repair verified — apply it?`
  if (applied) return `${repair.tool} repaired and active`
  if (repair.declined || repair.status === 'declined') return `${repair.tool}: repair declined`
  if (repair.status === 'cancelled') return `${repair.tool}: investigation cancelled`
  if (repair.status === 'blocked') return `${repair.tool}: repair blocked — no isolated environment`
  if (repair.status === 'needs_maintainer') return `${repair.tool}: the defect is in Ren, not the tool`
  if (repair.status === 'not_reproducible') return `${repair.tool}: the failure did not reproduce`
  if (repair.status === 'verified') return `${repair.tool}: repair verified but not applied`
  return `${repair.tool}: repair ${repair.status ?? 'failed'}`
}

function description(repair: RepairInvestigation): string {
  const applied = Boolean(repair.applied) || repair.status === 'active'
  const parts = [repair.summary || (repair.state === 'investigating'
    ? "Ren's fixer is reproducing the failure in an isolated copy of Ren; nothing changes until you approve."
    : 'No summary was produced.')]
  if (repair.sandbox) parts.push(`Sandbox: ${repair.sandbox}.`)
  if (repair.repairKind === 'adapter') parts.push('Repair kind: adapter (wraps the tool for your account; shared code untouched).')
  if (repair.repairKind === 'server') parts.push('Repair kind: browser server (your browser server restarts on the repaired copy when applied).')
  if (repair.status === 'needs_maintainer') parts.push('The proposed patch and test are stored in the revision manifest; it is never applied automatically.')
  if (repair.status === 'blocked') parts.push('Docker was not available on the API host, so the repair could not be verified. Nothing can be applied.')
  if (applied) parts.push('Ren calls the tool again before saying it is fixed.')
  return parts.join(' ')
}

function Demonstrations({ repair }: { repair: RepairInvestigation }) {
  return <Table dense className="text-xs">
    <TableHead><TableRow><TableHeader>Kind</TableHeader><TableHeader>Input</TableHeader><TableHeader>Status</TableHeader><TableHeader>Dry run</TableHeader><TableHeader>Source</TableHeader></TableRow></TableHead>
    <TableBody>
      {repair.demonstrations.map((demo, index) => <TableRow key={index}>
        <TableCell>{demo.kind}</TableCell>
        <TableCell className="max-w-xs truncate" title={displayValue(demo.input)}>{displayValue(demo.input).slice(0, 80)}</TableCell>
        <TableCell className={demo.status === 'passed' ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}>{demo.status}</TableCell>
        <TableCell>{demo.dry_run ? 'yes' : 'no'}</TableCell>
        <TableCell>{demo.source ?? ''}</TableCell>
      </TableRow>)}
      {!repair.demonstrations.length && <TableRow><TableCell colSpan={5} className="text-ink-muted">No demonstrations were recorded.</TableCell></TableRow>}
    </TableBody>
  </Table>
}

function Actions({ repair, busy, onApprove, onDecline, onCancel, onRollback, onDismiss }: RepairPanelProps) {
  const applied = Boolean(repair.applied) || repair.status === 'active'
  if (repair.state === 'investigating') return <button type="button" className={smallButton} disabled={busy} onClick={onCancel}>Cancel</button>
  if (repair.state === 'approval') return <>
    <button type="button" className={smallButton} disabled={busy} onClick={onDecline}>Decline</button>
    <button type="button" className={primaryButton} disabled={busy || !repair.approvalToken} onClick={onApprove}>Approve</button>
  </>
  return <>
    <button type="button" className={smallButton} onClick={onDismiss}>Close</button>
    {applied && <button type="button" className={smallButton} disabled={busy} onClick={onRollback}>Roll back</button>}
  </>
}

/**
 * One tool-repair investigation. It started on its own from the server's tool-failure hook; the
 * user only decides. `investigating`: progress with Cancel. `approval`: the verified artifact
 * (cause, diff, five demonstrations, sandbox) with Approve / Decline; Approve echoes the approval
 * token the server bound to exactly this artifact. `done`: the terminal outcome (applied, declined,
 * failed, blocked, cancelled, needs_maintainer, not_reproducible) with Roll back when applied.
 */
export function RepairPanel(props: RepairPanelProps) {
  const { repair, compact, onOpen, onDecline, onDismiss } = props
  if (compact) {
    return <div role={repair.state === 'approval' ? 'alertdialog' : 'status'} aria-live="polite" data-tool-repair data-state={repair.state} data-status={repair.status} className="p-3 text-xs">
      <div className="flex items-start gap-2">
        {repair.state === 'investigating' && <span className="mt-1 inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-500" aria-hidden />}
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-snug">{repairHeadline(repair)}</p>
          <p className="mt-1 text-ink-muted dark:text-ink-inverse-muted leading-snug line-clamp-4">{description(repair)}</p>
          {repair.state === 'approval' && <p className="mt-1 text-[11px] text-ink-muted dark:text-ink-inverse-muted">{repair.demonstrations.filter((d) => d.status === 'passed').length}/{repair.demonstrations.length} demonstrations passed{repair.diff ? ' · diff available' : ''}</p>}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        {onOpen && <button type="button" className={smallButton} onClick={onOpen}>Open in Ren</button>}
        <Actions {...props} />
      </div>
    </div>
  }
  if (repair.state === 'investigating') {
    return <div role="status" data-tool-repair-investigating className="mx-4 mb-3 flex items-center gap-3 rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50/70 dark:bg-indigo-950/30 p-3 text-xs">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-500" aria-hidden />
      <span className="flex-1">{repairHeadline(repair)}. {description(repair)}</span>
      <Actions {...props} />
    </div>
  }
  return <Alert open onClose={repair.state === 'approval' ? onDecline : onDismiss} size="2xl" data-tool-repair data-state={repair.state} data-status={repair.status}>
    <AlertTitle>{`${repairHeadline(repair)} (revision ${repair.rev})`}</AlertTitle>
    <AlertDescription>{description(repair)}</AlertDescription>
    <AlertBody>
      {repair.diff && <pre className="mb-3 max-h-48 overflow-auto rounded-lg bg-surface-100 dark:bg-surface-800 p-2 text-[11px] leading-snug" data-repair-diff>{repair.diff}</pre>}
      <Demonstrations repair={repair} />
    </AlertBody>
    <AlertActions><Actions {...props} /></AlertActions>
  </Alert>
}
