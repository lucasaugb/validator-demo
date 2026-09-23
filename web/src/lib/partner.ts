/**
 * Classificação de Parceria (código do parceiro de indicação) do cliente, PURAMENTE VISUAL.
 *
 * O sistema lê a coluna `PartnerCode` do sistema de origem (gravada na transação como
 * `sourcePartnerCode` na validação) e classifica:
 *   - é um dos NOSSOS parcerias        → "Dentro da parceria"
 *   - tem parceria mas é de outro       → "Em outra parceria"
 *   - não tem parceria (orgânico/vazio) → "Sem parceria"
 *
 * "Fora da parceria" = qualquer coisa que NÃO seja o nosso ("Em outra parceria" + "Não
 * possui parceria"). Nada disso interfere em validação/ativação/comissão, é só
 * sinalização pra admin/super_admin.
 */

import type { Transaction } from '../types'

/** IDs dos nossas parcerias. Tudo fora disto é "fora da parceria". */
export const OUR_PARTNER_IDS = new Set(['90001', '90002'])

export type PartnerStatus = 'dentro' | 'outro' | 'nenhum'

export const partnerStatusLabel: Record<PartnerStatus, string> = {
  dentro: 'Dentro da parceria',
  outro: 'Em outra parceria',
  nenhum: 'Sem parceria',
}

/**
 * Status de parceria de uma transação. Só faz sentido pra `verified` (Validado
 * Sistema): pros demais retorna `null` (não classifica). Também retorna
 * `null` quando `sourcePartnerCode` ainda não foi populado (`undefined`),
 * pra não classificar errado transação pré-feature.
 */
export function partnerStatusOf(
  d: Pick<Transaction, 'systemValidation' | 'sourcePartnerCode'>,
): PartnerStatus | null {
  if (d.systemValidation !== 'verified') return null
  const raw = d.sourcePartnerCode
  if (raw === undefined) return null // ainda não consultado
  const v = (raw ?? '').toString().trim()
  if (!v) return 'nenhum'
  return OUR_PARTNER_IDS.has(v) ? 'dentro' : 'outro'
}

/** True quando a transação é verified e NÃO está no nossa parceria (outro ou nenhum). */
export function isOutsidePartner(
  d: Pick<Transaction, 'systemValidation' | 'sourcePartnerCode'>,
): boolean {
  const s = partnerStatusOf(d)
  return s === 'outro' || s === 'nenhum'
}
