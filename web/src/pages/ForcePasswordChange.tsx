import { useState } from 'react'
import { FirebaseError } from 'firebase/app'
import { Eye, EyeOff, KeyRound, LogOut } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { ThemeToggle } from '../components/ThemeToggle'
import { changeMyPasswordAndClearFlag } from '../lib/agentes'

/**
 * Gate renderizado pelo ProtectedRoute quando `agente.mustChangePassword` é
 * true. Bloqueia acesso ao app até o usuário definir uma nova senha.
 *
 * Fluxo: typed new pwd + confirm → updatePassword no Firebase Auth → deleteField
 * em `mustChangePassword`. O AuthContext escuta o doc via onSnapshot e re-renderiza
 * a árvore sem o gate. Sem F5 necessário.
 *
 * Visual segue o Login (card centralizado com bordas suaves). Botão de logout
 * pra fuga em caso de bloqueio (ex: requires-recent-login persistente).
 */
export function ForcePasswordChange() {
  const { agente, signOut } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const validate = (): string | null => {
    if (password.length < 8) return 'A nova senha precisa ter pelo menos 8 caracteres.'
    if (password !== confirm) return 'A confirmação não bate com a nova senha.'
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const validationErr = validate()
    if (validationErr) {
      setError(validationErr)
      return
    }
    setSubmitting(true)
    try {
      await changeMyPasswordAndClearFlag(password)
      // Sucesso: onSnapshot do AuthContext detecta mustChangePassword sumir
      // do doc e este gate desmonta automaticamente.
    } catch (err) {
      setError(
        err instanceof FirebaseError
          ? translateAuthError(err.code)
          : err instanceof Error
            ? err.message
            : 'Não foi possível trocar a senha.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative flex min-h-full items-center justify-center px-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm rounded-2xl border border-app-border bg-app-card p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-app-accent/10 text-app-accent-text">
            <KeyRound size={20} />
          </div>
          <div className="text-center">
            <h1 className="text-base font-semibold tracking-tight text-app-text">
              Defina uma nova senha
            </h1>
            <p className="mt-1 text-[12.5px] text-app-muted">
              É seu primeiro acesso, {agente?.name?.split(' ')[0] ?? 'usuário'}.
              <br />
              Substitua a senha provisória antes de continuar.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-app-muted">
              Nova senha
            </label>
            <PasswordInput
              value={password}
              onChange={setPassword}
              show={showPassword}
              onToggleShow={() => setShowPassword((v) => !v)}
              placeholder="Mínimo 8 caracteres"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-app-muted">
              Confirmar nova senha
            </label>
            <PasswordInput
              value={confirm}
              onChange={setConfirm}
              show={showConfirm}
              onToggleShow={() => setShowConfirm((v) => !v)}
              placeholder="Repita a senha"
            />
          </div>

          {error && (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !password || !confirm}
            className="w-full rounded-lg bg-app-accent px-4 py-2.5 text-sm font-semibold text-app-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Salvando…' : 'Salvar e entrar'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => signOut()}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg border border-app-border bg-transparent px-3 py-2 text-xs text-app-muted transition-colors hover:bg-app-elev hover:text-app-text"
        >
          <LogOut size={12} />
          Sair sem trocar
        </button>
      </div>
    </div>
  )
}

/**
 * Input de senha com botão integrado pra mostrar/ocultar. O type alterna
 * entre 'password' (bolinhas) e 'text' (texto cru). Ícone Eye/EyeOff à
 * direita, dentro do input.
 */
function PasswordInput({
  value,
  onChange,
  show,
  onToggleShow,
  placeholder,
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  show: boolean
  onToggleShow: () => void
  placeholder?: string
  autoFocus?: boolean
}) {
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        autoComplete="new-password"
        placeholder={placeholder}
        className="w-full rounded-lg border border-app-border bg-app-input py-2 pl-3 pr-10 text-sm text-app-text outline-none focus:border-app-accent focus:ring-2 focus:ring-app-accent/20"
      />
      <button
        type="button"
        onClick={onToggleShow}
        title={show ? 'Ocultar senha' : 'Mostrar senha'}
        aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-app-subtle transition-colors hover:bg-app-elev hover:text-app-text"
      >
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  )
}

function translateAuthError(code: string): string {
  switch (code) {
    case 'auth/weak-password':
      return 'Senha muito fraca: escolha algo com 8+ caracteres mistos.'
    case 'auth/requires-recent-login':
      return 'Sessão antiga. Faça login novamente e tente outra vez.'
    case 'auth/network-request-failed':
      return 'Sem conexão. Cheque a internet e tente de novo.'
    default:
      return 'Não foi possível trocar a senha agora. Tente de novo.'
  }
}
