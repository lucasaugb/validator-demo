import { SETORES, finalStatus, setorLabel } from '../types'
import type { Currency, Transaction, Role, Setor } from '../types'
import { countryByDial, countryByIso, parsePhone } from './countries'
import {
  commissionByAgent,
  commissionForTransaction,
  effectiveUsdAmount,
} from './commission'

export function isThisMonth(iso: string): boolean {
  const [y, m] = iso.split('-').map(Number)
  const now = new Date()
  return y === now.getFullYear() && m === now.getMonth() + 1
}

export function isLastMonth(iso: string): boolean {
  const [y, m] = iso.split('-').map(Number)
  const now = new Date()
  const cur = now.getMonth() + 1
  const curY = now.getFullYear()
  const prevM = cur === 1 ? 12 : cur - 1
  const prevY = cur === 1 ? curY - 1 : curY
  return y === prevY && m === prevM
}

export function isInLastDays(iso: string, days: number): boolean {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = (today.getTime() - dt.getTime()) / 86_400_000
  return diff >= 0 && diff < days
}

export type CurrencyTotals = Record<Currency, number>

const emptyTotals = (): CurrencyTotals => ({ USD: 0, EUR: 0, GBP: 0 })

export interface AggregateMetrics {
  total: number
  verified: number
  invalid: number
  duplicate: number
  systemPending: number
  conversationPending: number
  approved: number
  rejected: number
  /** Transações com conversation=rejected mas system NÃO inválido (já contado em invalid). */
  rejectedOnly: number
  /** Validados de verdade: system=verified + conversation=approved. */
  validated: number
  activations: number
  totalByCurrency: CurrencyTotals
  /** Soma de transações system=verified (independente da conversa). */
  verifiedByCurrency: CurrencyTotals
  /** Soma das transações validadas (system=verified + conversation=approved). */
  validatedByCurrency: CurrencyTotals
  /** Soma das transações pendentes: nem validados, nem inválidos, nem rejeitados. */
  pendingByCurrency: CurrencyTotals
  /** Ativações com finalStatus=validated (sistema verified + conversa approved).
   *  Distinto de `activations`, que conta system-verified + isActivation
   *  independente da conversa. Usado pelas métricas analíticas (SETORES, etc.)
   *  que seguem o princípio "só conta validados". */
  validatedActivations: number
  /** Soma dos invalid + duplicate (decisão automática negativa). */
  invalidByCurrency: CurrencyTotals
  /** Soma das transações com conversa rejeitada e system não inválido. */
  rejectedByCurrency: CurrencyTotals
}

const emptyMetrics = (): AggregateMetrics => ({
  total: 0,
  verified: 0,
  invalid: 0,
  duplicate: 0,
  systemPending: 0,
  conversationPending: 0,
  approved: 0,
  rejected: 0,
  rejectedOnly: 0,
  validated: 0,
  activations: 0,
  totalByCurrency: emptyTotals(),
  verifiedByCurrency: emptyTotals(),
  validatedByCurrency: emptyTotals(),
  pendingByCurrency: emptyTotals(),
  invalidByCurrency: emptyTotals(),
  rejectedByCurrency: emptyTotals(),
  validatedActivations: 0,
})

/**
 * Particiona cada transação em UM de: validated | invalid | rejected | pending.
 *
 * Regra (mutuamente exclusivas):
 *   - validated: system=verified AND conversation=approved
 *   - invalid:   system=invalid OR system=duplicate (independente da conversa)
 *   - rejected:  conversation=rejected AND NOT invalid
 *   - pending:   resto
 *
 * Os _by-currency_ refletem essa partição: `totalByCurrency` é a soma de todas
 * as 4 buckets, então `validated + invalid + rejected + pending = total` SEMPRE.
 */
function tally(m: AggregateMetrics, d: Transaction) {
  m.total += 1
  const amt = d.amount || 0
  m.totalByCurrency[d.currency] += amt
  if (d.systemValidation === 'verified') {
    m.verified += 1
    m.verifiedByCurrency[d.currency] += amt
    if (d.isActivation) m.activations += 1
  } else if (d.systemValidation === 'invalid') m.invalid += 1
  else if (d.systemValidation === 'duplicate') {
    m.duplicate += 1
    m.invalid += 1
  } else m.systemPending += 1

  if (d.conversationValidation === 'approved') m.approved += 1
  else if (d.conversationValidation === 'rejected') m.rejected += 1
  else m.conversationPending += 1

  const isInvalid =
    d.systemValidation === 'invalid' || d.systemValidation === 'duplicate'
  const isRejectedOnly = !isInvalid && d.conversationValidation === 'rejected'
  const isFinalValidated =
    d.systemValidation === 'verified' && d.conversationValidation === 'approved'

  if (isFinalValidated) {
    m.validated += 1
    m.validatedByCurrency[d.currency] += amt
    if (d.isActivation) m.validatedActivations += 1
  } else if (isInvalid) {
    m.invalidByCurrency[d.currency] += amt
  } else if (isRejectedOnly) {
    m.rejectedOnly += 1
    m.rejectedByCurrency[d.currency] += amt
  } else {
    m.pendingByCurrency[d.currency] += amt
  }
}

export function aggregate(transactions: Transaction[]): AggregateMetrics {
  const m = emptyMetrics()
  for (const d of transactions) tally(m, d)
  return m
}

export interface SetorBreakdown {
  setor: Setor | 'sem_setor'
  label: string
  metrics: AggregateMetrics
  conversionRate: number // verified / total decided
  activationRate: number // activations / verified
}

export function bySetor(transactions: Transaction[]): SetorBreakdown[] {
  const buckets = new Map<string, AggregateMetrics>()
  for (const setor of SETORES) buckets.set(setor, emptyMetrics())
  buckets.set('sem_setor', emptyMetrics())

  for (const d of transactions) {
    const key = d.agenteSetor ?? 'sem_setor'
    const m = buckets.get(key) ?? emptyMetrics()
    tally(m, d)
    buckets.set(key, m)
  }

  const build = (setor: Setor | 'sem_setor', label: string): SetorBreakdown => {
    const m = buckets.get(setor)!
    // Conversão e ativações agora usam o critério ESTRITO (finalStatus
    // validated = system verified + conversa approved). Memo
    // [[feedback-metrics-validated-only]]: métricas analíticas só contam
    // validados. (#bug 2026-05-26: a coluna mostrava verified do sistema,
    // empurrando o número pra cima vs. o que vira comissão de verdade.)
    // `decided` aqui = validados + rejeitados-final = total - pending.
    const finalRejected = m.invalid + m.rejectedOnly
    const decided = m.validated + finalRejected
    const conversionRate = decided > 0 ? m.validated / decided : 0
    const activationRate =
      m.validated > 0 ? m.validatedActivations / m.validated : 0
    return { setor, label, metrics: m, conversionRate, activationRate }
  }

  const result: SetorBreakdown[] = SETORES.map((s) => build(s, setorLabel[s]))
  const semSetor = buckets.get('sem_setor')!
  if (semSetor.total > 0) result.push(build('sem_setor', 'Sem setor'))
  return result
}

export interface DailyPoint {
  date: string
  count: number
}

export function dailySeries(transactions: Transaction[], days = 30): DailyPoint[] {
  const map = new Map<string, number>()
  const today = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    map.set(d.toISOString().slice(0, 10), 0)
  }
  for (const dep of transactions) {
    if (!map.has(dep.transactionDate)) continue
    map.set(dep.transactionDate, (map.get(dep.transactionDate) ?? 0) + 1)
  }
  return Array.from(map.entries()).map(([date, count]) => ({ date, count }))
}

export interface DailyMultiPoint {
  date: string
  total: number
  verified: number
  invalid: number
  activations: number
}

/**
 * Série multi-métrica para gráficos empilhados ou múltiplas linhas:
 * total preenchido vs verificados vs inválidos vs ativações por dia.
 *
 * `endDate` (YYYY-MM-DD) determina o último ponto da janela. Default = hoje.
 * Útil quando o usuário navega pra um mês passado e quer ver os dias daquele
 * mês até o fim dele, não até hoje.
 */
export function dailyMultiSeries(
  transactions: Transaction[],
  days = 30,
  endDate?: string,
): DailyMultiPoint[] {
  const map = new Map<string, DailyMultiPoint>()
  const end = endDate
    ? (() => {
        const [y, m, d] = endDate.split('-').map(Number)
        return new Date(y, m - 1, d)
      })()
    : new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end)
    d.setDate(d.getDate() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    map.set(key, { date: key, total: 0, verified: 0, invalid: 0, activations: 0 })
  }
  for (const dep of transactions) {
    const point = map.get(dep.transactionDate)
    if (!point) continue
    point.total += 1
    // Validado = sistema verified + conversa approved (finalStatus='validated').
    // É o mesmo critério que dispara comissão, mantém os gráficos coerentes.
    const fs = finalStatus(dep)
    if (fs === 'validated') {
      point.verified += 1
      if (dep.isActivation) point.activations += 1
    } else if (fs === 'rejected') {
      point.invalid += 1
    }
  }
  return Array.from(map.values())
}

/**
 * Série mensal (granularidade Ano): agrega transações por `yyyy-mm` nos últimos
 * N meses. Mesmo critério de validado (finalStatus='validated') que daily.
 */
export function monthlyMultiSeries(
  transactions: Transaction[],
  months = 12,
): DailyMultiPoint[] {
  const map = new Map<string, DailyMultiPoint>()
  const today = new Date()
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    map.set(key, { date: key, total: 0, verified: 0, invalid: 0, activations: 0 })
  }
  for (const dep of transactions) {
    if (!dep.transactionDate) continue
    const ym = dep.transactionDate.slice(0, 7)
    const point = map.get(ym)
    if (!point) continue
    point.total += 1
    const fs = finalStatus(dep)
    if (fs === 'validated') {
      point.verified += 1
      if (dep.isActivation) point.activations += 1
    } else if (fs === 'rejected') {
      point.invalid += 1
    }
  }
  return Array.from(map.values())
}

export interface AgenteRanking {
  agenteId: string
  agenteName: string
  setor?: Setor
  totalByCurrency: CurrencyTotals
  /** Soma em cada moeda das transações system-verified (usado em `invalidRateAlerts`). */
  verifiedByCurrency: CurrencyTotals
  /** Soma em cada moeda das transações VALIDADOS (finalStatus=validated). Base
   *  do ranking de Top gestores: só conta o que de fato vira comissão. */
  validatedByCurrency: CurrencyTotals
  /** Soma em USD (já convertida) das transações validadas. Base do ranking. */
  validatedUsd: number
  count: number
  verified: number
  /** Count com finalStatus=validated (sistema verified + conversa approved). */
  validated: number
  activations: number
  /** Ativações com finalStatus=validated. */
  validatedActivations: number
  invalidCount: number
}

export function topAgentes(transactions: Transaction[], limit = 5): AgenteRanking[] {
  const map = buildAgenteMap(transactions)
  // Ranking pelo VALOR VALIDADO (estrito) em USD, sistema + conversa.
  // Sistema-only dava impressão errada de produção (gestor com muita conversa
  // pendente ou rejeitada aparecia no topo). #decisao 2026-05-26
  return Array.from(map.values())
    .sort((a, b) => b.validatedUsd - a.validatedUsd)
    .slice(0, limit)
}

export interface InvalidRateAlert {
  agenteId: string
  agenteName: string
  setor?: Setor
  invalidCount: number
  totalDecided: number
  rate: number
}

/**
 * Agentes com alta taxa de inválidos.
 * Considera apenas transactions com decisão final do sistema (verified|invalid|duplicate),
 * ignora pendentes. Mínimo de 5 decididos pra evitar ruído com agentes novos.
 */
export function invalidRateAlerts(
  transactions: Transaction[],
  { minDecided = 5, minRate = 0.3, limit = 5 } = {},
): InvalidRateAlert[] {
  const map = buildAgenteMap(transactions)
  const alerts: InvalidRateAlert[] = []
  for (const [, a] of map) {
    const decided = a.invalidCount + a.verified
    if (decided < minDecided) continue
    const rate = decided > 0 ? a.invalidCount / decided : 0
    if (rate < minRate) continue
    alerts.push({
      agenteId: a.agenteId,
      agenteName: a.agenteName,
      setor: a.setor,
      invalidCount: a.invalidCount,
      totalDecided: decided,
      rate,
    })
  }
  return alerts.sort((a, b) => b.rate - a.rate).slice(0, limit)
}

function buildAgenteMap(transactions: Transaction[]): Map<string, AgenteRanking> {
  const map = new Map<string, AgenteRanking>()
  for (const d of transactions) {
    const cur = map.get(d.agenteId) ?? {
      agenteId: d.agenteId,
      agenteName: d.agenteName,
      setor: d.agenteSetor,
      totalByCurrency: emptyTotals(),
      verifiedByCurrency: emptyTotals(),
      validatedByCurrency: emptyTotals(),
      validatedUsd: 0,
      count: 0,
      verified: 0,
      validated: 0,
      activations: 0,
      validatedActivations: 0,
      invalidCount: 0,
    }
    cur.totalByCurrency[d.currency] += d.amount || 0
    cur.count += 1
    if (d.systemValidation === 'verified') {
      cur.verified += 1
      cur.verifiedByCurrency[d.currency] += d.amount || 0
      if (d.isActivation) cur.activations += 1
    }
    // Métricas analíticas estritas: finalStatus=validated. Estes campos sao
    // a base do Top Gestores e demais rankings analíticos.
    if (finalStatus(d) === 'validated') {
      cur.validated += 1
      cur.validatedByCurrency[d.currency] += d.amount || 0
      cur.validatedUsd += effectiveUsdAmount(d)
      if (d.isActivation) cur.validatedActivations += 1
    }
    if (d.systemValidation === 'invalid' || d.systemValidation === 'duplicate') {
      cur.invalidCount += 1
    }
    map.set(d.agenteId, cur)
  }
  return map
}

function totalSum(t: CurrencyTotals): number {
  return (t.USD ?? 0) + (t.EUR ?? 0) + (t.GBP ?? 0)
}

// -------------------------------------------------------------------------
// Métricas avançadas adicionadas para o dashboard profissional
// -------------------------------------------------------------------------

/**
 * Variação percentual entre dois números. Retorna `null` quando a referência
 * é zero (não dá pra calcular % sobre base zero, UI mostra "-").
 */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return (current - previous) / previous
}

export interface ConversionFunnel {
  registered: number // total
  systemVerified: number
  conversationApproved: number
  fullyValidated: number // verified + approved
  systemConversionRate: number // verified / (verified+invalid)
  finalConversionRate: number // fullyValidated / total
}

export function conversionFunnel(transactions: Transaction[]): ConversionFunnel {
  let registered = 0
  let systemVerified = 0
  let conversationApproved = 0
  let fullyValidated = 0
  let systemDecided = 0

  for (const d of transactions) {
    registered += 1
    if (d.systemValidation === 'verified') systemVerified += 1
    if (
      d.systemValidation === 'verified' ||
      d.systemValidation === 'invalid' ||
      d.systemValidation === 'duplicate'
    ) {
      systemDecided += 1
    }
    if (d.conversationValidation === 'approved') conversationApproved += 1
    if (
      d.systemValidation === 'verified' &&
      d.conversationValidation === 'approved'
    ) {
      fullyValidated += 1
    }
  }

  return {
    registered,
    systemVerified,
    conversationApproved,
    fullyValidated,
    systemConversionRate: systemDecided > 0 ? systemVerified / systemDecided : 0,
    finalConversionRate: registered > 0 ? fullyValidated / registered : 0,
  }
}

/**
 * Tempo médio (em horas) entre `createdAt` e `updatedAt` para transactions
 * totalmente validados (verified + approved). Aproxima quanto tempo o
 * transaction leva pra fechar do começo ao fim.
 */
export function avgTimeToValidationHours(transactions: Transaction[]): number | null {
  let sum = 0
  let n = 0
  for (const d of transactions) {
    if (
      d.systemValidation !== 'verified' ||
      d.conversationValidation !== 'approved'
    )
      continue
    const createdMs = d.createdAt?.toMillis?.() ?? 0
    const updatedMs = d.updatedAt?.toMillis?.() ?? 0
    if (!createdMs || !updatedMs || updatedMs < createdMs) continue
    sum += (updatedMs - createdMs) / 3_600_000
    n += 1
  }
  if (n === 0) return null
  return sum / n
}

export interface CurrencyShare {
  currency: Currency
  amount: number
  count: number
  share: number // 0..1 sobre total (USD-equivalent não, apenas soma bruta)
}

/**
 * Distribuição por moeda. `share` é calculado sobre a soma bruta de todas as
 * moedas (não normaliza pra USD). Útil pra mostrar mix dominante.
 */
export function currencyMix(transactions: Transaction[]): CurrencyShare[] {
  const buckets: Record<Currency, { amount: number; count: number }> = {
    USD: { amount: 0, count: 0 },
    EUR: { amount: 0, count: 0 },
    GBP: { amount: 0, count: 0 },
  }
  for (const d of transactions) {
    buckets[d.currency].amount += d.amount || 0
    buckets[d.currency].count += 1
  }
  const total = buckets.USD.amount + buckets.EUR.amount + buckets.GBP.amount
  const result: CurrencyShare[] = (['USD', 'EUR', 'GBP'] as Currency[]).map((c) => ({
    currency: c,
    amount: buckets[c].amount,
    count: buckets[c].count,
    share: total > 0 ? buckets[c].amount / total : 0,
  }))
  return result
}

export interface TopClient {
  clientId: string
  clientName: string
  transactions: number
  /** Count com finalStatus=validated (sistema + conversa). */
  validatedTransactions: number
  totalByCurrency: CurrencyTotals
  /** Soma em USD das transações validadas (já convertidos). Base do ranking. */
  totalUsd: number
  lastDate: string
}

/**
 * Top clientes pelo MAIOR valor transacionado (em USD) considerando só os
 * transações validadas (finalStatus=validated = sistema + conversa). Empate é
 * resolvido pela quantidade de transações validadas. #decisao 2026-05-29
 */
export function topClients(transactions: Transaction[], limit = 5): TopClient[] {
  const map = new Map<string, TopClient>()
  for (const d of transactions) {
    if (!d.clientId) continue
    const cur =
      map.get(d.clientId) ??
      ({
        clientId: d.clientId,
        clientName: d.clientName,
        transactions: 0,
        validatedTransactions: 0,
        totalByCurrency: emptyTotals(),
        totalUsd: 0,
        lastDate: d.transactionDate,
      } satisfies TopClient)
    cur.transactions += 1
    // Ranking usa o critério ESTRITO (finalStatus=validated). Sistema-only
    // mostrava clientes "ativos" cujo gestor ainda não aprovou a conversa
    //: gerava ranking inflado vs comissão real. #decisao 2026-05-26
    if (finalStatus(d) === 'validated') {
      cur.validatedTransactions += 1
      cur.totalByCurrency[d.currency] += d.amount || 0
      cur.totalUsd += effectiveUsdAmount(d)
    }
    if (d.transactionDate > cur.lastDate) cur.lastDate = d.transactionDate
    if (d.clientName) cur.clientName = d.clientName
    map.set(d.clientId, cur)
  }
  return Array.from(map.values())
    .filter((c) => c.validatedTransactions > 0)
    .sort((a, b) => {
      if (b.totalUsd !== a.totalUsd) return b.totalUsd - a.totalUsd
      return b.validatedTransactions - a.validatedTransactions
    })
    .slice(0, limit)
}

/**
 * Conta transactions agrupados por dia da semana (0=domingo, 6=sábado).
 * Usado pra mostrar padrão de atividade da equipe.
 */
export function byWeekday(transactions: Transaction[]): { weekday: number; label: string; count: number }[] {
  const counts = [0, 0, 0, 0, 0, 0, 0]
  for (const d of transactions) {
    const [y, m, day] = d.transactionDate.split('-').map(Number)
    if (!y || !m || !day) continue
    const wd = new Date(y, m - 1, day).getDay()
    counts[wd] += 1
  }
  const labels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  return counts.map((count, weekday) => ({ weekday, label: labels[weekday], count }))
}

/**
 * Quantos transactions estão "presos" pendentes além da janela esperada (12h
 * depois do fim do dia BRT do transactionDate). Sinal de algo travado na pipeline.
 */
export function stalePendingCount(transactions: Transaction[]): number {
  const now = Date.now()
  let n = 0
  for (const d of transactions) {
    if (d.systemValidation !== 'pending') continue
    const [y, m, day] = d.transactionDate.split('-').map(Number)
    if (!y || !m || !day) continue
    // fim do dia BRT (UTC-3) + 12h ≈ transactionDate + 1 dia + 15h UTC
    const deadline = Date.UTC(y, m - 1, day) + 86_400_000 + 15 * 3_600_000
    if (now > deadline) n += 1
  }
  return n
}

/**
 * Soma todos os valores brutos das três moedas, útil pra ordenar/comparar
 * grosseiramente. Não normaliza câmbio.
 */
export function rawTotal(totals: CurrencyTotals): number {
  return totalSum(totals)
}

export type InvalidReasonCode =
  | 'duplicate_cross'
  | 'duplicate_same'
  | 'no_account'
  | 'amount_mismatch'
  | 'currency_mismatch'
  | 'date_mismatch'
  | 'multiple_mismatch'
  | 'no_match'
  | 'unknown'

export interface InvalidReason {
  code: InvalidReasonCode
  /** Texto curto pra renderizar inline na tabela. */
  short: string
  /** Detalhes adicionais (ex.: "esperado USD, encontrado EUR"). */
  detail?: string
}

/**
 * Resume em uma frase o motivo da transação estar inválido / duplicado.
 * Usado na lista de operações pra o admin não precisar abrir o modal.
 */
export function inferInvalidReason(d: Transaction): InvalidReason | null {
  if (d.systemValidation === 'duplicate') {
    const links = d.duplicateAlert?.linkedTransactionNumbers ?? []
    const cross = d.duplicateAlert?.crossAgent
    const linksStr = links.length > 0 ? ` (#${links.join(', #')})` : ''
    return {
      code: cross ? 'duplicate_cross' : 'duplicate_same',
      short: cross ? 'Duplicado com outro agente' : 'Duplicado',
      detail: linksStr ? `mesma tx que${linksStr}` : undefined,
    }
  }

  if (d.systemValidation !== 'invalid') return null

  const best = d.bestCandidate
  if (best) {
    const mismatches: string[] = []
    if (!best.loginMatch) mismatches.push('conta')
    if (!best.amountMatch) mismatches.push('valor')
    if (!best.currencyMatch) mismatches.push('moeda')
    if (!best.dateMatch) mismatches.push('data')
    if (mismatches.length === 0) {
      return { code: 'unknown', short: 'Inválido', detail: undefined }
    }
    if (mismatches.length === 1) {
      const code: InvalidReasonCode =
        mismatches[0] === 'valor'
          ? 'amount_mismatch'
          : mismatches[0] === 'moeda'
            ? 'currency_mismatch'
            : mismatches[0] === 'data'
              ? 'date_mismatch'
              : 'no_account'
      let detail: string | undefined
      if (mismatches[0] === 'valor' && best.sourceAmount != null) {
        detail = `sistema de origem tem ${best.sourceAmount} ${best.sourceCurrency ?? ''}`.trim()
      } else if (mismatches[0] === 'moeda' && best.sourceCurrency) {
        detail = `sistema de origem: ${best.sourceCurrency}`
      } else if (mismatches[0] === 'data' && best.sourceDate) {
        detail = `sistema de origem: ${best.sourceDate}`
      }
      return {
        code,
        short: `${cap(mismatches[0])} não bate`,
        detail,
      }
    }
    return {
      code: 'multiple_mismatch',
      short: `${mismatches.length} campos não batem`,
      detail: mismatches.join(' · '),
    }
  }

  // Sem bestCandidate: usa os checks isolados pra inferir
  const c = d.validationChecks ?? {}
  if (!c.id_check) {
    return {
      code: 'no_account',
      short: 'Conta não existe no sistema de origem',
      detail: `ID ${d.clientId}`,
    }
  }
  if (!c.value_check) {
    return {
      code: 'amount_mismatch',
      short: 'Valor nunca registrado por essa conta',
      detail: undefined,
    }
  }
  if (!c.date_check) {
    return {
      code: 'date_mismatch',
      short: 'Nenhum registro dessa conta na data',
      detail: undefined,
    }
  }
  if (!c.currency_check) {
    return {
      code: 'currency_mismatch',
      short: 'Moeda divergente',
      detail: undefined,
    }
  }
  if (!c.same_row_check) {
    return {
      code: 'no_match',
      short: 'Combinação não bate em nenhuma linha',
      detail: undefined,
    }
  }
  return { code: 'unknown', short: 'Inválido', detail: undefined }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Lista de inválidos/duplicados mais recentes, com motivo resumido pronto pra
 * renderizar na tabela do dashboard.
 */
export interface InvalidLogEntry {
  transaction: Transaction
  reason: InvalidReason
}

export function recentInvalids(transactions: Transaction[], limit = 8): InvalidLogEntry[] {
  const out: InvalidLogEntry[] = []
  for (const d of transactions) {
    if (d.systemValidation !== 'invalid' && d.systemValidation !== 'duplicate') continue
    const reason = inferInvalidReason(d)
    if (!reason) continue
    out.push({ transaction: d, reason })
  }
  out.sort((a, b) => {
    const ta = a.transaction.updatedAt?.toMillis?.() ?? 0
    const tb = b.transaction.updatedAt?.toMillis?.() ?? 0
    return tb - ta
  })
  return out.slice(0, limit)
}

/* -------------------------------------------------------------------------- */
/* Comparativo entre agentes: scorecards + deltas + insights                  */
/* -------------------------------------------------------------------------- */

export interface AgentScorecard {
  agenteId: string
  agenteName: string
  setor?: Setor

  /** Total de transações inseridos pelo agente no período. */
  total: number
  /** Validados (system=verified + conversation=approved). */
  validated: number
  /** Inválidos (system=invalid/duplicate). */
  invalid: number
  /** Ativações validadas. */
  activations: number

  /** validated / total: fração de aproveitamento bruto. */
  validationRate: number
  /** validated / (validated+invalid): só decididos. */
  systemConversionRate: number
  /** activations / validated. */
  activationRate: number
  /** invalid / (validated+invalid): quanto da decisão volta inválida. */
  invalidRate: number

  /** Soma bruta dos valores validados (face-value, sem câmbio). */
  validatedRawTotal: number
  /** Ticket médio dos validados (face-value). */
  avgTicket: number
  /** Comissão paga (bruto): fixos + 1% elegível. */
  commissionRawTotal: number

  /** Tempo médio de fechamento dos validados (em horas). */
  avgTimeToValidationHours: number | null
}

/**
 * Agrega um scorecard por agente. Reusa `commissionByAgent` pra extrair a
 * comissão exata (com regras de elegibilidade), e calcula as taxas no agregado.
 *
 * Inclui apenas agentes que registraram pelo menos 1 transação no período.
 */
export function agentScorecards(transactions: Transaction[]): AgentScorecard[] {
  const map = new Map<
    string,
    {
      agenteId: string
      agenteName: string
      setor?: Setor
      total: number
      validated: number
      invalid: number
      activations: number
      validatedRawTotal: number
      timeMsSum: number
      timeMsCount: number
    }
  >()
  for (const d of transactions) {
    const cur =
      map.get(d.agenteId) ??
      {
        agenteId: d.agenteId,
        agenteName: d.agenteName,
        setor: d.agenteSetor,
        total: 0,
        validated: 0,
        invalid: 0,
        activations: 0,
        validatedRawTotal: 0,
        timeMsSum: 0,
        timeMsCount: 0,
      }
    cur.total += 1
    const isInvalid =
      d.systemValidation === 'invalid' || d.systemValidation === 'duplicate'
    const isValidated =
      d.systemValidation === 'verified' && d.conversationValidation === 'approved'
    if (isValidated) {
      cur.validated += 1
      cur.validatedRawTotal += d.amount || 0
      if (d.isActivation) cur.activations += 1
      const created = d.createdAt?.toMillis?.() ?? 0
      const updated = d.updatedAt?.toMillis?.() ?? 0
      if (created && updated && updated >= created) {
        cur.timeMsSum += updated - created
        cur.timeMsCount += 1
      }
    } else if (isInvalid) {
      cur.invalid += 1
    }
    if (d.agenteName) cur.agenteName = d.agenteName
    if (d.agenteSetor) cur.setor = d.agenteSetor
    map.set(d.agenteId, cur)
  }

  // Comissão: reusa direto `commissionByAgent`, fonte canônica do app.
  // Antes calculávamos inline, com risco de drift. Agora apontamos pro mesmo
  // payableRawTotal que aparece no banner "Comissão calculada".
  const commissionByAgentList = commissionByAgent(transactions)
  const commissionMap = new Map(
    commissionByAgentList.map((a) => [a.agenteId, a.payableRawTotal]),
  )

  const out: AgentScorecard[] = []
  for (const s of map.values()) {
    const decided = s.validated + s.invalid
    out.push({
      agenteId: s.agenteId,
      agenteName: s.agenteName,
      setor: s.setor,
      total: s.total,
      validated: s.validated,
      invalid: s.invalid,
      activations: s.activations,
      validationRate: s.total > 0 ? s.validated / s.total : 0,
      systemConversionRate: decided > 0 ? s.validated / decided : 0,
      activationRate: s.validated > 0 ? s.activations / s.validated : 0,
      invalidRate: decided > 0 ? s.invalid / decided : 0,
      validatedRawTotal: s.validatedRawTotal,
      avgTicket: s.validated > 0 ? s.validatedRawTotal / s.validated : 0,
      commissionRawTotal: commissionMap.get(s.agenteId) ?? 0,
      avgTimeToValidationHours:
        s.timeMsCount > 0 ? s.timeMsSum / s.timeMsCount / 3_600_000 : null,
    })
  }
  return out.sort((a, b) => b.commissionRawTotal - a.commissionRawTotal)
}

export type AgentMetricKey =
  | 'validated'
  | 'commission'
  | 'activations'
  | 'activationRate'
  | 'validationRate'
  | 'avgTicket'
  | 'invalidRate'
  | 'avgTimeToValidationHours'

export interface AgentDelta {
  agenteId: string
  metric: AgentMetricKey
  current: number
  previous: number
  /** delta absoluto (current - previous). */
  abs: number
  /** delta relativo (current/previous - 1), null se previous == 0. */
  rel: number | null
}

export const METRIC_GETTER: Record<AgentMetricKey, (s: AgentScorecard) => number | null> = {
  validated: (s) => s.validated,
  commission: (s) => s.commissionRawTotal,
  activations: (s) => s.activations,
  activationRate: (s) => s.activationRate,
  validationRate: (s) => s.validationRate,
  avgTicket: (s) => s.avgTicket,
  invalidRate: (s) => s.invalidRate,
  avgTimeToValidationHours: (s) => s.avgTimeToValidationHours,
}

/**
 * Para cada agente que existe nos dois períodos, calcula delta de uma métrica.
 * Agentes que aparecem só num lado têm o outro como 0 (ou null pra rates).
 */
export function agentDeltas(
  current: AgentScorecard[],
  previous: AgentScorecard[],
  metric: AgentMetricKey,
): AgentDelta[] {
  const prevMap = new Map(previous.map((s) => [s.agenteId, s]))
  const result: AgentDelta[] = []
  const get = METRIC_GETTER[metric]
  for (const cur of current) {
    const prev = prevMap.get(cur.agenteId)
    const curV = get(cur) ?? 0
    const prevV = prev ? (get(prev) ?? 0) : 0
    const rel = prevV === 0 ? (curV === 0 ? 0 : null) : (curV - prevV) / prevV
    result.push({
      agenteId: cur.agenteId,
      metric,
      current: curV,
      previous: prevV,
      abs: curV - prevV,
      rel,
    })
  }
  return result
}

export type TeamInsightKind =
  | 'top_commission'
  | 'top_validated'
  | 'most_improved'
  | 'slipping'
  | 'activation_specialist'
  | 'speed_champion'
  | 'quality_concern'
  | 'conversion_gap'
  | 'newcomer'
  | 'inactive'

export interface TeamInsight {
  kind: TeamInsightKind
  /** Mensagem em pt-BR curta, pronta pra renderizar. */
  message: string
  /** Detalhe opcional pra segunda linha. */
  detail?: string
  /** Tom: 'positive', 'warning', 'info'. */
  tone: 'positive' | 'warning' | 'info'
  /** Métrica relacionada (pra ordenar/destacar). */
  metric?: AgentMetricKey
  /** Agente envolvido (pra link). */
  agenteId?: string
  /** Agente nome (pra display sem precisar de lookup). */
  agenteName?: string
}

/**
 * Gera insights automáticos sobre o time, comparando o período atual com o
 * anterior. Foco em: quem brilhou, quem precisa de atenção, quem evoluiu mais.
 *
 * Filtros pra evitar ruído com agentes novos:
 *   - Top performers: mín. 1 validado.
 *   - Most improved / slipping: mín. 3 validados nos dois períodos.
 *   - Activation/speed champion: mín. 3 validações.
 *   - Quality concern: mín. 5 decididos e taxa de inválidos >= 25%.
 */
export function teamInsights(
  current: AgentScorecard[],
  previous: AgentScorecard[],
): TeamInsight[] {
  const insights: TeamInsight[] = []
  if (current.length === 0) {
    return [
      {
        kind: 'newcomer',
        message: 'Sem dados de agentes no período selecionado.',
        tone: 'info',
      },
    ]
  }

  // 1. Top performer em comissão
  const byCommission = [...current]
    .filter((s) => s.validated > 0)
    .sort((a, b) => b.commissionRawTotal - a.commissionRawTotal)
  if (byCommission[0] && byCommission[0].commissionRawTotal > 0) {
    const top = byCommission[0]
    const teamCommission = current.reduce((s, x) => s + x.commissionRawTotal, 0)
    const share = teamCommission > 0 ? (top.commissionRawTotal / teamCommission) * 100 : 0
    insights.push({
      kind: 'top_commission',
      tone: 'positive',
      agenteId: top.agenteId,
      agenteName: top.agenteName,
      metric: 'commission',
      message: `${top.agenteName} lidera em comissão com ${compactUsdInternal(top.commissionRawTotal)}`,
      detail: `${share.toFixed(0)}% da comissão da operação · ${top.validated} validado${top.validated === 1 ? '' : 's'}`,
    })
  }

  // 2. Top em validados (se diferente do top comissão)
  const byValidated = [...current].sort((a, b) => b.validated - a.validated)
  if (byValidated[0]?.validated && byValidated[0].agenteId !== byCommission[0]?.agenteId) {
    const top = byValidated[0]
    insights.push({
      kind: 'top_validated',
      tone: 'positive',
      agenteId: top.agenteId,
      agenteName: top.agenteName,
      metric: 'validated',
      message: `${top.agenteName} é o que mais validou: ${top.validated} registros`,
      detail: `taxa de validação ${(top.validationRate * 100).toFixed(0)}% · ${top.activations} ativ.`,
    })
  }

  // 3. Most improved (delta % de comissão)
  if (previous.length > 0) {
    const deltas = agentDeltas(current, previous, 'commission')
      .filter((d) => {
        const cur = current.find((s) => s.agenteId === d.agenteId)
        const prev = previous.find((s) => s.agenteId === d.agenteId)
        return (
          cur &&
          prev &&
          cur.validated >= 3 &&
          prev.validated >= 3 &&
          d.rel !== null
        )
      })
      .sort((a, b) => (b.rel ?? -Infinity) - (a.rel ?? -Infinity))
    if (deltas[0] && (deltas[0].rel ?? 0) > 0.15) {
      const d = deltas[0]
      const sc = current.find((s) => s.agenteId === d.agenteId)!
      insights.push({
        kind: 'most_improved',
        tone: 'positive',
        agenteId: d.agenteId,
        agenteName: sc.agenteName,
        metric: 'commission',
        message: `${sc.agenteName} subiu ${((d.rel ?? 0) * 100).toFixed(0)}% em comissão`,
        detail: `${compactUsdInternal(d.previous)} → ${compactUsdInternal(d.current)} vs período anterior`,
      })
    }

    // 4. Slipping (delta negativo grande)
    const slipping = deltas.slice().sort((a, b) => (a.rel ?? Infinity) - (b.rel ?? Infinity))
    if (slipping[0] && (slipping[0].rel ?? 0) < -0.15) {
      const d = slipping[0]
      const sc = current.find((s) => s.agenteId === d.agenteId)!
      insights.push({
        kind: 'slipping',
        tone: 'warning',
        agenteId: d.agenteId,
        agenteName: sc.agenteName,
        metric: 'commission',
        message: `${sc.agenteName} caiu ${Math.abs((d.rel ?? 0) * 100).toFixed(0)}% em comissão`,
        detail: `${compactUsdInternal(d.previous)} → ${compactUsdInternal(d.current)}, vale conversar`,
      })
    }
  }

  // 5. Activation specialist (maior activationRate, mín. 3 validações)
  const actSpec = [...current]
    .filter((s) => s.validated >= 3)
    .sort((a, b) => b.activationRate - a.activationRate)
  if (actSpec[0] && actSpec[0].activationRate >= 0.5) {
    const top = actSpec[0]
    insights.push({
      kind: 'activation_specialist',
      tone: 'positive',
      agenteId: top.agenteId,
      agenteName: top.agenteName,
      metric: 'activationRate',
      message: `${top.agenteName} é especialista em ativações`,
      detail: `${(top.activationRate * 100).toFixed(0)}% dos validados são ativações (${top.activations}/${top.validated})`,
    })
  }

  // 7. Quality concern (taxa de inválidos alta com volume mínimo)
  const concerns = [...current]
    .filter((s) => s.validated + s.invalid >= 5 && s.invalidRate >= 0.25)
    .sort((a, b) => b.invalidRate - a.invalidRate)
  if (concerns[0]) {
    const bad = concerns[0]
    insights.push({
      kind: 'quality_concern',
      tone: 'warning',
      agenteId: bad.agenteId,
      agenteName: bad.agenteName,
      metric: 'invalidRate',
      message: `${bad.agenteName} com alta taxa de inválidos`,
      detail: `${(bad.invalidRate * 100).toFixed(0)}% dos decididos voltam inválidos (${bad.invalid} de ${bad.validated + bad.invalid})`,
    })
  }

  // 8. Conversion gap (top vs mediana)
  if (current.length >= 3) {
    const rates = [...current]
      .filter((s) => s.validated + s.invalid >= 3)
      .map((s) => s.systemConversionRate)
      .sort((a, b) => a - b)
    if (rates.length >= 3) {
      const top = rates[rates.length - 1]
      const median = rates[Math.floor(rates.length / 2)]
      const gap = top - median
      if (gap >= 0.15) {
        insights.push({
          kind: 'conversion_gap',
          tone: 'info',
          metric: 'validationRate',
          message: `Gap de conversão de ${(gap * 100).toFixed(0)}pp entre top e mediana`,
          detail: `top em ${(top * 100).toFixed(0)}% vs mediana ${(median * 100).toFixed(0)}%, espaço pra padronizar processo`,
        })
      }
    }
  }

  return insights
}

/**
 * Insight de inatividade: o gestor ATIVO que está há mais tempo sem registrar
 * NENHUM registro (validado ou não: conta qualquer transação). Ajuda a equipe a
 * perceber quem parou de registrar e investigar o motivo.
 *
 * Só considera gestores ativos (role 'agente', active !== false) que já
 * registraram ao menos uma vez no histórico fornecido, assim não confundimos
 * "parou de registrar" com "recém-contratado que nunca registrou".
 *
 * @param transactions histórico (idealmente completo, já recortado por setor).
 * @param agentes  lista de usuários pra restringir a gestores ativos.
 * @param minDays  só gera o insight a partir desse gap (default 3 dias).
 */
export function inactiveAgentInsight(
  transactions: Transaction[],
  agentes: { uid: string; name: string; role: Role; active: boolean }[],
  minDays = 3,
): TeamInsight | null {
  // Último registro por agente (qualquer status), via transactionDate (yyyy-mm-dd).
  const lastByAgent = new Map<string, string>()
  const nameByAgent = new Map<string, string>()
  for (const d of transactions) {
    if (!d.transactionDate) continue
    const prev = lastByAgent.get(d.agenteId)
    if (!prev || d.transactionDate > prev) lastByAgent.set(d.agenteId, d.transactionDate)
    if (d.agenteName) nameByAgent.set(d.agenteId, d.agenteName)
  }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const daysSince = (iso: string) => {
    const [y, m, dd] = iso.split('-').map(Number)
    const dt = new Date(y, m - 1, dd)
    dt.setHours(0, 0, 0, 0)
    return Math.floor((today.getTime() - dt.getTime()) / 86_400_000)
  }
  let worst: { id: string; name: string; days: number; last: string } | null = null
  for (const a of agentes) {
    if (a.role !== 'agente' || a.active === false) continue
    const last = lastByAgent.get(a.uid)
    if (!last) continue // nunca registrou, pode ser novo, não flagramos aqui
    const days = daysSince(last)
    if (days < minDays) continue
    if (!worst || days > worst.days) {
      worst = {
        id: a.uid,
        name: a.name || nameByAgent.get(a.uid) || 'Gestor',
        days,
        last,
      }
    }
  }
  if (!worst) return null
  const [, mm, dd] = worst.last.split('-')
  return {
    kind: 'inactive',
    tone: 'warning',
    agenteId: worst.id,
    agenteName: worst.name,
    message: `${worst.name} está há ${worst.days} dia${worst.days === 1 ? '' : 's'} sem registro`,
    detail: `último registro em ${dd}/${mm}: vale checar o que está acontecendo`,
  }
}

function compactUsdInternal(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 10_000) return `$${(v / 1_000).toFixed(1)}k`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(2)}k`
  return `$${v.toFixed(0)}`
}

/**
 * Distribuição dos motivos de inválido (agrupados por código). Útil pra um
 * "diagnóstico rápido" no topo do painel: onde a operação está errando mais?
 */
export interface InvalidReasonBucket {
  code: InvalidReasonCode
  label: string
  count: number
}

const reasonLabel: Record<InvalidReasonCode, string> = {
  duplicate_cross: 'Duplicado entre agentes',
  duplicate_same: 'Duplicado mesmo agente',
  no_account: 'Conta inexistente',
  amount_mismatch: 'Valor divergente',
  currency_mismatch: 'Moeda divergente',
  date_mismatch: 'Data divergente',
  multiple_mismatch: 'Múltiplos campos errados',
  no_match: 'Sem correspondência',
  unknown: 'Outro',
}

/* -------------------------------------------------------------------------- */
/* Análise de carteira                                                          */
/* -------------------------------------------------------------------------- */

export interface WalletAnalytics {
  /** Clientes únicos (pelo clientId) que aparecem no período, qualquer status. */
  uniqueClients: number
  /** Clientes únicos com ao menos 1 transação verified pelo sistema. */
  verifiedClients: number
  /** Clientes que tiveram >1 transação no período (recorrentes). */
  recurringClients: number
  /** Total de transações validadas (verified + approved). */
  validatedTransactions: number
  /** Transações por cliente (validatedTransactions / verifiedClients), 0 se sem base. */
  transactionsPerClient: number
  /** Ticket médio por moeda (média do `amount` em transações verified). */
  avgTicketByCurrency: CurrencyTotals
  /** Maior transação verified por moeda. */
  maxTicketByCurrency: CurrencyTotals
  /** Percentual de clientes recorrentes (recurring / unique). */
  recurrenceRate: number
  /** Cliente com maior soma bruta validada (USD+EUR+GBP). */
  topClient?: {
    clientId: string
    clientName: string
    totalByCurrency: CurrencyTotals
    transactions: number
  }
}

export function walletAnalytics(transactions: Transaction[]): WalletAnalytics {
  const buckets = new Map<
    string,
    {
      clientId: string
      clientName: string
      transactionCount: number
      verifiedCount: number
      totalByCurrency: CurrencyTotals
      lastDate: string
    }
  >()

  let validatedTransactions = 0
  const sumByCurrency: CurrencyTotals = { USD: 0, EUR: 0, GBP: 0 }
  const countVerifiedByCurrency: Record<Currency, number> = { USD: 0, EUR: 0, GBP: 0 }
  const maxByCurrency: CurrencyTotals = { USD: 0, EUR: 0, GBP: 0 }

  for (const d of transactions) {
    if (!d.clientId) continue
    const cur =
      buckets.get(d.clientId) ??
      {
        clientId: d.clientId,
        clientName: d.clientName,
        transactionCount: 0,
        verifiedCount: 0,
        totalByCurrency: { USD: 0, EUR: 0, GBP: 0 } as CurrencyTotals,
        lastDate: d.transactionDate,
      }
    cur.transactionCount += 1
    if (d.systemValidation === 'verified') {
      cur.verifiedCount += 1
      cur.totalByCurrency[d.currency] += d.amount || 0
      sumByCurrency[d.currency] += d.amount || 0
      countVerifiedByCurrency[d.currency] += 1
      if ((d.amount || 0) > maxByCurrency[d.currency]) {
        maxByCurrency[d.currency] = d.amount || 0
      }
    }
    if (d.transactionDate > cur.lastDate) cur.lastDate = d.transactionDate
    if (d.clientName) cur.clientName = d.clientName
    if (
      d.systemValidation === 'verified' &&
      d.conversationValidation === 'approved'
    ) {
      validatedTransactions += 1
    }
    buckets.set(d.clientId, cur)
  }

  const uniqueClients = buckets.size
  let verifiedClients = 0
  let recurringClients = 0
  let topClientObj: WalletAnalytics['topClient']
  let topClientTotal = -1

  for (const c of buckets.values()) {
    if (c.verifiedCount > 0) verifiedClients += 1
    if (c.transactionCount > 1) recurringClients += 1
    const total =
      c.totalByCurrency.USD + c.totalByCurrency.EUR + c.totalByCurrency.GBP
    if (total > topClientTotal) {
      topClientTotal = total
      topClientObj = {
        clientId: c.clientId,
        clientName: c.clientName,
        totalByCurrency: c.totalByCurrency,
        transactions: c.verifiedCount,
      }
    }
  }

  const avgTicket: CurrencyTotals = { USD: 0, EUR: 0, GBP: 0 }
  for (const c of ['USD', 'EUR', 'GBP'] as Currency[]) {
    avgTicket[c] =
      countVerifiedByCurrency[c] > 0
        ? sumByCurrency[c] / countVerifiedByCurrency[c]
        : 0
  }

  return {
    uniqueClients,
    verifiedClients,
    recurringClients,
    validatedTransactions,
    transactionsPerClient:
      verifiedClients > 0 ? validatedTransactions / verifiedClients : 0,
    avgTicketByCurrency: avgTicket,
    maxTicketByCurrency: maxByCurrency,
    recurrenceRate: uniqueClients > 0 ? recurringClients / uniqueClients : 0,
    topClient: topClientTotal > 0 ? topClientObj : undefined,
  }
}

/* -------------------------------------------------------------------------- */
/* Geografia (país via DDD do telefone)                                        */
/* -------------------------------------------------------------------------- */

export interface CountryDistribution {
  /** ISO 3166-1 alpha-2, ex.: "BR" */
  code: string
  name: string
  flag: string
  /** Quantos transações vieram desse país. */
  transactions: number
  /** Quantos clientes únicos (pelo clientId). */
  clients: number
  /** Total bruto em USD-equivalente face-value (sem câmbio). */
  rawAmount: number
}

/**
 * Resolve o país de uma transação. Fonte primária: `sourceCountry` (ISO-2 vindo
 * direto do sistema de origem, gravado na validação). Fallback: DDI do telefone, pra
 * transações ainda não casados ou sem país na source. Retorna `undefined`
 * quando nenhuma das fontes resolve (vira "Desconhecido" no chamador).
 */
function resolveCountry(d: Transaction) {
  const fromSource = countryByIso(d.sourceCountry)
  if (fromSource) return fromSource
  const { dial } = parsePhone(d.clientPhone)
  return countryByDial(dial)
}

/**
 * Distribui transações por país. Usa o país real do sistema de origem (`sourceCountry`)
 * quando disponível, caindo no DDI do telefone como fallback. Quando nenhuma
 * fonte resolve, classifica como "Desconhecido". Retorna ordenado por número
 * de clientes únicos (desc).
 */
export function geoByPhone(transactions: Transaction[]): CountryDistribution[] {
  const buckets = new Map<
    string,
    {
      code: string
      name: string
      flag: string
      transactions: number
      clients: Set<string>
      rawAmount: number
    }
  >()

  for (const d of transactions) {
    const c = resolveCountry(d)
    const key = c?.code ?? '??'
    const name = c?.name ?? 'Desconhecido'
    const flag = c?.flag ?? '🌐'

    const cur =
      buckets.get(key) ??
      {
        code: key,
        name,
        flag,
        transactions: 0,
        clients: new Set<string>(),
        rawAmount: 0,
      }
    cur.transactions += 1
    if (d.clientId) cur.clients.add(d.clientId)
    cur.rawAmount += d.amount || 0
    buckets.set(key, cur)
  }

  return Array.from(buckets.values())
    .map((b) => ({
      code: b.code,
      name: b.name,
      flag: b.flag,
      transactions: b.transactions,
      clients: b.clients.size,
      rawAmount: b.rawAmount,
    }))
    .sort((a, b) => b.clients - a.clients || b.transactions - a.transactions)
}

/**
 * Versão "rica" da distribuição geográfica: inclui breakdown de status final
 * (verified/approved/pending/invalid), ativações e comissão por país. Usada
 * pelo mapa-mundi com tooltip estilo Power BI.
 *
 * - `verified`: transações com systemValidation=verified (independente da conversa).
 * - `approved`: transações com conversationValidation=approved.
 * - `validated`: final = validated (verified + approved).
 * - `pending`: final = pending.
 * - `invalid`: final = rejected (inclui systemValidation=invalid/duplicate ou
 *   conversationValidation=rejected).
 * - `activations`: ativações validadas (final=validated AND isActivation).
 * - `commission.payableRawTotal`: soma bruta (face-value, sem câmbio) do que o
 *   país gerou de comissão paga + pendente de operação.
 */
export interface CountryRich {
  code: string
  name: string
  flag: string
  transactions: number
  clients: number
  rawAmount: number
  verified: number
  approved: number
  validated: number
  pending: number
  invalid: number
  activations: number
  /** Soma em USD (via effectiveUsdAmount) dos transactions VALIDADOS, métrica de
   *  análise. Não inclui pending/invalid. */
  totalValidatedUsd: number
  /** Ticket médio em USD: totalValidatedUsd / clientes únicos validados. */
  avgTicketUsd: number
  commission: {
    fixedUsd: number
    percentageByCurrency: { USD: number; EUR: number; GBP: number }
    pendingByCurrency: { USD: number; EUR: number; GBP: number }
    /** Face-value total (USD+EUR+GBP somados sem câmbio). */
    payableRawTotal: number
  }
}

export function geoByPhoneRich(transactions: Transaction[]): CountryRich[] {
  // TODO: quando `from_user_id` for propagado pelo backend pro doc da transação,
  // trocar `validatedClients` pra usar from_user_id em vez de clientId (login).
  // Hoje 1 cliente pode ter várias contas, o ticket médio pode subestimar.
  const buckets = new Map<
    string,
    {
      code: string
      name: string
      flag: string
      transactions: number
      clients: Set<string>
      validatedClients: Set<string>
      rawAmount: number
      totalValidatedUsd: number
      verified: number
      approved: number
      validated: number
      pending: number
      invalid: number
      activations: number
      fixedUsd: number
      pct: { USD: number; EUR: number; GBP: number }
      pend: { USD: number; EUR: number; GBP: number }
    }
  >()

  for (const d of transactions) {
    const c = resolveCountry(d)
    const key = c?.code ?? '??'
    const name = c?.name ?? 'Desconhecido'
    const flag = c?.flag ?? '🌐'

    const cur =
      buckets.get(key) ??
      {
        code: key,
        name,
        flag,
        transactions: 0,
        clients: new Set<string>(),
        validatedClients: new Set<string>(),
        rawAmount: 0,
        totalValidatedUsd: 0,
        verified: 0,
        approved: 0,
        validated: 0,
        pending: 0,
        invalid: 0,
        activations: 0,
        fixedUsd: 0,
        pct: { USD: 0, EUR: 0, GBP: 0 },
        pend: { USD: 0, EUR: 0, GBP: 0 },
      }
    cur.transactions += 1
    if (d.clientId) cur.clients.add(d.clientId)
    cur.rawAmount += d.amount || 0

    if (d.systemValidation === 'verified') cur.verified += 1
    if (d.conversationValidation === 'approved') cur.approved += 1

    const fs = finalStatus(d)
    if (fs === 'validated') {
      cur.validated += 1
      cur.totalValidatedUsd += effectiveUsdAmount(d)
      if (d.clientId) cur.validatedClients.add(d.clientId)
      if (d.isActivation) cur.activations += 1
    } else if (fs === 'rejected') {
      cur.invalid += 1
    } else {
      cur.pending += 1
    }

    const com = commissionForTransaction(d)
    cur.fixedUsd += com.fixedUsd
    if (com.status === 'eligible') {
      cur.pct[com.currency] += com.percentage
    } else if (com.status === 'pending_operation') {
      cur.pend[com.currency] += (d.amount || 0) * 0.01
    }

    buckets.set(key, cur)
  }

  return Array.from(buckets.values())
    .map((b) => {
      const payableRawTotal =
        b.fixedUsd + b.pct.USD + b.pct.EUR + b.pct.GBP
      const validatedClientCount = b.validatedClients.size
      const avgTicketUsd =
        validatedClientCount > 0
          ? b.totalValidatedUsd / validatedClientCount
          : 0
      return {
        code: b.code,
        name: b.name,
        flag: b.flag,
        transactions: b.transactions,
        clients: b.clients.size,
        rawAmount: b.rawAmount,
        totalValidatedUsd: b.totalValidatedUsd,
        avgTicketUsd,
        verified: b.verified,
        approved: b.approved,
        validated: b.validated,
        pending: b.pending,
        invalid: b.invalid,
        activations: b.activations,
        commission: {
          fixedUsd: b.fixedUsd,
          percentageByCurrency: b.pct,
          pendingByCurrency: b.pend,
          payableRawTotal,
        },
      }
    })
    .sort((a, b) => b.transactions - a.transactions || b.clients - a.clients)
}

/* -------------------------------------------------------------------------- */
/* Heatmap (hora x dia da semana)                                              */
/* -------------------------------------------------------------------------- */

export interface HeatmapCell {
  /** 0 = domingo, 6 = sábado */
  weekday: number
  /** 0-23 */
  hour: number
  count: number
}

/**
 * Conta transações por (dia da semana, hora do dia) baseado no `createdAt`
 * (timestamp Firestore). Útil pra ver quando o time mais opera. Retorna uma
 * matriz 7×24 com células em ordem (weekday=0,hour=0) ... (weekday=6,hour=23).
 */
export function transactionsByHourWeekday(transactions: Transaction[]): HeatmapCell[] {
  const cells: HeatmapCell[] = []
  const counts: number[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => 0),
  )
  for (const d of transactions) {
    const ms = d.createdAt?.toMillis?.() ?? 0
    if (!ms) continue
    const dt = new Date(ms)
    counts[dt.getDay()][dt.getHours()] += 1
  }
  for (let w = 0; w < 7; w++) {
    for (let h = 0; h < 24; h++) {
      cells.push({ weekday: w, hour: h, count: counts[w][h] })
    }
  }
  return cells
}

export function invalidReasonBuckets(transactions: Transaction[]): InvalidReasonBucket[] {
  const counts = new Map<InvalidReasonCode, number>()
  for (const d of transactions) {
    if (d.systemValidation !== 'invalid' && d.systemValidation !== 'duplicate') continue
    const r = inferInvalidReason(d)
    if (!r) continue
    counts.set(r.code, (counts.get(r.code) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([code, count]) => ({ code, label: reasonLabel[code], count }))
    .sort((a, b) => b.count - a.count)
}
