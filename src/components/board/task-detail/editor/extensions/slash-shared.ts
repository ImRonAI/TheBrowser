import type { Editor } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import type { LucideIcon } from 'lucide-react'
import type { SlashGroup } from '@/lib/editor-blocks'

/** One "/" option. What it does lives in `SlashCommandMenu`. */
export interface SlashItem {
  id: string
  label: string
  /** One line under the label. */
  description: string
  group: SlashGroup
  icon: LucideIcon
  /** Other words that find the item ("ul" finds Bullet list). */
  keywords?: readonly string[]
  /** Schema nodes or marks the item needs; it is hidden in editors without them. */
  requires?: readonly string[]
}

/** The "/" suggestion's own plugin key, so it never collides with other suggestion menus (mentions). */
export const SLASH_PLUGIN_KEY = new PluginKey('slashCommand')

/** The Ask Ron callback the editor was configured with (`SlashCommand.configure({ onAskRon })`). */
export function askRonCallback(editor: Editor): ((goal: boolean) => void) | null {
  return editor.extensionManager.extensions.find((extension) => extension.name === 'slashCommand')?.options.onAskRon ?? null
}
