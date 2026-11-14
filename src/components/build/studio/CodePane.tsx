/**
 * The workspace's files (AI Elements FileTree) and an editor (CodeMirror). Saves are version-checked: a save sends
 * the sha256 the file was opened at, so an edit never silently overwrites a change Ren made meanwhile (the API
 * answers 409 and the pane offers Reload or Overwrite). An open file that Ren edits reloads itself while it has no
 * unsaved changes.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, Code2, FileCode2, FileImage, FileJson, FileText, File as FileIcon, FilePlus2, Loader2, Save, Trash2, X } from 'lucide-react'
import { FileTree, FileTreeFile, FileTreeFolder } from '@/components/ai-elements/file-tree'
import { BuildConflict, buildDeleteFile, buildFile, buildSaveFile, buildTree, defaultBuildFile,
  type BuildFile, type BuildRequest, type BuildTreeNode, type BuildWorkspace } from '@/lib/build-api'
import { cn } from '@/utils/cn'
import { CodeEditor, languageName } from '../CodeEditor'
import { PaneBar, StudioEmpty, barButton, barIconButton, formatBytes, primaryButton } from './shared'

const fileIcon = (name: string) => {
  if (/\.(png|jpe?g|gif|webp|svg|ico|avif)$/i.test(name)) return <FileImage className="size-4 text-ink-muted dark:text-ink-inverse-muted" />
  if (/\.(json|jsonc|lock)$/i.test(name)) return <FileJson className="size-4 text-ink-muted dark:text-ink-inverse-muted" />
  if (/\.(md|mdx|txt|rst)$/i.test(name) || /^readme/i.test(name)) return <FileText className="size-4 text-ink-muted dark:text-ink-inverse-muted" />
  if (/\.(tsx?|jsx?|mjs|cjs|py|html?|css|scss|vue|svelte|go|rs|rb|java|kt|swift|sh|ya?ml|toml|sql)$/i.test(name)) return <FileCode2 className="size-4 text-volt" />
  return <FileIcon className="size-4 text-ink-muted dark:text-ink-inverse-muted" />
}

function TreeNodes({ nodes }: { nodes: BuildTreeNode[] }) {
  return <>{nodes.map((node) => node.type === 'dir'
    ? <FileTreeFolder key={node.path} path={node.path} name={node.name}><TreeNodes nodes={node.children} /></FileTreeFolder>
    : <FileTreeFile key={node.path} path={node.path} name={node.name} icon={fileIcon(node.name)} />)}</>
}

const ancestors = (path: string) => path.split('/').slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join('/'))

interface OpenFile extends BuildFile { draft: string }

export function CodePane({ request, userId, sessionId, workspace, onChanged, open, onOpened }: {
  request: BuildRequest
  userId: string
  sessionId: string
  workspace: BuildWorkspace
  /** Ask the Studio to re-read the workspace (after a save, create or delete). */
  onChanged: () => void
  /** A path another tab asked to open. */
  open: string | null
  onOpened: () => void
}) {
  const entries = workspace.entries
  const tree = useMemo(() => buildTree(entries), [entries])
  const isFile = useCallback((path: string) => entries.some((entry) => entry.path === path && entry.type === 'file'), [entries])
  const [selected, setSelected] = useState<string | null>(null)
  const [file, setFile] = useState<OpenFile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState<BuildConflict | null>(null)
  const [stale, setStale] = useState(false)
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newPath, setNewPath] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  // Counts the versions loaded into the editor; each one gets a fresh editor (see the CodeEditor key below).
  const [loadId, setLoadId] = useState(0)
  const [focusEditor, setFocusEditor] = useState(false)
  const fileRef = useRef(file)
  fileRef.current = file
  const dirty = Boolean(file && file.content !== null && file.draft !== file.content)
  // A path just created or deleted here, until the Studio's next listing catches up with it.
  const created = useRef<string | null>(null)
  const deleted = useRef<string | null>(null)
  // Only the latest load fills the editor: a slower earlier one never lands under another file's name.
  const loads = useRef(0)
  const editorRef = useRef<HTMLDivElement>(null)

  /** Open a file's current version. `focus` puts the keyboard in the editor (a file just created here). */
  const load = useCallback(async (path: string, focus = false) => {
    const attempt = ++loads.current
    // A reload while the editor has focus (Ren's edit, "Load Ren’s version") keeps the keyboard there.
    const refocus = focus || Boolean(editorRef.current?.contains(document.activeElement))
    setLoading(true)
    setError('')
    setConflict(null)
    setStale(false)
    setConfirmDelete(false)
    try {
      const loaded = await buildFile(request, userId, sessionId, path)
      if (attempt !== loads.current) return
      setFile({ ...loaded, draft: loaded.content ?? '' })
      setLoadId((id) => id + 1)
      // Not when the user has since moved on (focus left the editor for somewhere other than the page itself).
      setFocusEditor(refocus && (document.activeElement === document.body || Boolean(editorRef.current?.contains(document.activeElement))))
    } catch (failure) {
      if (attempt !== loads.current) return
      setFile(null)
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (attempt === loads.current) setLoading(false)
    }
  }, [request, sessionId, userId])

  const select = useCallback((path: string) => {
    if (!isFile(path)) return
    if (dirty && path !== selected && !window.confirm(`Discard your unsaved changes to ${selected}?`)) return
    setExpanded((current) => new Set([...current, ...ancestors(path)]))
    setSelected(path)
    void load(path)
  }, [dirty, isFile, load, selected])

  // First file, a file another tab asked for, and the open file's fate when the workspace changes.
  useEffect(() => {
    // A create or delete made here is settled once the listing shows it.
    if (created.current && entries.some((item) => item.path === created.current)) created.current = null
    if (deleted.current && !entries.some((item) => item.path === deleted.current)) deleted.current = null
    if (open && isFile(open)) { onOpened(); if (open !== selected) select(open); return }
    if (!selected) {
      // Never the file just deleted, which the listing still shows until the Studio re-reads it.
      const first = defaultBuildFile(entries.filter((item) => item.path !== deleted.current))
      if (first) select(first)
      return
    }
    const entry = entries.find((item) => item.path === selected)
    const current = fileRef.current
    if (!entry) {
      // A file just created here is missing from the listing until then: keep it open meanwhile.
      if (selected !== created.current) { setSelected(null); setFile(null) }
      return
    }
    if (current && entry.modified !== current.modified && !loading) {
      if (current.draft === current.content) void load(selected)
      else setStale(true)
    }
  }, [entries, isFile, load, loading, onOpened, open, select, selected])

  // Expand the top-level folders once, so a fresh workspace reads at a glance.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || !tree.length) return
    seeded.current = true
    setExpanded((current) => new Set([...current, ...tree.filter((node) => node.type === 'dir' && node.children.length <= 12).map((node) => node.path)]))
  }, [tree])

  const save = useCallback(async (base?: string) => {
    const current = fileRef.current
    if (!current || current.content === null || saving) return
    if (base === undefined && current.draft === current.content) return
    setSaving(true)
    setError('')
    try {
      const saved = await buildSaveFile(request, userId, sessionId, current.path, current.draft, base ?? current.sha256)
      setFile((previous) => previous && previous.path === saved.path
        ? { ...previous, content: previous.draft, sha256: saved.sha256, modified: saved.modified, size: saved.size } : previous)
      setConflict(null)
      setStale(false)
      onChanged()
    } catch (failure) {
      if (failure instanceof BuildConflict) setConflict(failure)
      else setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setSaving(false)
    }
  }, [onChanged, request, saving, sessionId, userId])

  /**
   * Overwrite Ren's version with the editor's: against the sha the 409 reported (empty when Ren deleted the file,
   * which makes the save a create), or the file's current sha when the change was noticed by a refresh.
   */
  const keepMine = async () => {
    const current = fileRef.current
    if (!current) return
    try {
      const base = conflict ? conflict.sha256 : (await buildFile(request, userId, sessionId, current.path)).sha256
      await save(base)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  const create = async (event: FormEvent) => {
    event.preventDefault()
    const path = newPath.trim().replace(/^\/+/, '')
    if (!path) return
    setError('')
    try {
      await buildSaveFile(request, userId, sessionId, path, '', null)
      setCreating(false)
      setNewPath('')
      setExpanded((current) => new Set([...current, ...ancestors(path)]))
      setSelected(path)
      setFile(null)
      onChanged()
      void load(path)
    } catch (failure) {
      setError(failure instanceof BuildConflict ? `${path} already exists.` : failure instanceof Error ? failure.message : String(failure))
    }
  }

  const remove = async () => {
    if (!selected) return
    if (!confirmDelete) { setConfirmDelete(true); return }
    setError('')
    try {
      await buildDeleteFile(request, userId, sessionId, selected)
      setSelected(null)
      setFile(null)
      setConfirmDelete(false)
      onChanged()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[228px] shrink-0 flex-col border-r border-surface-200/80 dark:border-surface-800" aria-label="Files">
        <PaneBar>
          <span className="tag-label">Files · {entries.filter((entry) => entry.type === 'file').length}</span>
          <button type="button" className={barIconButton} title="New file" aria-label="New file" onClick={() => { setCreating((value) => !value); setNewPath('') }}>
            <FilePlus2 className="h-4 w-4" />
          </button>
        </PaneBar>
        {creating && (
          <form onSubmit={(event) => void create(event)} className="flex items-center gap-1 border-b border-surface-200/80 p-2 dark:border-surface-800">
            <input autoFocus value={newPath} onChange={(event) => setNewPath(event.target.value)} placeholder="src/new-file.ts" aria-label="New file path"
              onKeyDown={(event) => { if (event.key === 'Escape') setCreating(false) }}
              className="h-7 min-w-0 flex-1 rounded-md border border-surface-200 bg-surface-0 px-2 font-mono text-[12px] text-ink outline-none focus:border-blurple-400 focus:ring-2 focus:ring-blurple-500/20 dark:border-surface-700 dark:bg-surface-950 dark:text-ink-inverse" />
            <button type="submit" className={primaryButton} disabled={!newPath.trim()}>Add</button>
          </form>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          {tree.length ? (
            <FileTree expanded={expanded} onExpandedChange={setExpanded} selectedPath={selected ?? undefined}
              // FileTree's `onSelect(path)` shares its name with the DOM's onSelect event in the props type.
              onSelect={(value: unknown) => { if (typeof value === 'string') select(value) }}
              className="rounded-none border-0 bg-transparent text-[12.5px] text-ink-secondary dark:text-ink-inverse-secondary [&_[role=treeitem]]:outline-none [&_[role=treeitem]:focus-visible]:ring-2 [&_[role=treeitem]:focus-visible]:ring-blurple-500/40">
              <TreeNodes nodes={tree} />
            </FileTree>
          ) : <p className="px-3 py-4 text-[12px] text-ink-muted dark:text-ink-inverse-muted">No files yet.</p>}
        </div>
        {(workspace.truncated || workspace.ignored.length > 0) && (
          <p className="border-t border-surface-200/80 px-3 py-2 text-[11px] leading-snug text-ink-muted dark:border-surface-800 dark:text-ink-inverse-muted">
            {workspace.truncated && 'Showing the first part of a large workspace. '}
            {workspace.ignored.length > 0 && `Hidden: ${workspace.ignored.join(', ')}`}
          </p>
        )}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col" aria-label="Editor">
        <PaneBar>
          <div className="flex min-w-0 items-center gap-2">
            {selected ? <>
              <span className="truncate font-mono text-[12px] text-ink dark:text-ink-inverse" title={selected}>{selected}</span>
              {dirty && <span className="h-2 w-2 shrink-0 rounded-full bg-volt" title="Unsaved changes" aria-label="Unsaved changes" />}
            </> : <span className="text-[12px] text-ink-muted dark:text-ink-inverse-muted">No file open</span>}
          </div>
          {file && <div className="flex shrink-0 items-center gap-1">
            <span className="mr-1 hidden text-[11px] text-ink-muted dark:text-ink-inverse-muted md:inline">{languageName(file.path)} · {formatBytes(file.size)}</span>
            {file.content !== null && <button type="button" className={dirty ? primaryButton : barButton} disabled={!dirty || saving} onClick={() => void save()}
              title="Save (⌘S)">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Save</button>}
            <button type="button" onClick={() => void remove()} onBlur={() => setConfirmDelete(false)}
              className={confirmDelete ? 'inline-flex h-7 items-center gap-1.5 rounded-md bg-red-600 px-2 text-[12px] font-semibold text-white hover:bg-red-700' : barIconButton}
              title={confirmDelete ? 'Click again to delete' : 'Delete file'} aria-label={confirmDelete ? `Confirm deleting ${file.path}` : `Delete ${file.path}`}>
              <Trash2 className="h-3.5 w-3.5" />{confirmDelete && 'Delete?'}
            </button>
          </div>}
        </PaneBar>
        {(conflict || stale || error) && (
          <div role="alert" className={cn('flex items-center gap-2.5 border-b px-3 py-2 text-[12px]',
            error && !conflict && !stale ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200'
              : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100')}>
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">{conflict || stale ? 'Ren changed this file while you were editing it.' : error}</span>
            {(conflict || stale) && selected && <>
              <button type="button" className={barButton} onClick={() => void load(selected)}>Load Ren’s version</button>
              <button type="button" className={primaryButton} onClick={() => void keepMine()} disabled={saving}>Keep mine</button>
            </>}
            {error && !conflict && !stale && <button type="button" className={barIconButton} onClick={() => setError('')} aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>}
          </div>
        )}
        <div ref={editorRef} className="relative min-h-0 flex-1 overflow-hidden">
          {loading && !file ? <div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-ink-muted" /></div>
            : file?.binary ? <StudioEmpty icon={FileImage} title="Binary file">{file.path} · {formatBytes(file.size)}. Open it from the preview or ask Ren about it.</StudioEmpty>
            : file?.too_large ? <StudioEmpty icon={FileText} title="Too large to edit here">{file.path} is {formatBytes(file.size)}.</StudioEmpty>
            : file ? <CodeEditor key={loadId} autoFocus={focusEditor} path={file.path} value={file.draft} onChange={(draft) => setFile((previous) => previous ? { ...previous, draft } : previous)} onSave={() => void save()} />
            : <StudioEmpty icon={Code2} title={entries.length ? 'Pick a file' : 'No files yet'}>
                {entries.length ? 'Choose a file on the left to read or edit it. Ren sees your saved edits.' : 'Files appear here the moment Ren writes them.'}
              </StudioEmpty>}
        </div>
      </section>
    </div>
  )
}
