import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useTheme } from '../contexts/ThemeContext'
import { dailyMultiSeries, monthlyMultiSeries } from '../lib/metrics'
import type { Transaction } from '../types'

interface Props {
  /** Transações pra granularidade Mês (diária). Deve vir já filtrado por período. */
  transactions: Transaction[]
  /**
   * Transações pra granularidade Ano (mensal, últimos 12 meses). Geralmente
   * é o sector-filtered SEM filtro de período. Default: usa `transactions`.
   */
  yearTransactions?: Transaction[]
  /** Quantos dias mostrar no modo Mês. Default 30. */
  days?: number
  /** YYYY-MM-DD: último dia da janela do modo Mês. Default = hoje. */
  endDate?: string
  height?: number
}

type Mode = 'all' | 'filled' | 'verified' | 'activations'
type Granularity = 'month' | 'year'

/**
 * Gráfico "Registros por dia/mês": série temporal com 3 linhas, Registros,
 * Validados e Ativações. Granularidade Mês (diária) ou Ano (mensal, últimos
 * 12 meses).
 */
export function TransactionsPerDayChart({
  transactions,
  yearTransactions,
  days = 30,
  endDate,
  height = 260,
}: Props) {
  const { theme } = useTheme()
  const [mode, setMode] = useState<Mode>('all')
  const [granularity, setGranularity] = useState<Granularity>('month')

  const data = useMemo(
    () =>
      granularity === 'year'
        ? monthlyMultiSeries(yearTransactions ?? transactions, 12)
        : dailyMultiSeries(transactions, days, endDate),
    [granularity, transactions, yearTransactions, days, endDate],
  )
  const summary = useMemo(() => {
    let filled = 0
    let verified = 0
    let activations = 0
    for (const d of data) {
      filled += d.total
      verified += d.verified
      activations += d.activations
    }
    return {
      filled,
      verified,
      activations,
      avgFilled: data.length > 0 ? filled / data.length : 0,
      avgVerified: data.length > 0 ? verified / data.length : 0,
      avgActivations: data.length > 0 ? activations / data.length : 0,
    }
  }, [data])

  // Paleta sóbria: 3 tons distintos sem virar BI dashboard.
  // Registros: cinza neutro fraco (linha tracejada como contexto/referência)
  // Verificados: accent teal: linha protagonista
  // Paleta monocromática gold (sem cores competindo): verificados = gold forte,
  // ativações = MESMO gold em tonalidade mais fraca. Só inválidos saem do gold.
  const grid = theme === 'dark' ? '#2b3139' : '#eef0f4'
  const axis = theme === 'dark' ? '#5e6673' : '#a1a8b8'
  const labelColor = theme === 'dark' ? '#eaecef' : '#0a0e1a'
  const tooltipBg = theme === 'dark' ? '#181a20' : '#ffffff'
  const tooltipBorder = theme === 'dark' ? '#2b3139' : '#e6e8ee'

  const filledColor = theme === 'dark' ? '#5e6673' : '#a8b0c0'
  // Dois passos de luminosidade BEM distintos pra diferenciar no claro:
  // verificados = gold profundo, ativações = gold claro.
  const verifiedColor = theme === 'dark' ? '#f0b90b' : '#b8810a'
  const activationsColor = theme === 'dark' ? '#f3d27a' : '#f1c84e'

  const showFilled = mode === 'all' || mode === 'filled'
  const showVerified = mode === 'all' || mode === 'verified'
  const showActivations = mode === 'all' || mode === 'activations'

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <LegendToggle mode={mode} onChange={setMode} />
          <GranularityToggle value={granularity} onChange={setGranularity} />
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[10px] tabular-nums">
          <Stat label="Registros" value={summary.filled} color={filledColor} />
          <Stat label="Validados" value={summary.verified} color={verifiedColor} />
          <Stat label="Ativações" value={summary.activations} color={activationsColor} />
        </div>
      </div>

      <div style={{ width: '100%', height }}>
        <ResponsiveContainer>
          <AreaChart
            data={data}
            margin={{ top: 6, right: 6, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              stroke={grid}
              strokeWidth={1}
              strokeOpacity={0.6}
              vertical={false}
            />
            <XAxis
              dataKey="date"
              stroke={axis}
              fontSize={9}
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              minTickGap={28}
              height={22}
              tickFormatter={(v: string) => {
                const parts = v.split('-')
                if (granularity === 'year') {
                  // yyyy-mm → mmm/yy
                  const monthIdx = Number(parts[1]) - 1
                  const monthAbbr = [
                    'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
                    'jul', 'ago', 'set', 'out', 'nov', 'dez',
                  ][monthIdx] ?? '?'
                  return `${monthAbbr}/${parts[0].slice(2)}`
                }
                return `${parts[2]}/${parts[1]}`
              }}
            />
            <YAxis
              stroke={axis}
              fontSize={9}
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              allowDecimals={false}
              width={24}
            />
            <Tooltip
              wrapperStyle={{ zIndex: 50, outline: 'none' }}
              allowEscapeViewBox={{ x: false, y: true }}
              cursor={{
                stroke: theme === 'dark' ? '#2b3139' : '#d9dee8',
                strokeWidth: 1,
              }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const p = payload[0]?.payload as
                  | {
                      date: string
                      total: number
                      verified: number
                      invalid: number
                      activations: number
                    }
                  | undefined
                if (!p) return null
                const parts = p.date.split('-')
                const tooltipDate =
                  granularity === 'year'
                    ? (() => {
                        const monthFull = [
                          'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                          'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
                        ][Number(parts[1]) - 1] ?? '?'
                        return `${monthFull} ${parts[0]}`
                      })()
                    : `${parts[2]}/${parts[1]}/${parts[0]}`
                return (
                  <div
                    style={{
                      background: tooltipBg,
                      border: `1px solid ${tooltipBorder}`,
                      borderRadius: 6,
                      padding: '6px 9px',
                      fontSize: 10,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      color: labelColor,
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
                        marginBottom: 5,
                        letterSpacing: '0.04em',
                      }}
                    >
                      {tooltipDate}
                    </div>
                    <Row label="Registros" value={p.total} color={filledColor} />
                    <Row label="Validados" value={p.verified} color={verifiedColor} />
                    <Row
                      label="Ativações"
                      value={p.activations}
                      color={activationsColor}
                    />
                    {p.invalid > 0 && (
                      <Row label="Inválidos" value={p.invalid} color={theme === 'dark' ? '#f6465d' : '#e23545'} />
                    )}
                  </div>
                )
              }}
            />
            {showFilled && (
              <Area
                type="monotone"
                dataKey="total"
                name="Registros"
                stroke={filledColor}
                strokeWidth={1}
                strokeDasharray="3 3"
                fill={filledColor}
                fillOpacity={0.04}
                isAnimationActive={false}
              />
            )}
            {showVerified && (
              <Area
                type="monotone"
                dataKey="verified"
                name="Validados"
                stroke={verifiedColor}
                strokeWidth={1.5}
                fill={verifiedColor}
                fillOpacity={0.07}
                isAnimationActive={false}
              />
            )}
            {showActivations && (
              <Area
                type="monotone"
                dataKey="activations"
                name="Ativações"
                stroke={activationsColor}
                strokeWidth={1.5}
                fill={activationsColor}
                fillOpacity={0.07}
                isAnimationActive={false}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function LegendToggle({
  mode,
  onChange,
}: {
  mode: Mode
  onChange: (m: Mode) => void
}) {
  const opts: { v: Mode; label: string }[] = [
    { v: 'all', label: 'Todos' },
    { v: 'filled', label: 'Registros' },
    { v: 'verified', label: 'Validados' },
    { v: 'activations', label: 'Ativações' },
  ]
  return (
    <div className="seg" role="tablist">
      {opts.map((o) => (
        <button
          key={o.v}
          role="tab"
          aria-selected={mode === o.v}
          onClick={() => onChange(o.v)}
          className="seg-item"
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function GranularityToggle({
  value,
  onChange,
}: {
  value: Granularity
  onChange: (g: Granularity) => void
}) {
  const opts: { v: Granularity; label: string }[] = [
    { v: 'month', label: 'Mês' },
    { v: 'year', label: 'Ano' },
  ]
  return (
    <div className="seg" role="tablist">
      {opts.map((o) => (
        <button
          key={o.v}
          role="tab"
          aria-selected={value === o.v}
          onClick={() => onChange(o.v)}
          className="seg-item"
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Stat({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="h-2 w-[2px] rounded-sm"
        style={{ background: color }}
        aria-hidden
      />
      <span className="text-app-subtle">{label}</span>
      <span className="font-semibold text-app-text">{value}</span>
    </span>
  )
}

function Row({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 14,
        padding: '1px 0',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span
          style={{
            width: 2,
            height: 8,
            borderRadius: 1,
            background: color,
            display: 'inline-block',
          }}
        />
        <span style={{ opacity: 0.7 }}>{label}</span>
      </span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  )
}
