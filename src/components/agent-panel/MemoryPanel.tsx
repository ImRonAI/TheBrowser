import { useCallback, useEffect, useMemo, useState } from 'react'
import { PencilIcon, PlusIcon, TrashIcon } from 'lucide-react'
import { getSession } from '@/api/supabase'
import { API_BASE_URL } from '@/lib/api-base'
import {
  CATEGORY_LABELS, SIGN_IN_MESSAGE, composeEntry, createMemoryRequest, entryBody, entryTitle, memoryAdd, memoryDelete,
  memoryEntries, memoryStores, memoryUpdate, type MemoryEntry, type MemoryStoreSummary,
} from '@/lib/memory-api'
import { isGuestUserId, openSignIn } from '@/lib/sign-in'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/utils/cn'

const label = (name: string) => CATEGORY_LABELS[name as keyof typeof CATEGORY_LABELS] ?? name

/**
 * What Ron remembers about the signed-in user, per store (`/memory/*`, native FileMemoryStores):
 * browse each category, add an entry, edit or delete one. Ron reads the same files in Chat and Live.
 */
export function MemoryPanel({ userId, onClose }: { userId: string; onClose: () => void }) {
  const signedIn = !isGuestUserId(userId)
  const request = useMemo(() => createMemoryRequest(API_BASE_URL, getSession, userId), [userId])
  const [stores, setStores] = useState<MemoryStoreSummary[]>([])
  const [active, setActive] = useState('facts')
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const report = (cause: unknown) => setError(cause instanceof Error ? cause.message : 'Memory request failed.')

  const load = useCallback(async (store: string) => {
    const [summary, list] = await Promise.all([memoryStores(request), memoryEntries(request, store)])
    setStores(summary.stores)
    setEntries(list.entries)
  }, [request])

  useEffect(() => {
    if (!signedIn) return
    setError('')
    load(active).catch(report)
  }, [signedIn, active, load])

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      await load(active)
    } catch (cause) {
      report(cause)
    } finally {
      setBusy(false)
    }
  }

  const add = () => run(async () => {
    await memoryAdd(request, active, composeEntry(subject, body))
    setAdding(false); setSubject(''); setBody('')
  })
  const save = (entry: MemoryEntry) => run(async () => {
    await memoryUpdate(request, entry.store, entry.key, draft)
    setEditing(null)
  })
  const remove = (entry: MemoryEntry) => {
    if (!window.confirm(`Forget “${entryTitle(entry)}”?`)) return
    void run(() => memoryDelete(request, entry.store, entry.key))
  }

  return <section aria-label="Memory" className="mx-4 mb-3 rounded-xl border border-surface-200 bg-white/70 p-2 text-xs dark:border-surface-700 dark:bg-surface-850/70">
    <div className="mb-2 flex items-center justify-between px-1">
      <p className="font-semibold">Memory</p>
      <Button type="button" size="sm" variant="ghost" onClick={onClose}>Close</Button>
    </div>
    {!signedIn && <p className="flex flex-wrap items-center gap-2 px-1 text-ink-muted dark:text-ink-inverse-muted">
      <span>{SIGN_IN_MESSAGE}</span>
      <Button type="button" size="sm" variant="outline" onClick={() => openSignIn()}>Sign in</Button>
    </p>}
    {signedIn && <>
      <div role="tablist" aria-label="Memory stores" className="mb-2 flex flex-wrap gap-1 px-1">
        {stores.map((store) => <button key={store.name} type="button" role="tab" aria-selected={store.name === active}
          title={store.description} onClick={() => { setActive(store.name); setEditing(null); setAdding(false) }}
          className={cn('rounded-lg px-2 py-1 hover:bg-surface-100 dark:hover:bg-surface-800',
            store.name === active && 'bg-surface-100 font-medium dark:bg-surface-800')}>
          {label(store.name)} <span className="tabular-nums text-ink-muted dark:text-ink-inverse-muted">{store.count}</span>
        </button>)}
      </div>
      {stores.find((store) => store.name === active)?.description &&
        <p className="mb-2 px-1 text-ink-muted dark:text-ink-inverse-muted">{stores.find((store) => store.name === active)?.description}</p>}
      {error && <p role="alert" className="mb-2 px-1 text-red-700 dark:text-red-300">{error}</p>}
      <ul className="max-h-72 space-y-1 overflow-y-auto scrollbar-thin">
        {!entries.length && <li className="px-1 text-ink-muted dark:text-ink-inverse-muted">Nothing remembered here yet.</li>}
        {entries.map((entry) => <li key={entry.key} className="rounded-lg px-2 py-1.5 hover:bg-surface-50 dark:hover:bg-surface-800/60">
          {editing === entry.key
            ? <div className="space-y-1.5">
                <Textarea aria-label={`Edit ${entryTitle(entry)}`} value={draft} onChange={(event) => setDraft(event.target.value)} rows={5} className="text-xs" />
                <div className="flex gap-1">
                  <Button type="button" size="sm" disabled={busy || !draft.trim()} onClick={() => void save(entry)}>Save</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                </div>
              </div>
            : <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{entryTitle(entry)}</p>
                  <p className="whitespace-pre-wrap text-ink-muted dark:text-ink-inverse-muted">{entryBody(entry)}</p>
                </div>
                <button type="button" aria-label={`Edit ${entryTitle(entry)}`} title="Edit" disabled={busy}
                  onClick={() => { setEditing(entry.key); setDraft(entry.content) }}
                  className="rounded p-1 hover:bg-surface-100 dark:hover:bg-surface-700"><PencilIcon className="size-3.5" /></button>
                <button type="button" aria-label={`Forget ${entryTitle(entry)}`} title="Forget" disabled={busy}
                  onClick={() => remove(entry)}
                  className="rounded p-1 hover:bg-surface-100 dark:hover:bg-surface-700"><TrashIcon className="size-3.5" /></button>
              </div>}
        </li>)}
      </ul>
      {adding
        ? <div className="mt-2 space-y-1.5 px-1">
            <Input aria-label="Subject" placeholder="Subject (e.g. Coffee order)" value={subject} onChange={(event) => setSubject(event.target.value)} className="h-8 text-xs" />
            <Textarea aria-label="Memory" placeholder="What Ren should remember" value={body} onChange={(event) => setBody(event.target.value)} rows={3} className="text-xs" />
            <div className="flex gap-1">
              <Button type="button" size="sm" disabled={busy} onClick={() => void add()}>Save to {label(active)}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </div>
        : <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => setAdding(true)}>
            <PlusIcon className="mr-1 size-3.5" />Add to {label(active)}
          </Button>}
    </>}
  </section>
}
