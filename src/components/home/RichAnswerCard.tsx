import { useId } from 'react'
import { formatNumber, sparklinePath, sparklinePoints, type RichAnswer } from '@/lib/discover-feed'

/**
 * Compact cards for Brave Rich Search verticals (`RichAnswer.card` contract built in
 * agent/api/core/brave_search.py). Unknown subtypes render a generic key/value card so a
 * new vertical never blanks the ribbon.
 */
export function RichAnswerCard({ answer }: { answer: RichAnswer }) {
  const body = renderBody(answer)
  if (!body) return null
  const provider = answer.provider?.name || answer.provider?.long_name
  // Width and height come from the grid cell (HomePage "At a glance"), so every card in a row fills it edge to edge.
  return <article className="flex h-full min-w-0 flex-col justify-between rounded-xl border border-surface-200 bg-surface-0 p-5 text-sm text-ink dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse">
    {body}
    {provider && <p className={`mt-4 truncate font-mono text-[10.5px] uppercase tracking-[0.08em] ${muted}`}>via {provider}</p>}
  </article>
}

type Card = Record<string, unknown>
const num = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null
const str = (value: unknown): string => typeof value === 'string' ? value : ''
const rec = (value: unknown): Card => (value && typeof value === 'object' && !Array.isArray(value) ? value as Card : {})
const list = (value: unknown): Card[] => Array.isArray(value) ? value.map(rec) : []
const muted = 'text-ink-muted dark:text-ink-inverse-muted'
/** The headline figure of a card: set in the display face, tight and heavy. */
const figure = 'font-display font-bold leading-none tracking-[-0.03em] tabular-nums text-ink dark:text-ink-inverse'

/** Change in green or red (the sign repeats it in text); the sparkline itself is drawn in volt. */
function Trend({ change, percent, series }: { change: unknown; percent: unknown; series: unknown }) {
  const fill = `spark-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const delta = num(change)
  const pct = num(percent)
  const points = sparklinePoints(series)
  const up = (delta ?? 0) >= 0
  const tone = up ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
  const path = points.length > 1 ? sparklinePath(points) : ''
  const [lastX, lastY] = path ? path.slice(path.lastIndexOf(' ') + 1).split(',').map(Number) : []
  return <div className="mt-3 flex items-end justify-between gap-3">
    <span className={`font-mono text-[12px] font-medium tabular-nums ${tone}`}>{delta !== null ? `${up ? '+' : ''}${formatNumber(delta)}` : ''}{pct !== null ? ` (${up ? '+' : ''}${formatNumber(pct)}%)` : ''}</span>
    {path && <svg viewBox="0 0 96 28" width={96} height={28} aria-hidden="true" className="shrink-0 overflow-visible text-volt">
      <defs>
        <linearGradient id={fill} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity={0.24} />
          <stop offset="1" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={`0,28 ${path} 96,28`} fill={`url(#${fill})`} />
      <polyline fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" points={path} />
      {Number.isFinite(lastX) && Number.isFinite(lastY) && <circle cx={lastX} cy={lastY} r={2.5} fill="currentColor" />}
    </svg>}
  </div>
}

function Heading({ kicker, title }: { kicker: string; title: string }) {
  return <header><p className={`truncate font-mono text-[11px] font-medium uppercase tracking-[0.08em] ${muted}`}>{kicker}</p><h3 className="mt-1.5 font-display text-[17px] font-bold leading-tight tracking-[-0.015em] text-ink dark:text-ink-inverse">{title}</h3></header>
}

function Price({ value, unit }: { value: unknown; unit: string }) {
  return <p className={`mt-4 text-[1.75rem] ${figure}`}>{formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className={`font-mono text-[11px] font-medium tracking-[0.04em] ${muted}`}>{unit}</span></p>
}

function Weather({ card }: { card: Card }) {
  const temp = num(card.temp_c)
  const daily = list(card.daily).slice(0, 4)
  const deg = (value: unknown) => { const n = num(value); return n === null ? '–' : String(Math.round(n)) }
  // Each day's low-to-high range drawn on one scale shared by the four days (a flat week fills the track).
  const known = daily.flatMap((day) => [num(day.min_c), num(day.max_c)]).filter((value): value is number => value !== null)
  const low = known.length ? Math.min(...known) : 0
  const span = known.length ? Math.max(...known) - low : 0
  const position = (value: number) => (span ? ((value - low) / span) * 100 : 0)
  return <div>
    <Heading kicker="Weather" title={str(card.location) || 'Local weather'} />
    <p className={`mt-4 flex items-baseline gap-2 text-[2.25rem] ${figure}`}>{temp !== null ? `${Math.round(temp)}°C` : '—'}<span className={`font-sans text-[12px] font-normal tracking-normal ${muted}`}>{str(card.condition)}</span></p>
    {daily.length > 0 && <ul className={`mt-4 grid grid-cols-4 gap-1 border-t border-surface-200 pt-3 text-[11px] dark:border-surface-800 ${muted}`}>{daily.map((day, index) => {
      const min = num(day.min_c), max = num(day.max_c)
      return <li key={index} className="flex flex-col items-center text-center">
        <div className="w-full truncate font-mono text-[10px] uppercase tracking-[0.08em]">{str(day.label).slice(0, 3) || '·'}</div>
        <div className="mt-1 font-semibold tabular-nums text-ink dark:text-ink-inverse">{deg(day.max_c)}°</div>
        <div aria-hidden className="relative my-1 h-6 w-1 overflow-hidden rounded-full bg-surface-100 dark:bg-surface-850">
          {min !== null && max !== null && <span className="absolute inset-x-0 rounded-full bg-volt" style={{ bottom: `${position(min)}%`, top: `${span ? 100 - position(max) : 0}%` }} />}
        </div>
        <div className="tabular-nums">{deg(day.min_c)}°</div>
      </li>
    })}</ul>}
  </div>
}

function TeamLogo({ src }: { src: unknown }) {
  const url = str(src)
  return url ? <img src={url} alt="" loading="lazy" className="h-4 w-4 shrink-0 object-contain" /> : <span aria-hidden className="h-4 w-4 shrink-0 rounded-full bg-surface-200 dark:bg-surface-800" />
}

/** One team's scoreboard: the last two results and the next two fixtures (the backend ships ≤3 of each). */
function Sports({ card }: { card: Card }) {
  const team = rec(card.team), league = rec(card.league)
  const recent = list(card.recent).slice(-2), upcoming = list(card.upcoming).slice(0, 2)
  const games = [...recent, ...upcoming]
  const renderGame = (game: Card, index: number) => {
    const home = rec(game.home), away = rec(game.away), start = num(game.start_ts)
    const played = index < recent.length && (num(away.score) !== null || num(home.score) !== null)
    const when = start ? new Date(start * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : str(game.status)
    // The winning score of a finished game is the card's highlight.
    const awayScore = num(away.score), homeScore = num(home.score)
    const winner = played && awayScore !== null && homeScore !== null && awayScore !== homeScore ? (awayScore > homeScore ? 'away' : 'home') : null
    const score = (side: 'away' | 'home') => winner === side ? 'font-bold text-volt' : 'font-medium text-ink dark:text-ink-inverse'
    return <li key={index} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-[12px]">
      <span className="flex min-w-0 items-center gap-1.5"><TeamLogo src={away.logo} /><span className="truncate text-ink dark:text-ink-inverse">{str(away.name)}</span></span>
      <span className={`text-right font-mono tabular-nums ${score('away')}`}>{played ? num(away.score) ?? '–' : ''}</span>
      <span className="flex min-w-0 items-center gap-1.5"><TeamLogo src={home.logo} /><span className="truncate text-ink dark:text-ink-inverse">{str(home.name)}</span></span>
      <span className={`text-right font-mono tabular-nums ${score('home')}`}>{played ? num(home.score) ?? '–' : <span className={`font-mono text-[11px] font-normal uppercase tracking-[0.04em] ${muted}`}>{when}</span>}</span>
    </li>
  }
  return <div>
    <Heading kicker={str(league.name) || str(card.sport) || 'Sports'} title={str(team.name) || 'Scores'} />
    {games.length === 0 ? <p className={`mt-3 text-[12px] ${muted}`}>No games scheduled.</p> : <ul className="mt-3 divide-y divide-surface-200 dark:divide-surface-800 [&>li]:py-2 [&>li:first-child]:pt-0 [&>li:last-child]:pb-0">{games.map(renderGame)}</ul>}
  </div>
}

function renderBody(answer: RichAnswer) {
  const card = rec(answer.card)
  switch (answer.subtype) {
    case 'weather':
      return <Weather card={card} />
    case 'stocks':
      return <div>
        <Heading kicker={`${str(card.exchange) || 'Stock'} · ${str(card.symbol)}`} title={str(card.name) || str(card.symbol)} />
        <Price value={card.price} unit={str(card.currency)} />
        <Trend change={card.change} percent={card.change_percent} series={card.sparkline} />
      </div>
    case 'cryptocurrency':
      return <div>
        <Heading kicker={`Crypto · ${str(card.symbol)}`} title={str(card.name) || str(card.symbol)} />
        <Price value={card.price} unit={str(card.vs_currency)} />
        <Trend change={card.change_24h} percent={card.change_percent_24h} series={card.sparkline} />
      </div>
    case 'currency':
      return <div>
        <Heading kicker="Currency" title={`${str(card.from)} → ${str(card.to)}`} />
        <p className={`mt-4 text-[1.75rem] ${figure}`}>{formatNumber(card.result, { maximumFractionDigits: 4 })} <span className={`font-mono text-[11px] font-medium tracking-[0.04em] ${muted}`}>{str(card.to)}</span></p>
        <p className={`mt-1.5 font-mono text-[11px] tabular-nums ${muted}`}>{formatNumber(card.amount)} {str(card.from)} · rate {formatNumber(card.rate, { maximumFractionDigits: 4 })}</p>
        <Trend change={null} percent={null} series={card.sparkline} />
      </div>
    case 'sports':
      return <Sports card={card} />
    default: {
      const entries = Object.entries(card).filter(([, value]) => typeof value === 'string' || typeof value === 'number').slice(0, 4)
      if (!entries.length) return null
      return <div>
        <Heading kicker={answer.vertical} title={answer.subtype} />
        <dl className="mt-3 space-y-1.5 text-[12px]">{entries.map(([key, value]) => <div key={key} className="flex items-baseline justify-between gap-3"><dt className={`shrink-0 font-mono text-[10.5px] uppercase tracking-[0.08em] ${muted}`}>{key.replace(/_/g, ' ')}</dt><dd className="truncate font-medium text-ink dark:text-ink-inverse">{String(value)}</dd></div>)}</dl>
      </div>
    }
  }
}
