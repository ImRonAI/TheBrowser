'use client'

/**
 * IDE -- a composed development-environment view for agent file/shell activity.
 *
 * This is a *composition* of existing AI Elements primitives, not a reimplementation
 * of any of them. Every child is used with its real, published props:
 *
 *   Artifact / ArtifactHeader / ArtifactActions   the outer frame + header actions
 *   FileTree / FileTreeFolder / FileTreeFile      left pane, file navigation
 *   CodeBlock / CodeBlockCopyButton               center pane, the selected file
 *   Terminal / TerminalHeader / TerminalContent   bottom pane, shell output
 *   PackageInfo / PackageInfoDependency           right rail, dependency manifest
 *   WebPreview / WebPreviewBody / ...Console      slide-out preview of a running app
 *
 * The layout follows the three-pane arrangement: tree left, code + terminal center,
 * with the web preview sliding in over the right side when a dev server is running.
 */

import type { BundledLanguage } from 'shiki'
import { Fragment, useCallback, useMemo, useState } from 'react'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  RotateCwIcon,
} from 'lucide-react'

import { cn } from '@/utils/cn'
import {
  Artifact,
  ArtifactAction,
  ArtifactActions,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from '@/components/ai-elements/artifact'
import {
  FileTree,
  FileTreeFile,
  FileTreeFolder,
} from '@/components/ai-elements/file-tree'
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from '@/components/ai-elements/code-block'
import {
  Terminal,
  TerminalActions,
  TerminalContent,
  TerminalCopyButton,
  TerminalHeader,
  TerminalStatus,
  TerminalTitle,
} from '@/components/ai-elements/terminal'
import {
  PackageInfo,
  PackageInfoContent,
  PackageInfoDependencies,
  PackageInfoDependency,
  PackageInfoHeader,
  PackageInfoName,
  PackageInfoVersion,
} from '@/components/ai-elements/package-info'
import {
  WebPreview,
  WebPreviewBody,
  WebPreviewConsole,
  WebPreviewNavigation,
  WebPreviewNavigationButton,
  WebPreviewUrl,
} from '@/components/ai-elements/web-preview'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** One file the agent created, edited, or read. */
export type IDEFile = {
  /** Full path, used as the FileTree node id and the selection key. */
  path: string
  /** File contents to render in the CodeBlock. */
  code: string
  /**
   * Shiki language for highlighting. Optional -- inferred from the extension
   * when omitted, falling back to plain text.
   */
  language?: BundledLanguage
}

/** A dependency manifest entry, rendered through PackageInfo. */
export type IDEPackage = {
  name: string
  version?: string
  dependencies?: { name: string; version?: string }[]
}

export type IDEProps = {
  /** Files touched during this turn. The first is selected by default. */
  files: IDEFile[]
  /** Accumulated shell/stdout text for the Terminal pane. */
  output?: string
  /** True while a command is still running -- drives TerminalStatus. */
  isStreaming?: boolean
  /** Dev-server URL. When present, the web preview becomes available. */
  previewUrl?: string
  /** Console lines forwarded to WebPreviewConsole. */
  previewLogs?: {
    level: 'log' | 'warn' | 'error'
    message: string
    timestamp: Date
  }[]
  /** Optional dependency manifest for the right rail. */
  packageInfo?: IDEPackage
  title?: string
  description?: string
  className?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Language inference
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a file extension to a Shiki language id.
 *
 * CodeBlock requires a `language`, so an unknown extension resolves to
 * "text" rather than being left undefined.
 */
const EXTENSION_LANGUAGES: Record<string, BundledLanguage> = {
  cjs: 'javascript',
  css: 'css',
  go: 'go',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsonc: 'jsonc',
  jsx: 'jsx',
  md: 'markdown',
  mdx: 'mdx',
  mjs: 'javascript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  scss: 'scss',
  sh: 'bash',
  sql: 'sql',
  swift: 'swift',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
}

export function inferLanguage(path: string): BundledLanguage {
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSION_LANGUAGES[extension] ?? ('text' as BundledLanguage)
}

// ─────────────────────────────────────────────────────────────────────────────
// File tree assembly
// ─────────────────────────────────────────────────────────────────────────────

type TreeNode = {
  name: string
  path: string
  children: Map<string, TreeNode>
  isFile: boolean
}

/** Build a nested folder/file tree from a flat list of paths. */
function buildTree(files: IDEFile[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map(), isFile: false }

  for (const file of files) {
    const segments = file.path.split('/').filter(Boolean)
    let node = root

    segments.forEach((segment, index) => {
      const isLast = index === segments.length - 1
      const path = `${node.path}/${segment}`
      let next = node.children.get(segment)
      if (!next) {
        next = { name: segment, path, children: new Map(), isFile: isLast }
        node.children.set(segment, next)
      }
      node = next
    })
  }

  return root
}

/** Every folder path in the tree, so the tree renders fully expanded. */
function collectFolderPaths(node: TreeNode, into: Set<string> = new Set()): Set<string> {
  for (const child of node.children.values()) {
    if (!child.isFile) {
      into.add(child.path)
      collectFolderPaths(child, into)
    }
  }
  return into
}

/** Render tree nodes recursively, folders before files, each alphabetised. */
function TreeNodes({ node }: { node: TreeNode }) {
  const entries = Array.from(node.children.values()).sort((a, b) => {
    if (a.isFile !== b.isFile) return a.isFile ? 1 : -1
    return a.name.localeCompare(b.name)
  })

  return (
    <Fragment>
      {entries.map((entry) =>
        entry.isFile ? (
          <FileTreeFile key={entry.path} name={entry.name} path={entry.path} />
        ) : (
          <FileTreeFolder key={entry.path} name={entry.name} path={entry.path}>
            <TreeNodes node={entry} />
          </FileTreeFolder>
        ),
      )}
    </Fragment>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// IDE
// ─────────────────────────────────────────────────────────────────────────────

export function IDE({
  files,
  output = '',
  isStreaming = false,
  previewUrl,
  previewLogs = [],
  packageInfo,
  title = 'Workspace',
  description,
  className,
}: IDEProps) {
  const tree = useMemo(() => buildTree(files), [files])
  const defaultExpanded = useMemo(() => collectFolderPaths(tree), [tree])

  // FileTree keys nodes by their leading-slash path, so selection must match.
  const [selectedPath, setSelectedPath] = useState<string>(() =>
    files.length > 0 ? `/${files[0].path.split('/').filter(Boolean).join('/')}` : '',
  )
  const [previewOpen, setPreviewOpen] = useState(false)

  const byTreePath = useMemo(() => {
    const map = new Map<string, IDEFile>()
    for (const file of files) {
      map.set(`/${file.path.split('/').filter(Boolean).join('/')}`, file)
    }
    return map
  }, [files])

  const selected = byTreePath.get(selectedPath) ?? files[0]

  /**
   * FileTreeProps extends HTMLAttributes, so its `onSelect` type intersects with
   * the DOM `onSelect` handler. FileTree destructures `onSelect` out before
   * spreading the rest onto its div, so it is only ever called with a path --
   * the extra SyntheticEvent arm of the intersection is unreachable. Typing the
   * parameter as the union satisfies both arms without casting the component.
   */
  const handleSelect = useCallback(
    (path: string | React.SyntheticEvent<HTMLDivElement>) => {
      // Folder clicks also fire onSelect; only switch when a real file is hit.
      if (typeof path === 'string' && byTreePath.has(path)) setSelectedPath(path)
    },
    [byTreePath],
  )

  const togglePreview = useCallback(() => setPreviewOpen((open) => !open), [])

  return (
    <Artifact className={cn('overflow-hidden', className)}>
      <ArtifactHeader>
        <div className="min-w-0">
          <ArtifactTitle>{title}</ArtifactTitle>
          {description && <ArtifactDescription>{description}</ArtifactDescription>}
        </div>
        <ArtifactActions>
          {previewUrl && (
            <ArtifactAction
              className="w-auto gap-1.5 px-2"
              label={previewOpen ? 'Hide preview' : 'Show preview'}
              onClick={togglePreview}
              tooltip={previewOpen ? 'Hide preview' : 'Show preview'}
            >
              {previewOpen ? (
                <PanelRightCloseIcon className="size-4" />
              ) : (
                <PanelRightOpenIcon className="size-4" />
              )}
              Preview
            </ArtifactAction>
          )}
        </ArtifactActions>
      </ArtifactHeader>

      {/* relative: anchors the sliding preview overlay */}
      <div className="relative flex min-h-0">
        {/* Left: file navigation */}
        <div className="w-56 shrink-0 overflow-auto border-r p-2">
          <FileTree
            defaultExpanded={defaultExpanded}
            onSelect={handleSelect}
            selectedPath={selectedPath}
          >
            <TreeNodes node={tree} />
          </FileTree>
        </div>

        {/* Center: code above, terminal below */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {selected ? (
              <CodeBlock
                code={selected.code}
                language={selected.language ?? inferLanguage(selected.path)}
                showLineNumbers
              >
                <CodeBlockHeader>
                  <CodeBlockTitle>
                    <CodeBlockFilename>{selected.path}</CodeBlockFilename>
                  </CodeBlockTitle>
                  <CodeBlockActions>
                    <CodeBlockCopyButton />
                  </CodeBlockActions>
                </CodeBlockHeader>
              </CodeBlock>
            ) : (
              <p className="p-4 text-muted-foreground text-sm">No files yet.</p>
            )}
          </div>

          {(output || isStreaming) && (
            <div className="border-t p-3">
              <Terminal isStreaming={isStreaming} output={output}>
                <TerminalHeader>
                  <TerminalTitle>Terminal</TerminalTitle>
                  <TerminalStatus />
                  <TerminalActions>
                    <TerminalCopyButton />
                  </TerminalActions>
                </TerminalHeader>
                <TerminalContent />
              </Terminal>
            </div>
          )}
        </div>

        {/* Right rail: dependency manifest */}
        {packageInfo && (
          <div className="w-64 shrink-0 overflow-auto border-l p-3">
            <PackageInfo name={packageInfo.name} currentVersion={packageInfo.version}>
              <PackageInfoHeader>
                <PackageInfoName />
                <PackageInfoVersion />
              </PackageInfoHeader>
              {packageInfo.dependencies && packageInfo.dependencies.length > 0 && (
                <PackageInfoContent>
                  <PackageInfoDependencies>
                    {packageInfo.dependencies.map((dependency) => (
                      <PackageInfoDependency
                        key={dependency.name}
                        name={dependency.name}
                        version={dependency.version}
                      />
                    ))}
                  </PackageInfoDependencies>
                </PackageInfoContent>
              )}
            </PackageInfo>
          </div>
        )}

        {/* Web preview: slides in from the right edge over the IDE */}
        {previewUrl && (
          <div
            aria-hidden={!previewOpen}
            className={cn(
              'absolute inset-y-0 right-0 flex w-full max-w-2xl transform-gpu flex-col border-l bg-background shadow-xl transition-transform duration-300 ease-out',
              previewOpen ? 'translate-x-0' : 'pointer-events-none translate-x-full',
            )}
          >
            <WebPreview className="flex min-h-0 flex-1 flex-col" defaultUrl={previewUrl}>
              <WebPreviewNavigation>
                <WebPreviewNavigationButton
                  disabled
                  tooltip="Back"
                  onClick={() => undefined}
                >
                  <ArrowLeftIcon className="size-4" />
                </WebPreviewNavigationButton>
                <WebPreviewNavigationButton
                  disabled
                  tooltip="Forward"
                  onClick={() => undefined}
                >
                  <ArrowRightIcon className="size-4" />
                </WebPreviewNavigationButton>
                <WebPreviewNavigationButton
                  onClick={() => setPreviewOpen(true)}
                  tooltip="Reload"
                >
                  <RotateCwIcon className="size-4" />
                </WebPreviewNavigationButton>
                <WebPreviewUrl readOnly />
              </WebPreviewNavigation>
              <WebPreviewBody />
              <WebPreviewConsole logs={previewLogs} />
            </WebPreview>
          </div>
        )}
      </div>
    </Artifact>
  )
}
