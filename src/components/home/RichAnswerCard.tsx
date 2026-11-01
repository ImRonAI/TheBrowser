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
  return <article className="flex h-full min-w-0 flex-col justify-between rounded-xl border border-surface-200/80 bg-surface-0 p-4 text-sm dark:border-surface-800 dark:bg-surface-900">
    {body}
    {provider && <p className="mt-3 text-[10.5px] text-ink-muted dark:text-ink-inverse-muted">via {provider}</p>}
  </article>
}

type Card = Record<string, unknown>
const num = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null
const str = (value: unknown): string => typeof value === 'string' ? value : ''
const rec = (value: unknown): Card => (value && typeof value === 'object' && !Array.isArray(value) ? value as Card : {})
const list = (value: unknown): Card[] => Array.isArray(value) ? value.map(rec) : []
const muted = 'text-ink-muted dark:text-ink-inverse-muted'

function Trend({ change, percent, series }: { change: unknown; percent: unknown; series: unknown }) {
  const delta = num(change)
  const pct = num(percent)
  const points = sparklinePoints(series)
  const up = (delta ?? 0) >= 0
  const tone = up ? 'text-success' : 'text-danger'
  return <div className="mt-2 flex items-end justify-between gap-3">
    <span className={`font-mono text-[11.5px] font-medium tabular-nums ${tone}`}>{delta !== null ? `${up ? '+' : ''}${formatNumber(delta)}` : ''}{pct !== null ? ` (${up ? '+' : ''}${formatNumber(pct)}%)` : ''}</span>
    {points.length > 1 && <svg viewBox="0 0 96 28" width={96} height={28} aria-hidden="true" className={tone}><polyline fill="none" stroke="currentColor" strokeWidth={1.5} points={sparklinePath(points)} /></svg>}
  </div>
}

function Heading({ kicker, title }: { kicker: string; title: string }) {
  return <header><p className={`text-[10.5px] font-medium uppercase tracking-[0.12em] ${muted}`}>{kicker}</p><h3 className="mt-1 font-display text-[17px] leading-tight">{title}</h3></header>
}

function Price({ value, unit }: { value: unknown; unit: string }) {
  return <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className={`text-xs font-normal ${muted}`}>{unit}</span></p>
}

function Weather({ card }: { card: Card }) {
  const temp = num(card.temp_c)
  const daily = list(card.daily).slice(0, 4)
  const deg = (value: unknown) => { const n = num(value); return n === null ? '–' : String(Math.round(n)) }
  return <div>
    <Heading kicker="Weather" title={str(card.location) || 'Local weather'} />
    <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{temp !== null ? `${Math.round(temp)}°C` : '—'}<span className={`ml-2 text-xs font-normal ${muted}`}>{str(card.condition)}</span></p>
    {daily.length > 0 && <ul className={`mt-3 grid grid-cols-4 gap-1 text-[11px] ${muted}`}>{daily.map((day, index) =>
      <li key={index} className="text-center"><div className="truncate">{str(day.label).slice(0, 3) || '·'}</div><div className="text-ink dark:text-ink-inverse">{deg(day.max_c)}°</div><div>{deg(day.min_c)}°</div></li>)}</ul>}
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
    return <li key={index} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 text-xs">
      <span className="flex min-w-0 items-center gap-1.5"><TeamLogo src={away.logo} /><span className="truncate">{str(away.name)}</span></span>
      <span className="text-right font-mono font-medium tabular-nums">{played ? num(away.score) ?? '–' : ''}</span>
      <span className="flex min-w-0 items-center gap-1.5"><TeamLogo src={home.logo} /><span className="truncate">{str(home.name)}</span></span>
      <span className="text-right font-mono font-medium tabular-nums">{played ? num(home.score) ?? '–' : <span className={`font-sans font-normal ${muted}`}>{when}</span>}</span>
    </li>
  }
  return <div>
    <Heading kicker={str(league.name) || str(card.sport) || 'Sports'} title={str(team.name) || 'Scores'} />
    {games.length === 0 ? <p className={`mt-2 text-xs ${muted}`}>No games scheduled.</p> : <ul className="mt-3 divide-y divide-surface-200/70 dark:divide-surface-800 [&>li]:py-1.5 [&>li:first-child]:pt-0 [&>li:last-child]:pb-0">{games.map(renderGame)}</ul>}
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
        <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{formatNumber(card.result, { maximumFractionDigits: 4 })} <span className={`text-xs font-normal ${muted}`}>{str(card.to)}</span></p>
        <p className={`mt-1 text-xs ${muted}`}>{formatNumber(card.amount)} {str(card.from)} · rate {formatNumber(card.rate, { maximumFractionDigits: 4 })}</p>
        <Trend change={null} percent={null} series={card.sparkline} />
      </div>
    case 'sports':
      return <Sports card={card} />
    default: {
      const entries = Object.entries(card).filter(([, value]) => typeof value === 'string' || typeof value === 'number').slice(0, 4)
      if (!entries.length) return null
      return <div>
        <Heading kicker={answer.vertical} title={answer.subtype} />
        <dl className="mt-2 space-y-1 text-xs">{entries.map(([key, value]) => <div key={key} className="flex justify-between gap-3"><dt className={muted}>{key.replace(/_/g, ' ')}</dt><dd className="truncate font-medium">{String(value)}</dd></div>)}</dl>
      </div>
    }
  }
}

