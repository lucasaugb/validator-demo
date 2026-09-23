import { useEffect, useMemo, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import {
  ClipboardList,
  FileSpreadsheet,
  History,
  LayoutDashboard,
} from 'lucide-react'
import { AppShell } from '../components/AppShell'
import type { NavItem } from '../components/AppShell'
import { AgenteHome } from './AgenteHome'
import { AgenteTransactions } from './AgenteTransactions'
import { AgenteImport } from './AgenteImport'
import { ReleaseNotes } from './ReleaseNotes'
import { Profile } from './Profile'
import { AdminObservationToast } from '../components/AdminObservationToast'
import { useAuth } from '../contexts/AuthContext'
import { subscribeAgenteTransactions } from '../lib/transactions'
import { useAutoFxConversion } from '../lib/useAutoFxConversion'
import { useUnreadReleaseNotes } from '../lib/useUnreadReleaseNotes'
import type { Transaction } from '../types'

export function AgenteDashboard() {
  const { user, agente } = useAuth()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const unreadNotes = useUnreadReleaseNotes(agente?.role, agente?.uid)

  useEffect(() => {
    if (!user) return
    return subscribeAgenteTransactions(user.uid, setTransactions)
  }, [user])
  useAutoFxConversion(transactions)

  const nav = useMemo<NavItem[]>(
    () => [
      { to: '/agente', label: 'Visão geral', icon: LayoutDashboard, end: true },
      { to: '/agente/registros', label: 'Meus registros', icon: ClipboardList },
      { to: '/agente/importar', label: 'Importar planilha', icon: FileSpreadsheet },
      { to: '/agente/novidades', label: 'Notas de atualização', icon: History, badge: unreadNotes },
    ],
    [unreadNotes],
  )

  return (
    <AppShell nav={nav}>
      <Routes>
        <Route index element={<AgenteHome transactions={transactions} />} />
        <Route path="registros" element={<AgenteTransactions transactions={transactions} />} />
        <Route path="importar" element={<AgenteImport />} />
        <Route path="novidades" element={<ReleaseNotes />} />
        {/* Compat: links antigos pra /agente/transacoes e /agente/comissoes-pendentes
            redirecionam pra raiz/registros: nomenclatura nova é "Registro". */}
        <Route path="transacoes" element={<Navigate to="/agente/registros" replace />} />
        <Route
          path="comissoes-pendentes"
          element={<Navigate to="/agente" replace />}
        />
        <Route path="perfil" element={<Profile />} />
        <Route path="*" element={<Navigate to="/agente" replace />} />
      </Routes>
      <AdminObservationToast transactions={transactions} />
    </AppShell>
  )
}
