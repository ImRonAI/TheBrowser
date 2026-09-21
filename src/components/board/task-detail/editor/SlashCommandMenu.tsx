import { useEffect, useState, forwardRef, useImperativeHandle, useRef } from 'react'
import { 
  Heading1, 
  Heading2, 
  Heading3, 
  Type, 
  List, 
  CheckSquare, 
  Table, 
  Code, 
  Minus, 
  Quote,
  Upload,
  Sparkles
} from 'lucide-react'
import { fileToDataUrl } from '@/utils/file-utils'

// Map icons
const icons: Record<string, any> = {
  H1: Heading1,
  H2: Heading2,
  H3: Heading3,
  T: Type,
  list: List,
  'check-square': CheckSquare,
  table: Table,
  code: Code,
  minus: Minus,
  'quote-right': Quote,
  upload: Upload,
  sparkles: Sparkles,
}

export const SlashCommandMenu = forwardRef((props: any, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0)
  
  // We need a ref for the input inside the component
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const { editor, range } = props
    const dataUrl = await fileToDataUrl(file)
    
    // reset input
    if (inputRef.current) inputRef.current.value = ''

    editor.chain().focus().deleteRange(range).insertContent({
      type: 'fileAttachment',
      attrs: {
        dataUrl,
        name: file.name,
        size: file.size,
        type: file.type
      }
    }).run()
  }

  const selectItem = (index: number) => {
    const item = props.items[index]
    if (item) {
      command(item)
    }
  }

  const command = (item: any) => {
    const { editor, range } = props
    
    switch (item.action) {
      case 'fileUpload':
        inputRef.current?.click()
        break
      case 'askRon':
        editor.chain().focus().deleteRange(range).insertContent({
            type: 'askRon',
            attrs: {
                taskId: (props as any).taskId || '', // We need to pass taskId through props or extension options
            }
        }).run()
        break
      case 'heading':
        editor.chain().focus().deleteRange(range).setNode('heading', { level: item.level }).run()
        break
      case 'paragraph':
        editor.chain().focus().deleteRange(range).setNode('paragraph').run()
        break
      case 'bulletList':
        editor.chain().focus().deleteRange(range).toggleBulletList().run()
        break
      case 'taskList':
        editor.chain().focus().deleteRange(range).toggleTaskList().run()
        break
      case 'table':
        editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        break
      case 'codeBlock':
        editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
        break
      case 'divider':
        editor.chain().focus().deleteRange(range).setHorizontalRule().run()
        break
      case 'blockquote':
        editor.chain().focus().deleteRange(range).toggleBlockquote().run()
        break
      default:
        break
    }
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === 'ArrowUp') {
        setSelectedIndex((selectedIndex + props.items.length - 1) % props.items.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((selectedIndex + 1) % props.items.length)
        return true
      }
      if (event.key === 'Enter') {
        selectItem(selectedIndex)
        return true
      }
      return false
    },
  }))

  useEffect(() => {
    setSelectedIndex(0)
  }, [props.items])

  return (
    <div className="
      z-50 min-w-[280px] max-h-[320px] overflow-hidden rounded-xl
      glass-bold border border-surface-200/20 dark:border-surface-700/30
      shadow-dramatic dark:shadow-dark-bold
      flex flex-col p-1
    ">
      <input 
        type="file" 
        ref={inputRef} 
        className="hidden" 
        onChange={handleFileChange}
      />
      
      <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted opacity-50">
        Basic Blocks
      </div>
      <div className="overflow-y-auto scrollbar-thin max-h-[280px]">
        {props.items.map((item: any, index: number) => {
          const Icon = icons[item.icon] || Type
          const isSelected = index === selectedIndex

          return (
            <button
              key={item.id}
              className={`
                w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-left
                transition-colors duration-200
                ${isSelected 
                  ? 'bg-accent/10 dark:bg-accent-light/10 text-accent dark:text-accent-light' 
                  : 'text-ink dark:text-ink-inverse hover:bg-surface-100 dark:hover:bg-surface-800'
                }
              `}
              onClick={() => selectItem(index)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <div className={`
                flex items-center justify-center w-8 h-8 rounded-md
                ${isSelected 
                  ? 'bg-accent text-white dark:bg-accent-light dark:text-gray-900' 
                  : 'bg-surface-100 dark:bg-surface-800 text-ink-muted dark:text-ink-inverse-muted'
                }
              `}>
                <Icon size={16} strokeWidth={2} />
              </div>
              <div className="flex flex-col">
                <span className="text-body-sm font-medium">{item.label}</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
})

SlashCommandMenu.displayName = 'SlashCommandMenu'
