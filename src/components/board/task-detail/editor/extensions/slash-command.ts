import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import tippy from 'tippy.js'
import type { Instance } from 'tippy.js'
import { SlashCommandMenu } from '../SlashCommandMenu'

type SlashCommandMenuRef = {
  onKeyDown?: (props: any) => boolean
}

export const SLASH_COMMANDS = [
  { id: 'ask-ron', label: 'Ask Ron', icon: 'sparkles', action: 'askRon' },
  { id: 'upload', label: 'Upload File', icon: 'upload', action: 'fileUpload' },
  { id: 'text', label: 'Text', icon: 'T', action: 'paragraph' },
  { id: 'h1', label: 'Heading 1', icon: 'H1', action: 'heading', level: 1 },
  { id: 'h2', label: 'Heading 2', icon: 'H2', action: 'heading', level: 2 },
  { id: 'h3', label: 'Heading 3', icon: 'H3', action: 'heading', level: 3 },
  { id: 'bullet', label: 'Bullet List', icon: 'list', action: 'bulletList' },
  { id: 'todo', label: 'To-Do List', icon: 'check-square', action: 'taskList' },
  { id: 'table', label: 'Table', icon: 'table', action: 'table' },
  { id: 'code', label: 'Code Block', icon: 'code', action: 'codeBlock' },
  { id: 'divider', label: 'Divider', icon: 'minus', action: 'divider' },
  { id: 'quote', label: 'Quote', icon: 'quote-right', action: 'blockquote' },
]

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        command: ({ editor, range, props }: { editor: any, range: any, props: any }) => {
          props.command({ editor, range })
        },
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ]
  },
})

export const suggestionOptions = {
  items: ({ query }: { query: string }) => {
    return SLASH_COMMANDS.filter(item =>
      item.label.toLowerCase().startsWith(query.toLowerCase())
    ).slice(0, 20)
  },

  render: () => {
    let component: ReactRenderer<SlashCommandMenuRef, any> | null = null
    let popup: Instance | null = null

    return {
      onStart: (props: any) => {
        if (!props.clientRect) return

        const renderer = new ReactRenderer<SlashCommandMenuRef, any>(SlashCommandMenu as any, {
          props,
          editor: props.editor,
        })
        component = renderer

        popup = tippy(document.body, {
          getReferenceClientRect: props.clientRect,
          appendTo: () => document.body,
          content: renderer.element,
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'bottom-start',
        })
      },

      onUpdate: (props: any) => {
        component?.updateProps(props)
        if (props.clientRect && popup) {
          popup.setProps({ getReferenceClientRect: props.clientRect })
        }
      },

      onKeyDown: (props: any) => {
        if (props.event.key === 'Escape') {
          popup?.hide()
          return true
        }
        return component?.ref?.onKeyDown?.(props) ?? false
      },

      onExit: () => {
        popup?.destroy()
        component?.destroy()
        popup = null
        component = null
      },
    }
  },
}
