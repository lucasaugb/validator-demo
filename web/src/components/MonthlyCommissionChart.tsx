import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useTheme } from '../contexts/ThemeContext'
import { formatCurrency } from '../lib/format'
import {
  dailyCommissionSeries,
  monthlyCommissionSeries,
  yearlyCommissionSeries,
  type CommissionGranularity,
  type CommissionSeriesPoint,
} from '../lib/commission'
import type { Transaction } from '../types'

interface Props {
  /** Lista completa de transações: o componente computa as séries por dia/mês/ano. */
  transactions: Transaction[]
  /** Granularidade inicial (default 'month'). */
  defaultGranularity?: CommissionGranularity
  /** Quantos buckets mostrar: opcional, default sensato por granularidade. */
  counts?: Partial<Record<CommissionGranularity, number>>
  height?: number
  /** Quando true (default), destaca o último bucket. */
  highlightLast?: boolean
  /** Quando true, oculta os valores de comissão (eixo Y e tooltip), olhinho. */
  hidden?: boolean
}

const TOGGLE_LABEL: Record<CommissionGranularity, string> = {
  day: 'Dia',
  month: 'Mês',
  year: 'Ano',
}

const DEFAULT_COUNTS: Record<CommissionGranularity, number> = {
  day: 30,
  month: 12,
  year: 5,
}

/**
 * Bar chart vertical: comissão acumulada por dia/mês/ano, com toggle interno.
 * Estilo enterprise: barras finas, cor única, eixos discretos.
 */
export function MonthlyCommissionChart({
  transactions,
  defaultGranularity = 'month',
  counts,
  height = 220,
  highlightLast = true,
  hidden = false,
}: Props) {
  const [granularity, setGranularity] = useState<CommissionGranularity>(
    defaultGranularity,
  )

  const data: CommissionSeriesPoint[] = useMemo(() => {
    const n = counts?.[granularity] ?? DEFAULT_COUNTS[granularity]
    if (granularity === 'day') return dailyCommissionSeries(transactions, n)
    if (granularity === 'year') return yearlyCommissionSeries(transactions, n)
    return monthlyCommissionSeries(transactions, n).map((p) => ({
      bucket: p.month,
      shortLabel: p.shortLabel,
      longLabel: p.longLabel,
      payableRawTotal: p.payableRawTotal,
      fixedUsd: p.fixedUsd,
      percentageUsdEquivalent: p.percentageUsdEquivalent,
      activations: p.activations,
      validatedTransactions: p.validatedTransactions,
    }))
  }, [transactions, granularity, counts])

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <div className="text-[10px] uppercase tracking-[0.14em] text-app-subtle">
          {labelFor(granularity, data.length)}
        </div>
        <GranularityToggle value={granularity} onChange={setGranularity} />
      </div>
      <Chart
        data={data}
        height={height}
        highlightLast={highlightLast}
        hidden={hidden}
      />
    </div>
  )
}

function labelFor(g: CommissionGranularity, count: number): string {
  if (g === 'day') return `Últimos ${count} dias`
  if (g === 'year') return `Últimos ${count} anos`
  return `Últimos ${count} meses`
}

function GranularityToggle({
  value,
  onChange,
}: {
  value: CommissionGranularity
  onChange: (v: CommissionGranularity) => void
}) {
  const opts: CommissionGranularity[] = ['day', 'month', 'year']
  return (
    <div className="seg" role="tablist">
      {opts.map((o) => (
        <button
          key={o}
          role="tab"
          aria-selected={value === o}
          onClick={() => onChange(o)}
          className="seg-item"
        >
          {TOGGLE_LABEL[o]}
        </button>
      ))}
    </div>
  )
}

function Chart({
  data,
  height,
  highlightLast,
  hidden,
}: {
  data: CommissionSeriesPoint[]
  height: number
  highlightLast: boolean
  hidden?: boolean
}) {
  const { theme } = useTheme()
  // Paleta sistema: barra atual em accent teal, passadas em neutro esmaecido.
  // Sem cores múltiplas, sem gradiente, sem borda arredondada visível.
  const grid = theme === 'dark' ? '#2b3139' : '#eef0f4'
  const axis = theme === 'dark' ? '#5e6673' : '#a1a8b8'
  const barCurrent = theme === 'dark' ? '#f0b90b' : '#d9a400'
  const barPast = theme === 'dark' ? '#2b3139' : '#d9dee8'
  const tooltipBg = theme === 'dark' ? '#181a20' : '#ffffff'
  const tooltipBorder = theme === 'dark' ? '#2b3139' : '#e6e8ee'
  const tooltipLabel = theme === 'dark' ? '#eaecef' : '#0a0e1a'

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart
          data={data}
          margin={{ top: 8, right: 6, left: 0, bottom: 0 }}
          barCategoryGap={data.length > 20 ? '25%' : '45%'}
        >
          <CartesianGrid
            stroke={grid}
            strokeWidth={1}
            strokeOpacity={0.6}
            vertical={false}
          />
          <XAxis
            dataKey="shortLabel"
            stroke={axis}
            fontSize={9}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            interval={data.length > 20 ? 'preserveStartEnd' : 0}
          />
          <YAxis
            stroke={axis}
            fontSize={9}
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            width={42}
            tickFormatter={(v: number) => (hidden ? '•••' : compactNum(v))}
          />
          <Tooltip
            cursor={{ fill: theme === 'dark' ? '#161c28' : '#f3f5f9' }}
            wrapperStyle={{ zIndex: 50, outline: 'none' }}
            allowEscapeViewBox={{ x: false, y: true }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p = payload[0]?.payload as CommissionSeriesPoint | undefined
              if (!p) return null
              return (
                <div
                  style={{
                    background: tooltipBg,
                    border: `1px solid ${tooltipBorder}`,
                    borderRadius: 6,
                    fontSize: 10,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    padding: '6px 9px',
                    color: tooltipLabel,
                    boxShadow:
                      theme === 'dark'
                        ? '0 4px 14px rgba(0,0,0,0.55)'
                        : '0 4px 14px rgba(15,23,42,0.08)',
                    minWidth: 150,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 600,
                      marginBottom: 3,
                      letterSpacing: '0.04em',
                      color: tooltipLabel,
                    }}
                  >
                    {p.longLabel}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: tooltipLabel,
                      marginBottom: 3,
                    }}
                  >
                    {hidden ? '••••••' : formatCurrency(p.payableRawTotal, 'USD')}
                  </div>
                  {!hidden && (
                    <div style={{ color: tooltipLabel, opacity: 0.65 }}>
                      {formatCurrency(p.fixedUsd, 'USD')} fixo ·{' '}
                      {formatCurrency(p.percentageUsdEquivalent, 'USD')} 1%
                    </div>
                  )}
                  <div style={{ color: tooltipLabel, opacity: 0.65 }}>
                    {p.activations} ativ · {p.validatedTransactions} validados
                  </div>
                </div>
              )
            }}
          />
          <Bar dataKey="payableRawTotal" radius={[1, 1, 0, 0]}>
            {data.map((_, idx) => (
              <Cell
                key={idx}
                fill={
                  highlightLast && idx === data.length - 1
                    ? barCurrent
                    : barPast
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function compactNum(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`
  return v.toFixed(0)
}
