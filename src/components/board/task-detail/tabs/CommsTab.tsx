/**
 * Comms Tab - Communications Repository
 * 
 * A unified inbox for all task-related communications including:
 * - Phone calls with transcripts
 * - Emails with thread view
 * - SMS/Messages
 * - Video calls with recordings
 * - Faxes
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Task, TaskCommunication, CommunicationType } from '@/pages/types/task'
import { 
    LayoutGrid as GridIcon,
    Mail as MailIcon,
    Phone as PhoneIcon,
    Video as VideoIcon,
    MessageSquare as MessageIcon,
    Printer as PrinterIcon,
    Calendar as CalendarIcon,
    Search as SearchIcon,
    ArrowDownLeft as InboundIcon,
    ArrowUpRight as OutboundIcon,
    Paperclip as AttachmentIcon,
    Plus as PlusIcon
} from 'lucide-react'

// Sophisticated easing
const EASE = [0.16, 1, 0.3, 1] as const

interface CommsTabProps {
  task: Task
}

type FilterType = 'all' | CommunicationType

const COMMUNICATION_TYPES: { type: FilterType; label: string; icon: React.ReactNode }[] = [
  { type: 'all', label: 'All', icon: <GridIcon size={16} /> },
  { type: 'email', label: 'Email', icon: <MailIcon size={16} /> },
  { type: 'phone', label: 'Phone', icon: <PhoneIcon size={16} /> },
  { type: 'video', label: 'Video', icon: <VideoIcon size={16} /> },
  { type: 'message', label: 'Message', icon: <MessageIcon size={16} /> },
]

export function CommsTab({ task }: CommsTabProps) {
  const [filter, setFilter] = useState<FilterType>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Sample communications (would come from task.communications)
  const communications: TaskCommunication[] = task.communications || []
  
  // Filter communications
  const filteredComms = communications.filter(comm => {
    const matchesFilter = filter === 'all' || comm.type === filter
    const matchesSearch = !searchQuery || 
      comm.subject?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      comm.summary?.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesFilter && matchesSearch
  })

  return (
    <div className="h-full flex flex-col">
      {/* Header with Quick Actions */}
      <div className="flex-shrink-0 px-6 pt-4 pb-3 border-b border-surface-200/50 dark:border-surface-700/50 glass-subtle z-10">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-body-lg font-semibold text-ink dark:text-ink-inverse">
            Communications
          </h3>
          <QuickActions />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none pb-1">
          {COMMUNICATION_TYPES.map(({ type, label, icon }) => (
            <FilterPill
              key={type}
              active={filter === type}
              onClick={() => setFilter(type)}
              icon={icon}
              label={label}
              count={type === 'all' 
                ? communications.length 
                : communications.filter(c => c.type === type).length
              }
            />
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="flex-shrink-0 px-6 py-3">
        <div className="
          relative
          glass-subtle rounded-xl
          focus-within:border-accent dark:focus-within:border-accent-light
          focus-within:ring-1 focus-within:ring-accent/20
          transition-all duration-200
        ">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted dark:text-ink-inverse-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search communications..."
            className="
              w-full pl-10 pr-4 py-2.5
              bg-transparent
              text-body-sm text-ink dark:text-ink-inverse
              placeholder:text-ink-muted dark:placeholder:text-ink-inverse-muted
              focus:outline-none
            "
          />
        </div>
      </div>

      {/* Communications Timeline */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-3">
        {filteredComms.length > 0 ? (
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {filteredComms.map((comm, index) => (
                <CommunicationCard 
                  key={comm.id} 
                  communication={comm}
                  index={index}
                />
              ))}
            </AnimatePresence>
          </div>
        ) : (
          <EmptyCommsState filter={filter} />
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// QUICK ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

function QuickActions() {
  const actions = [
    { icon: <PhoneIcon size={14} />, label: 'Call', color: 'text-success', enabled: true },
    { icon: <MailIcon size={14} />, label: 'Email', color: 'text-info', enabled: true },
    { icon: <VideoIcon size={14} />, label: 'Meet', color: 'text-accent dark:text-accent-light', enabled: true },
  ]

  return (
    <div className="flex items-center gap-2">
      {actions.map(({ icon, label, color, enabled }) => (
        <motion.button
          key={label}
          whileHover={{ scale: enabled ? 1.05 : 1 }}
          whileTap={{ scale: enabled ? 0.95 : 1 }}
          disabled={!enabled}
          className={`
            flex items-center gap-1.5
            px-4 py-2 rounded-xl
            glass-card border border-surface-200/50 dark:border-surface-700/50
            ${color}
            text-body-xs font-semibold
            hover:elevated hover:shadow-glow-accent
            transition-all duration-200
            disabled:opacity-50 disabled:cursor-not-allowed
          `}
        >
          <span className="w-4 h-4 flex items-center justify-center">{icon}</span>
          <span>{label}</span>
        </motion.button>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FILTER PILL
// ─────────────────────────────────────────────────────────────────────────────

interface FilterPillProps {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  count: number
}

function FilterPill({ active, onClick, icon, label, count }: FilterPillProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className={`
        flex items-center gap-2
        px-3 py-1.5 rounded-full
        text-body-xs font-medium
        whitespace-nowrap
        transition-all duration-200
        ${active 
          ? 'glass-bold bg-accent/10 border-accent/20 text-accent dark:text-accent-light' 
          : 'glass-subtle text-ink-secondary dark:text-ink-inverse-secondary hover:bg-surface-100/50'
        }
      `}
    >
      <span className="w-3.5 h-3.5 flex items-center justify-center">{icon}</span>
      <span>{label}</span>
      {count > 0 && (
        <span className={`
          px-1.5 py-0.5 rounded
          text-[9px] font-bold
          ${active 
            ? 'bg-accent text-white dark:bg-accent-light dark:text-black' 
            : 'bg-surface-200 dark:bg-surface-700'
          }
        `}>
          {count}
        </span>
      )}
    </motion.button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMUNICATION CARD
// ─────────────────────────────────────────────────────────────────────────────

interface CommunicationCardProps {
  communication: TaskCommunication
  index: number
}

function CommunicationCard({ communication, index }: CommunicationCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const typeConfig = {
    email: { icon: <MailIcon size={20} />, color: 'bg-info/10 text-info' },
    phone: { icon: <PhoneIcon size={20} />, color: 'bg-success/10 text-success' },
    video: { icon: <VideoIcon size={20} />, color: 'bg-accent/10 text-accent dark:text-accent-light' },
    message: { icon: <MessageIcon size={20} />, color: 'bg-violet-500/10 text-violet-500' },
    sms: { icon: <MessageIcon size={20} />, color: 'bg-emerald-500/10 text-emerald-500' },
    fax: { icon: <PrinterIcon size={20} />, color: 'bg-surface-300/50 text-ink-secondary dark:text-ink-inverse-secondary' },
    meeting: { icon: <CalendarIcon size={20} />, color: 'bg-warning/10 text-warning' },
  }

  const config = typeConfig[communication.type] || typeConfig.message
  const directionIcon = communication.direction === 'inbound' ? <InboundIcon size={12} /> : <OutboundIcon size={12} />

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.3, delay: index * 0.03, ease: EASE }}
      className="
        relative group
        p-4 rounded-xl
        glass-card
        hover:elevated
        transition-all duration-300
        cursor-pointer
      "
      onClick={() => setIsExpanded(!isExpanded)}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        {/* Type Icon */}
        <div className={`
          w-10 h-10 rounded-xl
          flex items-center justify-center
          glass-subtle
          ${config.color}
        `}>
          {config.icon}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {/* Direction */}
            <span className={`
              w-4 h-4 flex items-center justify-center rounded-full bg-surface-100 dark:bg-surface-800
              ${communication.direction === 'inbound' ? 'text-success' : 'text-accent dark:text-accent-light'}
            `}>
              {directionIcon}
            </span>
            
            {/* Subject/Title */}
            <h4 className="text-body-sm font-semibold text-ink dark:text-ink-inverse truncate">
              {communication.subject || `${communication.type} communication`}
            </h4>

            {/* Sentiment Badge */}
            {communication.sentiment && communication.sentiment !== 'neutral' && (
              <SentimentBadge sentiment={communication.sentiment} />
            )}

            {/* Unread indicator */}
            {!communication.isRead && (
              <span className="w-2 h-2 rounded-full bg-accent dark:bg-accent-light shadow-glow-accent" />
            )}
          </div>

          {/* Participants */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-body-xs font-medium text-ink-muted dark:text-ink-inverse-muted">
              {communication.participants.map(p => p.name).join(', ')}
            </span>
            {communication.duration && (
              <span className="text-body-xs text-ink-muted dark:text-ink-inverse-muted">
                • {formatDuration(communication.duration)}
              </span>
            )}
          </div>

          {/* Summary */}
          {communication.summary && (
            <p className="text-body-xs text-ink-secondary dark:text-ink-inverse-secondary line-clamp-2 leading-relaxed">
              {communication.summary}
            </p>
          )}
        </div>

        {/* Timestamp */}
        <div className="flex-shrink-0 text-right">
          <span className="text-body-xs font-medium text-ink-muted dark:text-ink-inverse-muted">
            {formatTimestamp(new Date(communication.timestamp))}
          </span>
        </div>
      </div>

      {/* Expanded Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 pt-4 border-t border-surface-200/50 dark:border-surface-700/50"
          >
            {/* Full content or transcript */}
            {communication.content && (
              <div className="mb-3">
                <h5 className="text-[10px] font-bold uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted mb-2">
                  Content
                </h5>
                <p className="text-body-sm text-ink dark:text-ink-inverse whitespace-pre-wrap">
                  {communication.content}
                </p>
              </div>
            )}

            {/* Transcript for calls */}
            {communication.transcript && (
              <div className="mb-3 glass-subtle p-3 rounded-lg">
                <h5 className="text-[10px] font-bold uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted mb-2">
                  Transcript
                </h5>
                <p className="text-body-sm text-ink-secondary dark:text-ink-inverse-secondary whitespace-pre-wrap italic">
                  {communication.transcript}
                </p>
              </div>
            )}

            {/* Action Items */}
            {communication.actionItems && communication.actionItems.length > 0 && (
              <div className="mb-3">
                <h5 className="text-[10px] font-bold uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted mb-2">
                  Action Items
                </h5>
                <ul className="space-y-1">
                  {communication.actionItems.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-body-xs text-ink dark:text-ink-inverse bg-surface-100/50 dark:bg-surface-800/50 p-1.5 rounded-md">
                      <span className="text-success mt-0.5">→</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Attachments */}
            {communication.attachments && communication.attachments.length > 0 && (
              <div>
                <h5 className="text-[10px] font-bold uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted mb-2">
                  Attachments
                </h5>
                <div className="flex flex-wrap gap-2">
                  {communication.attachments.map((att) => (
                    <span
                      key={att.id}
                      className="
                        inline-flex items-center gap-1.5
                        px-2 py-1 rounded-md
                        glass-subtle
                        text-body-xs text-ink dark:text-ink-inverse
                        border border-surface-200 dark:border-surface-700
                      "
                    >
                      <AttachmentIcon size={12} />
                      {att.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SENTIMENT BADGE
// ─────────────────────────────────────────────────────────────────────────────

function SentimentBadge({ sentiment }: { sentiment: TaskCommunication['sentiment'] }) {
  const config = {
    positive: { label: 'Positive', color: 'bg-success/10 text-success' },
    negative: { label: 'Negative', color: 'bg-danger/10 text-danger' },
    urgent: { label: 'Urgent', color: 'bg-warning/10 text-warning' },
    neutral: { label: 'Neutral', color: 'bg-surface-200 dark:bg-surface-700 text-ink-muted' },
  }

  const { label, color } = config[sentiment || 'neutral']

  return (
    <span className={`
      px-1.5 py-0.5 rounded-sm
      text-[9px] font-bold uppercase tracking-wide
      ${color}
    `}>
      {label}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// EMPTY STATE
// ─────────────────────────────────────────────────────────────────────────────

function EmptyCommsState({ filter }: { filter: FilterType }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="
        h-full flex flex-col items-center justify-center
        p-8 text-center
      "
    >
      <div className="
        w-16 h-16 mb-4 rounded-2xl
        glass-subtle
        flex items-center justify-center
      ">
        <MessageIcon size={32} className="text-ink-muted dark:text-ink-inverse-muted opacity-50" />
      </div>
      
      <h3 className="
        text-body-lg font-medium
        text-ink dark:text-ink-inverse
        mb-2
      ">
        No communications yet
      </h3>
      
      <p className="
        text-body-sm
        text-ink-muted dark:text-ink-inverse-muted
        max-w-sm mb-6
      ">
        {filter === 'all' 
          ? 'All communications related to this task will appear here.'
          : `No ${filter} communications found. Try a different filter.`
        }
      </p>

      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className="
          flex items-center gap-2
          px-4 py-2.5 rounded-lg
          bg-accent dark:bg-accent-light
          text-white
          text-body-sm font-medium
          hover:shadow-glow-accent
          transition-shadow duration-200
        "
      >
        <PlusIcon size={16} />
        Log communication
      </motion.button>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function formatTimestamp(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  if (mins === 0) return `${secs}s`
  return `${mins}m ${secs}s`
}
