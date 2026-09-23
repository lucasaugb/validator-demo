import { useEffect, useRef } from 'react'
import type { Transaction } from '../types'
import { recalcUsdConversion } from './transactions'

/**
 * Auto-recalcula a conversão USD pra transações não-USD que estão sem `usdAmount`.
 *
 * Quando você abre a aplicação e a lista de transações é carregada, esse hook
 * varre os documentos órfãos (cotação falhou na criação ou doc é pré-feature),
 * consulta a cotação BCE do dia e patcha o Firestore, sem intervenção manual.
 *
 * Garantias:
 *  - **Idempotente**: cada (agenteId+transactionId) é processado no máximo uma vez
 *    por sessão. Mesmo se a lista de transactions atualizar em realtime, não dispara
 *    de novo (set in-memory).
 *  - **Cooperativo**: processa em chunks de 3 paralelas pra não saturar a API
 *    Frankfurter (rate limit informal de "fair use") nem gerar 100 writes
 *    simultâneos no Firestore.
 *  - **Resiliente**: falhas individuais são logadas mas não bloqueiam o resto.
 *    O documento fica órfão e o admin ainda pode usar o botão "Puxar cotação"
 *    no modal de detalhes pra forçar.
 */
export function useAutoFxConversion(transactions: Transaction[]): void {
  // Mantém os IDs que já tentamos nessa sessão (sucesso OU falha), evita
  // ficar martelando a API se a cotação não veio.
  const processedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const orphans = transactions.filter(
      (d) =>
        d.currency !== 'USD' &&
        typeof d.usdAmount !== 'number' &&
        !processedRef.current.has(d.id),
    )
    if (orphans.length === 0) return

    // Marca como processado ANTES de chamar, evita reentrância se o snapshot
    // do Firestore re-emitir antes do update propagar.
    for (const o of orphans) processedRef.current.add(o.id)

    void runInChunks(orphans, 3, async (d) => {
      try {
        const ok = await recalcUsdConversion(d)
        if (!ok) {
          console.warn(
            `[useAutoFxConversion] cotação falhou para ${d.id} (${d.currency} em ${d.transactionDate})`,
          )
        }
      } catch (err) {
        console.error(`[useAutoFxConversion] update falhou para ${d.id}:`, err)
      }
    })
  }, [transactions])
}

async function runInChunks<T>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn))
  }
}
