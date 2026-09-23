import type { Currency, MetaKind } from '../types'

/**
 * `formatCurrency` honra a moeda (transações em EUR mostram € etc.).
 * `formatMoney` sempre formata em USD: usado pra comissão, totais convertidos
 * e qualquer valor já em USD.
 */
const localeFor: Record<Currency, string> = {
  USD: 'en-US',
  EUR: 'de-DE',
  GBP: 'en-GB',
}

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

export const formatMoney = (value: number): string =>
  usdFormatter.format(value || 0)

/**
 * USD compacto para rótulos de gráfico (eixos/labels), onde `formatMoney`
 * ("$410,000.00") polui. Ex.: 410000 → "$410k", 12300 → "$12.3k", 850 → "$850".
 */
export const formatMoneyCompact = (value: number): string => {
  const v = value || 0
  const sign = v < 0 ? '-' : ''
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}k`
  return `${sign}$${Math.round(abs)}`
}

/**
 * Contagem (ativações). Valores derivados de meta, meta diária, meta
 * acumulada, gap: podem ser fracionários; aí mostra 1 casa pra não parecer
 * que a meta diária é zero. Inteiros saem sem casas.
 */
export const formatCount = (value: number): string => {
  const v = value || 0
  if (!Number.isInteger(v) && Math.abs(v) < 100) {
    return v.toFixed(1).replace('.', ',')
  }
  return formatNumber(Math.round(v))
}

/**
 * Formata um valor de meta/forecast conforme a métrica: USD pra volume,
 * contagem pra ativação. Evita `formatMoney` num número de ativações.
 */
export const formatMetric = (value: number, kind: MetaKind): string =>
  kind === 'ativacao' ? formatCount(value) : formatMoney(value)

/** Versão compacta (rótulos de gráfico / tiles). Contagem já é curta. */
export const formatMetricCompact = (value: number, kind: MetaKind): string =>
  kind === 'ativacao' ? formatCount(value) : formatMoneyCompact(value)

export const formatCurrency = (value: number, currency: Currency = 'USD'): string =>
  new Intl.NumberFormat(localeFor[currency], {
    style: 'currency',
    currency,
  }).format(value || 0)

export const formatNumber = (value: number): string =>
  new Intl.NumberFormat('pt-BR').format(value || 0)

export const formatDateBR = (iso: string): string => {
  if (!iso) return '-'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export const todayISO = (): string => new Date().toISOString().slice(0, 10)
