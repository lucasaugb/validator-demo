import type { Currency, Transaction, Setor } from '../types'
import { finalStatus } from '../types'

/**
 * Regras de comissionamento (revisado em 2026-05-20):
 *
 * 1. Comissão é paga sobre transações `validated` (verified + approved).
 * 2. Para cada validado:
 *    a) **Bônus por ativação (escalonado, decisão 2026-07-21)**: sempre,
 *       independente da operação. O valor depende de quantos dias o cliente já
 *       estava na Premium/Starter (CRM) quando transacionou (`transactionDate −
 *       pipedriveDealAddTime`): ≤7d→$10, 8-15d→$7,50, 16-30d→$6, >30d ou fora
 *       do CRM→$5. Ver `activationBonusForTransaction`. Pago no **mês da transação**.
 *    b) **1% sobre o valor** transacionado:
 *       - Para transações comuns (não ativação): SEMPRE, pago no mês da transação.
 *       - Para ativações: SÓ se o cliente operou em data >= transactionDate
 *         (mesmo dia conta como elegível desde 2026-05-20). O 1% é pago no
 *         **mês da primeira operação**, não no mês da transação. Exemplo:
 *         ativação em abril, primeira operação em maio → $5 cai em abril,
 *         1% cai em maio. Ativação e operação no mesmo dia → tudo no mesmo mês.
 * 3. Quando `lastOperationDate` ainda não foi consultado (campo undefined no doc),
 *    a comissão fica em estado `pending_operation`, não é paga nem negada,
 *    mostra como "aguardando dado".
 * 4. Quando `lastOperationDate` é explicitamente null (source confirmou que o
 *    cliente nunca operou) ou é uma data < transactionDate, status `not_eligible`.
 *
 * `fixedPayoutMonth` e `percentagePayoutMonth` (yyyy-MM) carregam a atribuição
 * de cada componente: usados pelo `commissionByAgentForMonth` e pela tela de
 * Comissões Pendentes.
 */

/** Base/piso do bônus de ativação (e fallback quando não dá pra escalonar). */
export const ACTIVATION_FIXED_USD = 5
export const TRANSACTION_PCT = 0.01

/**
 * A partir de qual `transactionDate` a regra ESCALONADA de bônus vale (yyyy-mm-dd).
 * Registros com transação ANTES disso mantêm o bônus fixo histórico de $5, a
 * regra nova (2026-07-21) não reescreve competências anteriores. Usa
 * `transactionDate` (define a competência/mês de pagamento).
 */
export const ACTIVATION_TIERS_FROM = '2026-07-01'

/**
 * Dias que o cliente já estava na Premium/Starter (CRM) quando fez a transação de
 * ativação: `transactionDate − pipedriveDealAddTime` (data-a-data, UTC).
 *
 * Retorna `null` quando não dá pra calcular, sem `pipedriveDealAddTime`
 * (cliente fora do CRM / ainda não classificado) ou datas malformadas. O
 * chamador trata `null` como o tier base ($5).
 */
export function daysInTribeAtTransaction(d: Transaction): number | null {
  const add = d.pipedriveDealAddTime
  if (typeof add !== 'string' || !add) return null
  const addDate = add.slice(0, 10)
  const depDate = (d.transactionDate || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(addDate) || !/^\d{4}-\d{2}-\d{2}$/.test(depDate)) {
    return null
  }
  const [ay, am, ad] = addDate.split('-').map(Number)
  const [dy, dm, dd] = depDate.split('-').map(Number)
  const addUTC = Date.UTC(ay, am - 1, ad)
  const depUTC = Date.UTC(dy, dm - 1, dd)
  return Math.round((depUTC - addUTC) / 86_400_000)
}

/**
 * Bônus de ativação em USD, escalonado por `daysInTribeAtTransaction` (decisão
 * 2026-07-21). Quanto mais rápido o cliente ativa depois de entrar na
 * Premium/Starter, maior o bônus:
 *   - ≤ 7 dias  → $10
 *   - 8-15 dias → $7,50
 *   - 16-30 dias→ $6
 *   - > 30 dias → $5
 * Sem data de entrada no CRM (`null`) OU dias negativos (add_time posterior ao
 * transação: anomalia de dado) → $5 (base, conservador, nunca paga o teto por
 * dado ausente/estranho). NÃO checa `isActivation`, o chamador só usa isto
 * quando `isActivation` é true.
 */
export function activationBonusForTransaction(d: Transaction): number {
  // Corte por competência: transação anterior a ACTIVATION_TIERS_FROM mantém o
  // fixo histórico ($5). Não reescreve meses anteriores.
  if ((d.transactionDate || '').slice(0, 10) < ACTIVATION_TIERS_FROM) {
    return ACTIVATION_FIXED_USD
  }
  const days = daysInTribeAtTransaction(d)
  if (days === null || days < 0) return ACTIVATION_FIXED_USD
  if (days <= 7) return 10
  if (days <= 15) return 7.5
  if (days <= 30) return 6
  return 5
}

/**
 * Frase curta explicando POR QUE o bônus é aquele valor, fonte única pros
 * tooltips (tabela) e pro detalhe do registro, pra os textos não divergirem.
 */
export function activationBonusReason(d: Transaction): string {
  if ((d.transactionDate || '').slice(0, 10) < ACTIVATION_TIERS_FROM) {
    return 'regra fixa US$ 5 (registro anterior a 01/07/2026)'
  }
  const days = daysInTribeAtTransaction(d)
  if (days === null) return 'cliente fora do CRM, tier base US$ 5'
  if (days < 0) return 'entrada no CRM posterior ao registro, tier base US$ 5'
  return `cliente há ${days} dia${days === 1 ? '' : 's'} na Premium/Starter (≤7d=US$10, 8-15d=US$7,50, 16-30d=US$6, >30d=US$5)`
}

export type CommissionStatus =
  /** Comissão (1%) elegível e paga. */
  | 'eligible'
  /** Ativação aguardando dado de operação na source. */
  | 'pending_operation'
  /** Ativação onde cliente operou antes da transação ou não operou. */
  | 'not_eligible'
  /** Transação ainda não validated (verified + aprovado conversa). */
  | 'not_validated'

export interface TransactionCommission {
  /** Bônus de $5 USD por ativação (sempre pago se isActivation e validated). */
  fixedUsd: number
  /** Valor da % SEMPRE em USD, convertido com cotação do dia se a transação
   *  veio em EUR/GBP. 0 se não elegível. */
  percentage: number
  /** Mantido por compat: agora sempre 'USD' já que a % é convertida no cálculo. */
  currency: Currency
  /** Valor original da transação na moeda do registro (pré-conversão). Útil
   *  pra UI mostrar "1% sobre EUR X = USD Y". */
  rawAmount: number
  /** Cotação utilizada (1 unidade da moeda original = `usdRate` USD). 1 se USD. */
  usdRate: number
  /** Status detalhado da elegibilidade da %. */
  status: CommissionStatus
  /** Frase curta pra explicar o status (UI). */
  reason: string
  /**
   * Mês (yyyy-MM) em que o componente fixo ($5) é creditado. Igual ao mês do
   * `transactionDate` quando há fixed > 0; undefined quando não há fixed.
   */
  fixedPayoutMonth?: string
  /**
   * Mês (yyyy-MM) em que o componente percentual (1%) é creditado:
   *  - Transação comum: mês do `transactionDate`.
   *  - Ativação elegível: mês da `lastOperationDate` (primeira operação).
   *  - Ativação `pending_operation` ou `not_eligible`: undefined.
   */
  percentagePayoutMonth?: string
}

/**
 * Devolve o valor USD efetivo da transação pra fins de comissionamento.
 *
 * - Transação em USD: o próprio `amount`.
 * - Transação em EUR/GBP com conversão calculada: `usdAmount`.
 * - Transação em EUR/GBP sem conversão (cotação falhou ou doc legado): fallback
 *   pro `amount` face-value. Subdimensiona um pouco a comissão até a próxima
 *   edição recalcular: preferimos cobrir do que travar.
 */
export function effectiveUsdAmount(d: Transaction): number {
  if (d.currency === 'USD') return d.amount || 0
  if (typeof d.usdAmount === 'number') return d.usdAmount
  return d.amount || 0
}

export function effectiveUsdRate(d: Transaction): number {
  if (d.currency === 'USD') return 1
  if (typeof d.usdRate === 'number') return d.usdRate
  return 1
}

/**
 * Calcula comissão de uma única transação.
 *
 * `pending_operation` indica que o backend ainda não consultou
 * `last_operation_date`: a UI deve mostrar "aguardando" e o admin não deve
 * fechar comissionamento até resolver.
 */
export function commissionForTransaction(d: Transaction): TransactionCommission {
  const rate = effectiveUsdRate(d)
  const rawAmount = d.amount || 0
  const transactionMonth = (d.transactionDate || '').slice(0, 7) || undefined

  const base: TransactionCommission = {
    fixedUsd: 0,
    percentage: 0,
    currency: 'USD',
    rawAmount,
    usdRate: rate,
    status: 'not_validated',
    reason: 'Registro ainda não validado',
  }

  if (finalStatus(d) !== 'validated') return base

  // Ativação validada paga o bônus escalonado por dias na Premium/Starter
  // (≤7→$10, 8-15→$7,50, 16-30→$6, >30 ou fora do CRM→$5). Registro comum: 0.
  const fixedUsd = d.isActivation ? activationBonusForTransaction(d) : 0
  // 1% sobre o valor JÁ EM USD, converte EUR/GBP usando cotação do dia.
  const usdAmt = effectiveUsdAmount(d)
  const fullPct = usdAmt * TRANSACTION_PCT

  // Transação comum: 1% sempre, pago no mês da transação.
  if (!d.isActivation) {
    return {
      fixedUsd: 0,
      percentage: fullPct,
      currency: 'USD',
      rawAmount,
      usdRate: rate,
      status: 'eligible',
      reason: '1% sobre volume comum (USD)',
      percentagePayoutMonth: transactionMonth,
    }
  }

  // Ativação: $5 sempre cai no mês da transação.
  const fixedPayoutMonth = fixedUsd > 0 ? transactionMonth : undefined

  // 1% depende de operação posterior: e cai no mês da primeira operação.
  const elig = activationEligibility(d)
  if (elig.status === 'eligible') {
    const opMonth = String(d.lastOperationDate ?? '').slice(0, 7) || undefined
    return {
      fixedUsd,
      percentage: fullPct,
      currency: 'USD',
      rawAmount,
      usdRate: rate,
      status: 'eligible',
      reason: elig.reason,
      fixedPayoutMonth,
      percentagePayoutMonth: opMonth,
    }
  }
  return {
    fixedUsd,
    percentage: 0,
    currency: 'USD',
    rawAmount,
    usdRate: rate,
    status: elig.status,
    reason: elig.reason,
    fixedPayoutMonth,
    // percentagePayoutMonth indefinido: pending ou not_eligible
  }
}

interface Eligibility {
  status: CommissionStatus
  reason: string
}

function activationEligibility(d: Transaction): Eligibility {
  const lod = d.lastOperationDate
  if (lod === undefined) {
    return {
      status: 'pending_operation',
      reason: 'Aguardando dado de operação do sistema de origem',
    }
  }
  if (lod === null) {
    return {
      status: 'not_eligible',
      reason: 'Cliente nunca operou após a ativação',
    }
  }
  // Compara apenas a parte de data (yyyy-mm-dd).
  // Decisão 2026-05-20: operar NO MESMO DIA da transação conta como elegível
  // (`>=` em vez de `>`). Antes a regra era estrita: o cliente precisava
  // operar a partir do dia seguinte, bloqueava ativações legítimas onde o
  // cliente transactionava de manhã e operava à tarde.
  const opDate = String(lod).slice(0, 10)
  if (opDate >= d.transactionDate) {
    const sameDay = opDate === d.transactionDate
    return {
      status: 'eligible',
      reason: sameDay
        ? `Operou no mesmo dia (${opDate})`
        : `Operou em ${opDate} (após o registro de ${d.transactionDate})`,
    }
  }
  return {
    status: 'not_eligible',
    reason: `Última operação em ${opDate}, antes do registro (${d.transactionDate})`,
  }
}

/* -------------------------------------------------------------------------- */
/* Agregações                                                                  */
/* -------------------------------------------------------------------------- */

export interface CurrencyAmounts {
  USD: number
  EUR: number
  GBP: number
}

const emptyAmounts = (): CurrencyAmounts => ({ USD: 0, EUR: 0, GBP: 0 })

export interface AgentCommission {
  agenteId: string
  agenteName: string
  setor?: Setor

  /** Quantos transações validadas do agente. */
  validatedTransactions: number
  /** Quantas dessas validações foram ativações. */
  activations: number
  /** Quantas ativações ainda aguardam confirmação de operação. */
  activationsPendingOperation: number
  /** Quantas ativações foram desclassificadas pela regra de operação. */
  activationsNotEligible: number

  /** Bônus fixo total ($5 × ativações elegíveis para o fixo). */
  fixedUsd: number
  /** Valor consolidado da % por moeda, somando o que foi elegível. */
  percentageByCurrency: CurrencyAmounts
  /** Valor da % "represada" (em pending_operation) por moeda. */
  pendingByCurrency: CurrencyAmounts
  /** Valor da % perdida por não-elegibilidade, por moeda. */
  notEligibleByCurrency: CurrencyAmounts

  /** Total "pronto pra pagar" simplificado em USD-equivalente (soma bruta sem câmbio). */
  payableRawTotal: number
  /** Linhas detalhadas por transação, ordenadas por data. */
  rows: AgentCommissionRow[]
}

export interface AgentCommissionRow {
  transaction: Transaction
  commission: TransactionCommission
}

export function commissionByAgent(transactions: Transaction[]): AgentCommission[] {
  const map = new Map<string, AgentCommission>()

  for (const d of transactions) {
    const c = commissionForTransaction(d)
    // Linhas só pra transactions validated: não polui a tabela com pending genérico.
    if (c.status === 'not_validated') continue

    const cur =
      map.get(d.agenteId) ??
      ({
        agenteId: d.agenteId,
        agenteName: d.agenteName,
        setor: d.agenteSetor,
        validatedTransactions: 0,
        activations: 0,
        activationsPendingOperation: 0,
        activationsNotEligible: 0,
        fixedUsd: 0,
        percentageByCurrency: emptyAmounts(),
        pendingByCurrency: emptyAmounts(),
        notEligibleByCurrency: emptyAmounts(),
        payableRawTotal: 0,
        rows: [],
      } satisfies AgentCommission)

    cur.validatedTransactions += 1
    if (d.isActivation) cur.activations += 1

    cur.fixedUsd += c.fixedUsd

    // Tudo agregado em `percentageByCurrency.USD` agora, transações em EUR/GBP
    // já foram convertidos via `effectiveUsdAmount(d)` em commissionForTransaction.
    if (c.status === 'eligible') {
      cur.percentageByCurrency.USD += c.percentage
    } else if (c.status === 'pending_operation') {
      cur.activationsPendingOperation += 1
      cur.pendingByCurrency.USD += effectiveUsdAmount(d) * TRANSACTION_PCT
    } else if (c.status === 'not_eligible') {
      cur.activationsNotEligible += 1
      cur.notEligibleByCurrency.USD += effectiveUsdAmount(d) * TRANSACTION_PCT
    }

    cur.rows.push({ transaction: d, commission: c })
    map.set(d.agenteId, cur)
  }

  // Ordena rows por data desc + computa total bruto pra ranking
  for (const a of map.values()) {
    a.rows.sort((x, y) => (y.transaction.transactionDate.localeCompare(x.transaction.transactionDate)))
    a.payableRawTotal =
      a.fixedUsd +
      a.percentageByCurrency.USD +
      a.percentageByCurrency.EUR +
      a.percentageByCurrency.GBP
  }

  return Array.from(map.values()).sort(
    (a, b) => b.payableRawTotal - a.payableRawTotal,
  )
}

/**
 * Variação de `commissionByAgent` que atribui cada componente ao **mês de
 * pagamento**, não ao mês do `transactionDate`.
 *
 * Diferença essencial: pra ativações com operação posterior, o 1% migra pro
 * mês da `lastOperationDate`. Exemplo: ativação em 2026-04-28, primeira op em
 * 2026-05-03 → $5 cai em abril, 1% cai em maio.
 *
 * Recebe `allTransactions` (sem pré-filtro de mês) porque precisa olhar transações
 * de meses anteriores cujo 1% só "vence" agora (lastOperationDate no mês).
 *
 * - `validatedTransactions` / `activations` contam transações com `transactionDate` no
 *   mês: visão de "transações do mês".
 * - `fixedUsd` soma $5 de ativações com transactionDate no mês.
 * - `percentageByCurrency.USD` soma 1% atribuível ao mês (comuns do mês +
 *   ativações com operação no mês).
 * - `pendingByCurrency.USD` represa o 1% das ativações DO MÊS que ainda não
 *   confirmaram operação: bloqueia fechamento desse mês.
 * - `notEligibleByCurrency.USD` registra 1% perdido de ativações DO MÊS.
 * - `rows` inclui qualquer transação que contribui pra este mês (incluindo
 *   ativações de meses anteriores cuja operação caiu aqui).
 */
export function commissionByAgentForMonth(
  allTransactions: Transaction[],
  yearMonth: string,
): AgentCommission[] {
  const map = new Map<string, AgentCommission>()

  for (const d of allTransactions) {
    const c = commissionForTransaction(d)
    if (c.status === 'not_validated') continue

    const depMonth = (d.transactionDate || '').slice(0, 7)
    const isThisMonthTransaction = depMonth === yearMonth
    const fixedHitsMonth = c.fixedPayoutMonth === yearMonth && c.fixedUsd > 0
    const pctHitsMonth = c.percentagePayoutMonth === yearMonth && c.percentage > 0

    // Pending/not_eligible só representam "1% que devia ter pago neste mês"
    // quando a ativação É deste mês. Ativação de mês anterior com pending
    // ainda represa, mas pertence ao mês original.
    const blockingForThisMonth =
      isThisMonthTransaction &&
      d.isActivation &&
      (c.status === 'pending_operation' || c.status === 'not_eligible')

    if (!isThisMonthTransaction && !fixedHitsMonth && !pctHitsMonth && !blockingForThisMonth) {
      continue
    }

    const cur =
      map.get(d.agenteId) ??
      ({
        agenteId: d.agenteId,
        agenteName: d.agenteName,
        setor: d.agenteSetor,
        validatedTransactions: 0,
        activations: 0,
        activationsPendingOperation: 0,
        activationsNotEligible: 0,
        fixedUsd: 0,
        percentageByCurrency: emptyAmounts(),
        pendingByCurrency: emptyAmounts(),
        notEligibleByCurrency: emptyAmounts(),
        payableRawTotal: 0,
        rows: [],
      } satisfies AgentCommission)

    // Contagens "do mês" baseadas em transactionDate (visão transacional).
    if (isThisMonthTransaction) {
      cur.validatedTransactions += 1
      if (d.isActivation) cur.activations += 1
    }

    if (fixedHitsMonth) cur.fixedUsd += c.fixedUsd
    if (pctHitsMonth) cur.percentageByCurrency.USD += c.percentage

    if (isThisMonthTransaction && d.isActivation) {
      if (c.status === 'pending_operation') {
        cur.activationsPendingOperation += 1
        cur.pendingByCurrency.USD += effectiveUsdAmount(d) * TRANSACTION_PCT
      } else if (c.status === 'not_eligible') {
        cur.activationsNotEligible += 1
        cur.notEligibleByCurrency.USD += effectiveUsdAmount(d) * TRANSACTION_PCT
      }
    }

    cur.rows.push({ transaction: d, commission: c })
    map.set(d.agenteId, cur)
  }

  for (const a of map.values()) {
    a.rows.sort((x, y) => y.transaction.transactionDate.localeCompare(x.transaction.transactionDate))
    a.payableRawTotal =
      a.fixedUsd +
      a.percentageByCurrency.USD +
      a.percentageByCurrency.EUR +
      a.percentageByCurrency.GBP
  }

  return Array.from(map.values()).sort(
    (a, b) => b.payableRawTotal - a.payableRawTotal,
  )
}

/**
 * Decompõe o 1% (USD) creditado a um mês (mês de pagamento) em duas parcelas:
 *  - `pctThisMonthUsd`: 1% de registros cujo `transactionDate` é DO próprio mês.
 *  - `pctCarryoverUsd`: 1% de ativações de meses ANTERIORES cuja 1ª operação
 *    (`lastOperationDate`) caiu neste mês: "ativou antes, operou agora".
 *
 * Soma das duas = `percentageByCurrency.USD` de `commissionByAgentForMonth`
 * para o mesmo escopo/mês. Serve pra UI deixar explícito quanto do pagamento
 * do mês veio de carry-over de outros meses.
 *
 * Recebe `allTransactions` sem pré-filtro de mês (precisa enxergar meses anteriores).
 */
export interface MonthlyPayoutSplit {
  pctThisMonthUsd: number
  pctCarryoverUsd: number
  /** Quantos registros de outros meses contribuíram (ativações que operaram agora). */
  carryoverCount: number
}

export function monthlyPayoutSplit(
  allTransactions: Transaction[],
  yearMonth: string,
): MonthlyPayoutSplit {
  let pctThisMonthUsd = 0
  let pctCarryoverUsd = 0
  let carryoverCount = 0
  for (const d of allTransactions) {
    const c = commissionForTransaction(d)
    // Só 1% elegível efetivamente creditado a ESTE mês de pagamento.
    if (c.status !== 'eligible' || c.percentage <= 0) continue
    if (c.percentagePayoutMonth !== yearMonth) continue
    const depMonth = (d.transactionDate || '').slice(0, 7)
    if (depMonth === yearMonth) {
      pctThisMonthUsd += c.percentage
    } else {
      pctCarryoverUsd += c.percentage
      carryoverCount += 1
    }
  }
  return { pctThisMonthUsd, pctCarryoverUsd, carryoverCount }
}

/* -------------------------------------------------------------------------- */
/* Comissões Pendentes: pra tela de tracking de 1% após ativação              */
/* -------------------------------------------------------------------------- */

export type PendingCommissionStatus =
  /** Ativação validada, cliente ainda não operou → 1% represado, aguardando. */
  | 'awaiting'
  /** Cliente operou após transação → 1% já creditado em mês específico. */
  | 'paid'
  /** Cliente já operava ANTES do registro → 1% da ativação genuinamente perdido.
   *  (O caso "ainda não operou": lastOperationDate null, entra em `awaiting`.) */
  | 'lost'

export interface PendingCommissionRow {
  transaction: Transaction
  /** Mês do $5: sempre o mês da transação quando há fixedUsd > 0. */
  fixedPayoutMonth?: string
  /** Mês do 1%: definido quando `paid`; ausente em `awaiting`/`lost`. */
  percentagePayoutMonth?: string
  /** Valor estimado do 1% em USD (sempre, mostra mesmo represado/perdido). */
  pctEstimateUsd: number
  status: PendingCommissionStatus
  /** Frase curta pra UI ("Aguardando primeira operação", "Operou em 03/05/2026", etc.). */
  reason: string
}

/**
 * Lista ativações validadas com a situação do 1% após ativação, base da
 * tela "Comissões Pendentes". Inclui as três situações (`awaiting`, `paid`,
 * `lost`) pra o usuário acompanhar o histórico de cada ativação.
 */
export function pendingCommissionRows(transactions: Transaction[]): PendingCommissionRow[] {
  const out: PendingCommissionRow[] = []
  for (const d of transactions) {
    if (!d.isActivation) continue
    if (finalStatus(d) !== 'validated') continue
    const c = commissionForTransaction(d)
    const pctEstimateUsd = effectiveUsdAmount(d) * TRANSACTION_PCT

    if (c.status === 'eligible' && c.percentagePayoutMonth) {
      out.push({
        transaction: d,
        fixedPayoutMonth: c.fixedPayoutMonth,
        percentagePayoutMonth: c.percentagePayoutMonth,
        pctEstimateUsd: c.percentage,
        status: 'paid',
        reason: c.reason,
      })
    } else if (c.status === 'pending_operation') {
      out.push({
        transaction: d,
        fixedPayoutMonth: c.fixedPayoutMonth,
        pctEstimateUsd,
        status: 'awaiting',
        reason: c.reason,
      })
    } else if (c.status === 'not_eligible') {
      // `not_eligible` cobre DOIS casos reais bem diferentes:
      //   1. `lastOperationDate === null` → a source já foi consultada e o
      //      cliente AINDA NÃO operou. Esse é o caso COMUM de ativação recente:
      //      o 1% fica represado e o pass diário re-checa até o cliente operar.
      //      Pra esta tela isso é "Aguardando 1ª operação", NÃO perda.
      //   2. Uma data real anterior ao registro → o cliente já operava antes da
      //      ativação. Aí sim o 1% da ativação é genuinamente perdido.
      // (undefined cai no ramo `pending_operation` acima, nem deu pra consultar.)
      const neverOperated = d.lastOperationDate === null
      out.push({
        transaction: d,
        fixedPayoutMonth: c.fixedPayoutMonth,
        pctEstimateUsd,
        status: neverOperated ? 'awaiting' : 'lost',
        reason: neverOperated
          ? 'Ativação validada: cliente ainda não fez a primeira operação'
          : c.reason,
      })
    }
  }
  // Ordena: aguardando primeiro (urgente), depois pagos (recentes), por fim perdidos.
  const order: Record<PendingCommissionStatus, number> = {
    awaiting: 0,
    paid: 1,
    lost: 2,
  }
  out.sort((a, b) => {
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status]
    return b.transaction.transactionDate.localeCompare(a.transaction.transactionDate)
  })
  return out
}

/**
 * Resumo global da operação: pro card no dashboard admin.
 */
export interface GlobalCommissionSummary {
  fixedUsdTotal: number
  percentageByCurrency: CurrencyAmounts
  pendingByCurrency: CurrencyAmounts
  notEligibleByCurrency: CurrencyAmounts
  activations: number
  activationsPendingOperation: number
  activationsNotEligible: number
  validatedTransactions: number
  agentsWithCommission: number
  payableRawTotal: number
}

/**
 * Série mensal de comissões pra gráfico de comparativo histórico. Itera os
 * últimos `months` meses (incluindo o atual) e agrega comissão pra cada um.
 *
 * Cada ponto inclui o total a pagar (USD-equivalente face-value), o $5
 * acumulado e a % por moeda agregada.
 */
export interface MonthlyCommissionPoint {
  /** yyyy-MM */
  month: string
  /** Label curta tipo "Mai" */
  shortLabel: string
  /** Label longa tipo "Maio 2026" */
  longLabel: string
  /** Soma bruta USD+EUR+GBP face-value */
  payableRawTotal: number
  fixedUsd: number
  percentageUsdEquivalent: number
  /** Número de ativações validadas no mês */
  activations: number
  /** Transações validadas no mês */
  validatedTransactions: number
}

const MONTH_LABELS_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const MONTH_LABELS_LONG = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

/**
 * Granularidade da série de comissão pro gráfico (botão Dia/Mês/Ano).
 */
export type CommissionGranularity = 'day' | 'month' | 'year'

export interface CommissionSeriesPoint {
  bucket: string
  shortLabel: string
  longLabel: string
  payableRawTotal: number
  fixedUsd: number
  percentageUsdEquivalent: number
  activations: number
  validatedTransactions: number
}

const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export function dailyCommissionSeries(
  transactions: Transaction[],
  days = 30,
): CommissionSeriesPoint[] {
  const out: CommissionSeriesPoint[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const y = d.getFullYear()
    const m = d.getMonth() + 1
    const day = d.getDate()
    const bucket = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const dayTransactions = transactions.filter((dep) => dep.transactionDate === bucket)
    const summary = globalCommissionSummary(commissionByAgent(dayTransactions))
    out.push({
      bucket,
      shortLabel: `${String(day).padStart(2, '0')}/${String(m).padStart(2, '0')}`,
      longLabel: `${WEEKDAY_SHORT[d.getDay()]} ${String(day).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`,
      payableRawTotal: summary.payableRawTotal,
      fixedUsd: summary.fixedUsdTotal,
      percentageUsdEquivalent:
        summary.percentageByCurrency.USD +
        summary.percentageByCurrency.EUR +
        summary.percentageByCurrency.GBP,
      activations: summary.activations,
      validatedTransactions: summary.validatedTransactions,
    })
  }
  return out
}

export function yearlyCommissionSeries(
  transactions: Transaction[],
  years = 5,
): CommissionSeriesPoint[] {
  const out: CommissionSeriesPoint[] = []
  const now = new Date()
  for (let i = years - 1; i >= 0; i--) {
    const y = now.getFullYear() - i
    const yearTransactions = transactions.filter((d) => {
      const [dy] = d.transactionDate.split('-').map(Number)
      return dy === y
    })
    const summary = globalCommissionSummary(commissionByAgent(yearTransactions))
    out.push({
      bucket: String(y),
      shortLabel: String(y),
      longLabel: `Ano ${y}`,
      payableRawTotal: summary.payableRawTotal,
      fixedUsd: summary.fixedUsdTotal,
      percentageUsdEquivalent:
        summary.percentageByCurrency.USD +
        summary.percentageByCurrency.EUR +
        summary.percentageByCurrency.GBP,
      activations: summary.activations,
      validatedTransactions: summary.validatedTransactions,
    })
  }
  return out
}

export function monthlyCommissionSeries(
  transactions: Transaction[],
  months = 12,
): MonthlyCommissionPoint[] {
  const now = new Date()
  const series: MonthlyCommissionPoint[] = []

  for (let i = months - 1; i >= 0; i--) {
    const ref = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const y = ref.getFullYear()
    const m = ref.getMonth() // 0-indexed
    const monthKey = `${y}-${String(m + 1).padStart(2, '0')}`
    const monthTransactions = transactions.filter((d) => {
      const [dy, dm] = d.transactionDate.split('-').map(Number)
      return dy === y && dm === m + 1
    })
    const byAgent = commissionByAgent(monthTransactions)
    const summary = globalCommissionSummary(byAgent)
    series.push({
      month: monthKey,
      shortLabel: MONTH_LABELS_SHORT[m],
      longLabel: `${MONTH_LABELS_LONG[m]} ${y}`,
      payableRawTotal: summary.payableRawTotal,
      fixedUsd: summary.fixedUsdTotal,
      percentageUsdEquivalent:
        summary.percentageByCurrency.USD +
        summary.percentageByCurrency.EUR +
        summary.percentageByCurrency.GBP,
      activations: summary.activations,
      validatedTransactions: summary.validatedTransactions,
    })
  }
  return series
}

/**
 * Comissão agregada por setor: comparativo pra o admin.
 */
export interface SetorCommissionRow {
  setor: Setor | 'sem_setor'
  label: string
  fixedUsd: number
  percentageByCurrency: CurrencyAmounts
  pendingByCurrency: CurrencyAmounts
  notEligibleByCurrency: CurrencyAmounts
  activations: number
  validatedTransactions: number
  payableRawTotal: number
  agentsCount: number
}

const SETOR_LABEL_FALLBACK: Record<string, string> = {
  premium: 'Premium',
  starter: 'Starter',
  eventos: 'Eventos',
  online: 'Online',
  sem_setor: 'Sem setor',
}

export function commissionBySetor(transactions: Transaction[]): SetorCommissionRow[] {
  // Agrupa transactions por setor
  const groups = new Map<string, Transaction[]>()
  for (const d of transactions) {
    const key = d.agenteSetor ?? 'sem_setor'
    const arr = groups.get(key) ?? []
    arr.push(d)
    groups.set(key, arr)
  }

  const out: SetorCommissionRow[] = []
  for (const [setor, list] of groups) {
    const byAgent = commissionByAgent(list)
    const summary = globalCommissionSummary(byAgent)
    out.push({
      setor: setor as Setor | 'sem_setor',
      label: SETOR_LABEL_FALLBACK[setor] ?? setor,
      fixedUsd: summary.fixedUsdTotal,
      percentageByCurrency: summary.percentageByCurrency,
      pendingByCurrency: summary.pendingByCurrency,
      notEligibleByCurrency: summary.notEligibleByCurrency,
      activations: summary.activations,
      validatedTransactions: summary.validatedTransactions,
      payableRawTotal: summary.payableRawTotal,
      agentsCount: byAgent.length,
    })
  }
  return out.sort((a, b) => b.payableRawTotal - a.payableRawTotal)
}

/**
 * Versão de `commissionBySetor` na base de MÊS DE PAGAMENTO, usa
 * `commissionByAgentForMonth` por setor, então o total por setor bate com o
 * que a tela Fechamento paga naquele mês (inclui carry-over de outros meses).
 *
 * Recebe `allTransactions` sem pré-filtro de mês.
 */
export function commissionBySetorForMonth(
  allTransactions: Transaction[],
  yearMonth: string,
): SetorCommissionRow[] {
  const groups = new Map<string, Transaction[]>()
  for (const d of allTransactions) {
    const key = d.agenteSetor ?? 'sem_setor'
    const arr = groups.get(key) ?? []
    arr.push(d)
    groups.set(key, arr)
  }

  const out: SetorCommissionRow[] = []
  for (const [setor, list] of groups) {
    const byAgent = commissionByAgentForMonth(list, yearMonth)
    const summary = globalCommissionSummary(byAgent)
    // Setor sem nenhuma comissão atribuída ao mês não vira linha.
    if (summary.payableRawTotal === 0 && summary.validatedTransactions === 0) continue
    out.push({
      setor: setor as Setor | 'sem_setor',
      label: SETOR_LABEL_FALLBACK[setor] ?? setor,
      fixedUsd: summary.fixedUsdTotal,
      percentageByCurrency: summary.percentageByCurrency,
      pendingByCurrency: summary.pendingByCurrency,
      notEligibleByCurrency: summary.notEligibleByCurrency,
      activations: summary.activations,
      validatedTransactions: summary.validatedTransactions,
      payableRawTotal: summary.payableRawTotal,
      agentsCount: byAgent.length,
    })
  }
  return out.sort((a, b) => b.payableRawTotal - a.payableRawTotal)
}

export function globalCommissionSummary(
  byAgent: AgentCommission[],
): GlobalCommissionSummary {
  const summary: GlobalCommissionSummary = {
    fixedUsdTotal: 0,
    percentageByCurrency: emptyAmounts(),
    pendingByCurrency: emptyAmounts(),
    notEligibleByCurrency: emptyAmounts(),
    activations: 0,
    activationsPendingOperation: 0,
    activationsNotEligible: 0,
    validatedTransactions: 0,
    agentsWithCommission: 0,
    payableRawTotal: 0,
  }
  for (const a of byAgent) {
    summary.fixedUsdTotal += a.fixedUsd
    summary.validatedTransactions += a.validatedTransactions
    summary.activations += a.activations
    summary.activationsPendingOperation += a.activationsPendingOperation
    summary.activationsNotEligible += a.activationsNotEligible
    summary.payableRawTotal += a.payableRawTotal
    if (a.validatedTransactions > 0) summary.agentsWithCommission += 1
    for (const c of ['USD', 'EUR', 'GBP'] as Currency[]) {
      summary.percentageByCurrency[c] += a.percentageByCurrency[c]
      summary.pendingByCurrency[c] += a.pendingByCurrency[c]
      summary.notEligibleByCurrency[c] += a.notEligibleByCurrency[c]
    }
  }
  return summary
}
