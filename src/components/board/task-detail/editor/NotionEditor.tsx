import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import type { Extensions } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import { SlashCommand, suggestionOptions } from './extensions/slash-command'
import { FileAttachmentExtension } from './extensions/FileAttachmentExtension'
import { AskRonExtension } from './extensions/AskRonExtension'
import { BLOCK_EXTENSIONS } from './extensions/blocks'
import { ReferenceMention } from './extensions/ReferenceMention'
import { 
  Bold, 
  Italic, 
  Underline as UnderlineIcon, 
  Code as CodeIcon
} from 'lucide-react'
import { useEffect } from 'react'

const lowlight = createLowlight(common)

interface NotionEditorProps {
  content: string
  onChange: (content: string) => void
  onSave?: () => void
  placeholder?: string
  readOnly?: boolean
  canonical?: boolean
  onAskRon?: (goal: boolean) => void
  /** Extra blocks for this editor only (project documents add the workflow block). */
  extensions?: Extensions
  /** Receives the editor instance, e.g. for a fixed formatting toolbar; null on unmount. */
  onEditor?: (editor: Editor | null) => void
  /** Replaces the default classes of the editable area. */
  editorClassName?: string
  /** A read-only rendering sized to its content: no minimum height and no editing hints. */
  preview?: boolean
}

export function NotionEditor({ 
  content, 
  onChange, 
  onSave, 
  placeholder = 'Type / for commands...',
  readOnly = false,
  canonical = false,
  onAskRon,
  extensions = [],
  onEditor,
  editorClassName = 'prose prose-lg dark:prose-invert max-w-none focus:outline-none min-h-[200px] p-6',
  preview = false,
}: NotionEditorProps) {
  
  const editor = useEditor({
    editable: !readOnly,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false, // We use lowlight
        link: false, // Disable StarterKit's link (we use extension-link)
        underline: false, // Disable StarterKit's underline (we use extension-underline)
      }),
      Placeholder.configure({ 
        placeholder: ({ node }) => {
            if (node.type.name === 'heading') {
                return `Heading ${node.attrs.level}`
            }
            return placeholder
        }
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      // `@` references: pages, tools, agents, MCP servers and skills.
      ReferenceMention,
      TaskList,
      TaskItem.configure({ nested: true }),
      Underline,
      // Clicking a link opens it (Tiptap's window.open, target _blank); Electron turns that into a new app tab.
      Link.configure({
        openOnClick: true,
        HTMLAttributes: {
            class: 'cursor-pointer',
        },
      }),
      CodeBlockLowlight.configure({
        lowlight,
      }),
      SlashCommand.configure({
        onAskRon,
        suggestion: canonical ? { ...suggestionOptions, items: (args: Parameters<typeof suggestionOptions.items>[0]) =>
          suggestionOptions.items(args).filter((item) => item.id !== 'upload' && (!!onAskRon || !['ask-ron', 'goal'].includes(item.id))) } : suggestionOptions,
      }),
      ...(!canonical ? [FileAttachmentExtension, AskRonExtension] : []),
      // The "/" menu's blocks (embeds, media, layout, equations, issue/chat/page references).
      ...BLOCK_EXTENSIONS,
      ...extensions,
    ],
    content,
    shouldRerenderOnTransaction: false,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
    editorProps: {
      attributes: {
        class: editorClassName,
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 's' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          onSave?.()
          return true
        }
        return false
      }
    },
  })

  useEffect(() => {
    onEditor?.(editor)
    return () => onEditor?.(null)
  }, [editor, onEditor])

  useEffect(() => {
    // A lock transition is not a document edit. Emitting onUpdate here can
    // overwrite the final streamed draft with the editor's previous chunk.
    editor?.setEditable(!readOnly, false)
  }, [editor, readOnly])

  useEffect(() => {
    if (!editor) return

    const nextContent = content || ''
    if (nextContent !== editor.getHTML()) {
      editor.commands.setContent(nextContent, { emitUpdate: false })
    }
  }, [editor, content])


  return (
    <div className="relative group/editor">
      {editor && (
        <BubbleMenu 
          editor={editor} 
          shouldShow={({ editor, view }) => {
            // Only show for a text selection outside code blocks (not when a block such as a workflow is selected)
            return !editor.isActive('codeBlock') && !view.state.selection.empty && !(view.state.selection instanceof NodeSelection)
          }}
          className="flex items-center gap-1 p-1 rounded-lg glass-bold shadow-lg border border-white/20"
        >
          <MenuButton 
            isActive={editor.isActive('bold')} 
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold size={14} />
          </MenuButton>
          <MenuButton 
            isActive={editor.isActive('italic')} 
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic size={14} />
          </MenuButton>
          <MenuButton 
            isActive={editor.isActive('underline')} 
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          >
            <UnderlineIcon size={14} />
          </MenuButton>
          <div className="w-px h-4 bg-surface-200/50 dark:bg-surface-700/50 mx-1" />
           <MenuButton 
            isActive={editor.isActive('codeBlock')} 
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          >
            <CodeIcon size={14} />
          </MenuButton>
        </BubbleMenu>
      )}

      <div className={preview ? 'relative' : 'relative min-h-[300px]'}>
        <EditorContent editor={editor} />
        
        {/* Helper Hint */}
        {!preview && <div className="
           absolute bottom-4 right-4 
           flex items-center gap-3 
           opacity-0 group-hover/editor:opacity-100 transition-opacity duration-300
           pointer-events-none
        ">
            <span className="flex items-center gap-1.5 text-[10px] text-ink-muted dark:text-ink-inverse-muted font-medium bg-surface-100/50 dark:bg-surface-800/50 px-2 py-1 rounded-md">
                <kbd>/</kbd> for commands
            </span>
             <span className="flex items-center gap-1.5 text-[10px] text-ink-muted dark:text-ink-inverse-muted font-medium bg-surface-100/50 dark:bg-surface-800/50 px-2 py-1 rounded-md">
                <kbd>Cmd+S</kbd> to save
            </span>
        </div>}
      </div>
    </div>
  )
}

function MenuButton({ children, isActive, onClick }: { children: React.ReactNode, isActive: boolean, onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        p-1.5 rounded-md hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors
        ${isActive ? 'text-accent dark:text-accent-light bg-accent/5 dark:bg-accent-light/10' : 'text-ink-secondary dark:text-ink-inverse-secondary'}
      `}
    >
      {children}
    </button>
  )
}
