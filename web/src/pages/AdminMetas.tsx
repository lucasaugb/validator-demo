import { useEffect, useMemo, useRef, useState } from 'react'
import { Gauge, LineChart, RotateCcw } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { SetorBadge } from '../components/SetorBadge'
import { MetaRealizadoChart } from '../components/MetaRealizadoChart'
import { useAuth } from '../contexts/AuthContext'
import { subscribeAgentes } from '../lib/agentes'
import { formatMetric } from '../lib/format'
import {
  clearColaboradorMeta,
  clearMonthSetorMeta,
  defaultDocSetorMeta,
  effectiveColaboradorMeta,
  effectiveSetorMeta,
  eligibleColaboradores,
  equalShare,
  hasColaboradorOverride,
  hasSetorOverride,
  rolledUpGeralMeta,
  rolledUpSetorMeta,
  saveColaboradorMeta,
  saveDefaultSetorMeta,
  saveMonthSetorMeta,
  subscribeAllMetas,
  subscribeDefaultMeta,
  subscribeMonthMeta,
  updateRollupMetas,
  type MetaDoc,
} from '../lib/metas'
import { META_KINDS, SETORES, metaKindLabel } from '../types'
import type { Agente, Transaction, MetaKind, Setor } from '../types'

/** Date do dia 1 do mês deslocado em `offset` meses do atual. */
function monthDateFromOffset(offset: number): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth() + offset, 1)
}

export function AdminMetas({ transactions }: { transactions: Transaction[] }) {
  const { agente } = useAuth()
  const canEdit = !!agente?.canEditMetas || agente?.role === 'super_admin'

  /**
   * Métrica em foco. Volume (USD) e Ativação (contagem de primeiras transações)
   * têm estrutura idêntica e são guardadas em campos separados, trocar aqui
   * muda a tela inteira (meta geral, gráfico, times e colaboradores).
   */
  const [kind, setKind] = useState<MetaKind>('transacao')

  const [monthOffset, setMonthOffset] = useState(0)
  const target = monthDateFromOffset(monthOffset)
  const month = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}`
  const monthLabel = target.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

  const [monthDoc, setMonthDoc] = useState<MetaDoc | null>(null)
  const [defaultDoc, setDefaultDoc] = useState<MetaDoc | null>(null)
  const [agentes, setAgentes] = useState<Agente[]>([])
  const [allMetas, setAllMetas] = useState<Map<string, MetaDoc>>(new Map())
  const [showDefault, setShowDefault] = useState(false)
  // Meta do MÊS CORRENTE (independente do mês navegado), usada só pra manter o
  // cache `metas_rollup` do mês atual atualizado quando uma meta muda.
  const [curMeta, setCurMeta] = useState<MetaDoc | null>(null)
  const currentMonth = useMemo(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  }, [])

  useEffect(() => subscribeMonthMeta(month, setMonthDoc), [month])
  useEffect(() => subscribeDefaultMeta(setDefaultDoc), [])
  useEffect(() => subscribeAgentes(setAgentes), [])
  useEffect(() => subscribeAllMetas(setAllMetas), [])
  useEffect(() => subscribeMonthMeta(currentMonth, setCurMeta), [currentMonth])

  // Propaga a meta EFETIVA (rolled-up) de cada time pro cache do mês corrente
  // sempre que muda: assim o "meu time" do colaborador (que lê a meta do
  // rollup) reflete edições na hora, sem esperar a Visão Geral reabrir. Só
  // toca `metaUsd`; realizado/elegíveis seguem por conta dos dashboards.
  const rollupSig = useRef('')
  useEffect(() => {
    if (agentes.length === 0) return
    const metaBySetor: Partial<Record<Setor, number>> = {}
    const metaActBySetor: Partial<Record<Setor, number>> = {}
    for (const s of SETORES) {
      metaBySetor[s] = rolledUpSetorMeta(agentes, s, currentMonth, curMeta, defaultDoc, 'transacao')
      metaActBySetor[s] = rolledUpSetorMeta(agentes, s, currentMonth, curMeta, defaultDoc, 'ativacao')
    }
    const sig = JSON.stringify([metaBySetor, metaActBySetor])
    if (sig === rollupSig.current) return
    rollupSig.current = sig
    updateRollupMetas(currentMonth, metaBySetor, agente?.name, metaActBySetor).catch((e) =>
      console.warn('updateRollupMetas falhou (forecast do colaborador pode atrasar)', e),
    )
  }, [agentes, curMeta, defaultDoc, currentMonth, agente?.name])

  // Meta geral EFETIVA = soma das metas efetivas dos times (inclui ajustes
  // individuais que sobem pra geral). Antes de `agentes` carregar, cai na base.
  const geralMeta = useMemo(
    () => rolledUpGeralMeta(agentes, month, monthDoc, defaultDoc, kind),
    [agentes, month, monthDoc, defaultDoc, kind],
  )

  if (!canEdit) {
    return (
      <>
        <PageHeader title="Metas" subtitle="Definição de metas por time e colaborador" />
        <div className="panel px-5 py-8 text-center text-[12px] text-app-muted">
          Você não tem permissão para editar metas.
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Metas"
        subtitle={
          kind === 'ativacao'
            ? `${monthLabel} · base de ativações validadas (1º registro do cliente)`
            : `${monthLabel} · base de volume validado (USD)`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="seg" role="tablist">
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
            <MonthOffsetNav offset={monthOffset} onChange={setMonthOffset} />
          </div>
        }
      />

      {/* Meta geral (derivada = soma dos times) */}
      <div className="panel mb-3 flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex items-center gap-2">
          <Gauge size={16} className="text-app-muted" />
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-app-subtle">
              Meta geral do mês · {metaKindLabel[kind]}
            </div>
            <div className="text-[10.5px] text-app-subtle">
              soma dos times · inclui ajustes por colaborador
            </div>
          </div>
        </div>
        <div className="font-mono text-[26px] font-semibold tabular-nums tracking-[-0.02em] text-app-text">
          {formatMetric(geralMeta, kind)}
        </div>
      </div>

      {/* Gráfico Realizado × Meta (mês/dia · geral/time/colaborador) */}
      <div className="panel mb-3 overflow-hidden">
        <div className="panel-head">
          <div className="flex items-center gap-1.5">
            <LineChart size={12} className="text-app-muted" />
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-app-muted">
              Realizado × Meta
            </h3>
          </div>
        </div>
        <div className="px-4 pt-3 pb-2">
          <MetaRealizadoChart
            transactions={transactions}
            agentes={agentes}
            metasByMonth={allMetas}
            month={month}
            kind={kind}
          />
        </div>
      </div>

      {/* Metas por time */}
      <div className="panel mb-3 overflow-hidden">
        <div className="panel-head">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-app-muted">
            Metas por time
          </h3>
          <button
            type="button"
            onClick={() => setShowDefault((v) => !v)}
            className="text-[10.5px] font-medium text-app-muted transition-colors hover:text-app-text"
          >
            {showDefault ? 'ocultar padrão' : 'editar padrão (todos os meses)'}
          </button>
        </div>
        <ul className="divide-y divide-app-border/60">
          {SETORES.map((setor) => (
            <SetorMetaRow
              key={setor}
              setor={setor}
              month={month}
              monthDoc={monthDoc}
              defaultDoc={defaultDoc}
              agentes={agentes}
              showDefault={showDefault}
              kind={kind}
            />
          ))}
        </ul>
      </div>

      {/* Metas por colaborador, agrupadas por time */}
      {SETORES.map((setor) => (
        <ColaboradorMetaSection
          key={setor}
          setor={setor}
          month={month}
          monthDoc={monthDoc}
          defaultDoc={defaultDoc}
          agentes={agentes}
          kind={kind}
        />
      ))}
    </>
  )
}

/* --------------------------------------------------------------------------- */
/* Linha de meta por time                                                       */
/* --------------------------------------------------------------------------- */

function SetorMetaRow({
  setor,
  month,
  monthDoc,
  defaultDoc,
  agentes,
  showDefault,
  kind,
}: {
  setor: Setor
  month: string
  monthDoc: MetaDoc | null
  defaultDoc: MetaDoc | null
  agentes: Agente[]
  showDefault: boolean
  kind: MetaKind
}) {
  const effective = effectiveSetorMeta(setor, monthDoc, defaultDoc, kind)
  const hasOverride = hasSetorOverride(setor, monthDoc, kind)
  const defaultValue = defaultDocSetorMeta(setor, defaultDoc, kind, effective)
  // Meta efetiva (rolled-up): base + ajustes individuais. Difere da base
  // quando algum colaborador foi ajustado manualmente.
  const rolled = rolledUpSetorMeta(agentes, setor, month, monthDoc, defaultDoc, kind)
  // Tolerância de 1 em USD é ok; em ativação (números pequenos) precisa ser fina.
  const tol = kind === 'ativacao' ? 0.01 : 1
  const rolledDiffers = Math.abs(rolled - effective) > tol

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <SetorBadge setor={setor} />
          {hasOverride && (
            <span className="rounded bg-app-accent/10 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wide text-app-accent">
              base ajustada no mês
            </span>
          )}
          {rolledDiffers && (
            <span
              className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9.5px] font-medium text-emerald-600 dark:text-emerald-400"
              title="Meta efetiva do time = base + ajustes por colaborador (é o que entra na meta geral)"
            >
              efetiva {formatMetric(rolled, kind)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <MetaInput
            value={effective}
            kind={kind}
            onSave={(v) => saveMonthSetorMeta(month, setor, v, kind)}
          />
          {hasOverride && (
            <button
              type="button"
              title="Voltar ao padrão"
              onClick={() => clearMonthSetorMeta(month, setor, kind)}
              className="flex h-7 w-7 items-center justify-center rounded text-app-muted transition-colors hover:bg-app-elev hover:text-app-text"
            >
              <RotateCcw size={13} />
            </button>
          )}
        </div>
      </div>
      {showDefault && (
        <div className="mt-2 flex items-center justify-between gap-3 border-t border-dashed border-app-border/60 pt-2">
          <span className="text-[10.5px] text-app-subtle">
            Padrão (aplica a qualquer mês sem ajuste)
          </span>
          <MetaInput
            value={defaultValue}
            small
            kind={kind}
            onSave={(v) => saveDefaultSetorMeta(setor, v, kind)}
          />
        </div>
      )}
    </li>
  )
}

/* --------------------------------------------------------------------------- */
/* Seção de metas por colaborador (um time)                                     */
/* --------------------------------------------------------------------------- */

function ColaboradorMetaSection({
  setor,
  month,
  monthDoc,
  defaultDoc,
  agentes,
  kind,
}: {
  setor: Setor
  month: string
  monthDoc: MetaDoc | null
  defaultDoc: MetaDoc | null
  agentes: Agente[]
  kind: MetaKind
}) {
  const setorMeta = effectiveSetorMeta(setor, monthDoc, defaultDoc, kind)
  const monthStart = new Date(`${month}-01T00:00:00`)

  // Todos os gestores ativos do setor; novos (criados no mês) ficam fora do
  // divisor mas ainda aparecem (flag "novo").
  const membros = useMemo(
    () =>
      agentes
        .filter((a) => a.role === 'agente' && a.active && a.setor === setor)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [agentes, setor],
  )
  const eligibleCount = eligibleColaboradores(agentes, setor, month).length
  const share = equalShare(setorMeta, eligibleCount)

  const isNovo = (a: Agente) => {
    const created = a.createdAt?.toDate?.()
    return !!created && created >= monthStart
  }

  const effectiveOf = (a: Agente) => {
    if (hasColaboradorOverride(a.uid, monthDoc, kind)) {
      return effectiveColaboradorMeta(a.uid, setorMeta, eligibleCount, monthDoc, kind)
    }
    return isNovo(a) ? 0 : share
  }

  const somaIndividuais = membros.reduce((s, a) => s + effectiveOf(a), 0)
  const diff = somaIndividuais - setorMeta
  const mismatch = Math.abs(diff) > (kind === 'ativacao' ? 0.01 : 1)

  if (membros.length === 0) return null

  return (
    <div className="panel mb-3 overflow-hidden">
      <div className="panel-head">
        <div className="flex items-center gap-2">
          <SetorBadge setor={setor} size="sm" />
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-app-muted">
            Colaboradores
          </h3>
        </div>
        <span className="font-mono text-[10px] tabular-nums text-app-subtle">
          {eligibleCount} elegíve{eligibleCount === 1 ? 'l' : 'is'} · igual{' '}
          {formatMetric(share, kind)}
        </span>
      </div>

      <ul className="divide-y divide-app-border/60">
        {membros.map((a) => {
          const hasOverride = hasColaboradorOverride(a.uid, monthDoc, kind)
          const novo = isNovo(a)
          return (
            <li key={a.uid} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[12.5px] font-medium text-app-text">{a.name}</span>
                {novo && (
                  <span
                    className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9.5px] font-medium text-amber-600 dark:text-amber-400"
                    title="Colaborador novo: conta na divisão só no mês seguinte"
                  >
                    novo
                  </span>
                )}
                {hasOverride && (
                  <span className="rounded bg-app-accent/10 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wide text-app-accent">
                    manual
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <MetaInput
                  value={effectiveOf(a)}
                  small
                  kind={kind}
                  onSave={(v) => saveColaboradorMeta(month, a.uid, v, a.name, kind)}
                />
                {hasOverride && (
                  <button
                    type="button"
                    title="Voltar à divisão igualitária"
                    onClick={() => clearColaboradorMeta(month, a.uid, a.name, kind)}
                    className="flex h-7 w-7 items-center justify-center rounded text-app-muted transition-colors hover:bg-app-elev hover:text-app-text"
                  >
                    <RotateCcw size={13} />
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {/* Meta efetiva do time = soma dos individuais (sobe pra meta geral) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-app-border/60 bg-app-elev/30 px-4 py-2.5 text-[11px]">
        <span className="flex items-center gap-1.5 font-medium text-app-muted">
          <Gauge size={12} className="text-app-muted" />
          Meta efetiva do time
          <span className="text-app-subtle">· entra na meta geral</span>
        </span>
        <span className="font-mono tabular-nums text-app-text">
          {formatMetric(somaIndividuais, kind)}
          <span className="ml-2 text-app-subtle">base {formatMetric(setorMeta, kind)}</span>
          {mismatch && (
            <span
              className={`ml-2 ${
                diff > 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              ({diff > 0 ? '+' : ''}
              {formatMetric(diff, kind)})
            </span>
          )}
        </span>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------------------- */
/* Input de valor: USD (volume) ou contagem (ativação)                         */
/* --------------------------------------------------------------------------- */

function MetaInput({
  value,
  onSave,
  small,
  kind,
}: {
  value: number
  onSave: (v: number) => void | Promise<void>
  small?: boolean
  kind: MetaKind
}) {
  const [draft, setDraft] = useState(String(Math.round(value)))

  // Ressincroniza quando o valor efetivo muda por fora (troca de mês, reset).
  useEffect(() => {
    setDraft(String(Math.round(value)))
  }, [value])

  const commit = () => {
    const n = Number(draft.replace(/[^\d.-]/g, ''))
    if (!Number.isFinite(n) || n < 0) {
      setDraft(String(Math.round(value)))
      return
    }
    if (Math.round(n) !== Math.round(value)) {
      onSave(Math.round(n))
    }
  }

  const isAtiv = kind === 'ativacao'
  return (
    <div className="inline-flex items-center rounded-md border border-app-border bg-app-card focus-within:border-app-accent">
      {!isAtiv && <span className="pl-2 pr-1 text-[10.5px] text-app-subtle">$</span>}
      <input
        type="text"
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        className={`bg-transparent py-1 text-right font-mono tabular-nums text-app-text outline-none ${
          isAtiv ? 'pl-2' : ''
        } ${small ? 'w-24 text-[12px]' : 'w-28 text-[13px]'}`}
      />
      {isAtiv && (
        <span className="pl-1 pr-2 text-[10px] uppercase tracking-wide text-app-subtle">ativ.</span>
      )}
      {!isAtiv && <span className="pr-2" />}
    </div>
  )
}

/* --------------------------------------------------------------------------- */
/* Navegação de mês                                                             */
/* --------------------------------------------------------------------------- */

function MonthOffsetNav({
  offset,
  onChange,
}: {
  offset: number
  onChange: (next: number) => void
}) {
  const target = monthDateFromOffset(offset)
  const label = target.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-app-border bg-app-card px-1 py-1">
      <button
        type="button"
        onClick={() => onChange(offset - 1)}
        title="Mês anterior"
        className="flex h-5 w-5 items-center justify-center rounded text-app-muted transition-colors hover:bg-app-elev hover:text-app-text"
      >
        ‹
      </button>
      <span className="min-w-[72px] text-center font-mono text-[10.5px] font-semibold uppercase tabular-nums text-app-text">
        {label}
      </span>
      <button
        type="button"
        onClick={() => onChange(offset + 1)}
        title="Próximo mês"
        className="flex h-5 w-5 items-center justify-center rounded text-app-muted transition-colors hover:bg-app-elev hover:text-app-text"
      >
        ›
      </button>
    </div>
  )
}
