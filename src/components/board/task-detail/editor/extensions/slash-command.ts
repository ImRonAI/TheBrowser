import { Extension, type Editor, type Range } from '@tiptap/core'
import { RenIcon } from '@/components/brand'
import Suggestion, { type SuggestionKeyDownProps, type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import { AlertTriangle, AppWindow, Baseline, CalendarDays, CheckSquare, Clapperboard, Code, Columns2, Columns3, Columns4, CreditCard, Figma, FileSymlink, FileText, Film, HardDrive, Heading1, Heading2, Heading3, Highlighter, Image, List, ListCollapse, ListOrdered, ListTree, MapPin, MessageSquareText, Minus, MousePointerClick, Music, Quote, Radical, Sigma, Smile, SquareKanban, Table, Target, Type, Upload, Video, Workflow, Youtube } from 'lucide-react'
import { flattenSections, slashSections } from '@/lib/editor-blocks'
import { SLASH_PLUGIN_KEY, askRonCallback, type SlashItem } from './slash-shared'
import { SlashCommandMenu, type SlashMenuHandle } from '../SlashCommandMenu'

export type { SlashItem } from './slash-shared'

/**
 * Every "/" option, in menu order. What each one does lives in `SlashCommandMenu` (`runSlashItem` and
 * the in-popover steps for links, pickers and forms).
 */
export const SLASH_COMMANDS: readonly SlashItem[] = [
  // Basic blocks
  { id: 'text', label: 'Text', description: 'Plain paragraph text', group: 'basic', icon: Type, keywords: ['paragraph', 'p', 'plain'] },
  { id: 'h1', label: 'Heading 1', description: 'Big section heading', group: 'basic', icon: Heading1, keywords: ['h1', 'title', '#'] },
  { id: 'h2', label: 'Heading 2', description: 'Medium section heading', group: 'basic', icon: Heading2, keywords: ['h2', 'subtitle', '##'] },
  { id: 'h3', label: 'Heading 3', description: 'Small section heading', group: 'basic', icon: Heading3, keywords: ['h3', 'subheading', '###'] },
  { id: 'toggle-h1', label: 'Toggle heading 1', description: 'Big heading that hides content inside', group: 'basic', icon: ListCollapse, keywords: ['collapsible', 'th1', 'details'], requires: ['details'] },
  { id: 'toggle-h2', label: 'Toggle heading 2', description: 'Medium heading that hides content inside', group: 'basic', icon: ListCollapse, keywords: ['collapsible', 'th2', 'details'], requires: ['details'] },
  { id: 'toggle-h3', label: 'Toggle heading 3', description: 'Small heading that hides content inside', group: 'basic', icon: ListCollapse, keywords: ['collapsible', 'th3', 'details'], requires: ['details'] },
  { id: 'quote', label: 'Quote', description: 'Capture a quote', group: 'basic', icon: Quote, keywords: ['blockquote', 'citation', '>'] },
  { id: 'divider', label: 'Divider', description: 'Visually separate blocks', group: 'basic', icon: Minus, keywords: ['hr', 'horizontal rule', 'line', 'separator', '---'] },
  { id: 'callout', label: 'Callout', description: 'Info, warning, success or tip box', group: 'basic', icon: AlertTriangle, keywords: ['note', 'info', 'warning', 'success', 'tip', 'alert', 'admonition', 'box'], requires: ['callout'] },
  // Lists
  { id: 'bullet', label: 'Bullet List', description: 'A simple bulleted list', group: 'lists', icon: List, keywords: ['ul', 'unordered', 'bulleted', '-'] },
  { id: 'numbered', label: 'Numbered list', description: 'A list with numbering', group: 'lists', icon: ListOrdered, keywords: ['ol', 'ordered', '1.'] },
  { id: 'todo', label: 'To-Do List', description: 'Track tasks with checkboxes', group: 'lists', icon: CheckSquare, keywords: ['task', 'checkbox', 'checklist', '[]'] },
  { id: 'toggle', label: 'Toggle list', description: 'Show or hide the content inside', group: 'lists', icon: ListCollapse, keywords: ['collapsible', 'accordion', 'details', 'expand'], requires: ['details'] },
  // Media
  { id: 'image', label: 'Image', description: 'Upload an image or embed one by link', group: 'media', icon: Image, keywords: ['picture', 'photo', 'img', 'png', 'jpg', 'screenshot'], requires: ['image'] },
  { id: 'youtube', label: 'YouTube video', description: 'Play a YouTube video in the page', group: 'media', icon: Youtube, keywords: ['video', 'yt'], requires: ['youtube'] },
  { id: 'video', label: 'Video', description: 'Play a video file from a link', group: 'media', icon: Clapperboard, keywords: ['mp4', 'webm', 'movie', 'clip'], requires: ['media'] },
  { id: 'audio', label: 'Audio', description: 'Play an audio file from a link', group: 'media', icon: Music, keywords: ['mp3', 'sound', 'podcast', 'music'], requires: ['media'] },
  { id: 'pdf', label: 'PDF', description: 'Upload a PDF or view one by link', group: 'media', icon: FileText, keywords: ['document', 'file', 'viewer'], requires: ['pdf'] },
  { id: 'upload', label: 'Upload File', description: 'Attach any file', group: 'media', icon: Upload, keywords: ['file', 'attachment', 'attach'], requires: ['fileAttachment'] },
  // Embeds
  { id: 'embed', label: 'Embed', description: 'Show any https page inside the page', group: 'embeds', icon: AppWindow, keywords: ['iframe', 'website', 'url', 'link', 'web'], requires: ['embed'] },
  { id: 'maps', label: 'Google Maps', description: 'An interactive map of a place or address', group: 'embeds', icon: MapPin, keywords: ['map', 'location', 'address', 'directions'], requires: ['embed'] },
  { id: 'figma', label: 'Figma', description: 'A live Figma file or prototype', group: 'embeds', icon: Figma, keywords: ['design', 'prototype'], requires: ['embed'] },
  { id: 'loom', label: 'Loom', description: 'A Loom screen recording', group: 'embeds', icon: Video, keywords: ['recording', 'screen'], requires: ['embed'] },
  { id: 'vimeo', label: 'Vimeo', description: 'A Vimeo video', group: 'embeds', icon: Film, keywords: ['video'], requires: ['embed'] },
  { id: 'drive', label: 'Google Drive', description: 'A Google Doc, Sheet, Slides deck, Form or file', group: 'embeds', icon: HardDrive, keywords: ['docs', 'sheets', 'slides', 'forms', 'spreadsheet', 'gdrive'], requires: ['embed'] },
  // Layout
  { id: 'columns-2', label: '2 columns', description: 'Two side-by-side columns', group: 'layout', icon: Columns2, keywords: ['columns', 'layout', 'section', 'side by side', 'split'], requires: ['columns'] },
  { id: 'columns-3', label: '3 columns', description: 'Three side-by-side columns', group: 'layout', icon: Columns3, keywords: ['columns', 'layout', 'section', 'grid'], requires: ['columns'] },
  { id: 'columns-4', label: '4 columns', description: 'Four side-by-side columns', group: 'layout', icon: Columns4, keywords: ['columns', 'layout', 'section', 'grid'], requires: ['columns'] },
  { id: 'card', label: 'Card', description: 'A titled card to fill in', group: 'layout', icon: CreditCard, keywords: ['box', 'panel', 'container', 'form'], requires: ['card'] },
  { id: 'table', label: 'Table', description: 'A 3 × 3 table with a header row', group: 'layout', icon: Table, keywords: ['grid', 'spreadsheet', 'rows'] },
  { id: 'toc', label: 'Table of contents', description: 'A live outline of the headings', group: 'layout', icon: ListTree, keywords: ['toc', 'outline', 'contents', 'index'], requires: ['tableOfContents'] },
  // Advanced
  { id: 'code', label: 'Code Block', description: 'Code with syntax highlighting', group: 'advanced', icon: Code, keywords: ['snippet', 'pre', '```', 'program'] },
  { id: 'math-block', label: 'Block equation', description: 'A centered LaTeX equation', group: 'advanced', icon: Sigma, keywords: ['math', 'latex', 'katex', 'formula', 'tex'], requires: ['blockMath'] },
  { id: 'math-inline', label: 'Inline equation', description: 'LaTeX inside the text', group: 'advanced', icon: Radical, keywords: ['math', 'latex', 'katex', 'formula', 'tex'], requires: ['inlineMath'] },
  { id: 'emoji', label: 'Emoji', description: 'Search and insert an emoji', group: 'advanced', icon: Smile, keywords: ['emoticon', 'smiley', 'icon'] },
  { id: 'color', label: 'Text color', description: 'Color this block’s text', group: 'advanced', icon: Baseline, keywords: ['colour', 'font color', 'red', 'blue', 'green'], requires: ['textStyle'] },
  { id: 'highlight', label: 'Highlight', description: 'Highlight this block’s text', group: 'advanced', icon: Highlighter, keywords: ['background', 'marker', 'mark', 'colour'], requires: ['highlight'] },
  { id: 'date', label: 'Date', description: 'Insert a date (today, tomorrow, any day)', group: 'advanced', icon: CalendarDays, keywords: ['today', 'tomorrow', 'reminder', 'deadline', 'due', 'time'], requires: ['dateChip'] },
  // Offered only by editors that load WorkflowBlockExtension (project documents, issue descriptions).
  { id: 'workflow', label: 'Show a workflow', description: 'Draw a process as a diagram', group: 'advanced', icon: Workflow, keywords: ['workflow', 'diagram', 'flowchart', 'process'], requires: ['workflow'] },
  // Ron / Workspace
  { id: 'ask-ron', label: 'Ask Ren', description: 'Ren writes or edits this for you', group: 'workspace', icon: RenIcon, keywords: ['ai', 'write', 'draft', 'assistant'] },
  { id: 'goal', label: 'Goal', description: 'Give Ren a goal to work toward', group: 'workspace', icon: Target, keywords: ['ai', 'objective', 'agent'] },
  { id: 'issue', label: 'Embed an issue', description: 'A live card for an issue in your projects', group: 'workspace', icon: SquareKanban, keywords: ['task', 'ticket', 'bug', 'story', 'epic', 'project'], requires: ['issueEmbed'] },
  { id: 'chat', label: 'Reference a chat', description: 'Link a previous Agent Panel conversation', group: 'workspace', icon: MessageSquareText, keywords: ['thread', 'conversation', 'agent', 'history'], requires: ['chatReference'] },
  { id: 'page', label: 'Link to page', description: 'Link another project page', group: 'workspace', icon: FileSymlink, keywords: ['document', 'doc', 'mention', 'reference', 'wiki'], requires: ['pageLink'] },
  { id: 'ron-button', label: 'Ren button', description: 'A button that sends a saved prompt to Ren', group: 'workspace', icon: MousePointerClick, keywords: ['button', 'action', 'automation', 'prompt'], requires: ['ronButton'] },
]

function available(item: SlashItem, editor?: Editor): boolean {
  if (!editor) return !item.requires?.length
  const { nodes, marks } = editor.schema
  if (item.requires?.some((name) => !nodes[name] && !marks[name])) return false
  // Goal needs the editor's Ask Ron callback; Ask Ron also works through the inline Ask Ron block.
  if (item.id === 'goal') return !!askRonCallback(editor)
  if (item.id === 'ask-ron') return !!askRonCallback(editor) || !!nodes.askRon
  return true
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addOptions() {
    return {
      onAskRon: null as ((goal: boolean) => void) | null,
      suggestion: {
        char: '/',
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: { command: (args: { editor: Editor; range: Range }) => void } }) => {
          props.command({ editor, range })
        },
      },
    }
  },

  addProseMirrorPlugins() {
    const options = this.options.suggestion as Partial<SuggestionOptions<SlashItem>>
    return [
      Suggestion({
        pluginKey: SLASH_PLUGIN_KEY,
        editor: this.editor,
        ...options,
        // Multi-word queries ("/heading 2", "/table of contents") keep the menu open, as in Notion. It closes
        // when the query starts with a space, has a double space, or has a space and matches nothing.
        allowSpaces: true,
        shouldShow: ({ editor, query }) => !/^\s|\s\s/.test(query)
          && (!/\s/.test(query) || !options.items || (options.items({ query, editor, signal: new AbortController().signal }) as SlashItem[]).length > 0),
      }),
    ]
  },
})

export const suggestionOptions = {
  // Fixed positioning keeps the menu on screen inside scrolled panes and the issue modal.
  floatingUi: { strategy: 'fixed' as const },

  items: ({ query, editor }: { query: string; editor?: Editor }): SlashItem[] =>
    flattenSections(slashSections(SLASH_COMMANDS.filter((item) => available(item, editor)), query)),

  render: () => {
    let renderer: ReactRenderer<SlashMenuHandle, SuggestionProps<SlashItem>> | null = null
    let unmount: (() => void) | null = null

    return {
      onStart: (props: SuggestionProps<SlashItem>) => {
        renderer = new ReactRenderer<SlashMenuHandle, SuggestionProps<SlashItem>>(SlashCommandMenu, { props, editor: props.editor })
        const element = renderer.element as HTMLElement
        element.classList.add('ron-slash-popover')
        // Above the issue workspace modal (z-200) and the app chrome.
        element.style.zIndex = '400'
        unmount = props.mount(element)
      },

      onUpdate: (props: SuggestionProps<SlashItem>) => {
        renderer?.updateProps(props)
      },

      // Escape is handled by the suggestion plugin itself (it closes the menu).
      onKeyDown: (props: SuggestionKeyDownProps) => renderer?.ref?.onKeyDown(props) ?? false,

      onExit: () => {
        unmount?.()
        renderer?.destroy()
        unmount = null
        renderer = null
      },
    }
  },
}
