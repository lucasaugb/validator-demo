/**
 * Importador de planilha pro Gestor: parse de .xlsx/.csv + validação por
 * linha + execução em lote chamando createTransaction.
 *
 * Fluxo geral:
 *   1. `parseSpreadsheet(file)` lê o arquivo e devolve `RawRow[]` (objetos
 *      com chaves = cabeçalhos da planilha, valores brutos).
 *   2. `detectColumnMapping(headers)` casa cabeçalhos com campos do sistema
 *      via lista de sinônimos.
 *   3. `validateRows(rawRows, mapping)` aplica o mapping + parsers tolerantes
 *      (telefone, moeda, valor, data) e roda Zod por linha. Devolve
 *      `ParsedRow[]` com `valid: boolean` e `error?: string`.
 *   4. `importRows(rows, agente, onProgress)` percorre os válidos em chunks
 *      de 5 paralelos, chamando `createTransaction` com `clientNonce`
 *      determinístico (hash da linha) → re-import da mesma planilha não
 *      duplica.
 *
 * Tolerância proposital: esta planilha é típica de Excel de equipe
 * comercial: vírgula decimal, cifrão no valor, telefone com/sem DDI, data
 * BR/ISO/serial Excel. O importador absorve as variações comuns; o que
 * falhar vira erro de linha visível no preview.
 */

import * as XLSX from 'xlsx'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { createTransaction } from './transactions'
import type { Agente, Currency } from '../types'

/** Limite de linhas por importação (decisão 2026-05-20). */
export const IMPORT_ROW_LIMIT = 500

/**
 * Concorrência ao executar `createTransaction` no submit.
 *
 * **Tem que ser 1.** O `createTransaction` abre transação no `metadata/counters`
 * pra incrementar `transactionsCounter`: esse doc é gargalo singular. Em paralelo
 * (>1) cada transação lê o mesmo valor e tenta escrever +1; Firestore aceita
 * só uma e aborta as outras. Cada aborto vira retry no SDK (max 5 default), e
 * com 5 workers a probabilidade de exaurir os retries é alta, testei com
 * 11 linhas e 7 falharam.
 *
 * Serial garante: cada transação espera a anterior terminar, então quando
 * abre a próxima já lê o counter atualizado e commita de primeira. Custo:
 * ~300-500ms por linha (transação + activity log) → 500 linhas em ~4 min.
 */
const IMPORT_CONCURRENCY = 1

/** Campos do sistema que mapeamos a partir dos cabeçalhos da planilha. */
export type ColumnField =
  | 'clientName'
  | 'clientEmail'
  | 'clientPhone'
  | 'clientId'
  | 'currency'
  | 'amount'
  | 'transactionDate'

/** Sinônimos aceitos pra cada campo (lowercase, sem acentos). */
const HEADER_SYNONYMS: Record<ColumnField, string[]> = {
  clientName: ['cliente', 'nome', 'nome do cliente', 'nome completo'],
  clientEmail: ['email', 'e-mail', 'e mail', 'mail'],
  clientPhone: ['telefone', 'celular', 'whatsapp', 'whats', 'fone', 'tel'],
  clientId: [
    'identificacao',
    'conta',
    'conta do cliente',
    'id',
    'clientid',
    'login',
  ],
  currency: ['moeda', 'currency'],
  amount: [
    'valor',
    'volume',
    'volume registrado',
    'valor transacionado',
    'amount',
    'valor do transacao',
  ],
  transactionDate: [
    'data',
    'data do transacao',
    'data do registro',
    'transactiondate',
    'data da transação',
  ],
}

export type ColumnMapping = Partial<Record<ColumnField, string>>

export interface RawRow {
  /** Número da linha na planilha (1-based, contando o cabeçalho como 1). */
  rowNumber: number
  /** Dicionário cru: header → valor (qualquer tipo do xlsx). */
  data: Record<string, unknown>
}

export interface ParsedRow {
  rowNumber: number
  /** Dado bruto pra debug / referência no preview. */
  raw: Record<string, unknown>
  /** Valores normalizados quando válidos. `null` em campos faltantes/inválidos. */
  parsed: {
    clientName: string | null
    clientEmail: string | null
    clientPhoneDial: string | null
    clientPhone: string | null
    clientId: string | null
    currency: Currency | null
    amount: number | null
    transactionDate: string | null
  }
  /** Linha válida pronta pra `createTransaction`? */
  valid: boolean
  /** Lista de erros legíveis encontrados nessa linha. */
  errors: string[]
}

export interface ImportProgress {
  done: number
  total: number
  failed: number
  duplicated: number
}

export type ImportProgressHandler = (p: ImportProgress) => void

/* -------------------------------------------------------------------------- */
/* Parse                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Lê o arquivo (.xlsx, .xls, .csv) e devolve linhas como objetos cujas
 * chaves são os cabeçalhos da PRIMEIRA linha da planilha. Tolerante com
 * múltiplos abas: lê só a primeira aba.
 *
 * Limite: corta em IMPORT_ROW_LIMIT linhas. Se a planilha tiver mais, o
 * caller deve avisar o usuário pra dividir em lotes.
 */
export async function parseSpreadsheet(file: File): Promise<RawRow[]> {
  const buf = await file.arrayBuffer()
  // cellDates: deixa o xlsx devolver Date object pras células com formato de
  // data; sem isso vem só o número serial e a gente precisaria converter
  // manualmente. raw=false faria com que strings com formato BR fossem
  // re-formatadas: mantenho raw=true e parseio numérico/data por conta.
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const firstSheetName = wb.SheetNames[0]
  if (!firstSheetName) return []
  const sheet = wb.Sheets[firstSheetName]
  if (!sheet) return []
  // header: 1 devolveria arrays de arrays; sem header devolve objetos com
  // keys = cabeçalhos. `defval: null` mantém células vazias no objeto.
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: true,
  })
  return json.slice(0, IMPORT_ROW_LIMIT).map((data, i) => ({
    // +2 porque XLSX começa na linha 2 (linha 1 é o cabeçalho) e i é 0-indexed
    rowNumber: i + 2,
    data,
  }))
}

/**
 * Tenta casar automaticamente cada cabeçalho da planilha com um campo do
 * sistema. Devolve mapping `field → header` quando achou e lista de campos
 * faltantes. O usuário pode sobrescrever isso na UI antes de validar.
 */
export function detectColumnMapping(headers: string[]): {
  mapping: ColumnMapping
  missing: ColumnField[]
} {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // remove acentos
      .replace(/\s+/g, ' ')
      .trim()

  const mapping: ColumnMapping = {}
  const usedHeaders = new Set<string>()

  for (const [field, synonyms] of Object.entries(HEADER_SYNONYMS) as [
    ColumnField,
    string[],
  ][]) {
    const match = headers.find((h) => {
      if (usedHeaders.has(h)) return false
      const norm = normalize(h)
      return synonyms.includes(norm)
    })
    if (match) {
      mapping[field] = match
      usedHeaders.add(match)
    }
  }

  const missing = (Object.keys(HEADER_SYNONYMS) as ColumnField[]).filter(
    (f) => !mapping[f],
  )
  return { mapping, missing }
}

/* -------------------------------------------------------------------------- */
/* Parsers individuais                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Aceita "1500,50" (BR), "1500.50" (EN), "1.500,50" (BR com milhar),
 * "$ 1.500,50", número puro do Excel. Devolve `null` se não conseguir.
 *
 * Heurística pra decidir vírgula vs ponto como decimal:
 *  - Se tem AMBOS, o ÚLTIMO marca o decimal (1.500,50 → vírgula; 1,500.50 → ponto)
 *  - Se tem só vírgula: vírgula é decimal
 *  - Se tem só ponto: PRECISA olhar, "1500.50" decimal; "1.500" milhar, heurística:
 *    se tem 3 dígitos depois do ponto e nenhum outro separador, é milhar.
 */
export function parseAmount(input: unknown): number | null {
  if (typeof input === 'number' && isFinite(input)) return input
  if (input == null) return null
  let s = String(input).trim()
  if (!s) return null

  // Remove qualquer caractere que não seja dígito, sinal, vírgula ou ponto
  s = s.replace(/[^\d.,\-]/g, '')
  if (!s) return null

  const hasComma = s.includes(',')
  const hasDot = s.includes('.')

  if (hasComma && hasDot) {
    // Ambos: o último é o decimal
    const lastComma = s.lastIndexOf(',')
    const lastDot = s.lastIndexOf('.')
    if (lastComma > lastDot) {
      // formato BR: 1.500,50
      s = s.replace(/\./g, '').replace(',', '.')
    } else {
      // formato EN: 1,500.50
      s = s.replace(/,/g, '')
    }
  } else if (hasComma) {
    s = s.replace(',', '.')
  } else if (hasDot) {
    // Só ponto. Casos:
    //  a) Milhar BR puro: "1.234", "12.345", "1.234.567", pontos sempre
    //     seguidos por EXATAMENTE 3 dígitos. Trato como milhar (remove pontos).
    //  b) Decimal EN: "1500.50", "1.5": o último ponto não é seguido por
    //     exatamente 3 dígitos.
    //  c) Ambíguo: "1.234": pode ser 1234 (BR milhar) ou 1.234 (EN com 3
    //     casas decimais). Convenção: tratamos como milhar (BR domina o uso
    //     na operação de transações da Demo Source).
    // #bug 2026-05-26: regex antiga só pegava UM grupo de milhar, então
    // "12.345" virava 12.345 e "1.234.567" virava null.
    if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, '')
    }
    // senão deixa como tá (1500.50 fica 1500.50)
  }

  const n = Number(s)
  return isFinite(n) ? n : null
}

/**
 * Detecta a moeda da transação. Prioridade:
 *   1. Coluna explícita "Moeda" (USD/EUR/GBP, case-insensitive, com ou sem símbolo)
 *   2. Símbolo (cifrão/euro/libra) DENTRO do campo de valor
 *   3. Default: USD
 */
export function parseCurrency(input: unknown): Currency | null {
  if (input == null) return null
  const s = String(input).trim().toUpperCase()
  if (!s) return null
  if (s.includes('USD') || s.includes('$') || s.includes('US$')) return 'USD'
  if (s.includes('EUR') || s.includes('€')) return 'EUR'
  if (s.includes('GBP') || s.includes('£')) return 'GBP'
  return null
}

/**
 * Aceita Date (do xlsx), "DD/MM/YYYY", "YYYY-MM-DD", "DD/MM/YY", número
 * serial do Excel. Devolve string ISO "yyyy-mm-dd" ou null.
 */
export function parseDate(input: unknown): string | null {
  if (input == null) return null

  if (input instanceof Date && !isNaN(input.getTime())) {
    return toIso(input)
  }

  if (typeof input === 'number') {
    // Serial number do Excel: XLSX já converte quando cellDates:true, mas
    // garante o fallback caso uma célula isolada venha como número.
    const d = excelSerialToDate(input)
    return d ? toIso(d) : null
  }

  const s = String(input).trim()
  if (!s) return null

  // ISO yyyy-mm-dd
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) {
    const y = Number(iso[1])
    const m = Number(iso[2])
    const d = Number(iso[3])
    if (isValidDate(y, m, d)) return `${y}-${pad(m)}-${pad(d)}`
  }

  // BR dd/mm/yyyy ou dd/mm/yy (com / ou - ou .)
  const br = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/)
  if (br) {
    let y = Number(br[3])
    const mo = Number(br[2])
    const d = Number(br[1])
    if (y < 100) y = y >= 50 ? 1900 + y : 2000 + y // 2 dígitos → século atual/anterior
    if (isValidDate(y, mo, d)) return `${y}-${pad(mo)}-${pad(d)}`
  }

  // último fallback: deixa o Date parsear (ex: "Dec 5, 2025")
  const fallback = new Date(s)
  return isNaN(fallback.getTime()) ? null : toIso(fallback)
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function isValidDate(y: number, m: number, d: number): boolean {
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return false
  const dt = new Date(y, m - 1, d)
  return (
    dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
  )
}

/**
 * True quando a string ISO `yyyy-mm-dd` é maior que a data de HOJE no fuso
 * local. Usada pra detectar planilha com dd/mm invertido (Excel US-locale
 * leu "05/12/2026" como May 12 em vez de Dec 5). Transação é evento passado
 *: qualquer data > hoje é suspeita.
 */
function isFutureDate(isoYmd: string): boolean {
  const m = isoYmd.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return false
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const today = new Date()
  // Zera horas pra comparação só de data, transação feito HOJE não é futuro.
  today.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)
  return target.getTime() > today.getTime()
}

function excelSerialToDate(serial: number): Date | null {
  // Excel: dia 1 = 1900-01-01 (com bug do 1900 sendo bissexto)
  // serial 25569 = 1970-01-01 UTC
  const ms = (serial - 25569) * 86400 * 1000
  const d = new Date(ms)
  return isNaN(d.getTime()) ? null : d
}

/**
 * Aceita "+55 11 98765-4321", "+351 918 563 482", "5511987654321",
 * "11 98765-4321", "(11) 98765-4321". Devolve dial + phone separados.
 *
 * Heurística pra extrair o DDI:
 *  - Se começa com `+`, pega tudo até o primeiro espaço/grupo (1-3 dígitos)
 *  - Se começa com 55 e tem 12-13 dígitos, assume Brasil
 *  - Senão assume Brasil (55) e deixa o número inteiro
 *
 * (Por simplicidade não tentamos detectar DDIs estrangeiros sem o `+`. O
 * usuário pediu: "sem DDI → assume Brasil".)
 */
export function parsePhoneStr(input: unknown): {
  dial: string
  phone: string
} | null {
  if (input == null) return null
  const s = String(input).trim()
  if (!s) return null

  // Caso 1: tem `+` no início → DDI explícito
  if (s.startsWith('+')) {
    const digits = s.slice(1).replace(/\D/g, '')
    if (digits.length < 8) return null
    // DDI 1-3 dígitos. Tenta 3 → 2 → 1 buscando comprimento total razoável (8-15)
    for (const ddiLen of [3, 2, 1]) {
      const ddi = digits.slice(0, ddiLen)
      const rest = digits.slice(ddiLen)
      if (rest.length >= 7 && rest.length <= 15) {
        return { dial: ddi, phone: rest }
      }
    }
    return null
  }

  // Caso 2: sem `+`: assume Brasil. Limpa pra dígitos.
  const digits = s.replace(/\D/g, '')
  if (digits.length < 8) return null

  // Se já começa com "55" e tem 12-13 dígitos no total, é Brasil com DDI embutido
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return { dial: '55', phone: digits.slice(2) }
  }
  // Senão assume DDI 55 e o número inteiro como local
  return { dial: '55', phone: digits }
}

export function parseEmail(input: unknown): string | null {
  if (input == null) return null
  const s = String(input).trim()
  // Regex simples; o Zod no createTransaction já valida formalmente.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return null
  return s.toLowerCase()
}

export function parseClientId(input: unknown): string | null {
  if (input == null) return null
  // Remove qualquer não-dígito (a planilha às vezes tem espaços ou prefixos)
  const s = String(input).replace(/\D/g, '')
  return s.length > 0 ? s : null
}

export function parseString(input: unknown): string | null {
  if (input == null) return null
  const s = String(input).trim()
  return s.length > 0 ? s : null
}

/* -------------------------------------------------------------------------- */
/* Validação                                                                   */
/* -------------------------------------------------------------------------- */

export function validateRows(
  raws: RawRow[],
  mapping: ColumnMapping,
): ParsedRow[] {
  return raws.map((r) => validateRow(r, mapping))
}

function validateRow(raw: RawRow, mapping: ColumnMapping): ParsedRow {
  const errors: string[] = []
  const get = (field: ColumnField) =>
    mapping[field] ? raw.data[mapping[field]!] : undefined

  const clientName = parseString(get('clientName'))
  if (!clientName) errors.push('nome do cliente faltando')

  const clientEmail = parseEmail(get('clientEmail'))
  if (!clientEmail) errors.push('email inválido ou faltando')

  const phoneRaw = get('clientPhone')
  const phone = parsePhoneStr(phoneRaw)
  if (!phone) errors.push('telefone inválido ou faltando')

  const clientId = parseClientId(get('clientId'))
  if (!clientId) errors.push('identificação faltando')

  // Moeda: tenta a coluna dedicada; se não tiver, extrai do valor
  let currency: Currency | null = parseCurrency(get('currency'))
  const amountRaw = get('amount')
  if (!currency) currency = parseCurrency(amountRaw)
  if (!currency) currency = 'USD' // default seguro

  const amount = parseAmount(amountRaw)
  if (amount == null || amount <= 0) errors.push('valor inválido ou faltando')

  const transactionDate = parseDate(get('transactionDate'))
  if (!transactionDate) {
    errors.push('data inválida ou faltando')
  } else if (isFutureDate(transactionDate)) {
    // Transação é evento histórico: data no futuro indica que o Excel inverteu
    // dd/mm (planilha vinda de máquina com locale US, ex: "05/12/2026" virou
    // May 12 em vez de Dec 5). Não dá pra desfazer com certeza, então
    // sinalizamos pro gestor checar a planilha. #bug 2026-05-26
    errors.push(
      `data no futuro (${transactionDate}): verifique se a planilha está em formato dd/mm/aaaa`,
    )
  }

  return {
    rowNumber: raw.rowNumber,
    raw: raw.data,
    parsed: {
      clientName,
      clientEmail,
      clientPhoneDial: phone?.dial ?? null,
      clientPhone: phone?.phone ?? null,
      clientId,
      currency,
      amount,
      transactionDate,
    },
    valid: errors.length === 0,
    errors,
  }
}

/* -------------------------------------------------------------------------- */
/* Execução                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Hash determinístico baseado em (agenteId, clientId, currency, amount,
 * transactionDate). Usado como `clientNonce` do createTransaction → mesma linha
 * importada 2 vezes gera o MESMO docId → Firestore rejeita o 2º create →
 * importador conta como "já existia".
 *
 * SHA-1 via Web Crypto. 20 chars do hex suficiente pra colisão improvável.
 */
async function rowNonce(
  agenteId: string,
  row: ParsedRow,
): Promise<string> {
  const p = row.parsed
  const canonical = [
    agenteId,
    p.clientId ?? '',
    p.currency ?? '',
    p.amount ?? '',
    p.transactionDate ?? '',
  ].join('|')
  const buf = new TextEncoder().encode(canonical)
  const digest = await crypto.subtle.digest('SHA-1', buf)
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `imp-${hex.slice(0, 20)}`
}

export interface ImportResult {
  imported: number
  duplicated: number
  failed: number
  errors: { rowNumber: number; reason: string }[]
}

/**
 * Roda `createTransaction` pra cada linha válida com concorrência limitada.
 * Linhas com erro são puladas. Re-import da mesma planilha não duplica
 * (graças ao nonce determinístico).
 */
export async function importRows(
  rows: ParsedRow[],
  agente: Pick<Agente, 'uid' | 'name' | 'setor'>,
  onProgress?: ImportProgressHandler,
): Promise<ImportResult> {
  const valids = rows.filter((r) => r.valid)
  const result: ImportResult = {
    imported: 0,
    duplicated: 0,
    failed: 0,
    errors: [],
  }
  const total = valids.length
  let done = 0

  const emit = () =>
    onProgress?.({
      done,
      total,
      failed: result.failed,
      duplicated: result.duplicated,
    })

  // Fila simples com semáforo manual (Promise.all em batches)
  const queue = [...valids]
  const workers: Promise<void>[] = []

  for (let w = 0; w < IMPORT_CONCURRENCY; w++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const row = queue.shift()
          if (!row) break
          try {
            const nonce = await rowNonce(agente.uid, row)
            // Check pré-importação: se o doc com esse nonce já existe, é
            // re-importação da mesma linha: conta como "duplicado" em vez
            // de "importado", sem chamar createTransaction (que faria o mesmo
            // check silenciosamente).
            const existing = await getDoc(doc(db, 'transactions', nonce))
            if (existing.exists()) {
              result.duplicated += 1
              continue
            }
            const fullPhone = `+${row.parsed.clientPhoneDial} ${row.parsed.clientPhone}`.trim()
            await createTransaction({
              agenteId: agente.uid,
              agenteName: agente.name,
              agenteSetor: agente.setor,
              clientName: row.parsed.clientName!,
              clientEmail: row.parsed.clientEmail!,
              clientPhone: fullPhone,
              clientId: row.parsed.clientId!,
              currency: row.parsed.currency!,
              amount: row.parsed.amount!,
              transactionDate: row.parsed.transactionDate!,
              transactionReceipts: [],
              conversationReceipts: [],
              clientNonce: nonce,
              markImported: true,
            })
            result.imported += 1
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            result.failed += 1
            result.errors.push({ rowNumber: row.rowNumber, reason: msg })
          } finally {
            done += 1
            emit()
          }
        }
      })(),
    )
  }

  await Promise.all(workers)
  emit()
  return result
}
