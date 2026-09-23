/**
 * No sistema real, o "realizado do time" que o gestor enxerga é publicado em
 * `metas_rollup/{mês}` quando um admin/supervisor abre a Visão Geral. No demo
 * o visitante pode entrar direto como gestor, então o rollup do mês é
 * calculado aqui com as MESMAS funções do app. Carregado via import dinâmico
 * (depois que os módulos do app já inicializaram).
 */
import { realizedValidated } from '../lib/forecast'
import { eligibleColaboradores, rolledUpSetorMeta, type MetaDoc } from '../lib/metas'
import { SETORES, type Agente, type Transaction, type Setor } from '../types'
import { Timestamp, store } from './store'

export function computeRollup(month: string): void {
  const path = `metas_rollup/${month}`
  if (store.get(path)) return
  const agentes = store.list('agentes').map(([uid, d]) => ({ uid, ...d }) as unknown as Agente)
  const transactions = store.list('transactions').map(([id, d]) => ({ id, ...d }) as unknown as Transaction)
  const monthDoc = (store.get(`metas/${month}`) ?? null) as MetaDoc | null
  const defaultDoc = (store.get('metas/default') ?? null) as MetaDoc | null

  const setores: Record<string, unknown> = {}
  for (const s of SETORES as Setor[]) {
    const setorDeps = transactions.filter((d) => d.agenteSetor === s)
    setores[s] = {
      realizedUsd: realizedValidated(setorDeps, month, 'transacao'),
      eligibleCount: eligibleColaboradores(agentes, s, month).length,
      metaUsd: rolledUpSetorMeta(agentes, s, month, monthDoc, defaultDoc, 'transacao'),
      realizedAct: realizedValidated(setorDeps, month, 'ativacao'),
      metaAct: rolledUpSetorMeta(agentes, s, month, monthDoc, defaultDoc, 'ativacao'),
    }
  }
  store.put(path, { setores, updatedAt: Timestamp.now(), updatedBy: 'Sistema (demo)' })
}
