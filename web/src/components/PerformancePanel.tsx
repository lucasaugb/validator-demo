import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'

export interface PerfIndicator {
  label: string
  current: number
  previous: number
  /** Cor do bullet circular à esquerda do label. */
  dotColor: string
  /** Quando true, queda do valor é considerada positiva (ex: inválidos). */
  invertDelta?: boolean
  /** Valor do dia de hoje (comparativo "vs mesmo dia mês anterior"). */
  dayCurrent?: number
  /** Valor do mesmo dia no mês anterior. */
  dayPrevious?: number
  /**
   * Como renderizar o valor. `count` (default) imprime o número cru;
   * `currency` formata em USD compacto ($96.4k), as células são estreitas
   * (92-100px) e um valor cheio tipo $96,433.74 não caberia.
   */
  format?: 'count' | 'currency'
}

/** Valor compacto pra caber na célula estreita do painel. */
function formatPerfValue(v: number, format: 'count' | 'currency'): string {
  if (format !== 'currency') return String(v)
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(1)}k`
  return `$${v.toFixed(0)}`
}

interface Props {
  indicators: PerfIndicator[]
  caption?: string
  /** Legenda do comparativo diário, ex.: "18/06 vs 18/05". */
  dayCaption?: string
}

/**
 * Painel "Performance": 4 indicadores (Registros, Validados, Ativações,
 * Volume registrado). Layout COMPACTO em duas colunas lado a lado: "Mês" (vs mês
 * anterior) e "Dia" (hoje vs mesmo dia do mês passado). Cada célula é uma única
 * linha (valor + delta), mantendo o painel baixo pra não esticar o card vizinho.
 * Se faltar largura, rola horizontalmente.
 */
export function PerformancePanel({
  indicators,
  caption = 'vs período anterior',
  dayCaption,
}: Props) {
  if (indicators.length === 0) return null
  const hasDay = indicators.some(
    (i) => i.dayCurrent !== undefined && i.dayPrevious !== undefined,
  )
  return (
    <div className="panel overflow-hidden">
      <div className="panel-head">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-app-muted">
          Performance
        </h3>
        <span className="text-[10px] text-app-subtle">{caption}</span>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[320px]">
          {hasDay && (
            <div className="flex items-center gap-3 border-b border-app-border/60 px-4 py-1">
              <div className="min-w-0 flex-1" />
              <div className="w-[92px] shrink-0 text-right text-[8.5px] font-semibold uppercase tracking-[0.1em] text-app-subtle">
                Mês
              </div>
              <div className="w-[100px] shrink-0 text-right text-[8.5px] font-semibold uppercase tracking-[0.08em] text-app-subtle">
                {dayCaption ?? 'Dia'}
              </div>
            </div>
          )}
          <ul className="divide-y divide-app-border/60">
            {indicators.map((ind) => (
              <PerfRow key={ind.label} indicator={ind} />
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function PerfRow({ indicator }: { indicator: PerfIndicator }) {
  const {
    label,
    current,
    previous,
    dotColor,
    invertDelta,
    dayCurrent,
    dayPrevious,
    format = 'count',
  } = indicator
  const hasDay = dayCurrent !== undefined && dayPrevious !== undefined
  return (
    <li className="flex items-center gap-3 px-4 py-2">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-app-border"
        style={{ background: dotColor }}
        aria-hidden
      />
      <div className="min-w-0 flex-1 truncate text-[10.5px] font-medium uppercase tracking-[0.12em] text-app-muted">
        {label}
      </div>
      <ValueCell
        value={current}
        previous={previous}
        invert={invertDelta}
        width={92}
        format={format}
      />
      {hasDay && (
        <ValueCell
          value={dayCurrent as number}
          previous={dayPrevious as number}
          invert={invertDelta}
          width={100}
          small
          format={format}
        />
      )}
    </li>
  )
}

function ValueCell({
  value,
  previous,
  invert,
  width,
  small,
  format = 'count',
}: {
  value: number
  previous: number
  invert?: boolean
  width: number
  small?: boolean
  format?: 'count' | 'currency'
}) {
  return (
    <div className="shrink-0 text-right" style={{ width }}>
      <div className="flex items-baseline justify-end gap-1">
        <span
          className={`font-mono font-semibold tabular-nums tracking-[-0.01em] text-app-text ${
            format === 'currency'
              ? small
                ? 'text-[12px]'
                : 'text-[13.5px]'
              : small
                ? 'text-[14px]'
                : 'text-[16px]'
          }`}
        >
          {formatPerfValue(value, format)}
        </span>
        <span className="font-mono text-[9.5px] tabular-nums text-app-subtle">
          vs {formatPerfValue(previous, format)}
        </span>
      </div>
      <div className="mt-0.5 flex justify-end">
        <DeltaBadge current={value} previous={previous} invert={invert} />
      </div>
    </div>
  )
}

function DeltaBadge({
  current,
  previous,
  invert,
}: {
  current: number
  previous: number
  invert?: boolean
}) {
  // Sem histórico (previous=0): mostra delta absoluto sem porcentagem
  if (previous === 0) {
    if (current === 0) {
      return (
        <span className="inline-flex items-center font-mono text-[9px] text-app-subtle">
          <Minus size={9} />
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-0.5 font-mono text-[9px] tabular-nums text-app-muted">
        <ArrowUpRight size={9} strokeWidth={2.4} />
        novo
      </span>
    )
  }
  const rel = (current - previous) / previous
  if (Math.abs(rel) < 0.005) {
    return (
      <span className="inline-flex items-center font-mono text-[9px] text-app-subtle">
        <Minus size={9} />
        0%
      </span>
    )
  }
  const isUp = rel > 0
  const isGood = invert ? !isUp : isUp
  const cls = isGood
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-rose-600 dark:text-rose-400'
  const Icon = isUp ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={`inline-flex items-center gap-0.5 font-mono text-[9px] tabular-nums ${cls}`}
    >
      <Icon size={9} strokeWidth={2.4} />
      {Math.abs(rel * 100).toFixed(0)}%
    </span>
  )
}
