import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDoc,
  limit as fbLimit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore'
import type { Unsubscribe } from 'firebase/firestore'
import { auth, db } from '../firebase/config'
import type { Role, Setor } from '../types'

/**
 * Log de atividade humana: qualquer ação que um usuário (agente/admin/super)
 * executa explicitamente no sistema é gravada aqui. Triggers automáticos (Cloud
 * Functions, scheduler) NÃO geram entrada.
 */
export type ActivityAction =
  | 'transaction.create'
  | 'transaction.edit-request'
  | 'transaction.edit-approve'
  | 'transaction.edit-reject'
  | 'transaction.edit-direct'
  | 'transaction.delete'
  | 'transaction.conversation-approve'
  | 'transaction.conversation-reject'
  | 'transaction.conversation-pending'
  | 'transaction.fx-recalc'
  | 'transaction.force-revalidate'
  | 'transaction.receipts-add'
  | 'transaction.receipt-remove'
  | 'transaction.commission-settle'
  | 'transaction.commission-unsettle'
  | 'agente.create'
  | 'agente.update'
  | 'agente.deactivate'
  | 'agente.activate'
  | 'agente.delete'
  | 'agente.password-reset'
  | 'meta.update'

export interface ActivityLogEntry {
  id: string
  actorUid: string
  actorName: string
  actorRole: Role
  actorSetor: Setor | null
  action: ActivityAction
  targetType: 'transaction' | 'agente' | 'meta'
  targetId: string
  /** Label legível pra exibir na linha (ex.: "#42 · João Silva"). */
  targetLabel: string
  /** Diff campo→{from,to} pra edições. Mantido enxuto. */
  changes?: Record<string, { from: unknown; to: unknown }>
  note?: string
  createdAt: Timestamp
}

/* ---------------------------- ator atual ------------------------------- */

let currentActor: {
  uid: string
  name: string
  role: Role
  setor: Setor | null
} | null = null

/**
 * Define o ator atual: chamado pelo AuthContext sempre que o agente loga
 * ou muda. logActivity() lê esse valor em vez de receber por parâmetro
 * (evita propagar `agente` por toda a árvore de chamadas).
 */
export function setActivityActor(
  actor: { uid: string; name: string; role: Role; setor?: Setor } | null,
): void {
  if (!actor) {
    currentActor = null
    return
  }
  currentActor = {
    uid: actor.uid,
    name: actor.name,
    role: actor.role,
    setor: actor.setor ?? null,
  }
}

/* ----------------------------- log write ------------------------------- */

interface LogInput {
  action: ActivityAction
  targetType: 'transaction' | 'agente' | 'meta'
  targetId: string
  targetLabel: string
  changes?: Record<string, { from: unknown; to: unknown }>
  note?: string
}

/**
 * Grava uma entrada de log. **Não bloqueia** o fluxo, falhas em escrita são
 * apenas logadas no console.error.
 *
 * Se `currentActor` ainda não foi setado pelo AuthContext (race no boot),
 * tenta hidratar lendo o user atual do Firebase Auth + agentes/{uid}. Cache
 * em currentActor pra próximas chamadas serem instantâneas.
 */
export async function logActivity(input: LogInput): Promise<void> {
  const actor = await resolveActor()
  if (!actor) {
    console.warn('[activityLog] sem ator (não autenticado?), log ignorado:', input.action)
    return
  }
  try {
    await addDoc(collection(db, 'activityLog'), {
      actorUid: actor.uid,
      actorName: actor.name,
      actorRole: actor.role,
      actorSetor: actor.setor,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      targetLabel: input.targetLabel,
      changes: input.changes ?? null,
      note: input.note ?? null,
      createdAt: serverTimestamp(),
    })
  } catch (err) {
    console.error(
      `[activityLog] falha ao gravar action=${input.action} target=${input.targetId}:`,
      err,
    )
  }
}

/**
 * Garante um ator antes de gravar. Primeiro tenta o cache (currentActor setado
 * pelo AuthContext). Se vazio, busca direto do Auth + Firestore, útil em
 * race no boot da app ou quando uma chamada acontece muito cedo.
 */
async function resolveActor() {
  if (currentActor) return currentActor
  const fbUser = auth.currentUser
  if (!fbUser) return null
  try {
    const snap = await getDoc(doc(db, 'agentes', fbUser.uid))
    if (!snap.exists()) return null
    const data = snap.data() as {
      name?: string
      role?: Role
      setor?: Setor
    }
    if (!data.role) return null
    const actor = {
      uid: fbUser.uid,
      name: data.name ?? fbUser.email ?? fbUser.uid,
      role: data.role,
      setor: data.setor ?? null,
    }
    currentActor = actor
    return actor
  } catch (err) {
    console.error('[activityLog] falha ao hidratar ator:', err)
    return null
  }
}

/* ----------------------------- log read -------------------------------- */

/**
 * Stream realtime das últimas N entradas (default 200). Mostra TUDO, qualquer
 * usuário humano (agente/admin/super_admin) que tocou no sistema aparece.
 * Filtro por role/usuário fica a cargo da tela de log via UI.
 */
export function subscribeActivityLog(
  cb: (entries: ActivityLogEntry[]) => void,
  limit = 200,
): Unsubscribe {
  const q = query(
    collection(db, 'activityLog'),
    orderBy('createdAt', 'desc'),
    fbLimit(limit),
  )
  return onSnapshot(q, (snap) => {
    const out: ActivityLogEntry[] = []
    for (const d of snap.docs) {
      const raw = d.data() as Omit<ActivityLogEntry, 'id'>
      out.push({ id: d.id, ...raw })
    }
    cb(out)
  })
}
