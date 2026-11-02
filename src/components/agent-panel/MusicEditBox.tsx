import { useEffect, useState } from 'react'
import { PencilIcon } from 'lucide-react'
import {
  PromptInput, PromptInputBody, PromptInputFooter, PromptInputSubmit, PromptInputTextarea, PromptInputTools,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ai-elements/badge'
import { formatPosition, musicEditMessage, type MusicPosition } from '@/lib/music-position'
import type { WeightedPrompt } from '@/lib/voice-events'
import { cn } from '@/utils/cn'

/**
 * Position pinpoint + Edit for the live stream.
 *
 * Lyria RealTime has no seek, timestamp or regenerate (its playback messages are play / pause /
 * stop / reset_context, and steering changes future audio only), so the finest window a client can
 * name is the chunk audible right now: `[start, end)` from the renderer's own schedule. The strip
 * shows that window ticking; Edit opens the project's AI Elements `PromptInput`, and submit sends
 * the instruction to the Live agent (the model holding the Lyria session and the prompt-guide
 * skill) as a typed turn pinned to that window. The agent steers with `music_set_weighted_prompts`
 * and the music changes from that moment on.
 */
export function MusicEditBox({ position, prompts, sendText, disabled, className }: {
  position: () => MusicPosition | null
  prompts: WeightedPrompt[]
  sendText: (text: string) => boolean
  disabled?: boolean
  className?: string
}) {
  const [now, setNow] = useState<MusicPosition | null>(null)
  const [editing, setEditing] = useState(false)
  const [pinned, setPinned] = useState<MusicPosition | null>(null)
  const [status, setStatus] = useState<'ready' | 'submitted' | 'error'>('ready')
  const [notice, setNotice] = useState('')

  // Tick at 10 Hz: chunk windows are seconds long, so tenths are the honest resolution.
  useEffect(() => {
    const id = window.setInterval(() => setNow(position()), 100)
    return () => window.clearInterval(id)
  }, [position])

  const current = pinned ?? now
  const start = current ? formatPosition(current.chunk.offsetSeconds) : null
  const end = current ? formatPosition(current.chunk.offsetSeconds + current.chunk.durationSeconds) : null

  const openEdit = () => {
    const at = position()
    if (!at) return
    setPinned(at); setEditing(true); setStatus('ready'); setNotice('')
  }
  const closeEdit = () => { setEditing(false); setPinned(null); setStatus('ready') }

  const submit = async ({ text }: PromptInputMessage) => {
    if (!pinned || !text.trim()) return
    setStatus('submitted')
    const sent = sendText(musicEditMessage(pinned, prompts, text))
    if (!sent) { setStatus('error'); setNotice('Live is not connected; the edit was not sent.'); throw new Error('not sent') }
    setNotice(`Edit sent for ${formatPosition(pinned.chunk.offsetSeconds)}–${formatPosition(pinned.chunk.offsetSeconds + pinned.chunk.durationSeconds)}. The music changes from now on.`)
    closeEdit()
  }

  return <section aria-label="Position and edit" className={cn('rounded-xl border border-surface-200 p-2 dark:border-surface-700', className)}>
    <div className="flex items-center justify-between gap-2">
      <p className="flex items-center gap-2 tabular-nums">
        <span className="text-ink-muted dark:text-ink-inverse-muted">Now</span>
        {current ? <>
          <Badge variant={pinned ? 'default' : 'secondary'}>{start}–{end}</Badge>
          <span className="text-ink-muted dark:text-ink-inverse-muted">chunk {current.chunk.index + 1} · {formatPosition(current.streamSeconds)}</span>
        </> : <span className="text-ink-muted dark:text-ink-inverse-muted">no audio scheduled</span>}
      </p>
      {!editing && <Button type="button" size="sm" variant="outline" disabled={disabled || !now} onClick={openEdit} aria-label="Edit the music from this point"><PencilIcon />Edit</Button>}
    </div>
    {/* Chunk strip: the audible chunk highlighted; one cell per second of the chunk window. */}
    {current && <div aria-hidden className="mt-2 flex h-1.5 gap-px overflow-hidden rounded-full bg-surface-200 dark:bg-surface-700">
      {Array.from({ length: Math.max(1, Math.round(current.chunk.durationSeconds * 10)) }, (_, i) => (
        <span key={i} className={cn('flex-1', i / 10 <= current.intoChunk ? 'bg-indigo-500' : 'bg-transparent')} />
      ))}
    </div>}
    {editing && pinned && <PromptInput className="mt-2" onSubmit={submit}>
      <PromptInputBody>
        <PromptInputTextarea autoFocus placeholder={`Change the music from ${start}: e.g. “bring in a warm Rhodes piano, slow it down”`} />
      </PromptInputBody>
      <PromptInputFooter>
        <PromptInputTools>
          <span className="px-1 text-[11px] text-ink-muted dark:text-ink-inverse-muted">Steers Lyria RealTime forward from {start}; already-played audio is not regenerated.</span>
        </PromptInputTools>
        <div className="flex items-center gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={closeEdit}>Cancel</Button>
          <PromptInputSubmit status={status} />
        </div>
      </PromptInputFooter>
    </PromptInput>}
    {notice && <p role="status" className="mt-2 text-ink-muted dark:text-ink-inverse-muted">{notice}</p>}
  </section>
}
