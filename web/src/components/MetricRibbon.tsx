import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import type { ReactNode } from 'react'

export interface RibbonMetric {
  label: string
  value: string
  /** Variação relativa vs período anterior, ou `null` se indefinido. */
  delta?: number | null
  /** Quando `true`, queda é considerada boa (ex.: inválidos). */
  invertDelta?: boolean
  /** Detalhe opcional (linha abaixo, em cinza). Pode quebrar em 2 linhas. */
  detail?: string
  /** Aceito por compatibilidade: sem efeito visual (paleta mono). */
  accent?: 'green' | 'amber' | 'red' | 'purple' | 'blue' | 'none'
  /** Quando setado, o segmento vira clicável. */
  onClick?: () => void
}

interface Props {
  metrics: RibbonMetric[]
  rightSlot?: ReactNode
}

/**
 * Faixa horizontal de KPIs no estilo "extrato / report financeiro".
 *
 * Convenções (2026-05-12):
 *   - Valores monocromáticos sempre: cor só para deltas.
 *   - Hierarquia: label tiny uppercase → valor grande tabular → delta+detail abaixo.
 *   - Sem cards individuais, sem ícones decorativos. Só dados.
 */
export function MetricRibbon({ metrics, rightSlot }: Props) {
  return (
    <div className="surface overflow-hidden">
      <div className="flex flex-wrap lg:flex-nowrap">
        {metrics.map((m, i) => (
          <Segment key={`${m.label}-${i}`} metric={m} isFirst={i === 0} />
        ))}
        {rightSlot && (
          <div className="flex flex-1 items-center justify-end gap-2 border-l border-app-border px-5 py-4 lg:py-0">
            {rightSlot}
          </div>
        )}
      </div>
    </div>
  )
}

function Segment({
  metric,
  isFirst,
}: {
  metric: RibbonMetric
  isFirst: boolean
}) {
  const clickable = !!metric.onClick

  const inner = (
    <>
      <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-app-subtle">
        {metric.label}
      </div>
      <div className="mt-2 text-[22px] font-medium leading-none tabular-nums tracking-[-0.015em] text-app-text">
        {metric.value}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        {metric.delta !== undefined && (
          <DeltaInline delta={metric.delta} invert={metric.invertDelta} />
        )}
        {metric.detail && (
          <span className="text-[11px] leading-snug text-app-subtle">
            {metric.detail}
          </span>
        )}
      </div>
    </>
  )

  const baseCls = [
    'flex-1 min-w-[180px] px-5 py-4 lg:min-w-0 lg:flex-1',
    !isFirst ? 'border-t border-app-border lg:border-t-0 lg:border-l' : '',
    'transition-colors',
  ].join(' ')

  if (clickable) {
    return (
      <button
        type="button"
        onClick={metric.onClick}
        className={`${baseCls} text-left hover:bg-app-elev/60`}
      >
        {inner}
      </button>
    )
  }
  return <div className={baseCls}>{inner}</div>
}

function DeltaInline({ delta, invert }: { delta: number | null; invert?: boolean }) {
  if (delta === null) {
    return (
      <span className="inline-flex items-center text-[11px] font-medium text-app-subtle">
        <Minus size={11} />
      </span>
    )
  }
  const isZero = Math.abs(delta) < 0.005
  const isUp = delta > 0
  const isGood = isZero ? false : invert ? !isUp : isUp
  const isBad = isZero ? false : invert ? isUp : !isUp

  const cls = isZero
    ? 'text-app-subtle'
    : isGood
      ? 'text-emerald-600 dark:text-emerald-400'
      : isBad
        ? 'text-rose-600 dark:text-rose-400'
        : 'text-app-subtle'

  const Icon = isZero ? Minus : isUp ? ArrowUpRight : ArrowDownRight

  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums ${cls}`}
    >
      <Icon size={12} strokeWidth={2.5} />
      {isZero
        ? '0.0%'
        : `${Math.abs(delta * 100).toFixed(delta * 100 >= 10 ? 0 : 1)}%`}
    </span>
  )
}
