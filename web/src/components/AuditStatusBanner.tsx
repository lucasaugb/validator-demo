import { useEffect, useState } from 'react'
import { CheckCircle2, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Timestamp, doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase/config'

/**
 * Banner passivo de status da auditoria automática de ativações.
 *
 * Lê `/audit_status/current` que é atualizado a cada execução do
 * `validator-validation` Cloud Run Job (30min). Mostra:
 *  - Verde (clean): tudo OK, última verificação X tempo atrás
 *  - Vermelho (auto_fixed): a auditoria corrigiu N falso(s) positivo(s),
 *    chip permanente até o admin clicar pra dispensar (sessionStorage)
 *  - Laranja (view_disagreement): erro sistêmico, view e fonte raw divergem;
 *    auto-fix BLOQUEADO, exige intervenção manual.
 *
 * Visivel só pra admin/super. Roda só leitura, nada de escrita do client.
 */

type AuditStatus = 'clean' | 'auto_fixed' | 'view_disagreement'

interface AuditStatusDoc {
  lastRunAt?: Timestamp
  status?: AuditStatus
  checked?: number
  fixedCount?: number
  disagreementCount?: number
  lastReportId?: string
}

export function AuditStatusBanner() {
  const [data, setData] = useState<AuditStatusDoc | null>(null)
  const [dismissedFixed, setDismissedFixed] = useState<string | null>(() =>
    typeof window === 'undefined'
      ? null
      : window.sessionStorage.getItem('audit_dismiss'),
  )

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'audit_status', 'current'),
      (snap) => {
        setData(snap.exists() ? ((snap.data() as AuditStatusDoc) ?? null) : null)
      },
      (err) => {
        // Sem permissão (não-admin) ou rede caída, silencioso, banner some.
        console.debug('[AuditStatusBanner] subscribe error:', err)
      },
    )
    return unsub
  }, [])

  if (!data || !data.status) return null

  // Permite admin dispensar o aviso DEPOIS de revisar o fix. O dismiss é
  // amarrado ao lastReportId: se vier um novo report com fix, o aviso volta.
  const isDismissed =
    data.status === 'auto_fixed' && dismissedFixed === data.lastReportId

  const dismiss = () => {
    if (!data.lastReportId) return
    window.sessionStorage.setItem('audit_dismiss', data.lastReportId)
    setDismissedFixed(data.lastReportId)
  }

  if (data.status === 'clean' || isDismissed) {
    // Estado bom: chip pequeno, neutro, no canto. Não polui a tela.
    return (
      <div
        title={`Auditoria automática: tudo OK (${data.checked ?? 0} ativação${(data.checked ?? 0) === 1 ? '' : 'ões'} verificada${(data.checked ?? 0) === 1 ? '' : 's'} • ${formatAgo(data.lastRunAt)})`}
        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] px-2 py-1 text-[10.5px] font-medium text-emerald-700 dark:text-emerald-300"
      >
        <ShieldCheck size={11} />
        Auditoria OK
        <span className="text-app-subtle">· {formatAgo(data.lastRunAt)}</span>
      </div>
    )
  }

  if (data.status === 'view_disagreement') {
    return (
      <div className="flex items-start gap-2 rounded-md border-2 border-rose-500/50 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-700 dark:text-rose-200">
        <ShieldAlert size={14} className="mt-0.5 shrink-0" />
        <div>
          <div className="font-semibold">
            ⚠️ AUDITORIA: divergência crítica entre view e fonte raw (
            {data.disagreementCount ?? 0} linha
            {data.disagreementCount === 1 ? '' : 's'})
          </div>
          <div className="mt-0.5 text-[11px] opacity-90">
            Auto-fix bloqueado. Bug provável na view{' '}
            <code className="font-mono">source_transactions_enriched</code>, chamar
            o BI imediatamente. Última verificação: {formatAgo(data.lastRunAt)}.
            Report: <span className="font-mono">{data.lastReportId}</span>
          </div>
        </div>
      </div>
    )
  }

  // auto_fixed: corrigiu falsos positivos automaticamente
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/[0.08] px-3 py-2 text-[12px]">
      <div className="flex items-start gap-2 text-amber-800 dark:text-amber-200">
        <ShieldAlert size={14} className="mt-0.5 shrink-0" />
        <div>
          <div className="font-semibold">
            Auditoria corrigiu {data.fixedCount} ativação
            {data.fixedCount === 1 ? '' : 'ões'} falso-positivas
          </div>
          <div className="mt-0.5 text-[11px] opacity-90">
            isActivation foi resetado em {data.fixedCount} registro
            {data.fixedCount === 1 ? '' : 's'}. Comissão dos afetados não
            recebe mais o bônus fixo de $5. Última verificação:{' '}
            {formatAgo(data.lastRunAt)} · Report:{' '}
            <span className="font-mono">{data.lastReportId}</span>
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        title="Marcar como revisado"
        className="inline-flex shrink-0 items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10.5px] font-medium text-amber-800 transition-colors hover:bg-amber-500/20 dark:text-amber-200"
      >
        <CheckCircle2 size={11} /> revisado
      </button>
    </div>
  )
}

function formatAgo(ts: Timestamp | undefined): string {
  if (!ts || typeof ts.toMillis !== 'function') return '-'
  const diffMs = Date.now() - ts.toMillis()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'agora há pouco'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours}h`
  const days = Math.floor(hours / 24)
  return `há ${days}d`
}
