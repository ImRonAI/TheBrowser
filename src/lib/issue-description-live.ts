/**
 * Pure helpers for the issue-description Ask Ron surface. No React, no `@/`
 * imports so `node --test` can run the colocated test.
 */

/** Plain text → escaped paragraphs; the editor never receives raw model HTML. */
export function descriptionHtml(text: string): string {
  return text.split(/\n\n+/).map((paragraph) => `<p>${paragraph.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>`).join('')
}

export const DRAFT_LIMIT = 4000

/** The request handed to issue Live. Not auto-sent: the user reviews it in the Live composer first. */
export function descriptionLivePrompt(intent: string, currentDraft: string): string {
  const goal = intent.trim().replace(/^\/goal\s+/, '')
  const draft = currentDraft.trim()
  return `Help me write the description for this issue. ${goal}`.trim()
    + (draft ? `\n\nCurrent description draft (reference, may be replaced):\n${draft.slice(0, DRAFT_LIMIT)}${draft.length > DRAFT_LIMIT ? '…' : ''}` : '')
    + '\n\nSpeak your proposal, then give the final description as text. I will review it before anything is saved.'
}

/** Latest assistant text from Live; the user applies it explicitly. */
export function latestProposal<T extends { role: 'user' | 'assistant'; text: string }>(turns: readonly T[]): T | undefined {
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === 'assistant' && turns[i].text.trim()) return turns[i]
  return undefined
}
