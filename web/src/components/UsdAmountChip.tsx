import { formatMoney } from '../lib/format'
import type { Transaction } from '../types'

interface Props {
  transaction: Transaction
  /** Tamanho do chip. `xs` é o default, só pra linha de tabela. */
  size?: 'xs' | 'sm'
  /** Quando true, mostra também a cotação tipo "1 EUR = $1.0934". */
  showRate?: boolean
}

/**
 * Chip pequeno que indica o equivalente USD de uma transação em EUR/GBP.
 * Renderiza `null` quando a moeda já é USD (não há conversão a mostrar).
 *
 * Visualmente:
 *  - **Convertido**: `≈ $X.XX` em texto cinza-claro com ícone discreto.
 *  - **Pendente** (cotação não puxada ainda): `≈ aguardando $` em amber.
 */
export function UsdAmountChip({ transaction, size = 'xs', showRate = false }: Props) {
  if (transaction.currency === 'USD') return null
  const hasConversion =
    typeof transaction.usdAmount === 'number' && typeof transaction.usdRate === 'number'

  const baseCls =
    size === 'xs'
      ? 'text-[10px]'
      : 'text-[11px]'

  if (!hasConversion) {
    return (
      <div
        className={`mt-0.5 inline-flex items-center gap-1 font-mono tabular-nums text-amber-600 dark:text-amber-400 ${baseCls}`}
        title="Conversão pra USD pendente: recalculando…"
      >
        <span aria-hidden>≈</span>
        <span>aguardando $</span>
      </div>
    )
  }

  return (
    <div
      className={`mt-0.5 font-mono tabular-nums text-app-subtle ${baseCls}`}
      title={
        transaction.usdRate
          ? `Convertido pela cotação BCE de 1 ${transaction.currency} = ${transaction.usdRate.toFixed(4)} USD em ${transaction.usdRateDate ?? transaction.transactionDate}`
          : undefined
      }
    >
      <span aria-hidden>≈ </span>
      <span className="text-app-muted">{formatMoney(transaction.usdAmount!)}</span>
      {showRate && transaction.usdRate && (
        <span className="ml-1 text-app-subtle">
          · 1 {transaction.currency} = {transaction.usdRate.toFixed(4)}
        </span>
      )}
    </div>
  )
}
