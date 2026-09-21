import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { AskRonMenu } from '../AskRonMenu'

export const AskRonExtension = Node.create({
  name: 'askRon',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      taskId: {
        default: '',
      },
      defaultAction: {
        default: null, // 'fix', 'expand', or null (for menu)
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'ask-ron',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['ask-ron', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(AskRonMenu)
  },
})
