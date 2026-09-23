/**
 * Cotação histórica EUR/GBP → USD via Frankfurter (BCE).
 *
 * - Gratuita, sem chave, dados oficiais do Banco Central Europeu.
 * - Cotação comercial publicada diariamente em dias úteis. Pra finais de
 *   semana e feriados a API retorna a cotação do último dia útil, guardamos
 *   a `rateDate` que veio na resposta pra ser transparente na UI.
 * - Cache em duas camadas: memória (mapa do módulo) + `sessionStorage` pra
 *   sobreviver a navegações.
 *
 * Endpoint: `GET https://api.frankfurter.dev/v1/{YYYY-MM-DD}?from={EUR|GBP}&to=USD`
 *
 * (O domínio antigo `api.frankfurter.app` ainda existe mas retorna 301 pro
 *  domínio novo: fetch CORS no browser não segue o redirect entre origens, então
 *  precisamos chamar `.dev/v1` direto.)
 */

import type { Currency } from '../types'

export interface UsdConversion {
  /** Cotação efetiva utilizada: 1 unidade da moeda fonte = `rate` USD. */
  rate: number
  /** Data efetiva (último dia útil) da cotação retornada pela API. */
  rateDate: string
  /** Provedor da cotação: guardado pra rastreabilidade. */
  source: 'frankfurter' | 'identity'
}

const memCache = new Map<string, UsdConversion>()
const STORAGE_PREFIX = 'fx:v2:'
const FRANKFURTER_BASE = 'https://api.frankfurter.dev/v1'

function cacheKey(from: Currency, dateIso: string): string {
  return `${from}:${dateIso}`
}

function readStorage(key: string): UsdConversion | null {
  try {
    const raw = window.sessionStorage?.getItem(STORAGE_PREFIX + key)
    if (!raw) return null
    return JSON.parse(raw) as UsdConversion
  } catch {
    return null
  }
}

function writeStorage(key: string, val: UsdConversion): void {
  try {
    window.sessionStorage?.setItem(STORAGE_PREFIX + key, JSON.stringify(val))
  } catch {
    // Ignora: storage cheio ou indisponível, não bloqueia.
  }
}

/**
 * Busca a cotação `from → USD` no `dateIso` (YYYY-MM-DD). Para `from='USD'`
 * retorna identidade sem hit de rede.
 *
 * Lança erro se a API falhar, o caller decide se cria sem conversão ou aborta.
 */
export async function getUsdRate(
  from: Currency,
  dateIso: string,
): Promise<UsdConversion> {
  if (from === 'USD') {
    return { rate: 1, rateDate: dateIso, source: 'identity' }
  }

  const key = cacheKey(from, dateIso)
  const mem = memCache.get(key)
  if (mem) return mem

  const stored = readStorage(key)
  if (stored) {
    memCache.set(key, stored)
    return stored
  }

  const url = `${FRANKFURTER_BASE}/${dateIso}?from=${from}&to=USD`
  const res = await fetch(url, { method: 'GET' })
  if (!res.ok) {
    throw new Error(`Falha ao consultar cotação ${from}→USD em ${dateIso} (HTTP ${res.status})`)
  }
  const json = (await res.json()) as {
    base: string
    date: string
    rates: { USD?: number }
  }
  const rate = json.rates?.USD
  if (typeof rate !== 'number' || !isFinite(rate) || rate <= 0) {
    throw new Error(`Cotação ${from}→USD inválida pra ${dateIso}`)
  }
  const result: UsdConversion = {
    rate,
    rateDate: json.date || dateIso,
    source: 'frankfurter',
  }
  memCache.set(key, result)
  writeStorage(key, result)
  return result
}

/**
 * Converte `amount` na moeda `from` pra USD usando a cotação do `dateIso`.
 * Retorna `null` caso a busca de cotação falhe, caller deve gravar a transação
 * sem `usdAmount` (UI mostra "conversão pendente").
 */
export async function convertToUsd(
  amount: number,
  from: Currency,
  dateIso: string,
): Promise<{ usdAmount: number; usdRate: number; usdRateDate: string } | null> {
  try {
    const { rate, rateDate } = await getUsdRate(from, dateIso)
    return {
      usdAmount: amount * rate,
      usdRate: rate,
      usdRateDate: rateDate,
    }
  } catch (err) {
    console.error(`[fxRate] conversão ${from}→USD falhou em ${dateIso}:`, err)
    return null
  }
}
