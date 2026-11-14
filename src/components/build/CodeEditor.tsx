/**
 * The Build Studio's editor: @uiw/react-codemirror with a Ren theme per appearance (createTheme from
 * @uiw/codemirror-themes), the file's language resolved from its name through @codemirror/language-data
 * (`LanguageDescription.matchFilename` + `load()`), and ⌘S / Ctrl+S bound to save.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror, { EditorView, Prec, keymap, type Extension } from '@uiw/react-codemirror'
import { createTheme } from '@uiw/codemirror-themes'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { tags as t } from '@lezer/highlight'

const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace'

const renLight = createTheme({
  theme: 'light',
  settings: {
    background: 'transparent',
    foreground: '#0B0C17',
    caret: '#5543FF',
    selection: '#5543FF26',
    selectionMatch: '#5543FF1A',
    lineHighlight: '#5543FF0A',
    gutterBackground: 'transparent',
    gutterForeground: '#9A9EB3',
    gutterActiveForeground: '#0B0C17',
    gutterBorder: 'transparent',
    fontFamily: MONO,
  },
  styles: [
    { tag: t.comment, color: '#8B90A6', fontStyle: 'italic' },
    { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: '#5543FF', fontWeight: '600' },
    { tag: [t.string, t.special(t.string), t.regexp], color: '#0E7C66' },
    { tag: [t.number, t.bool, t.null, t.atom], color: '#B0218A' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: '#1F5FD1' },
    { tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName)], color: '#7A3FE0' },
    { tag: [t.tagName, t.angleBracket], color: '#5543FF' },
    { tag: t.attributeName, color: '#1F5FD1' },
    { tag: [t.propertyName], color: '#284B9E' },
    { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: '#5B6075' },
    { tag: [t.heading], color: '#0B0C17', fontWeight: '700' },
    { tag: [t.link, t.url], color: '#5543FF', textDecoration: 'underline' },
    { tag: t.invalid, color: '#D12B4B' },
  ],
})

const renDark = createTheme({
  theme: 'dark',
  settings: {
    background: 'transparent',
    foreground: '#E8E9F1',
    caret: '#8D98FE',
    selection: '#8D98FE33',
    selectionMatch: '#8D98FE22',
    lineHighlight: '#8D98FE0D',
    gutterBackground: 'transparent',
    gutterForeground: '#5E6380',
    gutterActiveForeground: '#E8E9F1',
    gutterBorder: 'transparent',
    fontFamily: MONO,
  },
  styles: [
    { tag: t.comment, color: '#6B7089', fontStyle: 'italic' },
    { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: '#A9B0FF', fontWeight: '600' },
    { tag: [t.string, t.special(t.string), t.regexp], color: '#5FD4B4' },
    { tag: [t.number, t.bool, t.null, t.atom], color: '#F28BD0' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: '#7CB8FF' },
    { tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName)], color: '#C3A6FF' },
    { tag: [t.tagName, t.angleBracket], color: '#A9B0FF' },
    { tag: t.attributeName, color: '#7CB8FF' },
    { tag: [t.propertyName], color: '#9DB4F5' },
    { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: '#9EA3B8' },
    { tag: [t.heading], color: '#FFFFFF', fontWeight: '700' },
    { tag: [t.link, t.url], color: '#A9B0FF', textDecoration: 'underline' },
    { tag: t.invalid, color: '#FF7A93' },
  ],
})

/** Layout only (sizes and spacing); colours come from the theme above. */
const layout = EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '.cm-scroller': { lineHeight: '1.65', fontFamily: MONO },
  '.cm-content': { padding: '14px 0' },
  '.cm-gutters': { paddingLeft: '8px' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 4px', minWidth: '32px' },
  '&.cm-focused': { outline: 'none' },
})

/** Whether the document is in a dark appearance (`.dark` on <html>, set by applyThemeClasses for Dark and dark Glass). */
function useDocumentDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => setDark(root.classList.contains('dark')))
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return dark
}

/** The language support for a file name, loaded on demand; null for plain text. */
function useLanguage(path: string) {
  const [language, setLanguage] = useState<{ path: string; extension: Extension } | null>(null)
  useEffect(() => {
    let current = true
    const description = LanguageDescription.matchFilename(languages, path.split('/').pop() || path)
    if (!description) { setLanguage(null); return }
    description.load().then((support) => { if (current) setLanguage({ path, extension: support }) })
      .catch(() => { if (current) setLanguage(null) })
    return () => { current = false }
  }, [path])
  return language?.path === path ? language.extension : null
}

export function languageName(path: string): string {
  return LanguageDescription.matchFilename(languages, path.split('/').pop() || path)?.name ?? 'Plain text'
}

export function CodeEditor({ path, value, onChange, onSave, readOnly = false, autoFocus = false }: {
  path: string
  value: string
  onChange: (value: string) => void
  onSave: () => void
  readOnly?: boolean
  /** Puts the keyboard in the editor when it mounts. */
  autoFocus?: boolean
}) {
  const dark = useDocumentDark()
  const language = useLanguage(path)
  const saveRef = useRef(onSave)
  saveRef.current = onSave
  const extensions = useMemo(() => [
    layout,
    EditorView.lineWrapping,
    Prec.highest(keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => { saveRef.current(); return true } }])),
    ...(language ? [language] : []),
  ], [language])
  return (
    <CodeMirror
      className="h-full min-h-0 [&_.cm-editor]:h-full"
      height="100%"
      value={value}
      theme={dark ? renDark : renLight}
      extensions={extensions}
      editable={!readOnly}
      readOnly={readOnly}
      autoFocus={autoFocus}
      onChange={onChange}
      basicSetup={{ highlightActiveLine: true, highlightActiveLineGutter: true, foldGutter: true, bracketMatching: true,
        closeBrackets: true, autocompletion: true, indentOnInput: true, tabSize: 2 }}
    />
  )
}
