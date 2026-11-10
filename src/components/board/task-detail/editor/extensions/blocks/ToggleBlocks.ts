import { Extension } from '@tiptap/core'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    ronToggle: {
      /** A toggle (official Details) around the current block, opened, cursor in its summary. `level` makes it a toggle heading. */
      insertToggle: (level?: 1 | 2 | 3) => ReturnType
    }
  }
}

/**
 * Toggle lists are the official `@tiptap/extension-details` nodes. `persist: true` stores the open state
 * (`<details open>`), so a toggle reopens the way it was left and a new one starts open.
 */
export const ToggleDetails = Details.configure({
  persist: true,
  HTMLAttributes: { class: 'ron-toggle' },
  renderToggleButton: ({ element, isOpen, node }) => {
    const label = node.firstChild?.textContent || 'toggle'
    element.setAttribute('aria-label', isOpen ? `Collapse ${label}` : `Expand ${label}`)
    element.setAttribute('aria-expanded', String(isOpen))
  },
})

export { DetailsContent, DetailsSummary }

/**
 * Toggle headings: the summary of a Details node carries a heading level (`<summary data-level="2">`),
 * added through Tiptap's global-attributes extension point; CSS sizes it like H1–H3.
 */
export const ToggleHeadingLevel = Extension.create({
  name: 'toggleHeadingLevel',

  addGlobalAttributes() {
    return [{
      types: ['detailsSummary'],
      attributes: {
        level: {
          default: null,
          parseHTML: (element) => {
            const level = Number(element.getAttribute('data-level'))
            return level >= 1 && level <= 3 ? level : null
          },
          renderHTML: (attributes) => (attributes.level ? { 'data-level': String(attributes.level) } : {}),
        },
      },
    }]
  },

  addCommands() {
    return {
      insertToggle: (level) => ({ chain }) => chain()
        .setDetails()
        .updateAttributes('details', { open: true })
        .updateAttributes('detailsSummary', { level: level ?? null })
        .run(),
    }
  },
})
