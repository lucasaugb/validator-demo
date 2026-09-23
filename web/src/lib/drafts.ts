/**
 * Rascunhos locais de TransactionForm: guarda em `localStorage` por agente.
 *
 * Objetivo: se o usuário fecha a aba antes de enviar, perde a internet ou
 * recarrega o navegador, ele consegue voltar ao mesmo formulário e clicar
 * Enviar de novo sem redigitar tudo. **Não persiste imagens** (binary cara
 * demais pra localStorage); só os campos texto/numéricos.
 *
 * Chave única do rascunho = `nonce` (UUID). O mesmo nonce vira o docId do
 * transação quando o submit completa: isso casa com idempotência: 2º clique
 * (ou retry após falha de rede que já confirmou) tenta criar o MESMO docId,
 * e a rule do Firestore rejeita o create duplicado.
 */

const PREFIX_DRAFT = 'validator:draft:'

export interface TransactionDraft {
  /** UUID: chave do draft e docId quando enviar. */
  nonce: string
  clientName: string
  clientEmail: string
  clientPhone: string
  clientPhoneDial: string
  clientId: string
  currency: 'USD' | 'EUR' | 'GBP'
  amount: string
  transactionDate: string
  /** Última vez que o draft foi tocado (epoch ms), pra ordenar e expirar. */
  updatedAt: number
}

const MAX_DRAFTS_PER_AGENTE = 50

/**
 * Gera UUID v4: usa Crypto API quando disponível, fallback Math.random pra
 * suportar contextos não-seguros (raro mas defensivo).
 */
export function generateNonce(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  // RFC4122 v4 fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function keyFor(uid: string, nonce: string): string {
  return `${PREFIX_DRAFT}${uid}:${nonce}`
}

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function saveDraft(uid: string, draft: TransactionDraft): void {
  if (!uid || !draft.nonce) return
  try {
    localStorage.setItem(
      keyFor(uid, draft.nonce),
      JSON.stringify({ ...draft, updatedAt: Date.now() }),
    )
    // Limpa drafts mais velhos se passou do limite (defensivo, evita
    // localStorage estourar com lixo).
    enforceLimit(uid)
  } catch {
    // localStorage cheio ou desabilitado: silencioso, é best-effort.
  }
}

export function loadDraft(uid: string, nonce: string): TransactionDraft | null {
  if (!uid || !nonce) return null
  try {
    return safeJsonParse<TransactionDraft>(localStorage.getItem(keyFor(uid, nonce)))
  } catch {
    return null
  }
}

export function deleteDraft(uid: string, nonce: string): void {
  if (!uid || !nonce) return
  try {
    localStorage.removeItem(keyFor(uid, nonce))
  } catch {
    // ignore
  }
}

export function listDrafts(uid: string): TransactionDraft[] {
  if (!uid) return []
  const prefix = `${PREFIX_DRAFT}${uid}:`
  const out: TransactionDraft[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(prefix)) continue
      const draft = safeJsonParse<TransactionDraft>(localStorage.getItem(k))
      if (draft && draft.nonce) out.push(draft)
    }
  } catch {
    // ignore
  }
  // Mais recente primeiro
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  return out
}

function enforceLimit(uid: string): void {
  const drafts = listDrafts(uid)
  if (drafts.length <= MAX_DRAFTS_PER_AGENTE) return
  // Mantém os MAX mais recentes; apaga o resto.
  const excess = drafts.slice(MAX_DRAFTS_PER_AGENTE)
  for (const d of excess) {
    deleteDraft(uid, d.nonce)
  }
}

/**
 * Verdadeiro se o draft tem QUALQUER campo preenchido (não é apenas o
 * default vazio). Usado pra decidir mostrar o painel "rascunhos não enviados".
 */
export function isDraftMeaningful(d: TransactionDraft): boolean {
  return Boolean(
    d.clientName.trim() ||
      d.clientEmail.trim() ||
      d.clientPhone.trim() ||
      d.clientId.trim() ||
      d.amount.trim(),
  )
}
