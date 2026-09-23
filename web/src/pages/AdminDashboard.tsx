import { useEffect, useMemo, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import {
  Activity,
  ClipboardCheck,
  History,
  Hourglass,
  Gauge,
  LayoutDashboard,
  SquarePen,
  Table2,
  Users,
} from 'lucide-react'
import { AppShell } from '../components/AppShell'
import type { NavItem } from '../components/AppShell'
import { AdminFiltersProvider } from '../contexts/AdminFiltersContext'
import { AdminHome } from './AdminHome'
import { AdminTransactions } from './AdminTransactions'
import { AdminEdits } from './AdminEdits'
import { AdminFechamento } from './AdminFechamento'
import { AdminActivityLog } from './AdminActivityLog'
import { AgenteManagement } from './AgenteManagement'
import { AdminMetas } from './AdminMetas'
import { CommissoesPendentes } from './CommissoesPendentes'
import { ReleaseNotes } from './ReleaseNotes'
import { Profile } from './Profile'
import { useAuth } from '../contexts/AuthContext'
import { subscribeAllTransactions } from '../lib/transactions'
import { useAutoFxConversion } from '../lib/useAutoFxConversion'
import { useUnreadReleaseNotes } from '../lib/useUnreadReleaseNotes'
import { setoresInScope } from '../types'
import type { Transaction, Setor } from '../types'

export function AdminDashboard() {
  const { agente } = useAuth()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const isSupervisor = agente?.role === 'supervisor'
  // Lista de setores que o supervisor cobre. Pra setor virtual 'premium_starter'
  // expande em ['premium','starter']; pros outros vira lista de 1 elemento.
  const supervisorSetores = useMemo(
    () =>
      isSupervisor && agente?.setor ? setoresInScope(agente.setor) : undefined,
    [isSupervisor, agente?.setor],
  )

  // Pro supervisor a subscribe JÁ vem filtrada pelo Firestore (where setor in X).
  // Sem isso o snapshot falha por causa das rules, qualquer doc fora do setor
  // viola a regra de read e o listener inteiro retorna permission-denied.
  useEffect(
    () => subscribeAllTransactions(setTransactions, supervisorSetores),
    [supervisorSetores],
  )
  useAutoFxConversion(transactions)

  // Filtros globais aplicados em todas as telas admin (menos Usuários/Perfil/
  // Log). Persistem ao navegar entre rotas. `setorScopeFilter` só faz sentido
  // pro supervisor virtual 'premium_starter'.
  const [agenteFilter, setAgenteFilter] = useState<string | null>(null)
  const [setorScopeFilter, setSetorScopeFilter] = useState<Setor | null>(null)

  const filteredTransactions = useMemo(() => {
    if (!agenteFilter && !setorScopeFilter) return transactions
    return transactions.filter((d) => {
      if (agenteFilter && d.agenteId !== agenteFilter) return false
      if (setorScopeFilter && d.agenteSetor !== setorScopeFilter) return false
      return true
    })
  }, [transactions, agenteFilter, setorScopeFilter])

  const pendingEditsCount = useMemo(
    () => filteredTransactions.filter((d) => d.pendingEdit).length,
    [filteredTransactions],
  )

  const unreadNotes = useUnreadReleaseNotes(agente?.role, agente?.uid)

  const nav = useMemo<NavItem[]>(() => {
    const items: NavItem[] = [
      { to: '/admin', label: 'Visão geral', icon: LayoutDashboard, end: true, group: 'Operação' },
      { to: '/admin/transacoes', label: 'Registros', icon: Table2, group: 'Operação' },
      { to: '/admin/comissoes-pendentes', label: 'Comissões Pendentes', icon: Hourglass, group: 'Operação' },
      { to: '/admin/fechamento', label: 'Fechamento', icon: ClipboardCheck, group: 'Operação' },
      {
        to: '/admin/edicoes',
        label: 'Edições',
        icon: SquarePen,
        group: 'Gestão',
        badge: pendingEditsCount,
      },
    ]
    // Metas: quem tem a capability `canEditMetas` (ex.: Gerente operacional),
    // super_admin sempre pode (dono do sistema).
    if (agente?.canEditMetas || agente?.role === 'super_admin') {
      items.push({ to: '/admin/metas', label: 'Metas', icon: Gauge, group: 'Gestão' })
    }
    // Log de atividade: só admin/super_admin (supervisor não tem auditoria).
    if (agente?.role === 'admin' || agente?.role === 'super_admin') {
      items.push({ to: '/admin/log', label: 'Log de atividade', icon: Activity, group: 'Gestão' })
    }
    // Usuários: super_admin/admin (gestão global) ou supervisor (só do setor).
    // Admin pode tudo menos criar/promover pra role 'agente' (gestor), esse
    // privilégio fica reservado ao super_admin (ver firestore.rules e UI).
    if (
      agente?.role === 'super_admin' ||
      agente?.role === 'admin' ||
      agente?.role === 'supervisor'
    ) {
      items.push({ to: '/admin/agentes', label: 'Usuários', icon: Users, group: 'Gestão' })
    }
    items.push({
      to: '/admin/novidades',
      label: 'Notas de atualização',
      icon: History,
      group: 'Sistema',
      badge: unreadNotes,
    })
    return items
  }, [agente, pendingEditsCount, unreadNotes])

  return (
    <AdminFiltersProvider
      allTransactions={transactions}
      agente={agente ?? null}
      agenteFilter={agenteFilter}
      setAgenteFilter={setAgenteFilter}
      setorScopeFilter={setorScopeFilter}
      setSetorScopeFilter={setSetorScopeFilter}
    >
    <AppShell nav={nav}>
      <Routes>
        <Route index element={<AdminHome transactions={filteredTransactions} rawTransactions={transactions} />} />
        <Route path="edicoes" element={<AdminEdits transactions={filteredTransactions} />} />
        <Route path="transacoes" element={<AdminTransactions transactions={filteredTransactions} />} />
        <Route
          path="comissoes-pendentes"
          element={<CommissoesPendentes transactions={filteredTransactions} />}
        />
        <Route
          path="fechamento"
          element={<AdminFechamento transactions={filteredTransactions} />}
        />
        {(agente?.role === 'admin' || agente?.role === 'super_admin') && (
          <Route path="log" element={<AdminActivityLog />} />
        )}
        {(agente?.role === 'super_admin' ||
          agente?.role === 'admin' ||
          agente?.role === 'supervisor') && (
          <Route path="agentes" element={<AgenteManagement />} />
        )}
        {(agente?.canEditMetas || agente?.role === 'super_admin') && (
          <Route path="metas" element={<AdminMetas transactions={transactions} />} />
        )}
        <Route path="novidades" element={<ReleaseNotes />} />
        <Route path="perfil" element={<Profile />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </AppShell>
    </AdminFiltersProvider>
  )
}
