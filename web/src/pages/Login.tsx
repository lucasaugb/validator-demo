import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import { useAuth } from '../contexts/AuthContext'
import { ThemeToggle } from '../components/ThemeToggle'
import { Logo } from '../components/Logo'
import { DemoAccess } from '../components/DemoAccess'

const IS_DEMO = import.meta.env.VITE_DEMO_MODE === 'true'

export function Login() {
  const { signIn, agente, loading } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!loading && agente?.active) {
      navigate(agente.role === 'agente' ? '/agente' : '/admin', { replace: true })
    }
  }, [agente, loading, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await signIn(email, password)
    } catch (err) {
      if (err instanceof FirebaseError) {
        setError(translateAuthError(err.code))
      } else {
        setError('Erro inesperado. Tente novamente.')
      }
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
          <Logo size={64} />
          <div className="flex flex-col items-center gap-1.5">
            <p className="text-base font-semibold tracking-tight text-app-text">
              Validator Demo
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-app-muted">
              Email
            </label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-app-muted">
              Senha
            </label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls}
            />
          </div>

          {error && (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-green-500 px-4 py-2.5 text-sm font-semibold text-green-950 transition-colors hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        {IS_DEMO && <DemoAccess onPick={signIn} />}
      </div>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-app-border bg-app-input px-3 py-2 text-sm text-app-text outline-none transition-colors focus:border-green-500 focus:ring-2 focus:ring-green-500/20'

function translateAuthError(code: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email ou senha incorretos.'
    case 'auth/too-many-requests':
      return 'Muitas tentativas. Tente novamente mais tarde.'
    case 'auth/network-request-failed':
      return 'Falha de rede. Verifique sua conexão.'
    case 'auth/invalid-email':
      return 'Email inválido.'
    default:
      return 'Não foi possível entrar. Tente novamente.'
  }
}
