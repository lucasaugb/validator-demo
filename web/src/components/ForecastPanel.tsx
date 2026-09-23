import { useEffect, useMemo, useRef, useState } from 'react'
import { Gauge } from 'lucide-react'
import { ForecastChart, ForecastRitmoCards } from './ForecastStats'
import { formatMetric } from '../lib/format'
import {
  buildForecast,
  buildForecastDaily,
  realizedValidated,
  yearMonthOf,
  type Forecast,
  type ForecastDaily,
} from '../lib/forecast'
import {
  effectiveColaboradorMeta,
  effectiveGeralMeta,
  effectiveSetorMeta,
  eligibleColaboradores,
  equalShare,
  rolledUpGeralMeta,
  rolledUpSetorMeta,
  rollupMeta,
  rollupRealized,
  subscribeDefaultMeta,
  subscribeMonthMeta,
  subscribeRollup,
  writeRollup,
  type MetaDoc,
  type RollupDoc,
  type RollupSetorEntry,
} from '../lib/metas'
import { META_KINDS, SETORES, metaKindLabel, setorLabel, setoresInScope } from '../types'
import type { Agente, Transaction, MetaKind, Role, Setor } from '../types'

interface Props {
  /** yyyy-MM em foco (o painel projeta o fechamento desse mês). */
  month: string
  /** Transações disponíveis no escopo (admin: todos; supervisor: setores dele; agente: os próprios). */
  transactions: Transaction[]
  role: Role
  /** Usuário logado. */
  agente: Agente
  /** Lista de usuários: presente pra admin/supervisor; ausente pro agente (rules). */
  agentes?: Agente[]
  /** Setores reais do supervisor. undefined = admin (todos os setores). */
  scopeSetores?: Setor[]
}

/** Alvo do seletor de escopo. */
type ScopeKind = 'geral' | 'setor' | 'colaborador' | 'meu' | 'meu_time'

const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** "jul 2026" a partir de "2026-07". */
function monthLabel(month: string): string {
  const [y, mo] = month.split('-').map(Number)
  return `${MONTHS_SHORT[(mo || 1) - 1]} ${y}`
}

/**
 * Painel de Forecast na Visão Geral, Realizado × Meta.
 *
 * MÉTRICA (2026-07-31): seletor Volume · Ativação no topo. A estrutura é a
 * mesma nas duas: muda só a base (volume validado em USD × nº de ativações
 * validadas, ou seja a primeira transação de cada cliente) e a formatação.
 *
 * Layout (2026-07-20, replicar o report do Power BI):
 *  - Cards no topo com o realizado acumulado × meta, realizado no dia, meta
 *    diária, meta acumulada até hoje, gap vs meta acumulada e quanto precisa
 *    por dia útil restante. Barra de progresso com o % atingido.
 *  - Gráfico embaixo: barras = realizado acumulado por dia; linha = meta
 *    acumulada por dia. SEM linha de projeção (removida a pedido).
 *  - Fim de semana (sáb/dom) tem meta 0, a meta só acumula em dia útil.
 *
 * - Admin: Geral · Time · Colaborador (todos os setores).
 * - Supervisor: Time · Colaborador (limitado aos setores dele).
 * - Agente: Meu · Meu time (usa o rollup pra ler o realizado do time).
 *
 * Nada aqui toca comissão nem fechamento, é puramente informativo.
 */
export function ForecastPanel({
  month,
  transactions,
  role,
  agente,
  agentes,
  scopeSetores,
}: Props) {
  const isAgente = role === 'agente'
  const isSupervisor = role === 'supervisor'
  const isAdmin = role === 'admin' || role === 'super_admin'

  /** Métrica em foco: Volume (USD) ou Ativação (contagem). */
  const [kind, setKind] = useState<MetaKind>('transacao')

  const [monthDoc, setMonthDoc] = useState<MetaDoc | null>(null)
  const [defaultDoc, setDefaultDoc] = useState<MetaDoc | null>(null)
  const [rollup, setRollup] = useState<RollupDoc | null>(null)
  // Meta do MÊS CORRENTE: usada só pelo writer do rollup (que sempre publica o
  // mês corrente, independente do mês navegado no painel).
  const [curMeta, setCurMeta] = useState<MetaDoc | null>(null)

  useEffect(() => subscribeMonthMeta(month, setMonthDoc), [month])
  useEffect(() => subscribeDefaultMeta(setDefaultDoc), [])
  // Agente lê o rollup pra realizado do time + nº elegíveis + meta efetiva.
  useEffect(() => {
    if (!isAgente) return
    return subscribeRollup(month, setRollup)
  }, [isAgente, month])
  useEffect(() => {
    if (isAgente || !agentes) return
    return subscribeMonthMeta(yearMonthOf(new Date()), setCurMeta)
  }, [isAgente, agentes])

  // Setores reais em foco neste painel.
  const setoresDisponiveis = useMemo<Setor[]>(() => {
    if (isAdmin) return SETORES
    if (isSupervisor) return scopeSetores ?? setoresInScope(agente.setor)
    return agente.setor ? [agente.setor] : []
  }, [isAdmin, isSupervisor, scopeSetores, agente.setor])

  /* ----------------------------- rollup writer ---------------------------- */
  // Admin/supervisor mantêm o rollup do MÊS CORRENTE atualizado (realizado +
  // nº elegíveis por setor) pra que os colaboradores consigam ver "meu time".
  const lastSig = useRef<string>('')
  useEffect(() => {
    if (isAgente || !agentes) return
    const currentMonth = yearMonthOf(new Date())
    const targets = isAdmin ? SETORES : setoresDisponiveis
    if (targets.length === 0) return
    const entries: Partial<Record<Setor, RollupSetorEntry>> = {}
    for (const s of targets) {
      const setorDeps = transactions.filter((d) => d.agenteSetor === s)
      entries[s] = {
        realizedUsd: realizedValidated(setorDeps, currentMonth, 'transacao'),
        eligibleCount: eligibleColaboradores(agentes, s, currentMonth).length,
        // Meta efetiva (rolled-up) do time: inclui ajustes individuais.
        metaUsd: rolledUpSetorMeta(agentes, s, currentMonth, curMeta, defaultDoc, 'transacao'),
        // Espelho da métrica de ATIVAÇÃO: publicado sempre (independente do
        // seletor), pra o "meu time" do gestor funcionar nas duas visões.
        realizedAct: realizedValidated(setorDeps, currentMonth, 'ativacao'),
        metaAct: rolledUpSetorMeta(agentes, s, currentMonth, curMeta, defaultDoc, 'ativacao'),
      }
    }
    // Evita writes redundantes (snapshot de transactions/metas muda com frequência).
    const sig = JSON.stringify(entries)
    if (sig === lastSig.current) return
    lastSig.current = sig
    writeRollup(currentMonth, entries, agente.name).catch((err) =>
      console.warn('writeRollup falhou (forecast segue local)', err),
    )
  }, [isAgente, isAdmin, agentes, transactions, setoresDisponiveis, agente.name, curMeta, defaultDoc])

  /* ----------------------------- seletor de escopo ------------------------ */
  const [scopeKind, setScopeKind] = useState<ScopeKind>(
    isAdmin ? 'geral' : isSupervisor ? 'setor' : 'meu',
  )
  const [selectedSetor, setSelectedSetor] = useState<Setor>(
    setoresDisponiveis[0] ?? 'premium',
  )
  const [selectedUid, setSelectedUid] = useState<string>('')

  // Mantém as seleções válidas quando o escopo muda.
  useEffect(() => {
    if (!setoresDisponiveis.includes(selectedSetor)) {
      setSelectedSetor(setoresDisponiveis[0] ?? 'premium')
    }
  }, [setoresDisponiveis, selectedSetor])

  // Colaboradores selecionáveis (admin: todos os gestores; supervisor: do escopo).
  const colaboradores = useMemo<Agente[]>(() => {
    if (!agentes) return []
    return agentes
      .filter(
        (a) =>
          a.role === 'agente' &&
          a.active &&
          a.setor &&
          setoresDisponiveis.includes(a.setor),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [agentes, setoresDisponiveis])

  useEffect(() => {
    if (scopeKind === 'colaborador' && !selectedUid && colaboradores[0]) {
      setSelectedUid(colaboradores[0].uid)
    }
  }, [scopeKind, selectedUid, colaboradores])

  /* ----------------------------- forecast principal ----------------------- */
  // `scopedTransactions` = transações do escopo (pra série diária do gráfico). Fica
  // null em "meu time" (o realizado vem do rollup, sem detalhe por dia).
  const main = useMemo<{
    forecast: Forecast
    label: string
    sub?: string
    scopedTransactions: Transaction[] | null
  } | null>(() => {
    // GERAL
    if (scopeKind === 'geral') {
      const realized = realizedValidated(transactions, month, kind)
      const meta = agentes
        ? rolledUpGeralMeta(agentes, month, monthDoc, defaultDoc, kind)
        : effectiveGeralMeta(monthDoc, defaultDoc, kind)
      return {
        forecast: buildForecast(realized, meta, month),
        label: 'Geral',
        sub: 'todos os times',
        scopedTransactions: transactions,
      }
    }
    // TIME (setor): admin/supervisor
    if (scopeKind === 'setor') {
      const setorDeps = transactions.filter((d) => d.agenteSetor === selectedSetor)
      const realized = realizedValidated(setorDeps, month, kind)
      const meta = agentes
        ? rolledUpSetorMeta(agentes, selectedSetor, month, monthDoc, defaultDoc, kind)
        : effectiveSetorMeta(selectedSetor, monthDoc, defaultDoc, kind)
      return {
        forecast: buildForecast(realized, meta, month),
        label: setorLabel[selectedSetor],
        sub: 'time',
        scopedTransactions: setorDeps,
      }
    }
    // COLABORADOR: admin/supervisor
    if (scopeKind === 'colaborador') {
      const target = colaboradores.find((a) => a.uid === selectedUid)
      if (!target || !target.setor) return null
      const setorMeta = effectiveSetorMeta(target.setor, monthDoc, defaultDoc, kind)
      const elig = agentes
        ? eligibleColaboradores(agentes, target.setor, month).length
        : 0
      const meta = effectiveColaboradorMeta(target.uid, setorMeta, elig, monthDoc, kind)
      const colDeps = transactions.filter((d) => d.agenteId === target.uid)
      const realized = realizedValidated(colDeps, month, kind)
      return {
        forecast: buildForecast(realized, meta, month),
        label: target.name,
        sub: target.setor ? setorLabel[target.setor] : 'colaborador',
        scopedTransactions: colDeps,
      }
    }
    // MEU: agente
    if (scopeKind === 'meu') {
      const mySetor = agente.setor
      const realized = realizedValidated(transactions, month, kind)
      // Meta individual: override explícito, senão divisão igualitária (usa nº
      // elegíveis do rollup, já que o agente não lê a lista de colegas).
      const override =
        kind === 'ativacao'
          ? monthDoc?.colaboradoresAtivacao?.[agente.uid]
          : monthDoc?.colaboradores?.[agente.uid]
      let meta = 0
      if (typeof override === 'number') {
        meta = override
      } else if (mySetor) {
        const setorMeta = effectiveSetorMeta(mySetor, monthDoc, defaultDoc, kind)
        const elig = rollup?.setores?.[mySetor]?.eligibleCount ?? 0
        meta = equalShare(setorMeta, elig)
      }
      return {
        forecast: buildForecast(realized, meta, month),
        label: 'Meu forecast',
        sub: 'individual',
        scopedTransactions: transactions,
      }
    }
    // MEU TIME: agente (realizado vem do rollup; sem detalhe por dia)
    if (scopeKind === 'meu_time') {
      const mySetor = agente.setor
      if (!mySetor) return null
      const entry = rollup?.setores?.[mySetor]
      const realized = rollupRealized(entry, kind)
      // Rollup antigo (gravado antes da métrica de ativação) não tem `metaAct`
      //: aí cai na meta-base do setor em vez de mostrar 0.
      const meta =
        rollupMeta(entry, kind) ?? effectiveSetorMeta(mySetor, monthDoc, defaultDoc, kind)
      const hasData = !!entry
      return {
        forecast: buildForecast(realized, meta, month),
        label: setorLabel[mySetor],
        sub: hasData ? 'meu time' : 'aguardando dados do time',
        scopedTransactions: null,
      }
    }
    return null
  }, [
    scopeKind,
    kind,
    transactions,
    month,
    monthDoc,
    defaultDoc,
    selectedSetor,
    selectedUid,
    colaboradores,
    agentes,
    agente.setor,
    agente.uid,
    rollup,
  ])

  // Série diária (realizado acumulado × meta acumulada) do escopo em foco.
  const daily = useMemo<ForecastDaily | null>(() => {
    if (!main || main.scopedTransactions == null) return null
    return buildForecastDaily(main.scopedTransactions, main.forecast.meta, month, kind)
  }, [main, month, kind])

  /* ----------------------------- breakdown -------------------------------- */
  // Geral → por time; Time → por colaborador. Enriquece a visão do admin/sup.
  const breakdown = useMemo<{ label: string; forecast: Forecast }[]>(() => {
    if (scopeKind === 'geral') {
      return setoresDisponiveis.map((s) => {
        const setorDeps = transactions.filter((d) => d.agenteSetor === s)
        return {
          label: setorLabel[s],
          forecast: buildForecast(
            realizedValidated(setorDeps, month, kind),
            agentes
              ? rolledUpSetorMeta(agentes, s, month, monthDoc, defaultDoc, kind)
              : effectiveSetorMeta(s, monthDoc, defaultDoc, kind),
            month,
          ),
        }
      })
    }
    if (scopeKind === 'setor' && agentes) {
      const setorMeta = effectiveSetorMeta(selectedSetor, monthDoc, defaultDoc, kind)
      const elig = eligibleColaboradores(agentes, selectedSetor, month).length
      return colaboradores
        .filter((a) => a.setor === selectedSetor)
        .map((a) => {
          const colDeps = transactions.filter((d) => d.agenteId === a.uid)
          return {
            label: a.name,
            forecast: buildForecast(
              realizedValidated(colDeps, month, kind),
              effectiveColaboradorMeta(a.uid, setorMeta, elig, monthDoc, kind),
              month,
            ),
          }
        })
        .sort((x, y) => y.forecast.realized - x.forecast.realized)
    }
    return []
  }, [
    scopeKind,
    kind,
    setoresDisponiveis,
    transactions,
    month,
    monthDoc,
    defaultDoc,
    selectedSetor,
    agentes,
    colaboradores,
  ])

  return (
    <div className="panel overflow-hidden">
      <div className="panel-head">
        <div className="flex items-center gap-1.5">
          <Gauge size={12} className="text-app-muted" />
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-app-muted">
            Forecast
          </h3>
          <span className="text-[11px] font-normal text-app-subtle">
            {monthLabel(month)}
          </span>
          {/* Métrica: Volume (USD) × Ativação (1º transação do cliente). */}
          <div className="seg ml-2" role="tablist">
            {META_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                onClick={() => setKind(k)}
                className="seg-item"
              >
                {metaKindLabel[k]}
              </button>
            ))}
          </div>
        </div>
        <ScopeControl
          role={role}
          scopeKind={scopeKind}
          setScopeKind={setScopeKind}
          setoresDisponiveis={setoresDisponiveis}
          selectedSetor={selectedSetor}
          setSelectedSetor={setSelectedSetor}
          colaboradores={colaboradores}
          selectedUid={selectedUid}
          setSelectedUid={setSelectedUid}
        />
      </div>

      {main ? (
        <div className="px-5 py-4">
          <ForecastHero
            forecast={main.forecast}
            daily={daily}
            label={main.label}
            sub={main.sub}
            kind={kind}
          />
          {daily && (
            <div className="mt-5">
              <ForecastChart daily={daily} meta={main.forecast.meta} kind={kind} />
            </div>
          )}
          {breakdown.length > 0 && (
            <div className="mt-4 border-t border-app-border/60 pt-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-app-subtle">
                {scopeKind === 'geral' ? 'Por time' : 'Por colaborador'}
              </div>
              <ul className="space-y-1.5">
                {breakdown.map((b) => (
                  <ForecastRow key={b.label} label={b.label} forecast={b.forecast} kind={kind} />
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="px-5 py-8 text-center text-[11px] text-app-subtle">
          Sem dados de forecast para este escopo.
        </div>
      )}
    </div>
  )
}

/* --------------------------------------------------------------------------- */
/* Hero: cards de ritmo + barra de progresso                                   */
/* --------------------------------------------------------------------------- */

function ForecastHero({
  forecast,
  daily,
  label,
  sub,
  kind,
}: {
  forecast: Forecast
  daily: ForecastDaily | null
  label: string
  sub?: string
  kind: MetaKind
}) {
  const { meta, attainmentPct, isPastMonth } = forecast
  const hasMeta = meta > 0

  // Pill de status: fechado / meta batida / no ritmo vs abaixo do ritmo.
  const status = !hasMeta
    ? { text: 'sem meta', tone: 'neutral' as const }
    : attainmentPct >= 1
      ? { text: 'meta batida', tone: 'good' as const }
      : isPastMonth
        ? { text: 'fechado', tone: 'bad' as const }
        : daily && daily.gapVsMetaAccum >= 0
          ? { text: 'no ritmo', tone: 'good' as const }
          : { text: 'abaixo do ritmo', tone: 'bad' as const }
  const statusCls =
    status.tone === 'good'
      ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400'
      : status.tone === 'bad'
        ? 'bg-rose-500/12 text-rose-600 dark:text-rose-400'
        : 'bg-app-elev text-app-subtle'

  return (
    <div>
      {/* Cabeçalho do escopo + meta do mês + status */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold text-app-text">{label}</span>
          {sub && <span className="text-[10px] font-normal text-app-subtle">{sub}</span>}
        </div>
        <div className="flex items-center gap-2">
          {hasMeta && (
            <span className="rounded-md border border-app-border bg-app-card px-2 py-0.5 text-[10.5px] font-medium text-app-text">
              Meta do mês:{' '}
              <span className="font-mono font-semibold tabular-nums">
                {formatMetric(meta, kind)}
              </span>
            </span>
          )}
          <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${statusCls}`}>
            {status.text}
          </span>
        </div>
      </div>

      {/* Cards de ritmo + barra de progresso + rodapé (compartilhado) */}
      <div className="mt-3">
        <ForecastRitmoCards forecast={forecast} daily={daily} kind={kind} />
      </div>
    </div>
  )
}

/* --------------------------------------------------------------------------- */
/* Linha compacta do breakdown (sem projeção)                                   */
/* --------------------------------------------------------------------------- */

function ForecastRow({
  label,
  forecast,
  kind,
}: {
  label: string
  forecast: Forecast
  kind: MetaKind
}) {
  const { realized, meta, attainmentPct } = forecast
  const fmt = (v: number) => formatMetric(v, kind)
  const tone = statusTone(attainmentPct)
  const realizedW = Math.min(100, Math.max(0, attainmentPct * 100))
  const remainingToMeta = Math.max(0, meta - realized)
  const title =
    meta > 0
      ? `${label}: ${fmt(realized)} de ${fmt(meta)} (${(attainmentPct * 100).toFixed(0)}%). ${
          remainingToMeta > 0 ? `Faltam ${fmt(remainingToMeta)}.` : 'Meta atingida.'
        }`
      : `${label}: ${fmt(realized)} (sem meta).`
  return (
    <li className="flex items-center gap-3 text-[11.5px]" title={title}>
      <span className="w-28 shrink-0 truncate text-app-text">{label}</span>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-app-elev">
        <div className={`absolute inset-y-0 left-0 ${tone.bar}`} style={{ width: `${realizedW}%` }} />
      </div>
      <span className={`w-10 shrink-0 text-right font-mono tabular-nums ${tone.text}`}>
        {(attainmentPct * 100).toFixed(0)}%
      </span>
      <span className="hidden w-40 shrink-0 text-right font-mono text-[10.5px] tabular-nums text-app-subtle sm:inline">
        {fmt(realized)} / {fmt(meta)}
      </span>
    </li>
  )
}

/* --------------------------------------------------------------------------- */
/* Controle de escopo                                                           */
/* --------------------------------------------------------------------------- */

function ScopeControl({
  role,
  scopeKind,
  setScopeKind,
  setoresDisponiveis,
  selectedSetor,
  setSelectedSetor,
  colaboradores,
  selectedUid,
  setSelectedUid,
}: {
  role: Role
  scopeKind: ScopeKind
  setScopeKind: (k: ScopeKind) => void
  setoresDisponiveis: Setor[]
  selectedSetor: Setor
  setSelectedSetor: (s: Setor) => void
  colaboradores: Agente[]
  selectedUid: string
  setSelectedUid: (u: string) => void
}) {
  const isAgente = role === 'agente'
  const isAdmin = role === 'admin' || role === 'super_admin'

  const kinds: { k: ScopeKind; label: string }[] = isAgente
    ? [
        { k: 'meu', label: 'Meu' },
        { k: 'meu_time', label: 'Meu time' },
      ]
    : isAdmin
      ? [
          { k: 'geral', label: 'Geral' },
          { k: 'setor', label: 'Time' },
          { k: 'colaborador', label: 'Colaborador' },
        ]
      : [
          { k: 'setor', label: 'Time' },
          { k: 'colaborador', label: 'Colaborador' },
        ]

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="seg" role="tablist">
        {kinds.map((o) => (
          <button
            key={o.k}
            type="button"
            role="tab"
            aria-selected={scopeKind === o.k}
            onClick={() => setScopeKind(o.k)}
            className="seg-item"
          >
            {o.label}
          </button>
        ))}
      </div>
      {scopeKind === 'setor' && setoresDisponiveis.length > 1 && (
        <select
          value={selectedSetor}
          onChange={(e) => setSelectedSetor(e.target.value as Setor)}
          className="rounded-md border border-app-border bg-app-card px-2 py-1 text-[11px] font-medium text-app-text"
        >
          {setoresDisponiveis.map((s) => (
            <option key={s} value={s}>
              {setorLabel[s]}
            </option>
          ))}
        </select>
      )}
      {scopeKind === 'colaborador' && (
        <select
          value={selectedUid}
          onChange={(e) => setSelectedUid(e.target.value)}
          className="max-w-[160px] rounded-md border border-app-border bg-app-card px-2 py-1 text-[11px] font-medium text-app-text"
        >
          {colaboradores.length === 0 && <option value="">-</option>}
          {colaboradores.map((a) => (
            <option key={a.uid} value={a.uid}>
              {a.name}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

/* --------------------------------------------------------------------------- */
/* Tom por atingimento                                                          */
/* --------------------------------------------------------------------------- */

function statusTone(refPct: number): { text: string; bar: string } {
  if (refPct >= 1) {
    return { text: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500' }
  }
  if (refPct >= 0.8) {
    return { text: 'text-amber-600 dark:text-amber-400', bar: 'bg-amber-500' }
  }
  return { text: 'text-rose-600 dark:text-rose-400', bar: 'bg-rose-500' }
}
