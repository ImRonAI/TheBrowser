import { useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, ReferenceLine, Scatter, ScatterChart, Tooltip, XAxis, YAxis, type ScatterShapeProps, type TooltipContentProps } from 'recharts'
import { FLOW_BANDS, MIN_FINISHED_FOR_PERCENTILES, type DashboardMetrics, type PercentileSet, type WipStatus } from '@/lib/agile-metrics'
import { ISSUE_STATUS_CONFIG, type Issue } from '@/types/projects'
import { ChartCard, Legend, TooltipCard } from './ChartFrame'
import { AXIS, CHART_HEIGHT, CHART_MARGIN, COLOR, STATUS_COLOR, formatDate, formatDay, formatDays, formatNumber, plural } from './viz'

interface ChartProps {
  metrics: DashboardMetrics
  issueKey: (issue: Issue) => string
  onIssueSelect: (issueId: string) => void
}

const statusLabel = (status: keyof typeof ISSUE_STATUS_CONFIG) => ISSUE_STATUS_CONFIG[status].label

/** Percentile reference lines; equal values share one line and one label. */
function percentileLines(cycle: PercentileSet | null, keys: ('p50' | 'p85' | 'p95')[]) {
  if (!cycle || cycle.count < MIN_FINISHED_FOR_PERCENTILES) return []
  const lines = new Map<number, string[]>()
  for (const key of keys) lines.set(cycle[key], [...(lines.get(cycle[key]) ?? []), key.slice(1)])
  return [...lines].map(([value, names]) => ({ value, label: `${names.join('/')}% · ${value}d` }))
}

// ── Cumulative flow ──────────────────────────────────────────────────────────

export function CumulativeFlowChart({ metrics, unit }: { metrics: DashboardMetrics; unit: string }) {
  const { flow } = metrics
  const first = flow[0]
  const last = flow[flow.length - 1]
  const wip = (point: typeof first) => point['in-progress'] + point.review + point.blocked
  const total = last ? FLOW_BANDS.reduce((sum, status) => sum + last[status], 0) : 0
  const topDown = [...FLOW_BANDS].reverse()
  const takeaway = first && last
    ? `In this range, Done grew by ${formatNumber(last.done - first.done)} ${unit}; work in progress went from ${formatNumber(wip(first))} to ${formatNumber(wip(last))} and backlog from ${formatNumber(first.backlog)} to ${formatNumber(last.backlog)}.`
    : ''
  return (
    <ChartCard
      title="Cumulative flow"
      question="Is work flowing, or piling up in one status?"
      takeaway={takeaway}
      howToRead="Each band is how much was in that status at the end of each day, with Done at the bottom. Parallel bands mean steady flow; a band that keeps widening is where work is piling up; a flat Done band means nothing is finishing."
      empty={total === 0 ? 'No issues of the selected types exist in this range yet.' : null}
      legend={<Legend entries={topDown.map((status) => ({ label: statusLabel(status), color: STATUS_COLOR[status], value: last ? formatNumber(last[status]) : undefined }))} />}
      table={{
        caption: `${unit} in each status at the end of each day`,
        columns: ['Day', ...topDown.map(statusLabel)],
        rows: [...flow].reverse().map((point) => [formatDate(point.day), ...topDown.map((status) => formatNumber(point[status]))]),
      }}
    >
      <AreaChart data={flow} responsive style={{ width: '100%', height: CHART_HEIGHT }} margin={CHART_MARGIN}>
        <CartesianGrid vertical={false} stroke={COLOR.grid} />
        <XAxis dataKey="day" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={formatDay} minTickGap={28} {...AXIS} />
        <YAxis width={36} allowDecimals={metrics.measure !== 'count'} {...AXIS} axisLine={false} />
        <Tooltip cursor={{ stroke: COLOR.axis, strokeWidth: 1 }} content={(props: TooltipContentProps) => props.active && props.payload?.length ? (
          <TooltipCard title={formatDate(Number(props.payload[0].payload.day))}
            rows={topDown.map((status) => ({ label: statusLabel(status), value: formatNumber(Number(props.payload[0].payload[status])), color: STATUS_COLOR[status] }))} />
        ) : null} />
        {FLOW_BANDS.map((status) => (
          <Area key={status} type="linear" dataKey={status} name={statusLabel(status)} stackId="flow" stroke={STATUS_COLOR[status]} strokeWidth={1.5}
            fill={STATUS_COLOR[status]} fillOpacity={0.16} isAnimationActive={false} />
        ))}
      </AreaChart>
    </ChartCard>
  )
}

// ── Cycle time scatterplot ───────────────────────────────────────────────────

interface Dot { x: number; y: number; id: string; name: string; detail: string; atRisk?: boolean }

function DotShape({ onSelect, ...props }: ScatterShapeProps & { onSelect: (id: string) => void }) {
  const { cx, cy, payload } = props
  if (cx === undefined || cy === undefined) return <g />
  const dot = payload as Dot
  return (
    <g className="cursor-pointer" onClick={() => onSelect(dot.id)}>
      {/* The hit target is bigger than the mark. */}
      <circle cx={cx} cy={cy} r={12} fill="transparent" />
      <circle cx={cx} cy={cy} r={4.5} fill={dot.atRisk ? COLOR.critical : 'currentColor'} stroke={COLOR.surface} strokeWidth={2} />
    </g>
  )
}

function DotTooltip(props: TooltipContentProps) {
  if (!props.active || !props.payload?.length) return null
  const dot = props.payload[0].payload as Dot
  return <TooltipCard title={dot.name} rows={[{ label: dot.detail, value: formatDays(dot.y) }]} note="Click the dot to open the issue." />
}

export function CycleTimeChart({ metrics, issueKey, onIssueSelect, className }: ChartProps & { className?: string }) {
  const { cycle, finishedWithoutStart, from } = metrics
  const dots = useMemo<Dot[]>(() => metrics.finished.flatMap((item) => item.cycleDays === null ? [] : [{
    x: item.finished, y: item.cycleDays, id: item.issue.id,
    name: `${issueKey(item.issue)} ${item.issue.title}`, detail: `finished ${formatDate(item.finished)}`,
  }]), [metrics.finished, issueKey])
  const lines = percentileLines(cycle, ['p50', 'p85', 'p95'])
  const skipped = finishedWithoutStart > 0 ? ` ${plural(finishedWithoutStart, 'item')} went straight to Done, so ${finishedWithoutStart === 1 ? 'it has' : 'they have'} no cycle time.` : ''
  const takeaway = !cycle ? '' : cycle.count >= MIN_FINISHED_FOR_PERCENTILES
    ? `Half of the ${cycle.count} finished items took ${formatDays(cycle.p50)} or less; 85% took ${formatDays(cycle.p85)} or less.${skipped}`
    : `${plural(cycle.count, 'item')} finished with a recorded start (median ${formatDays(cycle.p50)}). Percentile lines appear at ${MIN_FINISHED_FOR_PERCENTILES}.${skipped}`
  return (
    <ChartCard
      className={className}
      title="Cycle time"
      question="How long does an item take once work starts?"
      takeaway={takeaway}
      howToRead="Each dot is a finished item: when it finished (across) and how many calendar days it took from first moving to In progress, Review or Blocked until Done, counting both ends (up). The dashed lines read “85% of items finished in this many days or less”; use the 85% line to answer “when will this item be done?”."
      empty={dots.length === 0 ? 'No item finished in this range after a recorded start. Cycle time starts when an issue first moves to In progress, Review or Blocked.' : null}
      table={{
        caption: 'Finished items and their cycle time in days',
        columns: ['Issue', 'Finished', 'Cycle time'],
        rows: [...dots].reverse().map((dot) => [
          <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => onIssueSelect(dot.id)}>{dot.name}</button>,
          formatDate(dot.x), formatDays(dot.y)]),
      }}
    >
      <div style={{ color: STATUS_COLOR.done }}>
        <ScatterChart responsive style={{ width: '100%', height: CHART_HEIGHT }} margin={CHART_MARGIN}>
          <CartesianGrid vertical={false} stroke={COLOR.grid} />
          <XAxis dataKey="x" type="number" scale="time" domain={[from, 'dataMax']} tickFormatter={formatDay} minTickGap={28} name="Finished" {...AXIS} />
          <YAxis dataKey="y" type="number" width={40} allowDecimals={false} tickFormatter={(value: number) => `${value}d`} name="Cycle time" {...AXIS} axisLine={false} />
          <Tooltip cursor={false} content={DotTooltip} />
          {lines.map((line) => (
            <ReferenceLine key={line.value} y={line.value} ifOverflow="extendDomain" stroke={COLOR.ink} strokeDasharray="4 4" strokeWidth={1}
              label={{ value: line.label, position: 'insideTopRight', fill: COLOR.tick, fontSize: 11 }} />
          ))}
          <Scatter data={dots} isAnimationActive={false} shape={(props: ScatterShapeProps) => <DotShape {...props} onSelect={onIssueSelect} />} />
        </ScatterChart>
      </div>
    </ChartCard>
  )
}

// ── Aging work in progress ───────────────────────────────────────────────────

const AGING_COLUMNS: WipStatus[] = ['in-progress', 'review', 'blocked']

export function AgingWipChart({ metrics, issueKey, onIssueSelect }: ChartProps) {
  const { aging, cycle } = metrics
  const usable = cycle && cycle.count >= MIN_FINISHED_FOR_PERCENTILES ? cycle : null
  const counts = AGING_COLUMNS.map((status) => aging.filter((item) => item.status === status).length)
  const dots = useMemo<Dot[]>(() => {
    const seen = AGING_COLUMNS.map(() => 0)
    return aging.map((item) => {
      const column = AGING_COLUMNS.indexOf(item.status)
      const position = seen[column]++
      // Deterministic spread inside the column so items of the same age do not hide each other.
      const offset = ((position % 5) - 2) * 0.09
      return {
        x: column + offset, y: item.ageDays, id: item.issue.id, atRisk: item.pace === 'past-85',
        name: `${issueKey(item.issue)} ${item.issue.title}`,
        detail: `${statusLabel(item.status)} · started ${formatDate(item.started)}${item.pace === 'past-85' ? ' · older than 85% of finished items' : ''}`,
      }
    })
  }, [aging, issueKey])
  const atRisk = aging.filter((item) => item.pace === 'past-85').length
  const oldest = aging[0]
  const takeaway = !oldest ? '' : usable
    ? atRisk > 0
      ? `${atRisk} of ${aging.length} items in flight ${atRisk === 1 ? 'is' : 'are'} already older than 85% of finished items (${formatDays(usable.p85)}). Swarm on ${atRisk === 1 ? 'it' : 'those'} first.`
      : `All ${aging.length} items in flight are younger than 85% of finished items (${formatDays(usable.p85)}). The oldest is ${formatDays(oldest.ageDays)} old.`
    : `${plural(aging.length, 'item')} in flight; the oldest is ${formatDays(oldest.ageDays)} old. Pace lines appear once ${MIN_FINISHED_FOR_PERCENTILES} items have finished in this range.`
  const lines = percentileLines(cycle, ['p50', 'p85'])
  return (
    <ChartCard
      title="Aging work in progress"
      question="Which items in flight are at risk of taking too long?"
      takeaway={takeaway}
      howToRead="Each dot is an item in progress, in review or blocked, placed by its age in calendar days since work started. The dashed lines are the 50th and 85th percentile cycle times of finished items; red dots are already older than 85% of finished work and need attention."
      empty={aging.length === 0 ? 'Nothing is in progress, in review or blocked right now.' : null}
      legend={usable ? <Legend entries={[{ label: 'In flight', color: COLOR.neutral, mark: 'dot' }, { label: 'Older than 85% of finished items', color: COLOR.critical, mark: 'dot' }]} /> : undefined}
      table={{
        caption: 'Items in flight by age in days',
        columns: ['Issue', 'Status', 'Age', 'Pace'],
        rows: aging.map((item) => [
          <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => onIssueSelect(item.issue.id)}>{issueKey(item.issue)} {item.issue.title}</button>,
          statusLabel(item.status), formatDays(item.ageDays),
          item.pace === 'past-85' ? 'Older than 85%' : item.pace === 'within-85' ? 'Past median' : item.pace === 'within-50' ? 'On pace' : '—']),
      }}
    >
      <div style={{ color: COLOR.neutral }}>
        <ScatterChart responsive style={{ width: '100%', height: CHART_HEIGHT }} margin={CHART_MARGIN}>
          <CartesianGrid vertical={false} stroke={COLOR.grid} />
          <XAxis dataKey="x" type="number" domain={[-0.5, AGING_COLUMNS.length - 0.5]} ticks={AGING_COLUMNS.map((_, index) => index)} interval={0}
            tickFormatter={(value: number) => `${statusLabel(AGING_COLUMNS[value])} (${counts[value]})`} {...AXIS} />
          <YAxis dataKey="y" type="number" width={40} allowDecimals={false} tickFormatter={(value: number) => `${value}d`} {...AXIS} axisLine={false} />
          <Tooltip cursor={false} content={DotTooltip} />
          {lines.map((line) => (
            <ReferenceLine key={line.value} y={line.value} ifOverflow="extendDomain" stroke={COLOR.ink} strokeDasharray="4 4" strokeWidth={1}
              label={{ value: line.label, position: 'insideTopRight', fill: COLOR.tick, fontSize: 11 }} />
          ))}
          <Scatter data={dots} isAnimationActive={false} shape={(props: ScatterShapeProps) => <DotShape {...props} onSelect={onIssueSelect} />} />
        </ScatterChart>
      </div>
    </ChartCard>
  )
}
