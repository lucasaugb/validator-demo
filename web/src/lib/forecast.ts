import type { Transaction, MetaKind } from '../types'
import { finalStatus } from '../types'
import { effectiveUsdAmount } from './commission'

/**
 * Forecast de fechamento do mês por RITMO em DIAS ÚTEIS (seg-sex).
 *
 * Decisões (2026-07-13, pedido do Gerente operacional):
 *  - Base = realizado VALIDADO (finalStatus === 'validated').
 *  - Projeção = (validado até hoje ÷ dias úteis decorridos) × dias úteis do mês.
 *  - Fim de semana NÃO gera crescimento esperado (sáb/dom = 0); só seg-sex
 *    puxam a projeção. A projeção fica estável ao longo do fim de semana.
 *  - Mês passado = sem projeção (projeção = realizado final).
 *  - Mês futuro = sem realizado nem projeção (0).
 *
 * MÉTRICA (2026-07-31): a mesma estrutura serve pra duas bases, escolhidas pelo
 * `MetaKind`:
 *  - 'transacao' → volume validado em USD.
 *  - 'ativacao' → nº de ativações validadas (1º transação do cliente).
 * Os números aqui são adimensionais: quem formata ($ ou contagem) é a UI, via
 * `formatMetric`. Nenhum campo carrega unidade no nome por isso.
 *
 * Os campos `daysElapsed`/`daysInMonth` referem-se a DIAS ÚTEIS.
 * O forecast é puramente informativo: não toca comissão nem fechamento.
 */
export interface Forecast {
  /** yyyy-MM ao qual o forecast se refere. */
  month: string
  /** Realizado acumulado no mês até agora (USD ou nº de ativações). */
  realized: number
  /** Projeção de fechamento do mês. */
  projected: number
  /** Meta do escopo. */
  meta: number
  /** realizado ÷ meta (0..∞). 0 se meta = 0. */
  attainmentPct: number
  /** projeção ÷ meta (0..∞). 0 se meta = 0. */
  projectedPct: number
  /** meta − projeção. Positivo = falta; negativo = supera. */
  gap: number
  /** Dias corridos já decorridos no mês (1..daysInMonth). */
  daysElapsed: number
  /** Total de dias do mês. */
  daysInMonth: number
  isCurrentMonth: boolean
  isPastMonth: boolean
}

/** yyyy-MM do Date informado (horário local). */
export function yearMonthOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Conta dias ÚTEIS (seg-sex) do dia `fromDay` ao `toDay` (inclusive) no mês.
 * `mo1` é 1-based.
 */
export function countBusinessDays(y: number, mo1: number, fromDay: number, toDay: number): number {
  let n = 0
  for (let d = fromDay; d <= toDay; d++) {
    const wd = new Date(y, mo1 - 1, d).getDay() // 0=dom, 6=sáb
    if (wd !== 0 && wd !== 6) n += 1
  }
  return n
}

/**
 * Monta o forecast a partir do realizado (validado no mês) e da meta.
 * `now` é injetável pra testes; default = agora.
 */
export function buildForecast(
  realized: number,
  meta: number,
  month: string,
  now: Date = new Date(),
): Forecast {
  const [y, mo] = month.split('-').map(Number)
  const lastDay = new Date(y, mo, 0).getDate() // mo é 1-based → dia 0 do próximo = último deste
  const daysInMonth = countBusinessDays(y, mo, 1, lastDay) // dias úteis do mês
  const nowYm = yearMonthOf(now)
  const isCurrentMonth = month === nowYm
  const isPastMonth = month < nowYm

  let daysElapsed: number
  let projected: number
  if (isPastMonth) {
    daysElapsed = daysInMonth
    projected = realized // mês fechado, sem extrapolação
  } else if (isCurrentMonth) {
    // Dias úteis decorridos (fim de semana não conta e não gera crescimento).
    daysElapsed = countBusinessDays(y, mo, 1, now.getDate())
    projected = daysElapsed > 0 ? (realized / daysElapsed) * daysInMonth : realized
  } else {
    // mês futuro
    daysElapsed = 0
    projected = 0
  }

  const attainmentPct = meta > 0 ? realized / meta : 0
  const projectedPct = meta > 0 ? projected / meta : 0
  const gap = meta - projected

  return {
    month,
    realized,
    projected,
    meta,
    attainmentPct,
    projectedPct,
    gap,
    daysElapsed,
    daysInMonth,
    isCurrentMonth,
    isPastMonth,
  }
}

/**
 * Contribuição de UM transação pra métrica em foco.
 *  - 'transacao' → valor em USD (com o fallback de conversão).
 *  - 'ativacao' → 1 se for ativação (1º transação do cliente), senão 0.
 */
export function metricValueOf(d: Transaction, kind: MetaKind): number {
  if (kind === 'ativacao') return d.isActivation ? 1 : 0
  return effectiveUsdAmount(d)
}

/**
 * Soma o realizado VALIDADO das transações cujo `transactionDate` cai no mês.
 * Filtro por escopo (setor/colaborador) deve ser feito ANTES de chamar.
 */
export function realizedValidated(
  transactions: Transaction[],
  month: string,
  kind: MetaKind = 'transacao',
): number {
  let sum = 0
  for (const d of transactions) {
    if (finalStatus(d) !== 'validated') continue
    if ((d.transactionDate || '').slice(0, 7) !== month) continue
    sum += metricValueOf(d, kind)
  }
  return sum
}

/** Atalho legado: volume validado em USD. */
export function realizedValidatedUsd(transactions: Transaction[], month: string): number {
  return realizedValidated(transactions, month, 'transacao')
}

/* --------------------------------------------------------------------------- */
/* Série diária (realizado acumulado × meta acumulada) + métricas de ritmo      */
/* --------------------------------------------------------------------------- */

/** Um dia do mês na série do gráfico Realizado × Meta. */
export interface ForecastDailyPoint {
  /** Dia do mês (1..lastDay). */
  day: number
  /** Rótulo "dd/MM" pro eixo X. */
  label: string
  /** Sábado ou domingo (meta não cresce; barra some se futuro). */
  isWeekend: boolean
  /** Dia ainda não decorrido (mês corrente, depois de hoje). Sem barra. */
  isFuture: boolean
  /** Realizado acumulado até este dia (null nos dias futuros). */
  realizedCum: number | null
  /** Meta acumulada até este dia: só cresce em dia útil (seg-sex). */
  metaCum: number
}

/**
 * Métricas de ritmo do mês (base dos cards do topo do Forecast) + a série
 * diária pro gráfico. Fim de semana NÃO tem meta (sáb/dom = 0), então a meta
 * diária é a meta do mês dividida pelos DIAS ÚTEIS e só acumula seg-sex.
 */
export interface ForecastDaily {
  points: ForecastDailyPoint[]
  /** Meta por dia útil = meta ÷ dias úteis do mês. */
  metaDaily: number
  /** Meta acumulada esperada até hoje (dias úteis decorridos × metaDaily). */
  metaAccumToday: number
  /** Realizado no dia de hoje (só o transactionDate de hoje). */
  realizedToday: number
  /** Dia de hoje (1..lastDay) no mês em foco; 0 se mês futuro. */
  todayDay: number
  /** Realizado acumulado − meta acumulada até hoje. Negativo = abaixo do ritmo. */
  gapVsMetaAccum: number
  /** Quanto precisa realizar por dia útil restante pra bater a meta. */
  neededPerDay: number
  /** Dias úteis que ainda faltam no mês. */
  businessDaysRemaining: number
  /** Total de dias úteis do mês. */
  businessDaysInMonth: number
}

/**
 * Monta a série diária + métricas de ritmo a partir das transações do escopo
 * (já filtrados) e da meta do mês. `now` injetável pra testes.
 */
export function buildForecastDaily(
  transactions: Transaction[],
  meta: number,
  month: string,
  kind: MetaKind = 'transacao',
  now: Date = new Date(),
): ForecastDaily {
  const [y, mo] = month.split('-').map(Number)
  const lastDay = new Date(y, mo, 0).getDate()
  const businessDaysInMonth = countBusinessDays(y, mo, 1, lastDay)
  const metaDaily = businessDaysInMonth > 0 ? meta / businessDaysInMonth : 0

  const nowYm = yearMonthOf(now)
  const isCurrentMonth = month === nowYm
  const isPastMonth = month < nowYm
  // Dia "de hoje" dentro do mês em foco: mês corrente = hoje; mês passado =
  // último dia (tudo decorrido); mês futuro = 0 (nada decorrido).
  const todayDay = isCurrentMonth ? now.getDate() : isPastMonth ? lastDay : 0

  // Realizado por dia do mês.
  const perDay = new Array<number>(lastDay + 1).fill(0)
  for (const d of transactions) {
    if (finalStatus(d) !== 'validated') continue
    const dd = d.transactionDate || ''
    if (dd.slice(0, 7) !== month) continue
    const day = Number(dd.slice(8, 10))
    if (day >= 1 && day <= lastDay) perDay[day] += metricValueOf(d, kind)
  }

  const points: ForecastDailyPoint[] = []
  let realizedAcc = 0
  let metaAcc = 0
  for (let day = 1; day <= lastDay; day++) {
    const wd = new Date(y, mo - 1, day).getDay() // 0=dom, 6=sáb
    const isWeekend = wd === 0 || wd === 6
    if (!isWeekend) metaAcc += metaDaily // meta só cresce em dia útil
    const isFuture = isCurrentMonth && day > todayDay
    if (!isFuture) realizedAcc += perDay[day]
    points.push({
      day,
      label: `${String(day).padStart(2, '0')}/${String(mo).padStart(2, '0')}`,
      isWeekend,
      isFuture,
      realizedCum: isFuture ? null : realizedAcc,
      metaCum: metaAcc,
    })
  }

  const bdElapsed = todayDay > 0 ? countBusinessDays(y, mo, 1, todayDay) : 0
  const metaAccumToday = metaDaily * bdElapsed
  const realizedTotal = realizedAcc // acumulado até hoje
  const realizedToday = todayDay > 0 ? perDay[todayDay] : 0
  const gapVsMetaAccum = realizedTotal - metaAccumToday
  const businessDaysRemaining = Math.max(0, businessDaysInMonth - bdElapsed)
  const remainingToMeta = Math.max(0, meta - realizedTotal)
  const neededPerDay =
    businessDaysRemaining > 0 ? remainingToMeta / businessDaysRemaining : 0

  return {
    points,
    metaDaily,
    metaAccumToday,
    realizedToday,
    todayDay,
    gapVsMetaAccum,
    neededPerDay,
    businessDaysRemaining,
    businessDaysInMonth,
  }
}
