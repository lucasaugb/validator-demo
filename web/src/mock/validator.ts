/**
 * Validador simulado: no sistema real, um Cloud Run Job cruza cada registro
 * com a base oficial de transações no BigQuery. No demo, qualquer registro
 * que fica com `systemValidation: 'pending'` é "validado" alguns segundos
 * depois, seguindo as mesmas regras de negócio:
 *
 *  - mesmo cliente + valor + moeda + data de outro registro → duplicado
 *  - conta do cliente terminada em 0 → simula divergência de valor (inválido)
 *  - caso contrário → verificado; primeiro registro do cliente vira ativação
 */
import { Timestamp, clone, store, type DocData } from './store'

const scheduled = new Set<string>()
const VALIDATION_DELAY_MS = 3500

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

function countryFromPhone(phone: string): string {
  const p = phone.replace(/\D/g, '')
  if (p.startsWith('55')) return 'BR'
  if (p.startsWith('351')) return 'PT'
  if (p.startsWith('54')) return 'AR'
  if (p.startsWith('52')) return 'MX'
  if (p.startsWith('57')) return 'CO'
  if (p.startsWith('56')) return 'CL'
  if (p.startsWith('1')) return 'US'
  return 'BR'
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function onTransactionWritten(id: string, _prev: DocData | undefined, next: DocData): void {
  if (next.systemValidation !== 'pending' || scheduled.has(id)) return
  scheduled.add(id)
  setTimeout(() => {
    scheduled.delete(id)
    validate(id)
  }, VALIDATION_DELAY_MS)
}

function validate(id: string): void {
  const path = `transactions/${id}`
  const d = store.get(path)
  if (!d || d.systemValidation !== 'pending') return

  const others = store.list('transactions').filter(([oid]) => oid !== id)
  const now = Timestamp.now()
  const clientId = String(d.clientId ?? '')

  const dup = others.filter(
    ([, o]) =>
      o.clientId === d.clientId &&
      Number(o.amount) === Number(d.amount) &&
      o.currency === d.currency &&
      o.transactionDate === d.transactionDate,
  )
  if (dup.length > 0) {
    const group = [[id, d] as [string, DocData], ...dup]
    const agentes = [...new Set(group.map(([, g]) => String(g.agenteId)))]
    for (const [gid, g] of group) {
      const linked = group.filter(([x]) => x !== gid)
      store.put(`transactions/${gid}`, {
        ...clone(g),
        systemValidation: 'duplicate',
        validationChecks: { duplicate_check: false },
        duplicateAlert: {
          crossAgent: agentes.length > 1,
          agentes,
          linkedTransactionIds: linked.map(([x]) => x),
          linkedTransactionNumbers: linked.map(([, l]) => Number(l.transactionNumber ?? 0)),
          setores: [...new Set(group.map(([, x]) => x.agenteSetor).filter(Boolean))],
          agentesInfo: group.map(([, x]) => ({ uid: x.agenteId, name: x.agenteName, setor: x.agenteSetor })),
        },
        updatedAt: now,
      })
    }
    return
  }

  const txId = 'TX' + String(hash(id + clientId)).slice(0, 9)
  const sourceCountry = countryFromPhone(String(d.clientPhone ?? ''))

  if (clientId.endsWith('0')) {
    store.put(path, {
      ...clone(d),
      systemValidation: 'invalid',
      validationChecks: {
        id_check: true,
        value_check: false,
        currency_check: true,
        date_check: true,
        same_row_check: false,
        duplicate_check: true,
      },
      bestCandidate: {
        sourceTransactionId: txId,
        matchCount: 3,
        loginMatch: true,
        amountMatch: false,
        currencyMatch: true,
        dateMatch: true,
        sourceAmount: Math.round(Number(d.amount) * 0.9),
        sourceCurrency: d.currency,
        sourceDate: d.transactionDate,
      },
      sourceCountry,
      updatedAt: now,
    })
    return
  }

  const isActivation = !others.some(
    ([, o]) =>
      o.clientId === d.clientId &&
      o.systemValidation === 'verified' &&
      String(o.transactionDate) <= String(d.transactionDate),
  )
  const today = new Date().toISOString().slice(0, 10)
  const opDate = addDays(String(d.transactionDate), 1 + (hash(id) % 3))
  const tribes = ['premium', 'starter', 'nao_encontrado'] as const

  store.put(path, {
    ...clone(d),
    systemValidation: 'verified',
    validationChecks: {
      id_check: true,
      value_check: true,
      currency_check: true,
      date_check: true,
      same_row_check: true,
      duplicate_check: true,
    },
    matchedTransactionId: txId,
    isActivation,
    lastOperationDate: opDate <= today ? opDate : null,
    sourceCountry,
    sourcePartnerCode: '90001',
    pipedriveTribe: tribes[hash(clientId) % 3],
    updatedAt: now,
  })
}
