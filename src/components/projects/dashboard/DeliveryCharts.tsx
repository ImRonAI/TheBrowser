import { useMemo } from 'react'
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts'
import type { DashboardMetrics, Measure } from '@/lib/agile-metrics'
import { ChartCard, Legend, TooltipCard } from './ChartFrame'
import { AXIS, CHART_HEIGHT, CHART_MARGIN, COLOR, STATUS_COLOR, formatDate, formatDay, formatNumber, plural } from './viz'

interface DeliveryProps {
  metrics: DashboardMetrics
  /** Plural unit for values: "items", "points", "hours"... */
  unit: string
}

const BAR = { maxBarSize: 24, radius: [4, 4, 0, 0] as [number, number, number, number], isAnimationActive: false }

// ── Throughput / velocity ────────────────────────────────────────────────────

export function ThroughputChart({ metrics, unit, measure }: DeliveryProps & { measure: Measure }) {
  const data = metrics.throughput
  const total = data.reduce((sum, bucket) => sum + bucket.value, 0)
  const items = data.reduce((sum, bucket) => sum + bucket.items, 0)
  const average = data.length ? total / data.length : 0
  const last = data[data.length - 1]
  const velocity = measure === 'estimate'
  const unestimated = velocity ? metrics.finished.filter((item) => !item.issue.estimate).length : 0
  return (
    <ChartCard
      title={velocity ? 'Velocity' : 'Throughput'}
      question={velocity ? `How much estimated work (${unit}) is finished each week?` : 'How many items are finished each week?'}
      takeaway={last ? `${formatNumber(average)} ${unit} a week on average over the last ${plural(data.length, 'week')}; ${formatNumber(last.value)} in the week ending ${formatDay(last.end)}.${unestimated ? ` ${plural(unestimated, 'finished item')} had no estimate and count as 0.` : ''}` : ''}
      howToRead={`Each bar is one 7-day period ending on the date shown, counting items whose final move was to Done${velocity ? ' and summing their estimates' : ''}. The dashed line is the average. Steady bars make forecasts reliable; spiky bars mean work is finished in batches.`}
      empty={items === 0 ? 'Nothing was finished in this range. Throughput counts items moved to Done.' : null}
      table={{
        caption: `${unit} finished per week`,
        columns: ['Week ending', velocity ? `Estimate (${unit})` : 'Items', ...(velocity ? ['Items'] : [])],
        rows: [...data].reverse().map((bucket) => [formatDate(bucket.end), formatNumber(bucket.value), ...(velocity ? [formatNumber(bucket.items)] : [])]),
      }}
    >
      <BarChart data={data} responsive style={{ width: '100%', height: CHART_HEIGHT }} margin={CHART_MARGIN} barCategoryGap="20%">
        <CartesianGrid vertical={false} stroke={COLOR.grid} />
        <XAxis dataKey="end" type="category" tickFormatter={formatDay} minTickGap={16} {...AXIS} />
        <YAxis width={36} allowDecimals={velocity} {...AXIS} axisLine={false} />
        <Tooltip cursor={{ fill: COLOR.grid, fillOpacity: 0.6 }} content={(props: TooltipContentProps) => {
          if (!props.active || !props.payload?.length) return null
          const bucket = props.payload[0].payload as (typeof data)[number]
          return <TooltipCard title={`${formatDay(bucket.start)} – ${formatDay(bucket.end)}`}
            rows={[{ label: `${unit} finished`, value: formatNumber(bucket.value), color: STATUS_COLOR.done }, ...(velocity ? [{ label: 'items', value: formatNumber(bucket.items) }] : [])]} />
        }} />
        {average > 0 && <ReferenceLine y={average} stroke={COLOR.ink} strokeDasharray="4 4" strokeWidth={1}
          label={{ value: `avg ${formatNumber(average)}`, position: 'insideTopRight', fill: COLOR.tick, fontSize: 11 }} />}
        <Bar dataKey="value" name={unit} fill={STATUS_COLOR.done} {...BAR} />
      </BarChart>
    </ChartCard>
  )
}

// ── Burnup ───────────────────────────────────────────────────────────────────

export function BurnupChart({ metrics, unit }: DeliveryProps) {
  const { burnup: points } = metrics
  const first = points[0]
  const last = points[points.length - 1]
  const share = last && last.scope > 0 ? Math.round((last.done / last.scope) * 100) : 0
  const grew = first && last ? last.scope - first.scope : 0
  return (
    <ChartCard
      title="Burnup"
      question="Is finished work catching up with the total scope?"
      takeaway={last ? `${formatNumber(last.done)} of ${formatNumber(last.scope)} ${unit} done (${share}%); scope ${grew > 0 ? `grew by ${formatNumber(grew)}` : grew < 0 ? `shrank by ${formatNumber(-grew)}` : 'did not change'} in this range.` : ''}
      howToRead="The gray line is total scope (everything created so far); the shaded area is work in Done. The gap between them is what remains. If the scope line rises as fast as Done, the work will not finish without cutting scope."
      empty={!last || last.scope === 0 ? 'No issues of the selected types exist in this range yet.' : null}
      legend={<Legend entries={[{ label: 'Scope', color: COLOR.neutral, mark: 'line', value: last ? formatNumber(last.scope) : undefined },
        { label: 'Done', color: STATUS_COLOR.done, mark: 'rect', value: last ? formatNumber(last.done) : undefined }]} />}
      table={{
        caption: `Scope and done ${unit} at the end of each day`,
        columns: ['Day', 'Scope', 'Done', 'Remaining'],
        rows: [...points].reverse().map((point) => [formatDate(point.day), formatNumber(point.scope), formatNumber(point.done), formatNumber(point.scope - point.done)]),
      }}
    >
      <ComposedChart data={points} responsive style={{ width: '100%', height: CHART_HEIGHT }} margin={CHART_MARGIN}>
        <CartesianGrid vertical={false} stroke={COLOR.grid} />
        <XAxis dataKey="day" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={formatDay} minTickGap={28} {...AXIS} />
        <YAxis width={36} {...AXIS} axisLine={false} />
        <Tooltip cursor={{ stroke: COLOR.axis, strokeWidth: 1 }} content={(props: TooltipContentProps) => {
          if (!props.active || !props.payload?.length) return null
          const point = props.payload[0].payload as (typeof points)[number]
          return <TooltipCard title={formatDate(point.day)} rows={[
            { label: 'scope', value: formatNumber(point.scope), color: COLOR.neutral },
            { label: 'done', value: formatNumber(point.done), color: STATUS_COLOR.done },
            { label: 'remaining', value: formatNumber(point.scope - point.done) },
          ]} />
        }} />
        <Area type="linear" dataKey="done" name="Done" stroke={STATUS_COLOR.done} strokeWidth={2} fill={STATUS_COLOR.done} fillOpacity={0.1} isAnimationActive={false} />
        <Line type="linear" dataKey="scope" name="Scope" stroke={COLOR.neutral} strokeWidth={2} dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ChartCard>
  )
}

// ── Monte Carlo forecast ─────────────────────────────────────────────────────

export function ForecastChart({ metrics, className }: { metrics: DashboardMetrics; className?: string }) {
  const { forecast } = metrics
  const data = useMemo(() => {
    let cumulative = 0
    return forecast.histogram.map((bucket) => {
      cumulative += bucket.share
      return { ...bucket, percent: bucket.share * 100, cumulative: cumulative * 100 }
    })
  }, [forecast.histogram])
  const markers = useMemo(() => {
    if (!forecast.days) return []
    const byWeek = new Map<number, string[]>()
    for (const key of ['p50', 'p85', 'p95'] as const) {
      const week = Math.ceil(forecast.days[key] / 7)
      byWeek.set(week, [...(byWeek.get(week) ?? []), key.slice(1)])
    }
    return [...byWeek].map(([week, names]) => ({ x: week, label: `${names.join('/')}%` }))
  }, [forecast.days])
  const empty = forecast.status === 'done' ? 'Every item of the selected types is done; nothing is left to forecast.'
    : forecast.status === 'insufficient' ? `${forecast.reason} Try a longer time range.` : null
  const dates = forecast.dates
  return (
    <ChartCard
      className={className}
      title="When will it be done?"
      question={`When will the ${plural(forecast.remaining, 'open item')} be finished at the recent pace?`}
      takeaway={dates ? `85% likely by ${formatDate(dates.p85)} (50%: ${formatDate(dates.p50)}, 95%: ${formatDate(dates.p95)}).${forecast.beyondHorizon ? ' Some simulations did not finish within 10 years.' : ''}` : ''}
      howToRead={`A Monte Carlo forecast: ${formatNumber(forecast.trials)} simulated futures, each replaying randomly drawn days of this range's throughput (${plural(forecast.sampleFinished, 'item')} finished over ${plural(forecast.sampleDays, 'day')}) until the open items are done. Each bar is the share of futures finishing in that week. Plan on the 85% date, not the 50% one. New scope is not included.`}
      empty={empty}
      table={{
        caption: 'Share of simulations finishing in each week',
        columns: ['Week ending', 'Share', 'Done by then'],
        rows: data.map((bucket) => [formatDate(bucket.end), `${formatNumber(bucket.percent)}%`, `${formatNumber(bucket.cumulative)}%`]),
      }}
    >
      <BarChart data={data} responsive style={{ width: '100%', height: CHART_HEIGHT }} margin={CHART_MARGIN} barCategoryGap="15%">
        <CartesianGrid vertical={false} stroke={COLOR.grid} />
        <XAxis dataKey="week" type="category" tickFormatter={(week: number) => data[week - 1] ? formatDay(data[week - 1].end) : ''} minTickGap={16} {...AXIS} />
        <YAxis width={40} tickFormatter={(value: number) => `${formatNumber(value)}%`} {...AXIS} axisLine={false} />
        <Tooltip cursor={{ fill: COLOR.grid, fillOpacity: 0.6 }} content={(props: TooltipContentProps) => {
          if (!props.active || !props.payload?.length) return null
          const bucket = props.payload[0].payload as (typeof data)[number]
          return <TooltipCard title={`Week ending ${formatDate(bucket.end)}`} rows={[
            { label: 'of simulations finish this week', value: `${formatNumber(bucket.percent)}%`, color: STATUS_COLOR.done },
            { label: 'done by then', value: `${formatNumber(bucket.cumulative)}%` },
          ]} />
        }} />
        {markers.map((marker) => (
          <ReferenceLine key={marker.x} x={marker.x} stroke={COLOR.ink} strokeDasharray="4 4" strokeWidth={1}
            label={{ value: marker.label, position: 'insideTop', fill: COLOR.tick, fontSize: 11 }} />
        ))}
        <Bar dataKey="percent" name="Share of simulations" fill={STATUS_COLOR.done} {...BAR} />
      </BarChart>
    </ChartCard>
  )
}
