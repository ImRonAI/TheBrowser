import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { TextAttachmentCard } from '@/components/ai-elements/text-attachment-card'
import type { TextAttachment } from '@/components/ai-elements/types'

export const FileAttachmentExtension = Node.create({
  name: 'fileAttachment',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      dataUrl: {
        default: '',
      },
      name: {
        default: 'attachment.txt',
      },
      size: {
        default: 0,
      },
      type: {
        default: 'text/plain',
      },
      id: {
        default: '',
      }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'file-attachment',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['file-attachment', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileAttachmentComponent)
  },
})

function FileAttachmentComponent(props: any) {
  const { node, deleteNode, updateAttributes } = props
  const { dataUrl, name, size, type, id } = node.attrs

  // Reconstruct TextAttachment object
  // limited to what TextAttachmentCard likely needs via props
  const attachment: TextAttachment = {
    id: id || Math.random().toString(36).substring(7),
    // Mock the File object since we can't serialize it in Tiptap attributes
    file: {
      name,
      size,
      type,
    } as File,
    dataUrl,
    preview: dataUrl, // Simplified
  }

  const handleRemove = () => {
    deleteNode()
  }

  const handleUpdate = (_id: string, next: Partial<TextAttachment>) => {
    // If the card updates the file content (e.g. edit), we need to update attributes
    if (next.dataUrl) updateAttributes({ dataUrl: next.dataUrl })
    if (next.file?.name) updateAttributes({ name: next.file.name })
    if (next.file?.size) updateAttributes({ size: next.file.size })
  }

  return (
    <NodeViewWrapper className="my-4">
      <TextAttachmentCard
        attachment={attachment}
        onRemove={handleRemove}
        onUpdate={handleUpdate}
        className="max-w-md"
      />
    </NodeViewWrapper>
  )
}
