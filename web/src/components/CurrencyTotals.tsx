import { formatMoney } from '../lib/format'
import type { CurrencyTotals as Totals } from '../lib/metrics'

interface Props {
  totals: Totals
  size?: 'sm' | 'md' | 'lg'
  /**
   * Mantida por compatibilidade com chamadas existentes. Sistema agora usa
   * moeda única (USD): o argumento é ignorado e o componente sempre mostra
   * a soma em "$".
   */
  showSum?: boolean
}

const sumSizeMap = {
  sm: 'text-[14px]',
  md: 'text-[20px]',
  lg: 'text-[26px]',
}

/**
 * Sistema simplificado: todos os valores como USD. Soma as moedas legado
 * (USD+EUR+GBP face-value sem câmbio) e renderiza um único número em "$".
 */
export function CurrencyTotals({ totals, size = 'lg' }: Props) {
  const sum = (totals.USD || 0) + (totals.EUR || 0) + (totals.GBP || 0)
  const cls = sumSizeMap[size]
  const tone = sum === 0 ? 'text-app-subtle' : 'text-app-text'
  return (
    <div
      className={`font-medium tabular-nums leading-none tracking-[-0.015em] ${tone} ${cls}`}
    >
      {formatMoney(sum)}
    </div>
  )
}
