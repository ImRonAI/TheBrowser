import type { ContextItem } from '@/components/agent-panel/ContextPicker'

async function enrichTabContext(item: ContextItem): Promise<ContextItem> {
  if (item.type !== 'tab') return item
  try {
    const result = await window.electron?.tabs?.getContext?.(item.id)
    if (result?.success && result.context) return { ...item, tab_context: result.context }
  } catch { /* Tab context is optional when capture fails. */ }
  return item
}

/** Build ephemeral `browser_context` for POST /chat — only explicit user selections. */
export async function browserContextForSend(contexts: ContextItem[]): Promise<Record<string, unknown> | null> {
  const payload: Record<string, unknown> = {}
  if (contexts.length) {
    payload.selected_contexts = await Promise.all(contexts.map(enrichTabContext))
  }
  return Object.keys(payload).length ? payload : null
}
