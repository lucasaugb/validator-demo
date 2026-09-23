import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { ForcePasswordChange } from '../pages/ForcePasswordChange'
import type { Role } from '../types'

interface Props {
  roles: Role[]
  children: ReactNode
}

export function ProtectedRoute({ roles, children }: Props) {
  const { user, agente, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        Carregando…
      </div>
    )
  }

  if (!user || !agente || !agente.active) {
    return <Navigate to="/login" replace />
  }

  if (!roles.includes(agente.role)) {
    return <Navigate to={agente.role === 'agente' ? '/agente' : '/admin'} replace />
  }

  // Gate de primeiro login: enquanto `mustChangePassword === true`, renderiza
  // a tela de troca de senha em vez do dashboard. O onSnapshot do AuthContext
  // detecta o campo sumir do doc (deleteField em changeMyPasswordAndClearFlag)
  // e re-renderiza a árvore com `children` aqui sem precisar de F5.
  if (agente.mustChangePassword === true) {
    return <ForcePasswordChange />
  }

  return <>{children}</>
}
