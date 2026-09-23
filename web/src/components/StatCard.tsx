import type { LucideIcon } from 'lucide-react'
import { Sparkline } from './Sparkline'
import { TrendBadge } from './TrendBadge'

export type StatTone = 'default' | 'green' | 'amber' | 'blue' | 'red' | 'purple'

interface Props {
  label: string
  value: string
  hint?: string
  icon?: LucideIcon
  tone?: StatTone
  /** Variação relativa vs período anterior (-1..+∞) ou `null`. */
  delta?: number | null
  /** Se `true`, queda é tratada como bom (ex.: taxa de inválidos). */
  invertDelta?: boolean
  /** Série pra sparkline (typically últimos 14-30 dias). */
  sparkline?: { date: string; value: number }[]
}

const toneIcon: Record<StatTone, string> = {
  default: 'bg-app-elev text-app-muted',
  green: 'bg-green-500/10 text-green-600 dark:text-green-400',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  red: 'bg-red-500/10 text-red-600 dark:text-red-400',
  purple: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
}

const toneSpark: Record<StatTone, string> = {
  default: '#64748b',
  green: '#22c55e',
  amber: '#f59e0b',
  blue: '#3b82f6',
  red: '#ef4444',
  purple: '#a855f7',
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
  delta,
  invertDelta = false,
  sparkline,
}: Props) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-app-border bg-app-card p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-app-muted">
            {label}
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <div className="text-2xl font-semibold tracking-tight text-app-text">
              {value}
            </div>
            {delta !== undefined && (
              <TrendBadge delta={delta} invert={invertDelta} />
            )}
          </div>
          {hint && <div className="mt-1 text-xs text-app-subtle">{hint}</div>}
        </div>
        {Icon && (
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${toneIcon[tone]}`}
          >
            <Icon size={18} />
          </div>
        )}
      </div>
      {sparkline && sparkline.length > 0 && (
        <div className="mt-3 -mx-1 -mb-1">
          <Sparkline data={sparkline} color={toneSpark[tone]} height={34} />
        </div>
      )}
    </div>
  )
}
