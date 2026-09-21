import { useEditor, EditorContent } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import Mention from '@tiptap/extension-mention'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import { SlashCommand, suggestionOptions } from './extensions/slash-command'
import { FileAttachmentExtension } from './extensions/FileAttachmentExtension'
import { AskRonExtension } from './extensions/AskRonExtension'
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
  users?: { id: string; name: string }[]
  readOnly?: boolean
}

export function NotionEditor({ 
  content, 
  onChange, 
  onSave, 
  placeholder = 'Type / for commands...', 
  users = [],
  readOnly = false
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
      Mention.configure({
        suggestion: {
           items: ({ query }) => {
             return users.filter(user => user.name.toLowerCase().startsWith(query.toLowerCase())).slice(0, 5)
           },
           // Basic render for now for mentions, can enhance later
        }
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Underline,
      Link.configure({ 
        openOnClick: false,
        HTMLAttributes: {
            class: 'cursor-pointer',
        },
      }),
      CodeBlockLowlight.configure({
        lowlight,
      }),
      SlashCommand.configure({
        suggestion: suggestionOptions,
      }),
      FileAttachmentExtension,
      AskRonExtension,
    ],
    content,
    shouldRerenderOnTransaction: false,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
    editorProps: {
      attributes: {
        class: 'prose prose-lg dark:prose-invert max-w-none focus:outline-none min-h-[200px] p-6',
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
            // Only show if selection is not empty and not a code block
            return !editor.isActive('codeBlock') && !view.state.selection.empty
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

      <div className="relative min-h-[300px]">
        <EditorContent editor={editor} />
        
        {/* Helper Hint */}
        <div className="
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
        </div>
      </div>
    </div>
  )
}

function MenuButton({ children, isActive, onClick }: { children: React.ReactNode, isActive: boolean, onClick: () => void }) {
  return (
    <button
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
