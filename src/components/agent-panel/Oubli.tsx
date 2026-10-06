import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import oubliSvg from '@/assets/oubli.svg?raw'
import {
  EMPTY_THOUGHT, IDLE_THOUGHTS, MOVER_H, MOVER_W, createMascotState, stepMascot, thoughtAppend, thoughtSay,
  thoughtSettle, thoughtStep, type Genre, type MascotInputs, type MascotState, type ThoughtState, type Viseme,
} from '@/lib/mascot'
import { cn } from '@/utils/cn'
import './oubli.css'

/**
 * Oubli, Ron's mascot, living in the Agent Panel. The SVG rig from `docs/reference/oubli-mascot.html` is
 * inlined once; every joint is driven per animation frame from `src/lib/mascot.ts`.
 *
 * The stage is a full-width strip whose floor is its bottom edge. Oubli is a `MOVER_W x MOVER_H`
 * mover drawn at `scale` (CSS px per stage unit) and translated per frame: he wanders the strip,
 * runs from the cursor, gets caught (lifted, flailing) when it reaches him, and is thrown when it
 * flicks -- the reference behaviours, with the reference's numbers, in stage units.
 *
 * Inputs are pulled, not pushed: the parent passes `source()` which returns the
 * current `MascotInputs` (voice/music analyser taps, thinking/working flags, genre,
 * bpm). The thought bubble is pushed through the imperative handle so reasoning
 * deltas stream straight into it without re-rendering the parent.
 */
export interface OubliHandle {
  /** Append a chain-of-thought delta (`bidi_reasoning_delta`, `reasoning_delta`). */
  think: (delta: string) => void
  /** The reasoning stream ended: finish typing, then hide. */
  settle: () => void
  clear: () => void
}

export interface OubliProps {
  source: () => Omit<MascotInputs, 'pointer' | 'stageWidth'>
  /** Whether Oubli is out (peeking) or tucked below the panel edge. */
  visible: boolean
  /** CSS px per stage unit (figure height = MOVER_H * scale). */
  scale: number
  className?: string
}

type Joint = 'ob-jump' | 'ob-squash' | 'ob-lean' | 'ob-shadow' | 'ob-headfollow' | 'ob-headtilt' | 'ob-armL' | 'ob-armR'
  | 'ob-handL' | 'ob-handR' | 'ob-footL' | 'ob-footR' | 'ob-pupilL' | 'ob-pupilR' | 'ob-vSmile'
  | 'ob-sweat' | 'ob-vBrowW' | 'ob-vWavy'
const JOINTS: readonly Joint[] = ['ob-jump', 'ob-squash', 'ob-lean', 'ob-shadow', 'ob-headfollow', 'ob-headtilt', 'ob-armL', 'ob-armR',
  'ob-handL', 'ob-handR', 'ob-footL', 'ob-footR', 'ob-pupilL', 'ob-pupilR', 'ob-vSmile', 'ob-sweat', 'ob-vBrowW', 'ob-vWavy']
/** Bubble anchor (stage units from the stage top): the box grows upward from here; its dots dangle onto the antenna. */
const BUBBLE_Y = 40
const PROP_IDS: Record<Genre, string> = { electronic: 'obDj', country: 'obCowboy', rock: 'obRock', pop: 'obPop', rap: 'obRap', classical: 'obClassical' }
const VISEME_IDS: Record<Viseme, string> = { AH: 'obVisAH', O: 'obVisO', EE: 'obVisEE' }

interface Rig {
  joints: Partial<Record<Joint, SVGGElement>>
  /** `.ob-pshockL/R`: the pupils' parents, scaled down while he is caught. */
  pshockL: SVGGElement | null
  pshockR: SVGGElement | null
  flip: SVGGElement | null
  props: Partial<Record<Genre, SVGGElement>>
  visemes: Record<Viseme, { group: SVGGElement; scale: SVGGElement } | undefined>
  bulbs: SVGGElement[]
  laptop: SVGGElement | null
  platter: SVGGElement | null
  platter2: SVGGElement | null
  deckLights: SVGCircleElement[]
}

/** Last values written per element, so unchanged frames cost no style recalc. */
const written = new WeakMap<Element, Map<string, string>>()
function writeOnce(el: Element, key: string, value: string, apply: () => void) {
  let cache = written.get(el)
  if (!cache) { cache = new Map(); written.set(el, cache) }
  if (cache.get(key) === value) return
  cache.set(key, value)
  apply()
}
function setTransform(el: SVGElement | HTMLElement | null | undefined, transform: string, originX?: number, originY?: number) {
  if (!el) return
  writeOnce(el, 'transform', transform, () => { el.style.transform = transform })
  if (originX !== undefined) {
    const origin = `${originX}px ${originY}px`
    writeOnce(el, 'origin', origin, () => { el.style.transformOrigin = origin; el.style.transformBox = 'view-box' })
  }
}
function setOpacity(el: Element | null | undefined, value: number | string) {
  if (!el) return
  const text = typeof value === 'number' ? value.toFixed(3) : value
  writeOnce(el, 'opacity', text, () => el.setAttribute('opacity', text))
}
function setStyleOpacity(el: HTMLElement | SVGElement | null | undefined, value: number | string) {
  if (!el) return
  const text = typeof value === 'number' ? value.toFixed(3) : value
  writeOnce(el, 'style-opacity', text, () => { el.style.opacity = text })
}

function bindRig(root: HTMLElement): Rig {
  const q = <T extends Element>(selector: string) => root.querySelector<T>(selector)
  const joints: Rig['joints'] = {}
  for (const joint of JOINTS) { const el = q<SVGGElement>(`.${joint}`); if (el) joints[joint] = el }
  const props: Rig['props'] = {}
  for (const genre of Object.keys(PROP_IDS) as Genre[]) { const el = q<SVGGElement>(`#${PROP_IDS[genre]}`); if (el) props[genre] = el }
  const visemes = { AH: undefined, O: undefined, EE: undefined } as Rig['visemes']
  for (const viseme of Object.keys(VISEME_IDS) as Viseme[]) {
    const group = q<SVGGElement>(`#${VISEME_IDS[viseme]}`)
    const scale = group?.querySelector<SVGGElement>('.obVisScale') ?? null
    if (group && scale) visemes[viseme] = { group, scale }
  }
  return {
    joints, props, visemes,
    pshockL: q<SVGGElement>('.ob-pshockL'), pshockR: q<SVGGElement>('.ob-pshockR'), flip: q<SVGGElement>('#obFlip'),
    bulbs: Array.from(root.querySelectorAll<SVGGElement>('.ob-bulbOn')),
    laptop: q<SVGGElement>('#obLaptop'), platter: q<SVGGElement>('#obPlatter'), platter2: q<SVGGElement>('#obPlatter2'),
    deckLights: Array.from(root.querySelectorAll<SVGCircleElement>('.obDl')),
  }
}

function applyPose(rig: Rig, state: MascotState, genre: Genre | null) {
  const p = state.pose
  const j = rig.joints
  setTransform(j['ob-jump'], `translate(0px,${p.jumpY}px)`)
  setTransform(j['ob-squash'], `scale(${p.sqX},${p.sqY})`, 320, 730)
  setTransform(j['ob-lean'], `rotate(${p.lean}deg)`, 320, 730)
  setTransform(j['ob-shadow'], `scale(${p.shadowScale})`, 320, 735)
  setStyleOpacity(j['ob-shadow'], p.shadowOpacity)
  setTransform(j['ob-headfollow'], `translate(0px,${p.headY}px)`)
  setTransform(j['ob-headtilt'], `rotate(${p.headR}deg)`, 320, 460)
  setTransform(j['ob-armL'], `rotate(${p.armL}deg)`, 220, 492)
  setTransform(j['ob-armR'], `rotate(${p.armR}deg)`, 420, 492)
  setTransform(j['ob-handL'], `rotate(${p.handL}deg)`, 220, 578)
  setTransform(j['ob-handR'], `rotate(${p.handR}deg)`, 420, 578)
  setTransform(j['ob-footL'], p.footL, 288, 690)
  setTransform(j['ob-footR'], p.footR, 352, 690)
  setTransform(j['ob-pupilL'], `translate(${p.pupilL.x}px,${p.pupilL.y}px)`)
  setTransform(j['ob-pupilR'], `translate(${p.pupilR.x}px,${p.pupilR.y}px)`)
  setTransform(rig.pshockL, `scale(${p.pupilScale})`, 268, 331)
  setTransform(rig.pshockR, `scale(${p.pupilScale})`, 372, 335)
  setTransform(rig.flip, p.facing === -1 ? 'translate(485px,0px) scale(-1,1)' : 'none')
  // mouth (the worried wavy mouth replaces smile and visemes while he is caught)
  const mouthOn = p.open > 0.05 && !p.worried
  for (const viseme of Object.keys(rig.visemes) as Viseme[]) {
    const v = rig.visemes[viseme]
    if (!v) continue
    setOpacity(v.group, mouthOn && viseme === p.viseme ? '1' : '0')
    if (mouthOn && viseme === p.viseme) setTransform(v.scale, `scale(${0.85 + p.open * 0.3},${0.1 + p.open * 1.2})`, 320, 364)
  }
  setStyleOpacity(j['ob-vSmile'], mouthOn || p.worried ? '0' : '1')
  setStyleOpacity(j['ob-vBrowW'], p.worried ? '1' : '0')
  setStyleOpacity(j['ob-vWavy'], p.worried ? '1' : '0')
  setStyleOpacity(j['ob-sweat'], p.sweat ? '1' : '0')
  // bulb, laptop, costume
  for (const bulb of rig.bulbs) setOpacity(bulb, p.bulb)
  if (rig.laptop) {
    setStyleOpacity(rig.laptop, p.laptop > 0 ? '1' : '0')
    setTransform(rig.laptop, `scale(${Math.max(0.001, p.laptop)})`, 320, 560)
  }
  for (const key of Object.keys(rig.props) as Genre[]) setOpacity(rig.props[key], genre === key ? '1' : '0')
  if (genre === 'electronic') {
    setTransform(rig.platter, `rotate(${p.platter}deg)`, 252, 648)
    setTransform(rig.platter2, `rotate(${p.platter2}deg)`, 388, 648)
    rig.deckLights.forEach((light, i) => setOpacity(light, p.deckLights[i] ?? 1))
  }
}

export const Oubli = forwardRef<OubliHandle, OubliProps>(function Oubli({ source, visible, scale, className }, ref) {
  const stageEl = useRef<HTMLDivElement | null>(null)
  const mover = useRef<HTMLDivElement | null>(null)
  const host = useRef<HTMLDivElement | null>(null)
  const bubble = useRef<HTMLDivElement | null>(null)
  const bubbleScale = useRef<HTMLDivElement | null>(null)
  const bubbleText = useRef<HTMLSpanElement | null>(null)
  const lines = useRef<(HTMLDivElement | null)[]>([null, null, null])
  const state = useRef<MascotState>(createMascotState())
  const thought = useRef<ThoughtState>(EMPTY_THOUGHT)
  const sourceRef = useRef(source)
  sourceRef.current = source
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  /** Cursor in stage units plus its velocity; `moved` is the rig time it last moved. */
  const cursor = useRef<{ x: number; y: number; vx: number; vy: number; moved: number } | null>(null)
  const [bound, setBound] = useState(false)

  useImperativeHandle(ref, () => ({
    think: (delta) => { thought.current = thoughtAppend(thought.current, delta) },
    settle: () => { thought.current = thoughtSettle(thought.current, state.current.t) },
    clear: () => { thought.current = EMPTY_THOUGHT },
  }), [])

  // The cursor is tracked over the whole panel: he flees it, it catches him, his eyes follow it.
  useEffect(() => {
    const el = stageEl.current
    if (!el) return
    let prev: { x: number; y: number; at: number } | null = null
    const move = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      const s = scaleRef.current || 1
      // stage units, origin at the stage's top-left; the stage floor is y = MOVER_H
      const x = (event.clientX - rect.left) / s, y = (event.clientY - rect.top) / s
      const at = performance.now() / 1000
      let vx = 0, vy = 0
      if (prev && at - prev.at > 0.001 && at - prev.at < 0.2) { vx = (x - prev.x) / (at - prev.at); vy = (y - prev.y) / (at - prev.at) }
      prev = { x, y, at }
      cursor.current = { x, y, vx, vy, moved: state.current.t }
    }
    const leave = () => { prev = null; if (cursor.current) cursor.current = { ...cursor.current, vx: 0, vy: 0, moved: -9 } }
    const panel = el.closest('section') ?? el
    panel.addEventListener('pointermove', move)
    panel.addEventListener('pointerleave', leave)
    return () => { panel.removeEventListener('pointermove', move); panel.removeEventListener('pointerleave', leave) }
  }, [bound])

  const visibleRef = useRef(visible)
  visibleRef.current = visible

  useEffect(() => {
    const el = host.current, stage = stageEl.current
    if (!el || !stage) return
    const rig = bindRig(el)
    setBound(true)
    let frame = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let last = performance.now()
    let idleMutter = state.current.t + 9
    /**
     * Full frame rate only while Oubli is out and something is happening (voice, music, thinking,
     * working, a bubble, the cursor near him, or him moving). Tucked or idle he ticks at ~4 fps and
     * the CSS idle loops pause, so an all-day-open panel does not pay for a 60 Hz SVG repaint it
     * mostly cannot see.
     */
    const schedule = (active: boolean) => {
      if (active && !document.hidden) frame = requestAnimationFrame(loop)
      else timer = setTimeout(() => { frame = requestAnimationFrame(loop) }, 250)
    }
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const s = scaleRef.current || 1
      const c = cursor.current
      const t0 = state.current.t
      const input: MascotInputs = {
        ...sourceRef.current(),
        pointer: c ? { x: c.x, y: c.y, vx: c.vx, vy: c.vy, idle: t0 - c.moved } : null,
        stageWidth: stage.clientWidth / s,
      }
      // velocity decays between pointer events so a parked cursor is not "flicking"
      if (c) { c.vx *= 0.7; c.vy *= 0.7 }
      stepMascot(state.current, dt, input)
      const st = state.current, p = st.pose
      applyPose(rig, st, input.genre)
      // mover placement (stage units -> CSS px)
      setTransform(mover.current, `translate(${(p.x - MOVER_W / 2) * s}px, ${-p.alt * s}px) rotate(${p.dangle}deg)`)
      lines.current.forEach((line, i) => {
        const sl = p.speedLines[i]
        if (!line || !sl) return
        setStyleOpacity(line, sl.opacity)
        if (sl.opacity > 0) setTransform(line, `translate(${sl.x * s}px, ${sl.y * s}px) scaleX(${p.facing})`)
      })
      const lively = Boolean(input.voice || input.music || input.thinking || input.working || thought.current.shown)
      const moving = st.caught || st.fleeing || st.alt > 0 || Math.abs(st.vx) > 0.05
      const nearby = input.pointer !== null && input.pointer.idle < 2.5
      const active = visibleRef.current && (lively || moving || nearby)
      stage.classList.toggle('resting', !active)
      // thought bubble follows him
      const t = st.t
      if (!thought.current.shown && t > idleMutter) {
        idleMutter = t + 9
        if (!input.thinking && !input.working && !input.voice && !st.caught && Math.random() < 0.25) {
          thought.current = thoughtSay(thought.current, IDLE_THOUGHTS[Math.floor(Math.random() * IDLE_THOUGHTS.length)], t)
        }
      }
      const typed = thoughtStep(thought.current, dt, t)
      thought.current = typed.thought
      if (bubbleText.current && bubbleText.current.textContent !== typed.text) bubbleText.current.textContent = typed.text
      bubbleScale.current?.classList.toggle('on', typed.thought.shown)
      if (bubble.current) {
        // anchored to the stage top; its bottom sits just above the antenna, lifting with him
        const bx = Math.max(120, Math.min(stage.clientWidth - 120, p.x * s))
        setTransform(bubble.current, `translate(${bx - 120}px, ${(BUBBLE_Y - p.alt) * s}px) rotate(${p.dangle * 0.4}deg)`)
      }
      schedule(active)
    }
    frame = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(frame); if (timer) clearTimeout(timer) }
  }, [])

  return <div ref={stageEl} className={cn('oubli-stage relative w-full overflow-visible', !visible && 'tucked', className)}
    style={{ height: MOVER_H * scale }} aria-hidden={!visible} data-testid="oubli">
    {[0, 1, 2].map((i) => <div key={i} ref={(node) => { lines.current[i] = node }} className="oubli-speedline" />)}
    <div ref={bubble} className="oubli-bubble">
      <div ref={bubbleScale} className="oubli-bubble-scale">
        <div className="oubli-bubble-box"><span ref={bubbleText} /><span className="oubli-caret" /></div>
        <div className="oubli-dot" style={{ width: 16, height: 16, left: 100, bottom: -14 }} />
        <div className="oubli-dot" style={{ width: 9, height: 9, left: 116, bottom: -30 }} />
      </div>
    </div>
    <div ref={mover} className="oubli-mover" style={{ width: MOVER_W * scale, height: MOVER_H * scale }}>
      <div ref={host} className="oubli-rig h-full w-full [&>svg]:h-full [&>svg]:w-full [&>svg]:overflow-visible" dangerouslySetInnerHTML={{ __html: oubliSvg }} />
    </div>
  </div>
})
