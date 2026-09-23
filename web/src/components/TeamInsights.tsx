import {
  AlertTriangle,
  CalendarOff,
  Crown,
  Gauge,
  Lightbulb,
  Sparkles,
  Trophy,
  TrendingDown,
  TrendingUp,
  UserPlus,
  type LucideIcon,
} from 'lucide-react'
import type { TeamInsight, TeamInsightKind } from '../lib/metrics'

interface Props {
  insights: TeamInsight[]
  onSelectAgent?: (agenteId: string) => void
}

const ICON: Record<TeamInsightKind, LucideIcon> = {
  top_commission: Trophy,
  top_validated: Crown,
  most_improved: TrendingUp,
  slipping: TrendingDown,
  activation_specialist: UserPlus,
  speed_champion: Gauge,
  quality_concern: AlertTriangle,
  conversion_gap: Sparkles,
  newcomer: Lightbulb,
  inactive: CalendarOff,
}

const TONE_STYLES = {
  positive: {
    icon: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-500/8 border-emerald-500/25',
  },
  warning: {
    icon: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-500/8 border-amber-500/25',
  },
  info: {
    icon: 'text-app-muted',
    bg: 'bg-app-elev/60 border-app-border',
  },
} as const

/**
 * Grid de cards de insights gerados automaticamente sobre o time. Cada card
 * tem ícone tonal, mensagem principal e detalhe. Clicar leva ao agente.
 */
export function TeamInsights({ insights, onSelectAgent }: Props) {
  if (insights.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-app-border bg-app-elev/30 px-4 py-6 text-center text-xs text-app-subtle">
        Sem destaques no período.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {insights.map((ins, i) => {
        const Icon = ICON[ins.kind]
        const tone = TONE_STYLES[ins.tone]
        const clickable = !!ins.agenteId && !!onSelectAgent
        const inner = (
          <>
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${tone.icon} bg-app-card shadow-[var(--shadow-card)]`}
            >
              <Icon size={15} strokeWidth={2.1} />
            </div>
            <div className="min-w-0 flex-1 text-left">
              <div className="text-[12.5px] font-medium leading-snug text-app-text">
                {ins.message}
              </div>
              {ins.detail && (
                <div className="mt-1 text-[11px] leading-snug text-app-muted">
                  {ins.detail}
                </div>
              )}
            </div>
          </>
        )

        if (clickable) {
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelectAgent(ins.agenteId!)}
              className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-transform ${tone.bg} hover:-translate-y-px hover:shadow-[var(--shadow-card)]`}
            >
              {inner}
            </button>
          )
        }
        return (
          <div
            key={i}
            className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 ${tone.bg}`}
          >
            {inner}
          </div>
        )
      })}
    </div>
  )
}
