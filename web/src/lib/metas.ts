import {
  collection,
  deleteField,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import type { Timestamp, Unsubscribe } from 'firebase/firestore'
import { db } from '../firebase/config'
import { logActivity } from './activityLog'
import { SETORES } from '../types'
import type { Agente, MetaKind, Setor } from '../types'

/**
 * Metas comerciais: feature 2026-07-13, ampliada em 2026-07-31.
 *
 * DUAS métricas, com estrutura IDÊNTICA (`MetaKind`):
 *  - 'transacao' → volume VALIDADO em USD.
 *  - 'ativacao' → nº de ATIVAÇÕES validadas (1º transação do cliente).
 * Cada uma tem seu próprio par de campos no doc (`setores`/`colaboradores` e
 * `setoresAtivacao`/`colaboradoresAtivacao`), então editar uma nunca mexe na
 * outra e os docs antigos seguem válidos.
 *
 * Estrutura no Firestore (coleção `metas`):
 *  - `metas/default`  → baseline padrão por setor (aplicável a todos os meses
 *                       que não tiverem override). Editável na tela de Metas.
 *  - `metas/{yyyy-MM}` → overrides do mês: metas por setor e/ou por colaborador.
 *
 * Resolução da meta EFETIVA de um setor no mês M:
 *   override do mês → baseline `metas/default` → constante DEFAULT_SETOR_METAS.
 *
 * Meta EFETIVA de um colaborador no mês M:
 *   override do mês (colaboradores[uid]) → divisão igualitária da meta do setor
 *   entre os colaboradores ELEGÍVEIS (ativos, papel 'agente', criados ANTES do
 *   início do mês: "colaborador novo só conta no mês seguinte").
 *
 * A meta GERAL é derivada = soma das metas efetivas dos 4 setores reais.
 *
 * Escrita gateada por `canEditMetas` (firestore.rules + UI). Nada aqui toca
 * comissão nem fechamento: é só planejamento/acompanhamento.
 */

/** Baseline hardcoded de VOLUME: último fallback quando não há `metas/default`. */
export const DEFAULT_SETOR_METAS: Record<Setor, number> = {
  premium: 300_000,
  starter: 100_000,
  eventos: 5_000,
  online: 5_000,
  // Virtuais não recebem meta própria (supervisor agrega os reais). Mantidos
  // aqui só pra satisfazer o Record<Setor, number>; nunca são usados como meta.
  premium_starter: 0,
  online_eventos: 0,
}

/**
 * Baseline hardcoded de ATIVAÇÕES: 300 no total, dividido igualmente entre os
 * 4 times (75 cada), conforme definido em 2026-07-31. Editável na tela de Metas.
 */
export const DEFAULT_SETOR_METAS_ATIVACAO: Record<Setor, number> = {
  premium: 75,
  starter: 75,
  eventos: 75,
  online: 75,
  premium_starter: 0,
  online_eventos: 0,
}

/** Baseline conforme a métrica. */
export function defaultSetorMeta(setor: Setor, kind: MetaKind): number {
  const table = kind === 'ativacao' ? DEFAULT_SETOR_METAS_ATIVACAO : DEFAULT_SETOR_METAS
  return table[setor] ?? 0
}

const COL = 'metas'
const ROLLUP_COL = 'metas_rollup'
const DEFAULT_DOC = 'default'

export interface MetaDoc {
  /** Overrides de VOLUME por setor (parcial). */
  setores?: Partial<Record<Setor, number>>
  /** Overrides de VOLUME por colaborador (uid → meta USD). */
  colaboradores?: Record<string, number>
  /** Overrides de ATIVAÇÃO por setor (parcial). */
  setoresAtivacao?: Partial<Record<Setor, number>>
  /** Overrides de ATIVAÇÃO por colaborador (uid → nº de ativações). */
  colaboradoresAtivacao?: Record<string, number>
  updatedAt?: Timestamp
  updatedBy?: string
}

/* Nomes dos campos no doc conforme a métrica, um único ponto de verdade. */
const setoresField = (kind: MetaKind): 'setores' | 'setoresAtivacao' =>
  kind === 'ativacao' ? 'setoresAtivacao' : 'setores'
const colaboradoresField = (kind: MetaKind): 'colaboradores' | 'colaboradoresAtivacao' =>
  kind === 'ativacao' ? 'colaboradoresAtivacao' : 'colaboradores'

/** Overrides por setor do doc, na métrica pedida. */
function setoresOf(
  d: MetaDoc | null,
  kind: MetaKind,
): Partial<Record<Setor, number>> | undefined {
  return d?.[setoresField(kind)]
}

/** Overrides por colaborador do doc, na métrica pedida. */
function colaboradoresOf(
  d: MetaDoc | null,
  kind: MetaKind,
): Record<string, number> | undefined {
  return d?.[colaboradoresField(kind)]
}

/**
 * Cache de "realizado do time" que o COLABORADOR pode ler sem enxergar os
 * transações dos colegas (as rules bloqueiam isso). Atualizado pelos dashboards
 * de admin/supervisor ao abrir a Visão Geral. Guarda só agregados por setor,
 * zero PII, zero meta individual de colega.
 */
export interface RollupSetorEntry {
  /** Volume validado (USD) do setor no mês. */
  realizedUsd: number
  /** Nº de colaboradores elegíveis do setor no mês (divisor da meta individual). */
  eligibleCount: number
  /**
   * Meta EFETIVA do time no mês = soma das metas individuais (base + ajustes).
   * Publicada aqui pra o colaborador ver o "meu time" com a mesma meta que o
   * Gerente enxerga, incluindo ajustes individuais que sobem pro time/geral.
   */
  metaUsd: number
  /** Ativações validadas do setor no mês (métrica 'ativacao'). */
  realizedAct?: number
  /** Meta efetiva de ATIVAÇÕES do time no mês. */
  metaAct?: number
}

/** Realizado do rollup na métrica pedida (campos de ativação são opcionais). */
export function rollupRealized(e: RollupSetorEntry | undefined, kind: MetaKind): number {
  if (!e) return 0
  return kind === 'ativacao' ? (e.realizedAct ?? 0) : e.realizedUsd
}

/** Meta do rollup na métrica pedida. `undefined` = rollup ainda não tem o dado. */
export function rollupMeta(
  e: RollupSetorEntry | undefined,
  kind: MetaKind,
): number | undefined {
  if (!e) return undefined
  return kind === 'ativacao' ? e.metaAct : e.metaUsd
}
export interface RollupDoc {
  setores?: Partial<Record<Setor, RollupSetorEntry>>
  updatedAt?: Timestamp
  updatedBy?: string
}

/* -------------------------------------------------------------------------- */
/* Subscribes                                                                  */
/* -------------------------------------------------------------------------- */

export function subscribeDefaultMeta(cb: (d: MetaDoc | null) => void): Unsubscribe {
  return onSnapshot(
    doc(db, COL, DEFAULT_DOC),
    (snap) => cb(snap.exists() ? (snap.data() as MetaDoc) : null),
    (err) => {
      console.warn('subscribeDefaultMeta falhou', err)
      cb(null)
    },
  )
}

/**
 * Stream de TODOS os docs de meta (default + por mês) num Map keyed por id.
 * Usado pelos gráficos que precisam da meta de vários meses de uma vez sem
 * abrir um listener por mês. A coleção é pequena (1 doc/mês + default).
 */
export function subscribeAllMetas(
  cb: (map: Map<string, MetaDoc>) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db, COL),
    (snap) => {
      const m = new Map<string, MetaDoc>()
      snap.forEach((d) => m.set(d.id, d.data() as MetaDoc))
      cb(m)
    },
    (err) => {
      console.warn('subscribeAllMetas falhou', err)
      cb(new Map())
    },
  )
}

export function subscribeMonthMeta(
  month: string,
  cb: (d: MetaDoc | null) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, COL, month),
    (snap) => cb(snap.exists() ? (snap.data() as MetaDoc) : null),
    (err) => {
      console.warn('subscribeMonthMeta falhou', err)
      cb(null)
    },
  )
}

export function subscribeRollup(
  month: string,
  cb: (d: RollupDoc | null) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, ROLLUP_COL, month),
    (snap) => cb(snap.exists() ? (snap.data() as RollupDoc) : null),
    (err) => {
      console.warn('subscribeRollup falhou', err)
      cb(null)
    },
  )
}

/* -------------------------------------------------------------------------- */
/* Resolução de metas efetivas                                                 */
/* -------------------------------------------------------------------------- */

/** Meta efetiva de um setor real no mês, aplicando a cascata de fallback. */
export function effectiveSetorMeta(
  setor: Setor,
  monthDoc: MetaDoc | null,
  defaultDoc: MetaDoc | null,
  kind: MetaKind = 'transacao',
): number {
  const fromMonth = setoresOf(monthDoc, kind)?.[setor]
  if (typeof fromMonth === 'number') return fromMonth
  const fromDefault = setoresOf(defaultDoc, kind)?.[setor]
  if (typeof fromDefault === 'number') return fromDefault
  return defaultSetorMeta(setor, kind)
}

/** Meta geral efetiva = soma das metas dos 4 setores reais. */
export function effectiveGeralMeta(
  monthDoc: MetaDoc | null,
  defaultDoc: MetaDoc | null,
  kind: MetaKind = 'transacao',
): number {
  return SETORES.reduce(
    (s, setor) => s + effectiveSetorMeta(setor, monthDoc, defaultDoc, kind),
    0,
  )
}

/**
 * Meta EFETIVA de um time = soma das metas individuais dos seus colaboradores
 * (base dividida igualitariamente + ajustes manuais). Assim, alterar a meta de
 * UM colaborador reflete no time e sobe pra meta geral. Quando o time não tem
 * colaboradores elegíveis, cai na meta-base do setor (ex.: time recém-criado).
 *
 * Precisa da lista de agentes: só admin/supervisor a têm; o colaborador lê
 * este valor pronto no rollup (`RollupSetorEntry.metaUsd`).
 */
export function rolledUpSetorMeta(
  agentes: Agente[],
  setor: Setor,
  month: string,
  monthDoc: MetaDoc | null,
  defaultDoc: MetaDoc | null,
  kind: MetaKind = 'transacao',
): number {
  const base = effectiveSetorMeta(setor, monthDoc, defaultDoc, kind)
  const eligibleCount = eligibleColaboradores(agentes, setor, month).length
  if (eligibleCount === 0) return base
  const share = equalShare(base, eligibleCount)
  const monthStart = new Date(`${month}-01T00:00:00`)
  const membros = agentes.filter(
    (a) => a.role === 'agente' && a.active && a.setor === setor,
  )
  let sum = 0
  for (const a of membros) {
    const override = colaboradoresOf(monthDoc, kind)?.[a.uid]
    if (typeof override === 'number') {
      sum += override
      continue
    }
    const created = a.createdAt?.toDate?.()
    const isNovo = !!created && created >= monthStart
    sum += isNovo ? 0 : share
  }
  return sum
}

/** Meta geral rolled-up = soma das metas efetivas (rolled-up) dos 4 times. */
export function rolledUpGeralMeta(
  agentes: Agente[],
  month: string,
  monthDoc: MetaDoc | null,
  defaultDoc: MetaDoc | null,
  kind: MetaKind = 'transacao',
): number {
  return SETORES.reduce(
    (s, setor) => s + rolledUpSetorMeta(agentes, setor, month, monthDoc, defaultDoc, kind),
    0,
  )
}

/**
 * Colaboradores ELEGÍVEIS de um setor no mês: papel 'agente', ativos e criados
 * ANTES do primeiro dia do mês. "Colaborador novo só conta no mês seguinte."
 */
export function eligibleColaboradores(
  agentes: Agente[],
  setor: Setor,
  month: string,
): Agente[] {
  const monthStart = new Date(`${month}-01T00:00:00`)
  return agentes.filter((a) => {
    if (a.role !== 'agente' || !a.active || a.setor !== setor) return false
    const created = a.createdAt?.toDate?.()
    // Sem createdAt (doc legado): considera elegível (conservador).
    if (!created) return true
    return created < monthStart
  })
}

/**
 * Divisão igualitária da meta do setor entre os elegíveis. Não força a soma a
 * fechar com a meta do setor, overrides são independentes (decisão: "ficam
 * fixos; mostro soma vs meta do time").
 */
export function equalShare(setorMeta: number, eligibleCount: number): number {
  if (eligibleCount <= 0) return 0
  return setorMeta / eligibleCount
}

/**
 * Meta efetiva de um colaborador no mês:
 *   override do mês → divisão igualitária (setorMeta ÷ nº elegíveis).
 */
export function effectiveColaboradorMeta(
  uid: string,
  setorMeta: number,
  eligibleCount: number,
  monthDoc: MetaDoc | null,
  kind: MetaKind = 'transacao',
): number {
  const override = colaboradoresOf(monthDoc, kind)?.[uid]
  if (typeof override === 'number') return override
  return equalShare(setorMeta, eligibleCount)
}

/** true se o colaborador tem ajuste manual na métrica (mostra badge/reset). */
export function hasColaboradorOverride(
  uid: string,
  monthDoc: MetaDoc | null,
  kind: MetaKind,
): boolean {
  return typeof colaboradoresOf(monthDoc, kind)?.[uid] === 'number'
}

/** true se o setor tem base ajustada no mês (override) na métrica. */
export function hasSetorOverride(
  setor: Setor,
  monthDoc: MetaDoc | null,
  kind: MetaKind,
): boolean {
  return typeof setoresOf(monthDoc, kind)?.[setor] === 'number'
}

/** Valor da baseline (`metas/default`) da métrica, ou o efetivo como fallback. */
export function defaultDocSetorMeta(
  setor: Setor,
  defaultDoc: MetaDoc | null,
  kind: MetaKind,
  fallback: number,
): number {
  const v = setoresOf(defaultDoc, kind)?.[setor]
  return typeof v === 'number' ? v : fallback
}

/* -------------------------------------------------------------------------- */
/* Escrita (só canEditMetas)                                                    */
/* -------------------------------------------------------------------------- */

/** Unidade da métrica no texto do log de atividade. */
const unitOf = (kind: MetaKind, value: number): string =>
  kind === 'ativacao'
    ? `${Math.round(value)} ativaç${Math.round(value) === 1 ? 'ão' : 'ões'}`
    : `${Math.round(value)} USD`

/** Grava a meta de UM setor no mês (override). */
export async function saveMonthSetorMeta(
  month: string,
  setor: Setor,
  value: number,
  kind: MetaKind = 'transacao',
): Promise<void> {
  await setDoc(
    doc(db, COL, month),
    {
      [setoresField(kind)]: { [setor]: value },
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
  await logActivity({
    action: 'meta.update',
    targetType: 'meta',
    targetId: month,
    targetLabel: `${month} · ${setor}`,
    note: `meta do time (${kind}) → ${unitOf(kind, value)}`,
  })
}

/** Grava a meta de UM colaborador no mês (override). */
export async function saveColaboradorMeta(
  month: string,
  uid: string,
  value: number,
  nameHint?: string,
  kind: MetaKind = 'transacao',
): Promise<void> {
  await setDoc(
    doc(db, COL, month),
    {
      [colaboradoresField(kind)]: { [uid]: value },
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
  await logActivity({
    action: 'meta.update',
    targetType: 'meta',
    targetId: month,
    targetLabel: `${month} · ${nameHint ?? uid}`,
    note: `meta individual (${kind}) → ${unitOf(kind, value)}`,
  })
}

/** Grava a baseline padrão de um setor (aplica a meses sem override). */
export async function saveDefaultSetorMeta(
  setor: Setor,
  value: number,
  kind: MetaKind = 'transacao',
): Promise<void> {
  await setDoc(
    doc(db, COL, DEFAULT_DOC),
    {
      [setoresField(kind)]: { [setor]: value },
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
  await logActivity({
    action: 'meta.update',
    targetType: 'meta',
    targetId: DEFAULT_DOC,
    targetLabel: `padrão · ${setor}`,
    note: `meta padrão do time (${kind}) → ${unitOf(kind, value)}`,
  })
}

/** Remove o override de meta de um setor no mês (volta a herdar do padrão). */
export async function clearMonthSetorMeta(
  month: string,
  setor: Setor,
  kind: MetaKind = 'transacao',
): Promise<void> {
  try {
    await updateDoc(doc(db, COL, month), {
      [`${setoresField(kind)}.${setor}`]: deleteField(),
      updatedAt: serverTimestamp(),
    })
    await logActivity({
      action: 'meta.update',
      targetType: 'meta',
      targetId: month,
      targetLabel: `${month} · ${setor}`,
      note: `meta do time (${kind}) → padrão (override removido)`,
    })
  } catch (err) {
    // Doc do mês pode não existir ainda, nada a limpar.
    console.warn('clearMonthSetorMeta: nada a remover', err)
  }
}

/** Remove o override de meta de um colaborador no mês (volta à divisão igualitária). */
export async function clearColaboradorMeta(
  month: string,
  uid: string,
  nameHint?: string,
  kind: MetaKind = 'transacao',
): Promise<void> {
  try {
    await updateDoc(doc(db, COL, month), {
      [`${colaboradoresField(kind)}.${uid}`]: deleteField(),
      updatedAt: serverTimestamp(),
    })
    await logActivity({
      action: 'meta.update',
      targetType: 'meta',
      targetId: month,
      targetLabel: `${month} · ${nameHint ?? uid}`,
      note: `meta individual (${kind}) → divisão igualitária (override removido)`,
    })
  } catch (err) {
    console.warn('clearColaboradorMeta: nada a remover', err)
  }
}

/**
 * Atualiza o rollup (realizado + nº elegíveis por setor) do mês. Merge por
 * setor: supervisor grava só os setores dele sem apagar os dos outros.
 * Chamado pelos dashboards admin/supervisor; agente só lê.
 */
export async function writeRollup(
  month: string,
  entries: Partial<Record<Setor, RollupSetorEntry>>,
  byName?: string,
): Promise<void> {
  await setDoc(
    doc(db, ROLLUP_COL, month),
    {
      setores: entries,
      updatedAt: serverTimestamp(),
      ...(byName ? { updatedBy: byName } : {}),
    },
    { merge: true },
  )
}

/**
 * Atualiza SÓ o `metaUsd` de cada setor no rollup do mês (merge profundo:
 * preserva `realizedUsd`/`eligibleCount` que os dashboards populam). Serve pra
 * PROPAGAR uma meta recém-editada na tela de Metas direto pro cache, pra que o
 * "meu time" do colaborador (que lê a meta do rollup, não a calcula ao vivo)
 * reflita o valor novo NA HORA, sem esperar um admin/supervisor reabrir a
 * Visão Geral. Nada de realizado aqui: evita corromper o cache com um escopo
 * de transações parcial (ex.: supervisor).
 */
export async function updateRollupMetas(
  month: string,
  metaBySetor: Partial<Record<Setor, number>>,
  byName?: string,
  metaActBySetor?: Partial<Record<Setor, number>>,
): Promise<void> {
  const setores: Record<string, { metaUsd?: number; metaAct?: number }> = {}
  for (const [s, m] of Object.entries(metaBySetor)) {
    if (typeof m === 'number') setores[s] = { ...(setores[s] ?? {}), metaUsd: m }
  }
  for (const [s, m] of Object.entries(metaActBySetor ?? {})) {
    if (typeof m === 'number') setores[s] = { ...(setores[s] ?? {}), metaAct: m }
  }
  if (Object.keys(setores).length === 0) return
  await setDoc(
    doc(db, ROLLUP_COL, month),
    {
      setores,
      updatedAt: serverTimestamp(),
      ...(byName ? { updatedBy: byName } : {}),
    },
    { merge: true },
  )
}
