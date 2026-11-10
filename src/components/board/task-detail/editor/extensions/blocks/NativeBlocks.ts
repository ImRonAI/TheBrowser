import { Image } from '@tiptap/extension-image'
import { Youtube } from '@tiptap/extension-youtube'
import { Highlight } from '@tiptap/extension-highlight'
import { Color, TextStyle } from '@tiptap/extension-text-style'
import { isDataUrl } from '@/lib/editor-blocks'
import { EMBED_ALLOW, EMBED_SANDBOX } from './EmbedBlock'

/**
 * Official image node with drag-to-resize (core `ResizableNodeView`). `allowBase64` keeps images uploaded
 * into the page (stored as data URLs, at most `MAX_INLINE_FILE_BYTES`). Markdown never carries an uploaded
 * image's bytes: Ron reads `![alt](uploaded image)` instead of a megabyte of base64.
 */
export const RonImage = Image.extend({
  renderMarkdown: (node) => {
    const src = String(node.attrs?.src ?? '')
    const alt = String(node.attrs?.alt ?? '')
    if (isDataUrl(src)) return `![${alt || 'Image'}](uploaded image)`
    return node.attrs?.title ? `![${alt}](${src} "${node.attrs.title}")` : `![${alt}](${src})`
  },
}).configure({
  allowBase64: true,
  HTMLAttributes: { class: 'ron-image' },
  resize: { enabled: true, minWidth: 80, minHeight: 48, alwaysPreserveAspectRatio: true },
})

/**
 * Official YouTube node (`setYoutubeVideo`), privacy-enhanced (`youtube-nocookie.com`). Its iframe gets the
 * same sandbox, permissions and referrer policy as every other embed. Pasted YouTube links stay links.
 */
export const RonYoutube = Youtube.configure({
  addPasteHandler: false,
  nocookie: true,
  width: 640,
  height: 360,
  HTMLAttributes: { class: 'ron-youtube', sandbox: EMBED_SANDBOX, allow: EMBED_ALLOW, referrerpolicy: 'strict-origin-when-cross-origin' },
})

/** Official text color (TextStyle + Color) and multicolor highlight marks. */
export const RonTextStyle = TextStyle
export const RonColor = Color
export const RonHighlight = Highlight.configure({ multicolor: true })
