/**
 * Map agent tool calls onto AI Elements components.
 *
 * Every field read here was verified against the live tool surface rather than
 * assumed. The Strands Shell MCP server (agent/api/endpoints/chat.py) exposes
 * exactly four tools, reported by `list_tools_sync()` with the client-side
 * `prefix="sandbox"`:
 *
 *   sandbox_shell       { command, timeout_ms? }        -> Terminal
 *   sandbox_read_file   { file_path, offset?, limit? }  -> IDE
 *   sandbox_write_file  { file_path, content }          -> IDE
 *   sandbox_list_dir    { dir_path }                    -> IDE (file tree only)
 *
 * xAI's server-side `code_execution()` tool maps to the Sandbox component.
 *
 * Tool results arrive as `{ content: [{ text }] }`, never a bare string --
 * `sandbox_shell` returns two blocks (stdout then stderr).
 */

import type { IDEFile } from '@/components/ai-elements/ide'

/** Which component a given tool renders through. */
export type ToolView = 'terminal' | 'ide' | 'sandbox' | 'default'

/**
 * The MCP client is constructed with `prefix="sandbox"`, so tool names reach the
 * UI prefixed. The bare names are accepted too, since the prefix is applied
 * client-side and the underlying server registers them unprefixed.
 */
const TOOL_VIEWS: Record<string, ToolView> = {
  code_execution: 'sandbox',
  list_dir: 'ide',
  read_file: 'ide',
  sandbox_list_dir: 'ide',
  sandbox_read_file: 'ide',
  sandbox_shell: 'terminal',
  sandbox_write_file: 'ide',
  shell: 'terminal',
  write_file: 'ide',
}

export function getToolView(toolName: string): ToolView {
  return TOOL_VIEWS[toolName] ?? 'default'
}

/**
 * Flatten an MCP tool result into text.
 *
 * Verified shape: `{ content: [{ text: string }] }`. `sandbox_shell` emits
 * stdout and stderr as separate blocks, so all blocks are joined.
 */
export function toolOutputText(output: unknown): string {
  if (typeof output === 'string') return output
  if (!output || typeof output !== 'object') return ''

  const { content } = output as { content?: { text?: string }[] }
  if (!Array.isArray(content)) return ''

  return content
    .map((block) => (typeof block?.text === 'string' ? block.text : ''))
    .filter(Boolean)
    .join('')
}

/**
 * Strip the line-number gutter that `read_file` prepends.
 *
 * Verified output: `"     1\tprint('hi')\n"` -- right-aligned number, tab, then
 * the line. Lines that don't match are passed through untouched so ordinary file
 * content containing tabs is never mangled.
 */
export function stripLineNumbers(text: string): string {
  const lines = text.split('\n')
  const numbered = lines.filter((line) => /^\s*\d+\t/.test(line))
  // Only strip when the gutter is consistently present, not incidentally.
  if (numbered.length === 0 || numbered.length < lines.filter(Boolean).length) {
    return text
  }
  return lines.map((line) => line.replace(/^\s*\d+\t/, '')).join('\n')
}

/**
 * Derive the IDE's file list from one file-tool call.
 *
 * `write_file` carries the new contents on its *input* -- its output is only
 * "Wrote N bytes to <path>" -- so input is the source of truth for content,
 * while `read_file` content comes from the output.
 */
export function fileFromToolCall(
  toolName: string,
  input: unknown,
  output: unknown,
): IDEFile | null {
  const args = (input ?? {}) as {
    file_path?: string
    content?: string
    dir_path?: string
  }

  if (toolName.endsWith('write_file')) {
    if (!args.file_path) return null
    return { path: args.file_path, code: args.content ?? '' }
  }

  if (toolName.endsWith('read_file')) {
    if (!args.file_path) return null
    return { path: args.file_path, code: stripLineNumbers(toolOutputText(output)) }
  }

  return null
}

/**
 * Parse `list_dir` output into file paths for the tree.
 *
 * Verified output: tab-separated `"<kind>\t<name>\n"`, where kind is `file` or
 * `dir` (e.g. `"file\tdemo.py"`, `"dir\tsrc"`). Directories are skipped: the
 * IDE derives folders from the path segments of the files it is given, so
 * emitting a bare directory would render it as an empty leaf node.
 */
export function filesFromListDir(input: unknown, output: unknown): IDEFile[] {
  const { dir_path: dirPath } = (input ?? {}) as { dir_path?: string }
  if (!dirPath) return []

  const base = dirPath.replace(/\/+$/, '')

  return toolOutputText(output)
    .split('\n')
    .map((line) => line.split('\t'))
    .filter(([kind, name]) => kind?.trim() === 'file' && name?.trim().length > 0)
    .map(([, name]) => ({ path: `${base}/${name.trim()}`, code: '' }))
}

/**
 * Detect a dev-server URL in shell output so the web preview can be offered.
 *
 * Matches the localhost URLs that dev servers print on boot (Vite, Next, CRA).
 */
export function detectPreviewUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?[^\s"'<>]*/)
  return match?.[0]
}
