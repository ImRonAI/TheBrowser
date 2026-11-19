/**
 * Deep Research Launch / Idle view (`ron://research`):
 * Calm, minimal Inter (`font-sans`) launch surface matching `SearchHome.tsx`, sitting directly on
 * `.ron-content` so Light, Dark (with ambient top spotlight), and Glass show through cleanly.
 *
 * Includes:
 * - `.ron-field` research prompt composer with `ContextPicker`, `@` mention autocomplete
 *   (`ContextMentionList` over `useContextSources`), and `ComposerAttachmentTray`
 * - Depth segmented control (`Standard`, `Deep`, `Exhaustive`)
 * - Horizontal side-scrolling bar of 10 equal-fixed-width (`w-60`) glassmorphic `<Suggestion>` pills
 *   (`@/components/ai-elements/suggestion`) that populate rich scholarly prompts into the composer on click.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type WheelEvent,
} from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowUp, Loader2 } from 'lucide-react'
import { Suggestions, Suggestion } from '@/components/ai-elements/suggestion'
import { Marker } from '@/components/brand'
import { ContextMentionList, ContextPicker } from '@/components/agent-panel/ContextPicker'
import {
  DEFAULT_AGENT_MODEL,
  ModelSelector,
  useAgentModels,
  type AgentModelSelection,
} from '@/components/agent-panel/ModelSelector'
import { ComposerAttachmentTray } from '@/components/agent-panel/PromptAttachments'
import { useComposerAttachments } from '@/components/agent-panel/useComposerAttachments'
import { useContextSources } from '@/components/agent-panel/useContextSources'
import {
  formatAttachmentsForResearchContext,
  mentionAt,
  removeMention,
  searchContexts,
  type ContextItem,
} from '@/lib/chat-context'
import {
  DEPTH_METADATA,
  type DeepResearchSelection,
  type FormationTopology,
  type ResearchDepth,
} from '@/lib/deep-research-api'
import { articleDraftKey, useArticleDraftStore } from '@/stores/articleDraftStore'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/utils/cn'

const EASE = [0.16, 1, 0.3, 1] as const

export interface ResearchPromptSuggestion {
  id: string
  label: string
  prompt: string
}

/**
 * 10 curated Deep Research starter prompts rendered as equal-fixed-width glassmorphic `<Suggestion>` pills.
 * Clicking a pill populates `prompt` into the composer so the user can attach `@context`, tune depth, or edit before launch.
 */
export const DEEP_RESEARCH_SUGGESTIONS: readonly ResearchPromptSuggestion[] = [
  {
    id: 'ai-grid-power',
    label: 'AI Grid Power Bottlenecks',
    prompt:
      'Conduct a rigorous empirical analysis of 2026–2030 US and European electric grid bottlenecks driven by gigawatt-scale AI training and inference clusters. Compare interconnection queue backlogs, behind-the-meter nuclear and aeroderivative gas economics, transformer lead times, and FERC/ENTSO-E tariff reforms using primary utility filings and ISO capacity disclosures.',
  },
  {
    id: 'pqc-migration',
    label: 'Post-Quantum TLS Rollout',
    prompt:
      'Evaluate production readiness of NIST post-quantum cryptography standards (ML-KEM / FIPS 203, ML-DSA / FIPS 204, SLH-DSA / FIPS 205) across TLS 1.3 CDNs, cloud KMS providers, and hardware security modules. Quantify handshake latency, packet fragmentation under middleboxes, hybrid key-exchange trade-offs, and concrete enterprise migration blockers.',
  },
  {
    id: 'solid-state-vs-sodium',
    label: 'Solid-State vs Sodium EVs',
    prompt:
      'Compare commercial trajectories of sulfide/oxide solid-state lithium-metal batteries against generation-2 sodium-ion cells through 2029. Triangulate pilot-line yield rates, dry-electrode manufacturing capex, critical mineral supply chains, cycle-life degradation under fast charging, and pack-level $/kWh parity thresholds.',
  },
  {
    id: 'local-first-crdt',
    label: 'CRDTs vs Local SQLite Sync',
    prompt:
      'Synthesize an architectural comparison between Automerge/Yjs CRDT engines and server-reconciled local SQLite sync architectures (Zero, ElectricSQL, PowerSync) for collaborative desktop and mobile software. Stress-test memory compaction, schema evolution, row-level authorization boundaries, and adversarial offline conflict resolution.',
  },
  {
    id: 'qldpc-fault-tolerance',
    label: 'qLDPC vs Surface Qubits',
    prompt:
      'Examine high-rate quantum low-density parity-check (qLDPC) codes versus planar surface codes across neutral-atom, superconducting, and trapped-ion hardware roadmaps. Evaluate physical-to-logical qubit overhead, non-local coupler routing constraints, syndrome decoding latency budgets, and fault-tolerant magic-state factory costs.',
  },
  {
    id: 'glp1-cardiometabolic',
    label: 'Next-Gen Oral GLP-1 Trials',
    prompt:
      'Investigate clinical efficacy, lean-mass preservation, manufacturing peptide constraints, and payer reimbursement dynamics comparing next-generation oral small-molecule GLP-1s, amylin combinations, and GIP/GLP-1/glucagon triple agonists across Phase II/III cardiometabolic and renal outcome trials.',
  },
  {
    id: 'advanced-packaging-cowos',
    label: 'CoWoS-L & HBM4 Packaging',
    prompt:
      'Map the global advanced semiconductor packaging and memory bottleneck from 2026 to 2029: TSMC CoWoS-L/SoIC capacity expansions, HBM4 hybrid bonding yields, glass-core substrate adoption, and co-packaged optics (CPO) power-per-bit economics versus copper SerDes at 224G/448G.',
  },
  {
    id: 'enhanced-geothermal',
    label: 'Enhanced Geothermal LCOE',
    prompt:
      'Assess next-generation enhanced geothermal systems (horizontal multistage stimulation, closed-loop conduction, and millimeter-wave superhot rock drilling) as 24/7 clean baseload power. Audit field demonstration LCOE trajectories, induced seismicity mitigation, subsurface thermal drawdown rates, and oilfield rig transferability.',
  },
  {
    id: 'humanoid-actuators',
    label: 'Humanoid Actuator Supply',
    prompt:
      'Deconstruct bill-of-materials cost curves and mechanical bottlenecks in commercial humanoid robots: planetary roller screws, axial-flux vs frameless torque motors, harmonic drives, tactile sensor arrays, and sim-to-real visuomotor policy generalization in unstructured warehouse and manufacturing deployments.',
  },
  {
    id: 'sovereign-debt-term-premia',
    label: 'G7 Debt & Term Premia',
    prompt:
      'Analyze structural shifts in G7 sovereign bond markets under persistent fiscal deficits and central bank balance-sheet normalization. Cross-examine Treasury term-premia decompositions, dealer balance-sheet intermediation constraints, basis-trade leverage vulnerabilities, and foreign official duration demand.',
  },
]

/** Ambient top cone of light in dark mode, matching `SearchHome.tsx`. */
function Spotlight() {
  const reduced = useReducedMotion()
  return (
    <motion.div
      aria-hidden
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1.4, ease: EASE, delay: 0.08 }}
      className="pointer-events-none absolute inset-x-0 top-0 hidden h-[calc(11vh+220px)] overflow-hidden dark:block"
    >
      <div className="absolute left-1/2 top-0 h-full w-[min(780px,115vw)] -translate-x-1/2 blur-[26px]">
        <div
          className="h-full w-full [clip-path:polygon(43%_0,57%_0,90%_100%,10%_100%)]"
          style={{
            background:
              'linear-gradient(180deg, rgb(232 233 255 / 0.15) 0%, rgb(214 216 255 / 0.07) 45%, rgb(214 216 255 / 0.025) 78%, transparent 100%)',
          }}
        />
      </div>
      <div
        className="absolute bottom-2 left-1/2 h-24 w-[min(520px,92vw)] -translate-x-1/2 rounded-[50%] blur-2xl"
        style={{
          background:
            'radial-gradient(closest-side, rgb(255 255 255 / 0.07), rgb(200 204 255 / 0.025) 60%, transparent)',
        }}
      />
    </motion.div>
  )
}

export interface DeepResearchHeroProps {
  userId?: string | undefined
  depth: ResearchDepth
  depths: readonly ResearchDepth[]
  preferredModel: AgentModelSelection
  defaultSelection?: DeepResearchSelection | undefined
  starting: boolean
  available: boolean
  error: string | null
  topology: FormationTopology
  containerWidth: number
  onDepthChange: (depth: ResearchDepth) => void
  onModelChange: (selection: AgentModelSelection) => void
  onSubmit: (params: {
    query: string
    depth: ResearchDepth
    context?: string | undefined
    provider?: string | null | undefined
    modelId?: string | null | undefined
    reasoningEffort?: string | null | undefined
  }) => void
}

export function DeepResearchHero({
  userId,
  depth,
  depths,
  preferredModel,
  defaultSelection,
  starting,
  available,
  error,
  topology: _topology,
  containerWidth,
  onDepthChange,
  onModelChange,
  onSubmit,
}: DeepResearchHeroProps) {
  const reduced = useReducedMotion()
  const authUserId = useAuthStore((s) => s.user?.id || 'default')
  const resolvedUserId = userId || authUserId
  const { refresh: refreshModels, ...modelCatalogue } = useAgentModels()
  const effectiveModel =
    preferredModel.model || defaultSelection?.model_id || modelCatalogue.defaultModel || DEFAULT_AGENT_MODEL
  const effectiveProvider =
    preferredModel.provider || defaultSelection?.provider || modelCatalogue.defaultProvider
  const draftKey = useMemo(
    () => articleDraftKey(resolvedUserId, 'search', 'deep-research'),
    [resolvedUserId],
  )
  const attachments = useComposerAttachments(draftKey, resolvedUserId)

  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [resolvingContext, setResolvingContext] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [caret, setCaret] = useState(0)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionDismissedAt, setMentionDismissedAt] = useState<number | null>(null)
  const [cardRight, setCardRight] = useState<number>()

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const suggestionsWrapRef = useRef<HTMLDivElement>(null)

  const typedMention = useMemo(
    () => mentionAt(query, Math.min(caret, query.length)),
    [query, caret],
  )
  const mentionCandidateActive =
    typedMention !== null && typedMention.start !== mentionDismissedAt
  const { categories: mentionCategories } = useContextSources(mentionCandidateActive)

  const typedResults = useMemo(
    () =>
      mentionCandidateActive && typedMention
        ? searchContexts(mentionCategories, typedMention.query, 8)
        : [],
    [mentionCandidateActive, mentionCategories, typedMention],
  )
  const mention =
    mentionCandidateActive &&
    typedMention &&
    (typedResults.length > 0 || !/\s/.test(typedMention.query))
      ? typedMention
      : null
  const mentionResults = mention ? typedResults : []
  const selectedMention = Math.min(mentionIndex, Math.max(0, mentionResults.length - 1))
  const mentionLoading = mentionCategories.some((category) => category.loading)
  const mentionSelectedIds = useMemo(
    () => new Set(attachments.contexts.map((item) => item.id)),
    [attachments.contexts],
  )

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (!document.activeElement || document.activeElement === document.body) {
        textareaRef.current?.focus()
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  const busy = starting || resolvingContext
  const compactControls = containerWidth > 0 && containerWidth < 560
  const effectivePrompt = attachments.messageFor(query).trim()
  const canLaunch = Boolean(effectivePrompt) && !busy && available
  const activeDepthMeta = DEPTH_METADATA.find((d) => d.id === depth) ?? DEPTH_METADATA[2]

  const chooseMention = (item: ContextItem) => {
    if (!mention) return
    const next = removeMention(query, mention.start, Math.min(caret, query.length))
    setQuery(next.text)
    setCaret(next.caret)
    setMentionIndex(0)
    attachments.addContext(item)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(next.caret, next.caret)
    })
  }

  const handleQueryChange = (value: string, nextCaret: number) => {
    setQuery(value)
    setCaret(nextCaret)
    setMentionIndex(0)
    if (localError) setLocalError(null)
    if (mentionDismissedAt !== null && !mentionAt(value, nextCaret)) {
      setMentionDismissedAt(null)
    }
  }

  const triggerSubmit = async () => {
    const finalQuery = attachments.messageFor(query).trim()
    if (!finalQuery || busy || !available) return
    setLocalError(null)

    let contextMarkdown: string | undefined
    const sentPasteIds = attachments.pasted.map((item) => item.id)
    const sentContextIds = attachments.contexts.map((item) => item.id)

    if (attachments.count > 0) {
      setResolvingContext(true)
      try {
        const resolved = await attachments.forSend()
        const formatted = formatAttachmentsForResearchContext(resolved)
        if (formatted) contextMarkdown = formatted
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : String(err))
        setResolvingContext(false)
        return
      }
      setResolvingContext(false)
    }

    useArticleDraftStore.getState().clearSent(draftKey, query, sentPasteIds)
    attachments.clearContexts(sentContextIds)
    setQuery('')
    setCaret(0)
    setMentionDismissedAt(null)

    onSubmit({
      query: finalQuery,
      depth,
      context: contextMarkdown,
      provider: preferredModel.model ? preferredModel.provider || effectiveProvider || null : null,
      modelId: preferredModel.model || null,
      reasoningEffort: preferredModel.effort || null,
    })
  }

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault()
    void triggerSubmit()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (mention) {
      if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey && mentionResults.length === 0)) {
        e.preventDefault()
        setMentionDismissedAt(mention.start)
        return
      }
      if (mentionResults.length > 0) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          setMentionIndex(
            (selectedMention + (e.key === 'ArrowDown' ? 1 : -1) + mentionResults.length) %
              mentionResults.length,
          )
          return
        }
        if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
          e.preventDefault()
          const picked = mentionResults[selectedMention]
          if (picked) chooseMention(picked.item)
          return
        }
      }
    }

    if (e.key === 'Enter' && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void triggerSubmit()
    }
  }

  const handlePickSuggestion = (promptText: string) => {
    if (busy || !available) return
    setQuery(promptText)
    setCaret(promptText.length)
    setMentionDismissedAt(null)
    setLocalError(null)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(promptText.length, promptText.length)
    })
  }

  const handleSuggestionsWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
    const viewport = suggestionsWrapRef.current?.querySelector<HTMLElement>(
      '[data-radix-scroll-area-viewport]',
    )
    if (!viewport || viewport.scrollWidth <= viewport.clientWidth) return
    e.preventDefault()
    viewport.scrollLeft += e.deltaY
  }

  const rise = (delay: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 12 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.55, ease: EASE, delay },
        }

  const displayError = localError || error

  return (
    <div className="relative h-full overflow-y-auto px-6 pb-14 pt-[9vh] font-sans text-ink scrollbar-thin dark:text-ink-inverse">
      <Spotlight />

      <div className="relative mx-auto flex w-full max-w-[760px] min-w-0 flex-col items-center">
        {/* Hero Header: poster `.ren-display` statement + calm Inter body */}
        <motion.section {...rise(0)} className="relative w-full">
          <div
            aria-hidden
            className="halftone pointer-events-none absolute -left-20 -top-16 h-56 w-[30rem] opacity-75 dark:opacity-55"
          />
          <h1 className="ren-display relative text-[clamp(44px,5.6vw,74px)] text-ink dark:text-ink-inverse">
            Every angle,{' '}
            <span className="spray-halo inline-block">
              <Marker>verified.</Marker>
            </span>
          </h1>
          <p className="relative mt-4 max-w-[40rem] font-sans text-[15.5px] leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary">
            A research swarm, a data analysis graph and a writing swarm, published as a cited PDF report and
            an interactive Slidev deck.
          </p>
        </motion.section>

        {/* Disabled / Error Banner */}
        {!available && (
          <div
            role="status"
            className="mt-6 w-full rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 font-sans text-[13px] text-rose-700 dark:text-rose-300"
          >
            Deep Research is currently disabled on the backend.
          </div>
        )}
        {displayError && (
          <div
            role="alert"
            className="mt-6 w-full rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 font-sans text-[13px] text-rose-700 dark:text-rose-300"
          >
            {displayError}
          </div>
        )}

        {/* Research Prompt Composer with ContextPicker + @ Mentions + Attachment Tray */}
        <motion.form {...rise(0.06)} onSubmit={handleFormSubmit} className="mt-8 w-full min-w-0">
          <div
            ref={cardRef}
            className={cn(
              'ron-field relative rounded-[24px] border transition-[border-color,box-shadow,background-color] duration-150 ease-out',
              focused
                ? 'border-blurple-500/70 bg-surface-0 shadow-soft ring-[3px] ring-blurple-500/10 dark:border-blurple-400/70 dark:bg-surface-850 dark:shadow-dark-soft dark:ring-blurple-400/15'
                : 'border-surface-200 bg-surface-0 shadow-soft hover:border-surface-300 dark:border-surface-800 dark:bg-surface-850/90 dark:shadow-dark-soft dark:hover:border-surface-700',
            )}
          >
            {mention && (
              <ContextMentionList
                query={mention.query}
                results={mentionResults}
                activeIndex={selectedMention}
                loading={mentionLoading}
                selectedIds={mentionSelectedIds}
                onPick={chooseMention}
                onHover={setMentionIndex}
              />
            )}

            <ComposerAttachmentTray attachments={attachments} className="px-5 pt-4" />

            <label className="block px-5 pb-2 pt-4">
              <span className="sr-only">Research objective</span>
              <textarea
                ref={textareaRef}
                rows={4}
                value={query}
                onChange={(e) =>
                  handleQueryChange(e.target.value, e.target.selectionStart ?? e.target.value.length)
                }
                onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? query.length)}
                onPaste={attachments.onPaste}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={handleKeyDown}
                aria-expanded={mention ? true : undefined}
                disabled={busy || !available}
                placeholder="Ask a research question, or type @ to attach Context, tabs, chats, issues, and files…"
                className="w-full resize-none bg-transparent font-sans text-[15.5px] leading-relaxed text-ink outline-none placeholder:text-ink-muted focus-visible:ring-0 focus-visible:ring-offset-0 dark:text-ink-inverse dark:placeholder:text-ink-inverse-muted"
              />
            </label>

            <div
              className={cn(
                'flex items-center justify-between gap-2 px-3.5 pb-3 pt-1.5',
                compactControls && 'flex-wrap',
              )}
            >
              {/* Context Picker + ModelSelector + Depth Segmented Control */}
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span
                  onPointerDownCapture={() =>
                    setCardRight(cardRef.current?.getBoundingClientRect().right)
                  }
                  onKeyDownCapture={() =>
                    setCardRight(cardRef.current?.getBoundingClientRect().right)
                  }
                >
                  <ContextPicker
                    selectedContexts={attachments.contexts}
                    onContextsChange={attachments.setContexts}
                    anchor="bottom"
                    disabled={busy || !available}
                    width={336}
                    maxListHeight={280}
                    boundsRight={cardRight}
                  />
                </span>

                <ModelSelector
                  value={effectiveModel}
                  provider={effectiveProvider}
                  effort={preferredModel.effort}
                  {...modelCatalogue}
                  disabled={busy || !available}
                  onChange={(model, provider, effort) => onModelChange({ model, provider, effort })}
                  onOpen={refreshModels}
                  className="h-8 min-w-0 max-w-[210px] rounded-full border-surface-200 bg-surface-50 px-3 font-sans text-[12px] font-medium shadow-none dark:border-surface-700 dark:bg-surface-800/70"
                />

                <div
                  role="radiogroup"
                  aria-label="Research depth"
                  className="inline-flex items-center rounded-full bg-surface-100/90 p-0.5 dark:bg-surface-800/90"
                >
                  {DEPTH_METADATA.filter((item) => depths.includes(item.id)).map((item) => {
                    const selected = depth === item.id
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={busy || !available}
                        onClick={() => onDepthChange(item.id)}
                        title={item.description}
                        className={cn(
                          'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 font-sans text-[12.5px] font-medium transition-colors duration-150',
                          selected
                            ? 'bg-blurple-600 text-white dark:bg-blurple-400 dark:text-ink'
                            : 'text-ink-secondary hover:text-ink dark:text-ink-inverse-secondary dark:hover:text-ink-inverse',
                        )}
                      >
                        {item.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <button
                type="submit"
                disabled={!canLaunch}
                aria-label="Start Deep Research"
                title="Start Deep Research"
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors duration-150 ease-out',
                  canLaunch
                    ? 'bg-blurple-600 text-white hover:bg-blurple-700 active:bg-blurple-800 dark:bg-blurple-400 dark:text-ink dark:hover:bg-blurple-300'
                    : 'bg-surface-100 text-ink-muted dark:bg-surface-800 dark:text-ink-inverse-muted',
                )}
              >
                {busy ? (
                  <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden />
                ) : (
                  <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.25} aria-hidden />
                )}
              </button>
            </div>
          </div>

          <p className="mt-2.5 text-center font-sans text-[12.5px] text-ink-muted dark:text-ink-inverse-muted">
            <span className="font-medium text-ink-secondary dark:text-ink-inverse-secondary">
              {activeDepthMeta?.label}
            </span>{' '}
            — {activeDepthMeta?.description}
          </p>
        </motion.form>

        {/* 10 Equal-Fixed-Width Sleek Glassmorphic Horizontal Side-Scrolling Suggestions */}
        <motion.section
          {...rise(0.12)}
          ref={suggestionsWrapRef}
          onWheel={handleSuggestionsWheel}
          aria-label="Research prompt suggestions"
          className="mt-7 min-w-0 w-full overflow-hidden"
        >
          <Suggestions className="gap-2.5 py-1 pr-2">
            {DEEP_RESEARCH_SUGGESTIONS.map((item) => (
              <Suggestion
                key={item.id}
                variant="ghost"
                suggestion={item.prompt}
                disabled={busy || !available}
                onClick={handlePickSuggestion}
                title={item.prompt}
                className="h-10 w-60 min-w-60 max-w-60 shrink-0 items-center justify-center overflow-hidden rounded-full border border-ink/[0.08] bg-surface-0/55 px-4 text-center font-sans text-[13px] font-medium text-ink-secondary backdrop-blur-xl shadow-[0_4px_20px_-6px_rgb(11_12_23/0.08),inset_0_1px_0_0_rgb(255_255_255/0.7)] transition-all duration-150 hover:border-blurple-500/35 hover:bg-surface-0/80 hover:text-ink dark:border-white/[0.09] dark:bg-white/[0.045] dark:text-ink-inverse-secondary dark:shadow-[0_8px_24px_-8px_rgb(0_0_0/0.55),inset_0_1px_0_0_rgb(255_255_255/0.09)] dark:hover:border-blurple-400/40 dark:hover:bg-white/[0.085] dark:hover:text-ink-inverse"
              >
                <span className="block w-full truncate text-center">{item.label}</span>
              </Suggestion>
            ))}
          </Suggestions>
        </motion.section>
      </div>
    </div>
  )
}
