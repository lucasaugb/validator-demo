import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, MessageCircle, X } from 'lucide-react'
import type { Transaction } from '../types'
import { useAuth } from '../contexts/AuthContext'

interface Props {
  transactions: Transaction[]
}

const MAX_VISIBLE = 3

/**
 * Toast no canto inferior direito que mostra registros com conversa rejeitada
 * + observação do admin pro gestor.
 *
 * Persistência: dismiss é da SESSÃO (in-memory). Ao recarregar a página ou
 * voltar pro sistema, o popup reaparece, só some pra valer quando o admin
 * reabrir a conversa (i.e., conversationValidation deixa de ser 'rejected').
 * Decisão 2026-05-28: garantia de que o gestor leia a observação toda vez
 * que voltar, não só na sessão atual.
 */
export function AdminObservationToast({ transactions }: Props) {
  const { agente } = useAuth()
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const targets = useMemo(
    () =>
      transactions
        .filter(
          (d) =>
            d.conversationValidation === 'rejected' &&
            !!d.conversationNote &&
            !dismissed.has(d.id),
        )
        .sort((a, b) => {
          const aMs = a.updatedAt?.toMillis() ?? 0
          const bMs = b.updatedAt?.toMillis() ?? 0
          return bMs - aMs
        }),
    [transactions, dismissed],
  )

  if (agente?.role !== 'agente') return null
  if (targets.length === 0) return null

  const visible = targets.slice(0, MAX_VISIBLE)
  const overflow = targets.length - visible.length

  const handleDismiss = (id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-[360px] flex-col gap-2">
      {visible.map((d) => (
        <article
          key={d.id}
          className="pointer-events-auto overflow-hidden rounded-xl border border-rose-500/40 bg-app-card shadow-2xl ring-1 ring-rose-500/20"
        >
          <header className="flex items-start gap-2 border-b border-rose-500/30 bg-rose-500/[0.08] px-3 py-2">
            <MessageCircle
              size={14}
              className="mt-0.5 shrink-0 text-rose-600 dark:text-rose-300"
            />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-rose-700 dark:text-rose-300">
                Observação do admin
              </div>
              <div className="mt-0.5 truncate text-[11px] text-app-muted">
                Registro {d.transactionNumber != null ? `#${d.transactionNumber}` : ''}{' '}
                · {d.clientName}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleDismiss(d.id)}
              title="Marcar como lido"
              className="-mr-1 -mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-app-subtle transition-colors hover:bg-app-elev hover:text-app-text"
            >
              <X size={13} />
            </button>
          </header>
          <div className="px-3 py-2.5">
            <p className="whitespace-pre-line break-words text-[12.5px] leading-snug text-app-text">
              {d.conversationNote}
            </p>
            <div className="mt-2.5 flex items-center justify-between">
              <Link
                to={`/agente/registros?transacao=${d.id}`}
                className="inline-flex items-center gap-1 rounded-md border border-app-border bg-app-elev px-2 py-1 text-[11px] font-medium text-app-muted transition-colors hover:bg-app-elev/80 hover:text-app-text"
              >
                <ExternalLink size={11} />
                Ver registro
              </Link>
              <button
                type="button"
                onClick={() => handleDismiss(d.id)}
                className="text-[11px] font-medium text-app-muted transition-colors hover:text-app-text"
              >
                Marcar como lido
              </button>
            </div>
          </div>
        </article>
      ))}
      {overflow > 0 && (
        <div className="pointer-events-auto rounded-lg border border-app-border bg-app-card px-3 py-1.5 text-center text-[11px] text-app-muted shadow-lg">
          + {overflow} {overflow === 1 ? 'outra observação' : 'outras observações'}{' '}
          aguardando leitura
        </div>
      )}
    </div>
  )
}
