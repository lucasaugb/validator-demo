import { useState } from 'react'
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../mock/seed'
import { resetDemo } from '../mock/store'

/**
 * Bloco de acesso rápido da tela de login no modo demo: um clique entra com
 * uma conta fictícia de cada papel.
 */
export function DemoAccess({ onPick }: { onPick: (email: string, password: string) => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null)

  return (
    <div className="mt-6 border-t border-app-border pt-5">
      <p className="mb-1 text-xs font-medium uppercase tracking-wider text-app-muted">
        Modo demo · dados fictícios
      </p>
      <p className="mb-3 text-xs text-app-subtle">
        Entre com um dos perfis abaixo (senha <code className="font-mono">{DEMO_PASSWORD}</code>).
      </p>
      <div className="space-y-2">
        {DEMO_ACCOUNTS.map((a) => (
          <button
            key={a.email}
            type="button"
            disabled={busy !== null}
            onClick={async () => {
              setBusy(a.email)
              try {
                await onPick(a.email, DEMO_PASSWORD)
              } finally {
                setBusy(null)
              }
            }}
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-app-border px-3 py-2 text-left transition-colors hover:border-app-accent hover:bg-app-elev disabled:opacity-60"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium text-app-text">{a.label}</span>
              <span className="block truncate text-xs text-app-muted">{a.hint}</span>
            </span>
            <span className="shrink-0 text-xs text-app-subtle">
              {busy === a.email ? 'Entrando…' : 'Entrar →'}
            </span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={resetDemo}
        className="mt-3 w-full text-center text-xs text-app-subtle underline-offset-2 hover:text-app-text hover:underline"
      >
        Restaurar dados originais do demo
      </button>
    </div>
  )
}
