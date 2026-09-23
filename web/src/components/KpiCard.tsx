import type { LucideIcon } from 'lucide-react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { Sparkline } from './Sparkline'

export type KpiTone = 'default' | 'green' | 'amber' | 'blue' | 'red' | 'purple' | 'teal'

interface Props {
  label: string
  value: string
  /** Variação relativa (-1..+∞) ou `null` (sem base). undefined oculta o chip. */
  delta?: number | null
  /** Quando `true`, queda é boa (ex.: inválidos caindo). */
  invertDelta?: boolean
  /** Texto auxiliar abaixo do delta. */
  hint?: string
  /** Ícone exibido no canto superior direito do card. */
  icon?: LucideIcon
  /** Tom do ícone/sparkline. */
  tone?: KpiTone
  /** Quando true, o card vira accent teal (destaque tipo "Total Balance" da ref). */
  accent?: boolean
  /** Série pra sparkline (últimos 14-30 dias). */
  sparkline?: { date: string; value: number }[]
  onClick?: () => void
}

const toneIconBg: Record<KpiTone, string> = {
  default: 'bg-app-elev text-app-muted',
  green: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  red: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  purple: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  // "teal" virou o tom da MARCA = gold Binance (mantém o nome p/ não quebrar callers).
  teal: 'bg-app-accent/12 text-app-accent-text',
}

const toneSpark: Record<KpiTone, string> = {
  default: '#64748b',
  green: '#10b981',
  amber: '#f59e0b',
  blue: '#3b82f6',
  red: '#f43f5e',
  purple: '#8b5cf6',
  teal: '#f0b90b',
}

/**
 * Cartão KPI no estilo "Apex": rótulo pequeno em uppercase, valor grande,
 * chip de delta abaixo, ícone no canto. Quando `accent`, vira teal escuro
 * com texto claro. Sparkline opcional como rodapé.
 */
export function KpiCard({
  label,
  value,
  delta,
  invertDelta,
  hint,
  icon: Icon,
  tone = 'default',
  accent,
  sparkline,
  onClick,
}: Props) {
  const isClickable = !!onClick

  const containerCls = accent
    ? 'surface-accent relative overflow-hidden p-5 transition-transform'
    : 'surface relative overflow-hidden p-5 transition-shadow'

  const labelCls = accent
    ? 'text-[11px] font-medium uppercase tracking-[0.14em] text-app-accent-fg/70'
    : 'text-[11px] font-medium uppercase tracking-[0.14em] text-app-subtle'

  const valueCls = accent
    ? 'text-[28px] font-semibold leading-none tracking-tight text-app-accent-fg'
    : 'text-[28px] font-semibold leading-none tracking-tight text-app-text'

  const hintCls = accent
    ? 'text-[11px] text-app-accent-fg/75'
    : 'text-[11px] text-app-subtle'

  const iconBubble = accent
    ? 'flex h-9 w-9 items-center justify-center rounded-xl chip-on-accent'
    : `flex h-9 w-9 items-center justify-center rounded-xl ${toneIconBg[tone]}`

  const interactive = isClickable
    ? ' cursor-pointer hover:-translate-y-px hover:shadow-[var(--shadow-elev)]'
    : ''

  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className={labelCls}>{label}</div>
          <div className="mt-3">
            <div className={`${valueCls} tabular-nums`}>{value}</div>
          </div>
        </div>
        {Icon && (
          <div className={iconBubble}>
            <Icon size={16} strokeWidth={2} />
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        {delta !== undefined && (
          <DeltaChip delta={delta} invert={invertDelta} accent={accent} />
        )}
        {hint && <span className={`leading-snug ${hintCls}`}>{hint}</span>}
      </div>

      {sparkline && sparkline.length > 0 && (
        <div className="mt-4 -mx-2 -mb-2">
          <Sparkline
            data={sparkline}
            color={accent ? 'rgba(255,255,255,0.85)' : toneSpark[tone]}
            height={32}
          />
        </div>
      )}
    </>
  )

  if (isClickable) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${containerCls}${interactive} w-full text-left`}
      >
        {inner}
      </button>
    )
  }
  return <div className={containerCls}>{inner}</div>
}

function DeltaChip({
  delta,
  invert,
  accent,
}: {
  delta: number | null
  invert?: boolean
  accent?: boolean
}) {
  if (delta === null) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
          accent
            ? 'chip-on-accent'
            : 'bg-app-elev text-app-muted'
        }`}
      >
        <Minus size={11} />
        sem base
      </span>
    )
  }

  const isZero = Math.abs(delta) < 0.005
  const isUp = delta > 0
  const isGood = isZero ? false : invert ? !isUp : isUp

  let cls: string
  if (accent) {
    cls = 'chip-on-accent'
  } else if (isZero) {
    cls = 'bg-app-elev text-app-muted'
  } else if (isGood) {
    cls = 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
  } else {
    cls = 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
  }

  const Icon = isZero ? Minus : isUp ? ArrowUpRight : ArrowDownRight

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${cls}`}
    >
      <Icon size={11} strokeWidth={2.5} />
      {isZero
        ? '0%'
        : `${isUp ? '+' : '−'}${Math.abs(delta * 100).toFixed(delta * 100 >= 10 ? 0 : 1)}%`}
    </span>
  )
}
