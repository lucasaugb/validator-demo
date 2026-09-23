import type { LucideIcon } from 'lucide-react'
import {
  CheckCircle2,
  MessageSquare,
  Receipt,
  ShieldCheck,
} from 'lucide-react'
import type { ConversionFunnel as Funnel } from '../lib/metrics'

interface Props {
  funnel: Funnel
  /** Sem wrapper `surface`: útil pra encaixar dentro de um panel/tab. */
  bare?: boolean
}

interface Step {
  label: string
  value: number
  icon: LucideIcon
  /** Opacidade do accent (0-100): escala monocromática, etapa final 100%. */
  opacity: number
  hint: string
}

export function ConversionFunnel({ funnel, bare }: Props) {
  const max = Math.max(funnel.registered, 1)
  // Paleta sóbria: tudo no accent teal com opacidade crescente, etapa final
  // fica 100% e as anteriores em tons graduais. Sem cores múltiplas.
  const steps: Step[] = [
    {
      label: 'Registrados',
      value: funnel.registered,
      icon: Receipt,
      opacity: 25,
      hint: 'gestores preencheram',
    },
    {
      label: 'Verificados - Sistema',
      value: funnel.systemVerified,
      icon: ShieldCheck,
      opacity: 50,
      hint: 'BigQuery confirmou',
    },
    {
      label: 'Aprovados',
      value: funnel.conversationApproved,
      icon: MessageSquare,
      opacity: 75,
      hint: 'gestor liberou conversa',
    },
    {
      label: 'Validados Sistema + Conversa',
      value: funnel.fullyValidated,
      icon: CheckCircle2,
      opacity: 100,
      hint: 'fechados com sucesso',
    },
  ]

  return (
    <div className={bare ? '' : 'surface p-5'}>
      {!bare && (
        <div className="mb-4 flex items-end justify-between gap-3">
          <h2 className="text-[10px] font-medium uppercase tracking-[0.18em] text-app-muted">
            Funil de validação
          </h2>
          <div className="text-right">
            <div className="text-2xl font-medium leading-none tabular-nums tracking-[-0.02em] text-app-text">
              {(funnel.finalConversionRate * 100).toFixed(0)}%
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-app-subtle">
              taxa final
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3.5">
        {steps.map((s, i) => {
          const Icon = s.icon
          const pct = (s.value / max) * 100
          const ofTotal = funnel.registered > 0 ? (s.value / funnel.registered) * 100 : 0
          return (
            <div key={s.label}>
              <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 text-app-text">
                  <Icon size={13} className="text-app-muted" />
                  <span className="font-medium">{s.label}</span>
                  <span className="text-app-subtle">· {s.hint}</span>
                </div>
                <div className="flex items-baseline gap-2 font-mono tabular-nums">
                  <span className="text-sm font-semibold text-app-text">
                    {s.value}
                  </span>
                  {i > 0 && (
                    <span className="text-[11px] text-app-subtle">
                      ({ofTotal.toFixed(0)}%)
                    </span>
                  )}
                </div>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-app-elev">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${pct}%`,
                    background: `color-mix(in oklab, var(--app-accent) ${s.opacity}%, transparent)`,
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
