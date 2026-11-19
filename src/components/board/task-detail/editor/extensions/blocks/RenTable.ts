import { Table, TableView } from '@tiptap/extension-table'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { TEXT_COLORS, type ColorChoice } from '@/lib/editor-blocks'

/**
 * Colours a table's header row and header column can take. Each is drawn as one gradient across the whole row
 * (and down the whole column), from a deep, rich shade of the colour to a sheer metallic one (index.css § Tables).
 */
export const TABLE_HEADER_COLORS: readonly ColorChoice[] = [
  { id: 'none', label: 'No colour', value: null },
  { id: 'volt', label: 'Volt', value: '#5543FF' },
  ...TEXT_COLORS.filter((color) => color.value),
]

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    renTable: {
      /** Colours the header row and header column of the table around the selection (`null` removes it). */
      setTableHeaderColor: (color: string | null) => ReturnType
    }
  }
}

/** The editable table's node view (column resizing) with the header colour on the `<table>`, like `renderHTML`. */
class RenTableView extends TableView {
  constructor(node: ProseMirrorNode, cellMinWidth: number, view?: EditorView, HTMLAttributes?: Record<string, string>) {
    super(node, cellMinWidth, view, HTMLAttributes)
    this.paintHeader(node)
  }

  override update(node: ProseMirrorNode): boolean {
    if (!super.update(node)) return false
    this.paintHeader(node)
    return true
  }

  private paintHeader(node: ProseMirrorNode) {
    const color: unknown = node.attrs["headerColor"]
    if (typeof color === 'string' && color) this.table.dataset["headerColor"] = color
    else delete this.table.dataset["headerColor"]
  }
}

/** Tables with resizable columns and a header colour (`data-header-color`). */
export const RenTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      headerColor: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const color = element.getAttribute('data-header-color')
          return TABLE_HEADER_COLORS.some((choice) => choice.value && choice.id === color) ? color : null
        },
        renderHTML: (attributes: { headerColor?: string | null }) =>
          attributes.headerColor ? { 'data-header-color': attributes.headerColor } : {},
      },
    }
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setTableHeaderColor: (color) => ({ commands }) =>
        commands.updateAttributes(this.name, { headerColor: color && color !== 'none' ? color : null }),
    }
  },
}).configure({ resizable: true, cellMinWidth: 64, View: RenTableView })
