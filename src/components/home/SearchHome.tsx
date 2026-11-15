/**
 * The home page (`ron://home`, `activeTab === 'home'`): the "ren." logotype, one large search bar with the
 * Agent Panel's context button and the reasoning-level select, the user's favorites underneath and a dock
 * to Ren's other environments.
 *
 * No surface of its own: the page sits directly on the content area (so Glass shows through). In dark mode
 * a spotlight falls on the logotype from above.
 *
 * Search submits like the sidebar and address bar: a query opens `ron://search?q=…&level=…` in the active
 * tab, an address navigates to it. Context picked with the button (tabs, past conversations, issues,
 * projects, pages, files…) is the panel's own: `useComposerAttachments` + `ContextPicker` +
 * `ComposerAttachmentTray`. At submit it is read into `PromptAttachment`s, kept in `searchAttachmentsStore`
 * under the id the URL carries as `ctx`, and sent with the search (answered by the Search agent).
 */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowUp, Loader2, Search } from 'lucide-react'
import { RenWordmark } from '@/components/brand'
import { FavoriteLinks } from '@/components/home/FavoriteLinks'
import { TextAssist, handleAssistKey } from '@/components/shared/TextAssist'
import { buildSearchRonUrl, looksLikeUrl } from '@/components/chrome/UrlBar'
import { DESTINATIONS, openDestination } from '@/components/navigation/destinations'
import { openInternalUrl } from '@/components/board/task-detail/editor/extensions/blocks/workspace'
import { ContextPicker } from '@/components/agent-panel/ContextPicker'
import { ComposerAttachmentTray } from '@/components/agent-panel/PromptAttachments'
import { useComposerAttachments } from '@/components/agent-panel/useComposerAttachments'
import { SearchDepthSelector } from '@/components/search/SearchDepthSelector'
import { useTextAssist } from '@/hooks/useTextAssist'
import { useSearchStore } from '@/stores/searchStore'
import { useAuthStore } from '@/stores/authStore'
import { articleDraftKey } from '@/stores/articleDraftStore'
import { useSearchAttachmentsStore } from '@/stores/searchAttachmentsStore'
import { cn } from '@/utils/cn'

const EASE = [0.16, 1, 0.3, 1] as const
const skipAddresses = (value: string) => looksLikeUrl(value.trim())

/** Dark mode only: a cone of light from the top of the page onto the logotype, and the pool it leaves. */
function Spotlight() {
  const reduced = useReducedMotion()
  return (
    <motion.div
      aria-hidden
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1.6, ease: EASE, delay: 0.1 }}
      className="pointer-events-none absolute inset-x-0 top-0 hidden h-[calc(13vh+230px)] overflow-hidden dark:block"
    >
      {/* The blur sits on the wrapper: on the clipped element itself the clip would cut the softened edges. */}
      <div className="absolute left-1/2 top-0 h-full w-[min(820px,120vw)] -translate-x-1/2 blur-[26px]">
        <div
          className="h-full w-full [clip-path:polygon(43%_0,57%_0,90%_100%,10%_100%)]"
          style={{ background: 'linear-gradient(180deg, rgb(232 233 255 / 0.18) 0%, rgb(214 216 255 / 0.08) 45%, rgb(214 216 255 / 0.03) 78%, transparent 100%)' }}
        />
      </div>
      <div
        className="absolute bottom-2 left-1/2 h-28 w-[min(560px,95vw)] -translate-x-1/2 rounded-[50%] blur-2xl"
        style={{ background: 'radial-gradient(closest-side, rgb(255 255 255 / 0.08), rgb(200 204 255 / 0.03) 60%, transparent)' }}
      />
    </motion.div>
  )
}

/** Ren's other environments, one click from home. */
function EnvironmentDock() {
  return (
    <nav aria-label="Environments" className="flex items-center gap-0.5 rounded-full border border-surface-200/80 bg-surface-0/60 p-1 backdrop-blur-md dark:border-surface-800 dark:bg-surface-850/50">
      {DESTINATIONS.filter((destination) => destination.id !== 'home').map(({ id, label, icon: Icon, hint }) => (
        <button
          key={id}
          type="button"
          onClick={() => openDestination(id)}
          aria-label={label}
          title={`${label}: ${hint}`}
          className="group flex h-9 items-center gap-2 rounded-full px-3 text-[13px] font-medium text-ink-secondary transition-colors duration-150 ease-out hover:bg-ink/[0.06] hover:text-ink focus-visible:ring-offset-0 dark:text-ink-inverse-secondary dark:hover:bg-ink-inverse/[0.08] dark:hover:text-ink-inverse sm:px-3"
        >
          <Icon className="h-4 w-4 shrink-0 transition-colors duration-150 group-hover:text-volt" strokeWidth={1.75} aria-hidden />
          <span className="hidden md:inline">{label}</span>
        </button>
      ))}
    </nav>
  )
}

export function SearchHome() {
  const reduced = useReducedMotion()
  const level = useSearchStore((state) => state.level)
  const userId = useAuthStore((state) => state.user?.id || 'default')
  const attachments = useComposerAttachments(articleDraftKey(userId, 'search', 'home'), userId)
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  // The context menu stays inside the search card's right edge.
  const [cardRight, setCardRight] = useState<number>()
  // Brave Suggest + Spellcheck for queries; an address is not a search phrase.
  const assist = useTextAssist(query, { enabled: focused, count: 8, skip: skipAddresses })

  // Take focus on arrival unless something else (the address bar after ⌘T, a dialog) already has it.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (!document.activeElement || document.activeElement === document.body) inputRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  const submit = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    assist.dismiss()
    setError('')
    // An address is opened as is; attached context only goes with a search.
    if (looksLikeUrl(trimmed) && !trimmed.startsWith('ron://search') && !attachments.count) {
      openInternalUrl(trimmed)
      setQuery('')
      return
    }
    let contextId: string | null = null
    if (attachments.count) {
      setSending(true)
      try {
        // Each picked item is read now (the record as it is at send), exactly as the panel sends it.
        contextId = useSearchAttachmentsStore.getState().save(await attachments.forSend())
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
        return
      } finally {
        setSending(false)
      }
    }
    openInternalUrl(buildSearchRonUrl(trimmed, level, contextId))
    setQuery('')
    if (contextId) attachments.clearContexts()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (handleAssistKey(event, assist, (text) => void submit(text), (text) => { setQuery(text); assist.dismiss() })) return
    if (event.key === 'Escape') inputRef.current?.blur()
  }

  const canSubmit = Boolean(query.trim()) && !sending
  const onSubmit = (event: FormEvent) => { event.preventDefault(); void submit(query) }
  const rise = (delay: number) => reduced ? {} : {
    initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.6, ease: EASE, delay },
  }

  return (
    <div className="relative flex min-h-full flex-col items-center px-4 pb-6 pt-[13vh] text-ink dark:text-ink-inverse">
      <Spotlight />

      <motion.h1 {...rise(0)} className="relative">
        <RenWordmark className="text-[68px] text-ink sm:text-[92px] dark:text-ink-inverse dark:drop-shadow-[0_0_34px_rgb(225_228_255/0.2)]" />
      </motion.h1>

      <motion.form {...rise(0.08)} role="search" onSubmit={onSubmit} className="relative mt-10 w-full max-w-[680px]">
        <div ref={cardRef} className={cn(
          'ron-field rounded-[24px] border transition-[border-color,box-shadow,background-color] duration-150 ease-out',
          focused
            ? 'border-blurple-500/70 bg-surface-0 shadow-soft ring-[3px] ring-blurple-500/10 dark:border-blurple-400/70 dark:bg-surface-850 dark:shadow-dark-soft dark:ring-blurple-400/15'
            : 'border-surface-200 bg-surface-0 shadow-soft hover:border-surface-300 dark:border-surface-800 dark:bg-surface-850/90 dark:shadow-dark-soft dark:hover:border-surface-700',
        )}>
          <ComposerAttachmentTray attachments={attachments} className="px-5 pt-4" />
          <label className="flex items-center gap-3.5 px-5 pb-2 pt-4">
            <Search className={cn('h-4 w-4 shrink-0 transition-colors duration-150', focused ? 'text-volt' : 'text-ink-muted dark:text-ink-inverse-muted')} strokeWidth={1.75} aria-hidden />
            <span className="sr-only">Search the web or ask Ren</span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={onKeyDown}
              id="home-search-bar"
              data-testid="home-search-input"
              placeholder="Search the web or ask Ren"
              autoComplete="off"
              spellCheck={false}
              className="h-10 min-w-0 flex-1 bg-transparent text-[18px] text-ink outline-none placeholder:text-[15px] placeholder:text-ink-muted focus-visible:ring-0 focus-visible:ring-offset-0 dark:text-ink-inverse dark:placeholder:text-ink-inverse-muted"
            />
          </label>
          <div className="flex items-center gap-1.5 px-3 pb-3">
            {/* The Agent Panel's context button: tabs, past conversations, issues, projects, dates, interests, pages and files. */}
            <span onPointerDownCapture={() => setCardRight(cardRef.current?.getBoundingClientRect().right)} onKeyDownCapture={() => setCardRight(cardRef.current?.getBoundingClientRect().right)}>
              <ContextPicker selectedContexts={attachments.contexts} onContextsChange={attachments.setContexts} anchor="bottom" width={320} maxListHeight={260} boundsRight={cardRight} />
            </span>
            <div className="flex-1" />
            <SearchDepthSelector size="md" />
            <button
              type="submit"
              disabled={!canSubmit}
              aria-label="Search"
              title="Search"
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors duration-150 ease-out',
                canSubmit
                  ? 'bg-blurple-600 text-white hover:bg-blurple-700 active:bg-blurple-800 dark:bg-blurple-400 dark:text-ink dark:hover:bg-blurple-300'
                  : 'bg-surface-100 text-ink-muted dark:bg-surface-800 dark:text-ink-inverse-muted',
              )}
            >
              {sending ? <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden /> : <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.25} />}
            </button>
          </div>
        </div>
        {focused && <TextAssist assist={assist} placement="below" className="z-20"
          onPick={(text) => void submit(text)}
          onCorrect={(text) => { setQuery(text); assist.dismiss(); inputRef.current?.focus() }} />}
        {error && <p role="alert" className="mt-3 text-center text-[12.5px] text-red-600 dark:text-red-400">{error}</p>}
      </motion.form>

      <motion.div {...rise(0.16)} className="mt-10 w-full max-w-[680px]">
        <FavoriteLinks variant="dial" />
      </motion.div>

      <motion.div {...rise(0.24)} className="mt-auto pt-12">
        <EnvironmentDock />
      </motion.div>
    </div>
  )
}
