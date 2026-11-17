import { useState } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { RenMark } from '@/components/brand'
import { agoLabel, dreamTime, dreamTopicLabel, runNotifications, type Dream, type TopicReview } from '@/lib/context-api'
import { useContextAgentStore } from '@/stores/contextAgentStore'
import { cn } from '@/utils/cn'
import { field, ghostButton, iconButton, mutedText, primaryButton } from './contextUi'

const EASE = [0.19, 1, 0.22, 1] as const

/**
 * The dream's notification above the orb, where a finished run's notice sits (a run's notice goes first): what the
 * dream filed, and Review, a checklist of the topics it changed with a comment on each. Send hands the checklist to
 * the dreaming agent (`POST /context/dream/{version}`), which fixes the memory in its next dream and keeps what the
 * review teaches for every dream after.
 */
export function DreamNotice() {
  const dream = useContextAgentStore((state) => state.dream)
  const runsWaiting = useContextAgentStore((state) => runNotifications(state.runs).length > 0)
  if (!dream || runsWaiting) return null
  return <DreamCard key={dream.version} dream={dream} />
}

function DreamCard({ dream }: { dream: Dream }) {
  const reviewing = useContextAgentStore((state) => state.reviewingDream)
  const { setReviewingDream, reviewDream } = useContextAgentStore.getState()
  const [review, setReview] = useState<TopicReview[]>(() => dream.topics.map(({ key }) => ({ key, right: true, comment: '' })))
  const labels = dream.topics.map(dreamTopicLabel)
  const count = `${dream.topics.length} topic${dream.topics.length === 1 ? '' : 's'}`
  const mark = (index: number, patch: Partial<TopicReview>) =>
    setReview(review.map((entry, at) => at === index ? { ...entry, ...patch } : entry))

  return (
    <motion.div
      role="status"
      aria-live="polite"
      aria-label={`Ren filed new memories: ${count}`}
      data-testid="dream-notice"
      data-reviewing={reviewing}
      initial={{ y: 8, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 8, opacity: 0 }}
      transition={{ duration: 0.22, ease: EASE }}
      className={cn('fixed bottom-[84px] right-5 z-40', reviewing ? 'w-[360px]' : 'w-[300px]')}
    >
      <div className="ron-glass-panel flex h-full flex-col rounded-xl border border-surface-200 bg-surface-0 p-3 text-ink shadow-float dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse">
        <div className="flex items-start gap-2.5">
          <RenMark className="mt-0.5 h-6 w-6 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold">{reviewing ? 'Check what Ren remembered' : 'Ren filed new memories'}</p>
            <p className="text-[12px] text-ink-secondary dark:text-ink-inverse-secondary">{count} · {agoLabel(dreamTime(dream.version), Date.now())}</p>
          </div>
          <button type="button" onClick={() => void reviewDream([])} aria-label="Dismiss notification" title="Dismiss" className={cn(iconButton, '-mr-1 -mt-1')}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {reviewing ? <>
          <p className={cn('mt-2', mutedText)}>Uncheck anything wrong and say why. Ren fixes it in its next dream and keeps your notes for every dream after.</p>
          <ul data-testid="dream-topics" className="mt-2 max-h-[min(420px,calc(100vh-260px))] min-h-0 flex-1 space-y-1.5 overflow-y-auto">
            {dream.topics.map((topic, index) => <li key={topic.key} className="rounded-lg border border-surface-200 px-2.5 py-2 dark:border-surface-800">
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={review[index].right} onChange={(event) => mark(index, { right: event.target.checked })}
                  aria-label={`${labels[index].title} is right`} className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 accent-blurple-600 dark:accent-blurple-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold">{labels[index].title}
                    <span className="font-normal text-ink-muted dark:text-ink-inverse-muted"> · {labels[index].agent}</span></span>
                  <span className={cn('line-clamp-3 whitespace-pre-line', mutedText)}>
                    {topic.text === null ? 'Removed' : topic.text.split('\n').slice(1).join('\n').trim()}
                  </span>
                </span>
              </label>
              <input type="text" value={review[index].comment} onChange={(event) => mark(index, { comment: event.target.value })}
                maxLength={2000} placeholder="Comment" aria-label={`Comment on ${labels[index].title}`} className={cn(field, 'mt-1.5')} />
            </li>)}
          </ul>
          <div className="mt-2.5 flex items-center justify-end gap-2">
            <button type="button" onClick={() => setReviewingDream(false)} className={ghostButton}>Later</button>
            <button type="button" onClick={() => void reviewDream(review)} className={primaryButton}>Send to Ren</button>
          </div>
        </> : <>
          <p className={cn('mt-2 line-clamp-2', mutedText)}>{labels.map((label) => label.title).join(', ')}</p>
          <div className="mt-2.5 flex justify-end">
            <button type="button" onClick={() => setReviewingDream(true)} title="Check what Ren remembered" className={primaryButton}>Review</button>
          </div>
        </>}
      </div>
    </motion.div>
  )
}
