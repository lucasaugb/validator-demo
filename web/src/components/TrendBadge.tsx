import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'

interface Props {
  /** Variação relativa (-1..+∞) ou `null` quando indefinido. */
  delta: number | null
  /** Quando `true`, queda é considerada boa (ex.: taxa de inválido caindo é bom). */
  invert?: boolean
  /** Texto curto que aparece após o número (ex.: "vs. mês anterior"). */
  label?: string
}

/**
 * Badge visual de variação percentual. Verde = bom, vermelho = ruim, cinza = neutro.
 * `delta` é um número (0.12 = +12%); `null` mostra travessão.
 */
export function TrendBadge({ delta, invert = false, label }: Props) {
  if (delta === null) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-app-subtle">
        <Minus size={11} />
        sem base
        {label && <span className="text-app-subtle">{label}</span>}
      </span>
    )
  }

  const isZero = Math.abs(delta) < 0.005 // < 0.5% é "estável"
  const isUp = delta > 0
  const isGood = isZero ? false : invert ? !isUp : isUp
  const isBad = isZero ? false : invert ? isUp : !isUp

  const cls = isZero
    ? 'text-app-muted bg-app-elev'
    : isGood
      ? 'text-green-600 bg-green-500/10 dark:text-green-400'
      : isBad
        ? 'text-red-600 bg-red-500/10 dark:text-red-400'
        : 'text-app-muted bg-app-elev'

  const Icon = isZero ? Minus : isUp ? ArrowUpRight : ArrowDownRight

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${cls}`}
    >
      <Icon size={11} strokeWidth={2.5} />
      {isZero ? '0%' : `${Math.abs(delta * 100).toFixed(delta * 100 >= 10 ? 0 : 1)}%`}
      {label && <span className="text-app-muted">{label}</span>}
    </span>
  )
}
