/**
 * Classificação Premium/Starter do cliente vinda do CRM (Pipedrive), espelhado no
 * BigQuery em `crm-demo-project.Pipedrive_gcf.deals_all_primary`.
 *
 * O backend (validate.py / functions/main.py) bate `clientEmail` OU
 * `clientPhone` do registro contra `person_email`/`person_phone`, resolve
 * duplicidade pelo `add_time` mais recente e grava `pipedriveTribe` no doc:
 *   - `PRM` → 'premium'  (produto mais caro)
 *   - `STR` → 'starter' (entrada mais barata)
 *   - sem match → 'nao_encontrado'
 *
 * PURAMENTE INFORMATIVO por enquanto (Passo 1: só a tag). A nova regra de
 * comissão (Passo 2) vai usar essa mesma classificação.
 *
 * ⚠️ NÃO confundir com o SETOR Premium/Starter do gestor (SetorBadge), aqui é o
 * PRODUTO que o CLIENTE comprou, não o time de quem registrou.
 */

import type { Transaction } from '../types'

export type TribeMembership = 'premium' | 'starter'
export type TribeClassification = TribeMembership | 'nao_encontrado'

export const tribeLabel: Record<TribeClassification, string> = {
  premium: 'Premium',
  starter: 'Starter',
  nao_encontrado: 'Não encontrado',
}

/**
 * Classificação de um registro, ou `null` quando ainda não foi consultada
 * (`pipedriveTribe` undefined: doc pré-feature ou sem acesso ao CRM). A UI
 * não mostra tag nesse caso, pra não confundir "não consultado" com "não
 * encontrado no CRM".
 */
export function tribeOf(
  d: Pick<Transaction, 'pipedriveTribe'>,
): TribeClassification | null {
  const v = d.pipedriveTribe
  if (v === 'premium' || v === 'starter' || v === 'nao_encontrado') return v
  return null
}
