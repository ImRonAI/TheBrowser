/**
 * Renderer client for the Build agent's workspace (`agent/api/endpoints/build.py`, docs/build-agent.md): the files
 * the agent writes for one Build conversation, their contents, edits made in the Code tab (version-checked by
 * sha256), the workspace's git history and the URL of its live static preview. Every route is loopback-only and
 * scoped by (user, session). No React, no `@/` imports (node-testable).
 */

export interface BuildEntry { path: string; type: 'file' | 'dir'; size: number; modified: number }
export interface BuildPackage {
  name?: string; version?: string; description?: string
  scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string>
}
export interface BuildWorkspace {
  workspace_id: string
  root: string
  exists: boolean
  entries: BuildEntry[]
  truncated: boolean
  ignored: string[]
  has_index: boolean
  package: BuildPackage | null
  env: { name: string; file: string }[]
  /** `/build/preview/<workspace_id>/` when the workspace has a root index.html. */
  preview_url: string | null
}
export interface BuildFile {
  path: string; size: number; modified: number; sha256: string
  binary: boolean; too_large: boolean; content: string | null
}
export interface BuildSaved { path: string; size: number; modified: number; sha256: string }
/** `status` is git's letter (A, M, D, R, C, T); `old_path` is set for a rename or copy. */
export interface BuildCommitFile { path: string; status: string; additions: number; deletions: number; old_path: string | null }
export interface BuildCommit {
  /** `date` is the author date in ISO 8601 (`%aI`). */
  hash: string; short: string; author: string; email: string; date: string; message: string; body: string
  files: BuildCommitFile[]
}
/** `dirty` is `git status --porcelain=v1`: `status` is the two-letter XY code. */
export interface BuildGit {
  repo: boolean; branch: string | null; commits: BuildCommit[]; dirty: { path: string; status: string }[]
}

/** A Code-tab save lost a race with the agent (or another save): the file changed on disk since it was opened. */
export class BuildConflict extends Error {
  readonly sha256: string
  constructor(message: string, sha256: string) {
    super(message)
    this.name = 'BuildConflict'
    this.sha256 = sha256
  }
}

export type BuildRequest = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>

export function createBuildRequest(baseUrl: string, fetcher: typeof fetch = fetch): BuildRequest {
  return async <T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> => {
    let response: Response
    try {
      response = await fetcher(`${baseUrl.replace(/\/$/, '')}/build${path}`, {
        method: init.method ?? 'GET',
        headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(30000),
      })
    } catch {
      throw new Error('Cannot reach the Build workspace. Is the Ren backend running?')
    }
    if (response.status === 204) return undefined as T
    const data: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const detail = typeof data === 'object' && data !== null ? (data as { detail?: unknown }).detail : undefined
      if (response.status === 409 && typeof detail === 'object' && detail !== null) {
        const conflict = detail as { message?: unknown; sha256?: unknown }
        throw new BuildConflict(typeof conflict.message === 'string' ? conflict.message : 'The file changed on disk.', String(conflict.sha256 ?? ''))
      }
      throw new Error(typeof detail === 'string' ? detail : `Build workspace request failed (${response.status})`)
    }
    return data as T
  }
}

const query = (params: Record<string, string | number>) =>
  `?${new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString()}`

export const buildWorkspace = (request: BuildRequest, userId: string, sessionId: string) =>
  request<BuildWorkspace>(`/workspace${query({ user_id: userId, session_id: sessionId })}`)
export const buildFile = (request: BuildRequest, userId: string, sessionId: string, path: string) =>
  request<BuildFile>(`/file${query({ user_id: userId, session_id: sessionId, path })}`)
/** `baseSha256` is the version the editor opened; null creates a new file (409 when it already exists). */
export const buildSaveFile = (request: BuildRequest, userId: string, sessionId: string, path: string, content: string, baseSha256: string | null) =>
  request<BuildSaved>('/file', { method: 'PUT', body: { user_id: userId, session_id: sessionId, path, content, base_sha256: baseSha256 } })
export const buildDeleteFile = (request: BuildRequest, userId: string, sessionId: string, path: string) =>
  request<void>(`/file${query({ user_id: userId, session_id: sessionId, path })}`, { method: 'DELETE' })
export const buildGit = (request: BuildRequest, userId: string, sessionId: string, limit = 30) =>
  request<BuildGit>(`/git${query({ user_id: userId, session_id: sessionId, limit })}`)

/** The absolute URL of the workspace's static preview (served with a CSP sandbox, so it never shares the API's origin). */
export const buildPreviewUrl = (baseUrl: string, workspace: Pick<BuildWorkspace, 'preview_url'>) =>
  workspace.preview_url ? `${baseUrl.replace(/\/$/, '')}${workspace.preview_url}` : null

const hidden = (path: string) => path.split('/').some((part) => part.startsWith('.'))

/** Where the preview route serves one workspace file; null for a path under a dot segment, which it never serves. */
export function buildFileUrl(baseUrl: string, workspace: Pick<BuildWorkspace, 'workspace_id'>, path: string): string | null {
  const parts = path.split('/').filter(Boolean)
  if (!parts.length || hidden(path)) return null
  return `${baseUrl.replace(/\/$/, '')}/build/preview/${workspace.workspace_id}/${parts.map(encodeURIComponent).join('/')}`
}

/** What a static page loads: markup, styles, scripts, data, images, fonts and media. */
const PREVIEW_ASSET = /\.(html?|css|m?js|json|csv|xml|wasm|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|mp3|wav|ogg|mp4|webm)$/i

/**
 * A fingerprint of the files the static preview can load (FNV-1a over each one's path and modification time): it
 * changes when one is added, edited, renamed or deleted, and not for anything else Ren touches (a README, tests,
 * `.ren-dev.log`), so the preview reloads only when the page itself may have changed.
 */
export function previewVersion(entries: BuildEntry[]): string {
  let hash = 0x811c9dc5
  for (const entry of entries) {
    if (entry.type !== 'file' || !PREVIEW_ASSET.test(entry.path) || hidden(entry.path)) continue
    const key = `${entry.path}\u0000${entry.modified}\n`
    for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/** The flat listing as a tree: folders first, then files, each level sorted by name. */
export interface BuildTreeNode { path: string; name: string; type: 'file' | 'dir'; children: BuildTreeNode[] }
export function buildTree(entries: BuildEntry[]): BuildTreeNode[] {
  const root: BuildTreeNode = { path: '', name: '', type: 'dir', children: [] }
  const byPath = new Map<string, BuildTreeNode>([['', root]])
  const ensureDir = (path: string): BuildTreeNode => {
    const existing = byPath.get(path)
    if (existing) return existing
    const slash = path.lastIndexOf('/')
    const parent = ensureDir(slash < 0 ? '' : path.slice(0, slash))
    const node: BuildTreeNode = { path, name: path.slice(slash + 1), type: 'dir', children: [] }
    parent.children.push(node)
    byPath.set(path, node)
    return node
  }
  for (const entry of entries) {
    if (entry.type === 'dir') { ensureDir(entry.path); continue }
    const slash = entry.path.lastIndexOf('/')
    const parent = ensureDir(slash < 0 ? '' : entry.path.slice(0, slash))
    parent.children.push({ path: entry.path, name: entry.path.slice(slash + 1), type: 'file', children: [] })
  }
  const sort = (nodes: BuildTreeNode[]) => {
    nodes.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1)
    for (const node of nodes) sort(node.children)
  }
  sort(root.children)
  return root.children
}

/** The file a fresh workspace view should open: the root index.html, a README, then the first source file. */
export function defaultBuildFile(entries: BuildEntry[]): string | null {
  const files = entries.filter((entry) => entry.type === 'file').map((entry) => entry.path)
  return files.find((path) => path === 'index.html') ?? files.find((path) => /^readme(\.md)?$/i.test(path))
    ?? files.find((path) => /\.(tsx?|jsx?|py|html|css|md)$/.test(path)) ?? files[0] ?? null
}

/** A tool's path as a workspace-relative path: the agent's editor/shell work with absolute paths under `root`. */
export function workspaceRelative(workspace: Pick<BuildWorkspace, 'root' | 'workspace_id'>, path: string): string | null {
  const root = workspace.root.replace(/\/+$/, '')
  if (path.startsWith(`${root}/`)) return path.slice(root.length + 1)
  // macOS reports /var/… and /private/var/… for the same directory; the workspace id is unique either way.
  const marker = `/${workspace.workspace_id}/`
  const at = path.indexOf(marker)
  return at >= 0 ? path.slice(at + marker.length) : null
}
