/**
 * The opening sequence a first-time user sees (docs/brand.md § Opening), played once over the first screen:
 *
 * 1. The "ren" outlines draw themselves in blurple, then fill white.
 * 2. The dot drops in, squashes on landing, sends a shockwave and paint flecks out, and drips.
 * 3. "Browse." "Build." "Automate." cut in one after another, then "Let Ren cook." with the marker underline.
 * 4. "Let's go" (or Enter) floods the screen in blurple from the dot and fades into the app; Skip or Esc leaves at once.
 *
 * Reduced motion shows the finished frame without movement. `#intro` replays it (src/lib/intro.ts).
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { INTRO_HASH, markIntroSeen, shouldPlayIntro } from '@/lib/intro'
import { LOGOTYPE_DOT, LOGOTYPE_HEIGHT, LOGOTYPE_REN, LOGOTYPE_TOP, LOGOTYPE_WIDTH } from './logotype'
import { Marker } from './Marker'

const PHASES = ['draw', 'drop', 'words', 'final', 'exit'] as const
type Phase = typeof PHASES[number]

const WORDS = ['Browse', 'Build', 'Automate']
const BEAT = { drop: 1250, words: 2150, word: 660 }
const FINAL_AT = BEAT.words + WORDS.length * BEAT.word
const EXPO_OUT = [0.19, 1, 0.22, 1] as const
const EXPO_IN = [0.7, 0, 0.84, 0] as const
const VOLT = '#8D98FE'
const LANDING = 0.38

/** LOGOTYPE_DOT's centre and radius, in the logotype's font units. */
const DOT = { cx: 1412.6, cy: -77.5, r: 94 }
/** Paint thrown off by the landing: offsets from the dot's centre (font units) and radii. Hand-placed, mostly upward. */
const FLECKS = [
  { dx: -178, dy: -58, r: 15 }, { dx: -126, dy: -156, r: 10 }, { dx: -38, dy: -214, r: 13 }, { dx: 64, dy: -192, r: 8 },
  { dx: 156, dy: -128, r: 16 }, { dx: 214, dy: -22, r: 9 }, { dx: 192, dy: 66, r: 12 }, { dx: -214, dy: 44, r: 8 },
  { dx: -104, dy: 104, r: 6 }, { dx: 118, dy: 126, r: 6 }, { dx: -262, dy: -128, r: 5 }, { dx: 268, dy: -96, r: 5 },
]

/** The stage is always ink, whatever the theme: pin the dark variants of the brand channels for Marker and friends. */
const STAGE_VARS = { '--ren-volt': '141 152 254', '--ren-volt-soft': '179 189 255', '--ren-ink': '245 245 250' } as CSSProperties

export function OpeningSequence({ onDone }: { onDone: () => void }) {
  const reduce = useReducedMotion() ?? false
  const [phase, setPhase] = useState<Phase>(reduce ? 'final' : 'draw')
  const [word, setWord] = useState(0)
  const [leaving, setLeaving] = useState<'flood' | 'skip' | null>(null)
  const [flood, setFlood] = useState<{ x: number; y: number; radius: number } | null>(null)
  const timers = useRef<number[]>([])
  const dotRef = useRef<SVGPathElement>(null)
  const at = (target: Phase) => PHASES.indexOf(phase) >= PHASES.indexOf(target)

  const clearTimers = () => { timers.current.forEach((timer) => window.clearTimeout(timer)); timers.current = [] }
  useEffect(() => {
    if (reduce) { setPhase('final'); return }
    timers.current = [
      window.setTimeout(() => setPhase('drop'), BEAT.drop),
      window.setTimeout(() => setPhase('words'), BEAT.words),
      ...WORDS.map((_, index) => window.setTimeout(() => setWord(index), BEAT.words + index * BEAT.word)),
      window.setTimeout(() => setPhase('final'), FINAL_AT),
    ]
    return clearTimers
  }, [reduce])

  const go = useCallback(() => {
    if (leaving) return
    clearTimers()
    const rect = dotRef.current?.getBoundingClientRect()
    if (reduce || !rect) { setLeaving('skip'); return }
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)) + 24
    setFlood({ x, y, radius })
    setPhase('final')
    setLeaving('flood')
  }, [leaving, reduce])
  const skip = useCallback(() => { if (!leaving) { clearTimers(); setLeaving('skip') } }, [leaving])
  const fastForward = useCallback(() => { clearTimers(); setPhase('final') }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); skip() }
      else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault()
        if (at('final')) go(); else fastForward()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Nothing behind the stage takes focus or clicks while it plays.
  useEffect(() => {
    const root = document.getElementById('root')
    root?.setAttribute('inert', '')
    return () => root?.removeAttribute('inert')
  }, [])

  const dropped = at('drop')
  const settled = reduce || dropped
  const final = at('final')
  return (
    <motion.div role="dialog" aria-modal="true" aria-label="Welcome to Ren" style={STAGE_VARS}
      className="ren-grain fixed inset-0 z-[400] select-none overflow-hidden bg-[#06071A] text-white"
      initial={{ opacity: reduce ? 0 : 1 }}
      animate={{ opacity: leaving ? 0 : 1 }}
      transition={leaving === 'flood' ? { delay: 0.72, duration: 0.5, ease: 'easeOut' } : { duration: leaving ? 0.32 : 0.25 }}
      onAnimationComplete={() => { if (leaving) onDone() }}>
      <motion.div aria-hidden className="pointer-events-none absolute left-1/2 top-[42%] h-[130vmax] w-[130vmax] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: 'radial-gradient(closest-side, rgb(85 67 255 / 0.5), rgb(85 67 255 / 0.14) 42%, rgb(70 160 255 / 0.05) 60%, transparent 72%)' }}
        initial={reduce ? false : { scale: 0.55, opacity: 0 }}
        animate={dropped && !reduce ? { scale: [1, 1.12, 1], opacity: 1 } : { scale: 1, opacity: 1 }}
        transition={dropped ? { delay: LANDING, duration: 1.1, ease: EXPO_OUT } : { duration: 2.2, ease: EXPO_OUT }} />
      <motion.div aria-hidden className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: 'radial-gradient(rgb(141 152 254 / 0.2) 1px, transparent 1.3px)', backgroundSize: '11px 11px',
          WebkitMaskImage: 'radial-gradient(ellipse 60% 55% at 50% 44%, black 0%, transparent 70%)', maskImage: 'radial-gradient(ellipse 60% 55% at 50% 44%, black 0%, transparent 70%)' }}
        initial={reduce ? false : { opacity: 0, backgroundPosition: '0px 0px' }}
        animate={reduce ? { opacity: 0.7 } : { opacity: 0.7, backgroundPosition: '0px -88px' }}
        transition={{ opacity: { duration: 1.6 }, backgroundPosition: { duration: 16, ease: 'linear', repeat: Infinity } }} />

      <div className="drag-region absolute inset-x-0 top-0 z-10 flex h-14 items-center justify-end px-5">
        <button type="button" onClick={skip} className="no-drag inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-white/45 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50">
          Skip <kbd className="rounded border border-white/20 px-1 text-[10px] tracking-normal">Esc</kbd>
        </button>
      </div>

      <div className="relative flex h-full flex-col items-center justify-center px-6 pb-[4vh]">
        <div className="relative">
          <AnimatePresence>
            {final && (
              <motion.span key="sticker" aria-hidden className="absolute -left-3 -top-12 z-10 rounded-md border-[1.5px] border-white bg-[#5543FF] px-2.5 py-1 font-mono text-[11px] font-semibold uppercase leading-4 tracking-[0.14em] text-white shadow-[3px_3px_0_0_#ffffff] sm:-left-8"
                initial={reduce ? false : { scale: 1.6, rotate: -14, opacity: 0 }} animate={{ scale: 1, rotate: -6, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 520, damping: 18, delay: reduce ? 0 : 0.5 }}>
                hello, builder
              </motion.span>
            )}
          </AnimatePresence>
          <svg viewBox={`0 ${LOGOTYPE_TOP} ${LOGOTYPE_WIDTH} ${LOGOTYPE_HEIGHT}`} role="img" aria-label="ren."
            className="w-[min(64vw,600px)] overflow-visible" style={{ overflow: 'visible' }}>
            <motion.path d={LOGOTYPE_REN} stroke={VOLT} strokeWidth={5} strokeLinejoin="round"
              initial={reduce ? false : { pathLength: 0, fill: 'rgba(247, 247, 255, 0)', strokeOpacity: 1 }}
              animate={{ pathLength: 1, fill: 'rgba(247, 247, 255, 1)', strokeOpacity: 0 }}
              transition={{ pathLength: { duration: 1.1, ease: [0.65, 0, 0.35, 1] }, fill: { delay: 0.9, duration: 0.5 }, strokeOpacity: { delay: 1.15, duration: 0.4 } }} />
            {FLECKS.map((fleck, index) => (
              <motion.circle key={index} cx={DOT.cx} cy={DOT.cy} r={fleck.r} fill={VOLT}
                initial={reduce ? false : { x: 0, y: 0, opacity: 0 }}
                animate={settled ? { x: fleck.dx, y: fleck.dy, opacity: reduce ? 0.5 : [0, 1, 0.5] } : undefined}
                transition={{ delay: LANDING + index * 0.012, duration: 0.55, ease: EXPO_OUT }} />
            ))}
            <motion.rect x={DOT.cx - 8} y={DOT.cy + DOT.r - 12} width={16} height={96} rx={8} fill={VOLT}
              style={{ transformBox: 'fill-box', transformOrigin: '50% 0%' }}
              initial={reduce ? false : { scaleY: 0 }} animate={settled ? { scaleY: 1 } : undefined}
              transition={{ delay: LANDING + 0.3, duration: 1.5, ease: [0.33, 0, 0.2, 1] }} />
            <motion.circle cx={DOT.cx} cy={DOT.cy + DOT.r + 92} r={13} fill={VOLT}
              style={{ transformBox: 'fill-box', transformOrigin: '50% 0%' }}
              initial={reduce ? false : { opacity: 0, scale: 0.3 }} animate={settled ? { opacity: 1, scale: 1 } : undefined}
              transition={{ delay: LANDING + 1.6, duration: 0.35, ease: EXPO_OUT }} />
            {[0, 0.12].map((delay) => (
              <motion.circle key={delay} cx={DOT.cx} cy={DOT.cy} r={DOT.r} fill="none" stroke={VOLT} strokeWidth={delay ? 3 : 6}
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                initial={{ scale: 1, opacity: 0 }}
                animate={dropped && !reduce ? { scale: [1, delay ? 7 : 5], opacity: [0.85, 0] } : undefined}
                transition={{ delay: LANDING + delay, duration: 1, ease: EXPO_OUT }} />
            ))}
            <motion.path ref={dotRef} d={LOGOTYPE_DOT} fill={VOLT} style={{ transformBox: 'fill-box', transformOrigin: '50% 100%' }}
              initial={reduce ? false : { y: -1500, scaleX: 0.84, scaleY: 1.2, opacity: 0 }}
              animate={settled ? { y: [-1500, 0, 0, 0, 0], scaleX: [0.84, 0.84, 1.34, 0.95, 1], scaleY: [1.2, 1.2, 0.66, 1.06, 1], opacity: [1, 1, 1, 1, 1] } : undefined}
              transition={{ duration: 0.82, times: [0, 0.46, 0.6, 0.8, 1], ease: ['easeIn', 'linear', 'easeOut', 'easeOut'] }} />
          </svg>
        </div>

        <div aria-live="polite" className="ren-display relative mt-[min(9vh,72px)] h-[1.28em] w-full max-w-[1100px] overflow-hidden text-center text-[clamp(44px,7.4vw,96px)]">
          {/* Both words are in the clipped slot at once: the old one leaves upward while the next arrives, a ticker with no empty beat. */}
          <AnimatePresence initial={false}>
            {final ? (
              <motion.span key="final" className="absolute inset-x-0 top-0 block"
                initial={reduce ? false : { y: '105%' }} animate={{ y: '0%' }} transition={{ duration: 0.42, ease: EXPO_OUT }}>
                Let Ren <Marker>cook.</Marker>
              </motion.span>
            ) : phase === 'words' ? (
              <motion.span key={WORDS[word]} className="absolute inset-x-0 top-0 block"
                initial={{ y: '105%' }} animate={{ y: '0%' }} exit={{ y: '-105%' }} transition={{ duration: 0.34, ease: EXPO_OUT }}>
                {WORDS[word]}<span className="text-[#8D98FE]">.</span>
              </motion.span>
            ) : null}
          </AnimatePresence>
        </div>

        <motion.p className="mt-5 font-mono text-[11.5px] font-medium uppercase tracking-[0.32em] text-white/55"
          initial={reduce ? false : { opacity: 0, y: 8 }} animate={final ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
          transition={{ delay: final && !reduce ? 0.35 : 0, duration: 0.5, ease: EXPO_OUT }}>
          The browser that builds
        </motion.p>

        <AnimatePresence>
          {final && (
            <motion.div key="cta" className="mt-11 flex flex-col items-center gap-3"
              initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduce ? 0 : 0.7, duration: 0.5, ease: EXPO_OUT }}>
              <button type="button" autoFocus onClick={go}
                className="group inline-flex h-12 items-center gap-2.5 rounded-full bg-white pl-6 pr-5 text-[15px] font-semibold text-[#0B0C17] shadow-[0_18px_48px_-18px_rgb(141_152_254/0.9)] transition-[transform,background-color] duration-200 hover:bg-[#E9EBFF] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#8D98FE]/60">
                Let’s go
                <ArrowRight className="h-4 w-4 text-[#5543FF] transition-transform duration-200 group-hover:translate-x-0.5" strokeWidth={2.5} />
              </button>
              <span className="text-[12px] text-white/40">or press Enter</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {flood && (
        <motion.div aria-hidden className="pointer-events-none fixed inset-0 z-20 bg-[#5543FF]"
          initial={{ clipPath: `circle(0px at ${flood.x}px ${flood.y}px)` }}
          animate={{ clipPath: `circle(${flood.radius}px at ${flood.x}px ${flood.y}px)` }}
          transition={{ duration: 0.7, ease: EXPO_IN }} />
      )}
    </motion.div>
  )
}

/** Mounted once beside the app: plays the opening for a first-time user, or whenever the hash becomes `#intro`. */
export function OpeningSequenceGate() {
  const [playing, setPlaying] = useState(() => { try { return shouldPlayIntro() } catch { return false } })
  useEffect(() => {
    const onHash = () => { if (window.location.hash === INTRO_HASH) setPlaying(true) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const done = useCallback(() => {
    try { markIntroSeen() } catch { /* storage unavailable: it simply plays again next time */ }
    if (window.location.hash === INTRO_HASH) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    setPlaying(false)
  }, [])
  return playing ? createPortal(<OpeningSequence onDone={done} />, document.body) : null
}
