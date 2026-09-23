import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { FirebaseError } from 'firebase/app'
import { Check, KeyRound, Pencil, RefreshCcw, Search, Trash2, UserPlus, X } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { Modal } from '../components/Modal'
import {
  cleanupOrphanSetorOnAdmins,
  createAgente,
  deleteAgente,
  resetGestorPasswords,
  sendPasswordReset,
  setAgenteActive,
  setAgenteCanEditMetas,
  setAgenteName,
  setAgenteRole,
  setAgenteSetor,
  setAgenteSlackUserId,
  subscribeAgentes,
} from '../lib/agentes'
import { SETORES, SETORES_SUPERVISOR, setorLabel, setoresInScope } from '../types'
import type { Agente, Role, Setor } from '../types'
import { useAuth } from '../contexts/AuthContext'
import type { Timestamp } from 'firebase/firestore'
import { Avatar } from '../components/Avatar'
import { SetorBadge } from '../components/SetorBadge'

// Slack member IDs: U (user) ou W (workspace owner em alguns casos), seguidos
// de letras/dígitos maiúsculos. Validação leniente, pelo menos 9 chars.
const SLACK_USER_ID_RE = /^[UW][A-Z0-9]{8,}$/

// Senha padrão pra TODA conta de Gestor (role=agente). O usuário é forçado
// a trocar no primeiro login pelo flag `mustChangePassword`. Mantém a senha
// uniforme pra simplificar onboarding da equipe comercial.
export const GESTOR_DEFAULT_PASSWORD = 'validator2026'

const schema = z
  .object({
    name: z.string().min(1, 'Obrigatório'),
    email: z.string().email('Email inválido'),
    password: z.string().min(8, 'Mínimo 8 caracteres'),
    role: z.enum(['agente', 'supervisor', 'admin', 'super_admin']),
    setor: z
      .enum([
        'premium',
        'starter',
        'eventos',
        'online',
        'premium_starter',
        'online_eventos',
      ])
      .optional(),
    slackUserId: z
      .string()
      .trim()
      .optional()
      .refine(
        (v) => !v || SLACK_USER_ID_RE.test(v),
        'ID do Slack inválido (ex: U07ABC123)',
      ),
  })
  .refine(
    (d) => d.role === 'admin' || d.role === 'super_admin' || !!d.setor,
    {
      // Gestor e Supervisor exigem setor: admin/super_admin são globais.
      message: 'Setor é obrigatório para gestores e supervisores',
      path: ['setor'],
    },
  )
  .refine(
    // Setores virtuais ('premium_starter', 'online_eventos') são exclusivos
    // de supervisor (cobrem 2 setores). Atribuir a gestor confunde as métricas,
    // bloqueia no schema.
    (d) =>
      (d.setor !== 'premium_starter' && d.setor !== 'online_eventos') ||
      d.role === 'supervisor',
    {
      message: 'Setores combinados (ex: Premium/Starter) só podem ser atribuídos a Supervisor',
      path: ['setor'],
    },
  )

type FormValues = z.infer<typeof schema>

export function AgenteManagement() {
  const { agente: currentUser } = useAuth()
  const isSupervisor = currentUser?.role === 'supervisor'
  const isSuperAdmin = currentUser?.role === 'super_admin'
  const isAdmin = currentUser?.role === 'admin'
  // Capacidades:
  //   - Criar / deletar / reset de senha / editar Slack: SUPER_ADMIN only
  //   - Editar inline (role, setor): admin + super_admin
  //   - Ativar/desativar: admin + super_admin (e supervisor no próprio setor)
  // Admin não vê o form de "Novo usuário". Decisão de 2026-05-15 (rodada 2).
  const canCreate = isSuperAdmin
  const canEditInline = isSuperAdmin || isAdmin

  const [agentes, setAgentes] = useState<Agente[]>([])
  const [feedback, setFeedback] = useState<{
    kind: 'success' | 'error'
    msg: string
  } | null>(null)

  // Exclusão de usuário (super_admin only). Mantém o doc-alvo em estado pra
  // alimentar o Modal de confirmação e exibir nome/email no aviso.
  const [deleteTarget, setDeleteTarget] = useState<Agente | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Redefinição de senha (super_admin only). Mesmo padrão de modal:
  //   pendente → confirma → email enviado / erro
  const [resetTarget, setResetTarget] = useState<Agente | null>(null)
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetSentFor, setResetSentFor] = useState<string | null>(null)

  // Reset em massa pra senha padrão `validator2026` (super_admin only).
  // Dispara a Cloud Function `reset_gestor_passwords` sem `uid`, que itera
  // por TODOS os gestores e força mustChangePassword=true no próximo login.
  const [bulkResetOpen, setBulkResetOpen] = useState(false)
  const [bulkResetting, setBulkResetting] = useState(false)
  const [bulkResetError, setBulkResetError] = useState<string | null>(null)
  const [bulkResetResult, setBulkResetResult] = useState<{
    resetCount: number
    errorCount: number
  } | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
    setValue,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      role: 'agente',
      setor: 'premium',
      password: GESTOR_DEFAULT_PASSWORD,
    },
  })

  const selectedRole = watch('role')

  // Gestor entra sempre com a senha padrão; se o usuário trocar a role no
  // dropdown, limpa o campo pra obrigar a digitar (ou redigita default se voltar
  // pra gestor). Isso evita carregar "validator2026" como senha de admin/super.
  useEffect(() => {
    if (selectedRole === 'agente') {
      setValue('password', GESTOR_DEFAULT_PASSWORD, { shouldValidate: false })
    } else {
      setValue('password', '', { shouldValidate: false })
    }
  }, [selectedRole, setValue])

  useEffect(() => subscribeAgentes(setAgentes), [])

  // Saneamento: super_admin ao abrir a tela limpa `setor` legado de docs
  // admin/super_admin (bug 2026-05-26: admin promovido sem cleanup
  // ficava sendo contabilizado num setor). Roda uma vez por sessão depois
  // que a lista carrega. Idempotente: chamadas extras não causam erro.
  const [hasRunCleanup, setHasRunCleanup] = useState(false)
  useEffect(() => {
    if (!isSuperAdmin) return
    if (hasRunCleanup) return
    if (agentes.length === 0) return
    setHasRunCleanup(true)
    cleanupOrphanSetorOnAdmins(agentes).catch((err) => {
      console.warn('cleanupOrphanSetorOnAdmins falhou:', err)
    })
  }, [agentes, isSuperAdmin, hasRunCleanup])

  // Supervisor só vê GESTORES dentro do próprio escopo, não enxerga admins,
  // super_admins nem outros supervisores. Pra setor virtual 'premium_starter',
  // o escopo cobre ambos os setores. Super admin vê tudo.
  const visibleAgentes = useMemo(() => {
    if (!isSupervisor) return agentes
    const scope = currentUser?.setor ? setoresInScope(currentUser.setor) : []
    if (scope.length === 0) return []
    return agentes.filter(
      (a) =>
        a.role === 'agente' && a.setor !== undefined && scope.includes(a.setor),
    )
  }, [agentes, isSupervisor, currentUser?.setor])

  // Busca por nome/email + filtro por setor (admin/super veem o filtro;
  // supervisor já tem o escopo fixo no próprio setor).
  const [searchQuery, setSearchQuery] = useState('')
  const [setorFilter, setSetorFilter] = useState<Setor | 'all' | 'none' | 'supervisor'>('all')

  // Form de criação fica num Modal pra não ocupar coluna fixa na visão de
  // super_admin (decisão 2026-05-25: antes era um painel lateral sempre aberto).
  const [createOpen, setCreateOpen] = useState(false)

  const filteredAgentes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return visibleAgentes.filter((a) => {
      if (setorFilter === 'none') {
        if (a.role !== 'admin' && a.role !== 'super_admin') return false
      } else if (setorFilter === 'supervisor') {
        if (a.role !== 'supervisor') return false
      } else if (setorFilter !== 'all') {
        if (a.setor !== setorFilter) return false
      }
      if (!q) return true
      return (
        a.name.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q)
      )
    })
  }, [visibleAgentes, searchQuery, setorFilter])

  const onSubmit = handleSubmit(async (data) => {
    setFeedback(null)
    // Defense-in-depth: o form só renderiza pra super_admin, mas se alguém
    // (admin, ou um cliente adulterado) tentar submeter via devtools, as
    // firestore.rules bloqueiam: só super passa em `allow create`.
    if (!canCreate) {
      setFeedback({
        kind: 'error',
        msg: 'Apenas o super admin pode criar usuários.',
      })
      return
    }
    try {
      // admin/super_admin não levam setor: limpa antes de enviar
      // slackUserId "" vira undefined pra não gravar campo vazio
      const payload = {
        ...data,
        setor:
          data.role === 'admin' || data.role === 'super_admin'
            ? undefined
            : data.setor,
        slackUserId: data.slackUserId?.trim() || undefined,
      }
      await createAgente(payload)
      // Só limpa APÓS criar com sucesso, preserva o preenchimento se der erro.
      // Reset explícito de todos os campos pra evitar resíduo de inputs.
      // password volta pra GESTOR_DEFAULT_PASSWORD porque a role default é
      // 'agente'; useEffect mantém sincronizado se o usuário trocar role depois.
      reset({
        name: '',
        email: '',
        password: GESTOR_DEFAULT_PASSWORD,
        role: 'agente',
        setor: 'premium',
        slackUserId: '',
      })
      setFeedback({ kind: 'success', msg: 'Usuário criado com sucesso.' })
      setCreateOpen(false)
      setTimeout(() => setFeedback(null), 3000)
    } catch (err) {
      setFeedback({
        kind: 'error',
        msg: err instanceof FirebaseError ? translateAuthError(err.code) : 'Falha ao criar usuário.',
      })
    }
  })

  const subtitle = isSupervisor
    ? `Gestores do setor ${currentUser?.setor ? setorLabel[currentUser.setor] : ''}, ative ou desative`
    : canCreate
      ? 'Cadastre, ative, desative ou ajuste usuários da equipe'
      : 'Ative, desative, troque setor ou tipo dos usuários'

  return (
    <>
      <PageHeader
        title="Gestão de usuários"
        subtitle={subtitle}
      />

      {/* Feedback global de criação: fica fora do Modal pra continuar visível
          após o sucesso (Modal fecha automaticamente, mas o toast de "Criado"
          permanece 3s na página principal). */}
      {feedback?.kind === 'success' && !createOpen && (
        <p className="mb-4 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-300">
          {feedback.msg}
        </p>
      )}

      <div className="grid gap-6">
        <section className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-app-text">
              {isSupervisor ? 'Gestores do setor' : 'Usuários cadastrados'} ({filteredAgentes.length}
              {filteredAgentes.length !== visibleAgentes.length && ` de ${visibleAgentes.length}`})
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-56">
                <Search
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-app-subtle"
                />
                <input
                  type="text"
                  placeholder="Buscar por nome ou email"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-app-border bg-app-card py-2 pl-9 pr-3 text-sm text-app-text outline-none transition-colors focus:border-app-border-strong"
                />
              </div>
              {!isSupervisor && (
                <select
                  value={setorFilter}
                  onChange={(e) => setSetorFilter(e.target.value as Setor | 'all' | 'none' | 'supervisor')}
                  className="rounded-lg border border-app-border bg-app-card px-3 py-2 text-sm text-app-text outline-none focus:border-app-border-strong"
                >
                  <option value="all">Todos os setores</option>
                  {SETORES.map((s) => (
                    <option key={s} value={s}>
                      {setorLabel[s]}
                    </option>
                  ))}
                  <option value="supervisor">Supervisor</option>
                  <option value="none">Admin</option>
                </select>
              )}
              {isSuperAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    setBulkResetError(null)
                    setBulkResetResult(null)
                    setBulkResetOpen(true)
                  }}
                  title="Padroniza a senha de TODOS os gestores em validator2026"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-app-border bg-app-card px-3 py-2 text-sm font-medium text-app-text transition-colors hover:bg-app-elev"
                >
                  <RefreshCcw size={14} />
                  Senha padrão gestores
                </button>
              )}
              {canCreate && (
                <button
                  type="button"
                  onClick={() => {
                    setFeedback(null)
                    setCreateOpen(true)
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-green-500 px-3 py-2 text-sm font-semibold text-green-950 transition-colors hover:bg-green-400"
                >
                  <UserPlus size={14} />
                  Novo usuário
                </button>
              )}
            </div>
          </div>
          <div className="w-full overflow-x-auto rounded-xl border border-app-border bg-app-card">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="border-b border-app-border bg-app-elev/60">
                <tr>
                  <Th>Nome</Th>
                  <Th>Email</Th>
                  <Th>Tipo</Th>
                  <Th>Setor</Th>
                  {!isSupervisor && <Th>Slack ID</Th>}
                  <Th>Status</Th>
                  <Th>Criado</Th>
                  <Th>Último login</Th>
                  <Th>Ações</Th>
                </tr>
              </thead>
              <tbody>
                {filteredAgentes.length === 0 ? (
                  <tr>
                    <td colSpan={isSupervisor ? 8 : 9} className="py-10 text-center text-app-subtle">
                      {visibleAgentes.length === 0
                        ? isSupervisor
                          ? 'Nenhum gestor neste setor.'
                          : 'Nenhum usuário ainda.'
                        : 'Nenhum usuário bate com o filtro.'}
                    </td>
                  </tr>
                ) : (
                  filteredAgentes.map((a) => (
                    <tr key={a.uid} className="border-b border-app-border/60 last:border-0">
                      <Td>
                        <div className="flex items-center gap-2.5">
                          <Avatar
                            seed={a.uid}
                            name={a.name}
                            photoUrl={a.avatarUrl}
                            size={32}
                          />
                          <NameCell agente={a} canEdit={isSuperAdmin} />
                        </div>
                      </Td>
                      <Td>
                        <span className="block max-w-[220px] truncate" title={a.email}>
                          {a.email}
                        </span>
                      </Td>
                      <Td>
                        <RoleCell
                          agente={a}
                          canEdit={canEditInline}
                          isSuperAdmin={isSuperAdmin}
                          currentUid={currentUser?.uid}
                        />
                      </Td>
                      <Td>
                        <SetorCell agente={a} canEdit={canEditInline} />
                      </Td>
                      {!isSupervisor && (
                        <Td>
                          <SlackIdCell agente={a} canEdit={isSuperAdmin} />
                        </Td>
                      )}
                      <Td>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                            a.active
                              ? 'border-green-500/30 bg-green-500/15 text-green-700 dark:text-green-300'
                              : 'border-app-border bg-app-elev text-app-muted'
                          }`}
                        >
                          {a.active ? 'Ativo' : 'Inativo'}
                        </span>
                      </Td>
                      <Td>
                        <TimestampCell ts={a.createdAt} />
                      </Td>
                      <Td>
                        <TimestampCell ts={a.lastLoginAt} relative emptyHint="nunca" />
                      </Td>
                      <Td>
                        {a.role !== 'super_admin' && (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => setAgenteActive(a.uid, !a.active, a.name)}
                              className="rounded border border-app-border px-2 py-1 text-xs text-app-text transition-colors hover:bg-app-elev"
                            >
                              {a.active ? 'Desativar' : 'Ativar'}
                            </button>
                            {/* Reset de senha:
                                  - super_admin: pode pra qualquer um (exceto self)
                                  - admin: pode SÓ pra gestor (role 'agente')
                                Excluir continua super_admin only. */}
                            {a.uid !== currentUser?.uid &&
                              (isSuperAdmin ||
                                (isAdmin && a.role === 'agente')) && (
                                <button
                                  onClick={() => {
                                    setResetError(null)
                                    setResetSentFor(null)
                                    setResetTarget(a)
                                  }}
                                  title="Enviar email de redefinição de senha"
                                  className="flex h-7 w-7 items-center justify-center rounded border border-app-border text-app-subtle transition-colors hover:border-app-accent/40 hover:bg-app-accent/10 hover:text-app-accent"
                                >
                                  <KeyRound size={12} />
                                </button>
                              )}
                            {/* Acesso a Metas (canEditMetas): super_admin
                                concede/revoga. Faz sentido pra admin (ex.:
                                Gerente operacional); dá autonomia total sobre
                                metas geral/time/colaborador. */}
                            {isSuperAdmin && (
                              <button
                                onClick={() =>
                                  setAgenteCanEditMetas(a.uid, !a.canEditMetas, a.name)
                                }
                                title={
                                  a.canEditMetas
                                    ? 'Remover acesso à definição de Metas'
                                    : 'Conceder acesso à definição de Metas'
                                }
                                className={`rounded border px-2 py-1 text-xs font-medium transition-colors ${
                                  a.canEditMetas
                                    ? 'border-app-accent/40 bg-app-accent/10 text-app-accent'
                                    : 'border-app-border text-app-subtle hover:bg-app-elev hover:text-app-text'
                                }`}
                              >
                                Metas
                              </button>
                            )}
                            {isSuperAdmin && a.uid !== currentUser?.uid && (
                              <button
                                onClick={() => {
                                  setDeleteError(null)
                                  setDeleteTarget(a)
                                }}
                                title="Excluir usuário"
                                className="flex h-7 w-7 items-center justify-center rounded border border-app-border text-app-subtle transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-300"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        )}
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/*
        Modal de redefinição de senha. Triggar reset não requer privilégio no
        SDK do client: o email vai SEMPRE pro dono do endereço. Mesmo assim,
        UI gateia em super_admin pra manter o fluxo limpo + audit trail em
        `agente.password-reset`. Usa o estado `resetSentFor` pra mostrar
        sucesso inline antes de fechar o modal.
      */}
      <Modal
        open={!!resetTarget}
        onClose={() => {
          if (!resetting) {
            setResetTarget(null)
            setResetSentFor(null)
            setResetError(null)
          }
        }}
        title="Redefinir senha"
        subtitle={resetTarget ? `${resetTarget.name} · ${resetTarget.email}` : undefined}
        width="md"
      >
        <div className="space-y-4">
          {resetSentFor ? (
            <>
              <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                Email enviado pra <strong>{resetSentFor}</strong>. O link expira
                em 1 hora.
              </p>
              <p className="text-xs text-app-subtle">
                Avise o usuário pra checar a caixa de spam se não chegar nos
                próximos minutos.
              </p>
              <div className="flex justify-end">
                <button
                  onClick={() => {
                    setResetTarget(null)
                    setResetSentFor(null)
                  }}
                  className="rounded-lg bg-app-accent px-3 py-2 text-sm font-semibold text-app-accent-fg transition-colors hover:opacity-90"
                >
                  Fechar
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-app-text">
                O Firebase vai enviar um email pra{' '}
                <strong>{resetTarget?.email}</strong> com um link pra cadastrar
                uma nova senha. A senha atual continua válida até o usuário
                clicar no link e definir uma nova.
              </p>
              {resetError && (
                <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                  {resetError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setResetTarget(null)}
                  disabled={resetting}
                  className="rounded-lg border border-app-border bg-app-elev px-3 py-2 text-sm text-app-text transition-colors hover:bg-app-elev/80 disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  onClick={async () => {
                    if (!resetTarget) return
                    setResetting(true)
                    setResetError(null)
                    try {
                      await sendPasswordReset(
                        resetTarget.email,
                        resetTarget.uid,
                        resetTarget.name,
                      )
                      setResetSentFor(resetTarget.email)
                    } catch (err) {
                      setResetError(
                        err instanceof FirebaseError
                          ? translateAuthError(err.code)
                          : err instanceof Error
                            ? err.message
                            : 'Falha ao enviar o email.',
                      )
                    } finally {
                      setResetting(false)
                    }
                  }}
                  disabled={resetting}
                  className="rounded-lg bg-app-accent px-3 py-2 text-sm font-semibold text-app-accent-fg transition-colors hover:opacity-90 disabled:opacity-60"
                >
                  {resetting ? 'Enviando…' : 'Enviar email'}
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/*
        Modal de exclusão. Apaga o doc em `agentes/{uid}`, sem o doc, todas as
        rules retornam null em `userDoc()` e qualquer ação é negada, então é
        revogação completa. A conta no Firebase Auth fica órfã (limitação do
        client SDK: não dá pra apagar Auth de terceiro sem Admin SDK), mas
        inofensiva. Pra cleanup futuro, criar Cloud Function `onUserDocDelete`.
      */}
      <Modal
        open={!!deleteTarget}
        onClose={() => {
          if (!deleting) setDeleteTarget(null)
        }}
        title="Excluir usuário"
        subtitle={
          deleteTarget ? `${deleteTarget.name} · ${deleteTarget.email}` : undefined
        }
        width="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-app-text">
            Esta ação remove o usuário do sistema e revoga todo o acesso. Os
            registros já feitos pelo usuário ficam preservados (mantêm
            <code className="mx-1 rounded bg-app-elev px-1.5 py-0.5 font-mono text-[11px]">
              agenteId
            </code>
            histórico). Não dá pra desfazer.
          </p>
          <p className="text-xs text-app-subtle">
            A conta de autenticação no Firebase Auth permanece, mas sem o
            registro no sistema o usuário não consegue mais entrar.
          </p>
          {deleteError && (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {deleteError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="rounded-lg border border-app-border bg-app-elev px-3 py-2 text-sm text-app-text transition-colors hover:bg-app-elev/80 disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              onClick={async () => {
                if (!deleteTarget) return
                setDeleting(true)
                setDeleteError(null)
                try {
                  await deleteAgente(deleteTarget.uid, deleteTarget.name)
                  setDeleteTarget(null)
                } catch (err) {
                  setDeleteError(
                    err instanceof Error ? err.message : 'Falha ao excluir.',
                  )
                } finally {
                  setDeleting(false)
                }
              }}
              disabled={deleting}
              className="rounded-lg bg-red-500 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-60"
            >
              {deleting ? 'Excluindo…' : 'Excluir definitivamente'}
            </button>
          </div>
        </div>
      </Modal>

      {/*
        Modal de reset em massa pra senha padrão `validator2026`. Atinge TODOS
        os gestores (role='agente') de uma vez, útil pra onboarding ou pra
        normalizar usuários legados depois de mudar a política de senha.
        Cada gestor recebe `mustChangePassword=true` e é forçado a trocar no
        próximo login. Backend: Cloud Function `reset_gestor_passwords`.
      */}
      {isSuperAdmin && (
        <Modal
          open={bulkResetOpen}
          onClose={() => {
            if (!bulkResetting) {
              setBulkResetOpen(false)
              setBulkResetResult(null)
              setBulkResetError(null)
            }
          }}
          title="Padronizar senha dos gestores"
          subtitle="Aplica `validator2026` em TODOS os gestores"
          width="md"
        >
          <div className="space-y-4">
            {bulkResetResult ? (
              <>
                <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                  Reset aplicado em <strong>{bulkResetResult.resetCount}</strong>{' '}
                  gestor(es).
                  {bulkResetResult.errorCount > 0 && (
                    <>
                      {' '}
                      <span className="text-amber-700 dark:text-amber-300">
                        {bulkResetResult.errorCount} falha(s): checar logs.
                      </span>
                    </>
                  )}
                </p>
                <p className="text-xs text-app-subtle">
                  Os gestores entram com a senha{' '}
                  <code className="rounded bg-app-elev px-1.5 py-0.5 font-mono text-[11px]">
                    validator2026
                  </code>{' '}
                  e são forçados a trocar no próximo login.
                </p>
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      setBulkResetOpen(false)
                      setBulkResetResult(null)
                    }}
                    className="rounded-lg bg-app-accent px-3 py-2 text-sm font-semibold text-app-accent-fg transition-colors hover:opacity-90"
                  >
                    Fechar
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-app-text">
                  Esta ação substitui a senha de <strong>todos os gestores</strong>{' '}
                  (role <code className="rounded bg-app-elev px-1 py-0.5 font-mono text-[11px]">agente</code>)
                  pela senha padrão{' '}
                  <code className="rounded bg-app-elev px-1.5 py-0.5 font-mono text-[12px]">
                    validator2026
                  </code>
                  . Cada gestor será obrigado a trocar no próximo login.
                </p>
                <p className="text-xs text-app-subtle">
                  Admins, supervisores e super_admins NÃO são afetados. Sessões
                  ativas não são invalidadas: o usuário só vê a tela de troca
                  quando reabrir a sessão.
                </p>
                {bulkResetError && (
                  <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                    {bulkResetError}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setBulkResetOpen(false)}
                    disabled={bulkResetting}
                    className="rounded-lg border border-app-border bg-app-elev px-3 py-2 text-sm text-app-text transition-colors hover:bg-app-elev/80 disabled:opacity-60"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={async () => {
                      setBulkResetting(true)
                      setBulkResetError(null)
                      try {
                        const r = await resetGestorPasswords()
                        setBulkResetResult({
                          resetCount: r.resetCount,
                          errorCount: r.errorCount,
                        })
                      } catch (err) {
                        setBulkResetError(
                          err instanceof Error
                            ? err.message
                            : 'Falha ao resetar senhas.',
                        )
                      } finally {
                        setBulkResetting(false)
                      }
                    }}
                    disabled={bulkResetting}
                    className="rounded-lg bg-app-accent px-3 py-2 text-sm font-semibold text-app-accent-fg transition-colors hover:opacity-90 disabled:opacity-60"
                  >
                    {bulkResetting ? 'Aplicando…' : 'Aplicar senha padrão'}
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {/* Modal de criação de usuário, só renderiza pra super_admin (canCreate).
          Substitui o painel lateral fixo que ocupava 380px à esquerda. */}
      {canCreate && (
        <Modal
          open={createOpen}
          onClose={() => {
            if (!isSubmitting) {
              setCreateOpen(false)
              setFeedback(null)
            }
          }}
          title="Novo usuário"
          subtitle="Cadastrar gestor, supervisor ou admin"
          width="lg"
        >
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Nome" error={errors.name?.message}>
              <input type="text" {...register('name')} className={inputCls} />
            </Field>
            <Field label="Email" error={errors.email?.message}>
              <input type="email" {...register('email')} className={inputCls} />
            </Field>
            {selectedRole === 'agente' ? (
              // Gestor entra sempre com a senha padrão `validator2026`. O input
              // continua registrado (pra o submit enviar o valor), mas fica
              // invisível pro super_admin: só vê o aviso.
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-app-muted">
                  Senha provisória
                </label>
                <div className="rounded-lg border border-app-border bg-app-elev/40 px-3 py-2 text-sm">
                  <p className="text-app-text">
                    Senha padrão{' '}
                    <code className="rounded bg-app-elev px-1.5 py-0.5 font-mono text-[12px]">
                      {GESTOR_DEFAULT_PASSWORD}
                    </code>
                  </p>
                  <p className="mt-1 text-[11px] text-app-subtle">
                    O gestor será forçado a trocar no primeiro acesso.
                  </p>
                </div>
                <input type="hidden" {...register('password')} />
              </div>
            ) : (
              <Field
                label="Senha provisória"
                error={errors.password?.message}
                hint="O usuário será forçado a trocar essa senha no primeiro acesso."
              >
                <input type="text" {...register('password')} className={inputCls} />
              </Field>
            )}
            <div
              className={`grid gap-3 ${
                selectedRole !== 'admin' && selectedRole !== 'super_admin'
                  ? 'grid-cols-2'
                  : ''
              }`}
            >
              <Field label="Tipo" error={errors.role?.message}>
                <select {...register('role')} className={inputCls}>
                  <option value="agente">Gestor</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="admin">Admin</option>
                  {isSuperAdmin && (
                    <option value="super_admin">Super Admin</option>
                  )}
                </select>
              </Field>
              {selectedRole !== 'admin' && selectedRole !== 'super_admin' && (
                <Field label="Setor" error={errors.setor?.message}>
                  <select {...register('setor')} className={inputCls}>
                    {(selectedRole === 'supervisor'
                      ? SETORES_SUPERVISOR
                      : SETORES
                    ).map((s) => (
                      <option key={s} value={s}>
                        {setorLabel[s]}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>

            <Field
              label="Slack ID (opcional)"
              error={errors.slackUserId?.message}
              hint="usado pra mandar DM com o PDF do fechamento, pode preencher depois"
            >
              <input
                type="text"
                placeholder="U07ABC123"
                {...register('slackUserId')}
                className={`${inputCls} font-mono`}
              />
            </Field>

            {feedback?.kind === 'error' && (
              <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                {feedback.msg}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setCreateOpen(false)
                  setFeedback(null)
                }}
                disabled={isSubmitting}
                className="rounded-lg border border-app-border bg-app-elev px-3 py-2.5 text-sm text-app-text transition-colors hover:bg-app-elev/80 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-lg bg-green-500 px-4 py-2.5 text-sm font-semibold text-green-950 transition-colors hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? 'Criando…' : 'Criar usuário'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}

const inputCls =
  'w-full rounded-lg border border-app-border bg-app-input px-3 py-2 text-sm text-app-text outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/20'

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-app-muted">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p className="mt-1 text-[10.5px] text-app-subtle">{hint}</p>
      )}
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}

/**
 * Célula de Tipo. Editável por admin e super_admin (canEdit=true).
 *
 * Regras:
 *  - Admin pode mexer entre agente/supervisor/admin, mas NÃO toca em
 *    super_admin nem promove ninguém pra super_admin (rules confirmam).
 *  - Super admin pode promover/rebaixar qualquer outro (inclui super_admin),
 *    EXCETO ele mesmo (auto-proteção pra não se rebaixar acidentalmente).
 *
 * Cores: Agente=emerald, Supervisor=teal, Admin=blue, Super Admin=purple.
 */
function RoleCell({
  agente,
  canEdit,
  isSuperAdmin,
  currentUid,
}: {
  agente: Agente
  canEdit: boolean
  isSuperAdmin: boolean
  currentUid?: string
}) {
  // Auto-proteção: super_admin não edita o próprio role.
  const isSelf = !!currentUid && currentUid === agente.uid
  // Admin (não super) não pode editar quem já é super_admin.
  const lockedAsSuper = agente.role === 'super_admin' && !isSuperAdmin
  if (!canEdit || isSelf || lockedAsSuper) {
    return <RoleChip role={agente.role} />
  }
  return (
    <select
      value={agente.role}
      onChange={(e) => setAgenteRole(agente.uid, e.target.value as Role, agente.name)}
      className={`rounded border px-2 py-1 text-xs font-medium ${roleChipCls(agente.role)}`}
    >
      <option value="agente">Gestor</option>
      <option value="supervisor">Supervisor</option>
      <option value="admin">Admin</option>
      {isSuperAdmin && <option value="super_admin">Super Admin</option>}
    </select>
  )
}

function RoleChip({ role }: { role: Role }) {
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${roleChipCls(role)}`}>
      {roleLabel(role)}
    </span>
  )
}

function roleLabel(r: Role): string {
  return r === 'agente'
    ? 'Gestor'
    : r === 'supervisor'
      ? 'Supervisor'
      : r === 'admin'
        ? 'Admin'
        : 'Super Admin'
}

/**
 * Classes pra o chip de role. Mesma paleta usada no chip da sidebar (AppShell)
 * pra manter consistência visual: emerald (agente) → teal (supervisor) →
 * blue (admin) → purple (super_admin).
 */
function roleChipCls(r: Role): string {
  switch (r) {
    case 'super_admin':
      return 'border-purple-500/30 bg-purple-500/15 text-purple-700 dark:text-purple-300'
    case 'admin':
      return 'border-blue-500/30 bg-blue-500/15 text-blue-700 dark:text-blue-300'
    case 'supervisor':
      return 'border-teal-500/30 bg-teal-500/15 text-teal-700 dark:text-teal-300'
    case 'agente':
    default:
      return 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
  }
}

/**
 * Célula de Setor. Setor é exigido pra agente e supervisor; admin/super_admin
 * não usam (-). Edição inline disponível só pro super admin.
 */
function SetorCell({ agente, canEdit }: { agente: Agente; canEdit: boolean }) {
  const usesSetor = agente.role === 'agente' || agente.role === 'supervisor'
  if (!usesSetor) {
    return (
      <span className="text-xs text-app-subtle" title="Admin não usa setor">
,
      </span>
    )
  }
  if (!canEdit) {
    return agente.setor ? (
      <SetorBadge setor={agente.setor} size="xs" />
    ) : (
      <span className="text-xs text-app-subtle">-</span>
    )
  }
  return (
    <select
      value={agente.setor ?? ''}
      onChange={(e) => setAgenteSetor(agente.uid, e.target.value as Setor, agente.name)}
      className="rounded border border-app-border bg-app-input px-2 py-1 text-xs text-app-text"
    >
      {!agente.setor && <option value="">Selecionar…</option>}
      {(agente.role === 'supervisor' ? SETORES_SUPERVISOR : SETORES).map((s) => (
        <option key={s} value={s}>
          {setorLabel[s]}
        </option>
      ))}
    </select>
  )
}

/**
 * Célula do nome: read-only por padrão, super_admin pode editar inline
 * (clica no ícone de lápis, vira input, ✓ salva / ✕ cancela).
 */
function NameCell({ agente, canEdit }: { agente: Agente; canEdit: boolean }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(agente.name)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setValue(agente.name)
  }, [agente.name])

  const start = () => {
    setEditing(true)
    setError(null)
  }
  const cancel = () => {
    setValue(agente.name)
    setEditing(false)
    setError(null)
  }
  const save = async () => {
    const trimmed = value.trim()
    if (!trimmed) {
      setError('nome obrigatório')
      return
    }
    if (trimmed === agente.name) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await setAgenteName(agente.uid, trimmed, agente.name)
      setEditing(false)
      setError(null)
    } catch {
      setError('falha ao salvar')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="flex min-w-0 items-center gap-1">
        <input
          type="text"
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            if (error) setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') cancel()
          }}
          className="min-w-[140px] flex-1 rounded border border-app-border bg-app-input px-2 py-1 text-[12px] text-app-text outline-none focus:border-app-border-strong"
          disabled={saving}
        />
        <button
          type="button"
          onClick={save}
          disabled={saving}
          title="Salvar"
          className="flex h-6 w-6 items-center justify-center rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 transition-colors hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-300"
        >
          <Check size={11} />
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          title="Cancelar"
          className="flex h-6 w-6 items-center justify-center rounded border border-app-border bg-app-card text-app-muted transition-colors hover:bg-app-elev hover:text-app-text disabled:opacity-50"
        >
          <X size={11} />
        </button>
        {error && (
          <span className="text-[10px] text-rose-600 dark:text-rose-400">
            {error}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="truncate font-medium text-app-text">{agente.name}</span>
      {canEdit && (
        <button
          type="button"
          onClick={start}
          title="Editar nome"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-app-subtle transition-colors hover:bg-app-elev hover:text-app-text"
        >
          <Pencil size={10} />
        </button>
      )}
    </div>
  )
}

/**
 * Célula da tabela com edição inline do `slackUserId`. Estados:
 *   - vazio: chip "-" + (se canEdit) botão pra editar
 *   - preenchido: chip com ID + (se canEdit) botão pra editar
 *   - editando: input + ✓ salvar / ✕ cancelar
 *
 * Edição é restrita a super_admin: admin vê o valor mas não muda
 * (configurar slack de gestor pra fechamento PDF é decisão do super).
 *
 * Validação leniente: aceita "U..." ou "W...". Trim aplicado no save.
 */
function SlackIdCell({ agente, canEdit }: { agente: Agente; canEdit: boolean }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(agente.slackUserId ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setValue(agente.slackUserId ?? '')
  }, [agente.slackUserId])

  const start = () => {
    setEditing(true)
    setError(null)
  }
  const cancel = () => {
    setValue(agente.slackUserId ?? '')
    setEditing(false)
    setError(null)
  }
  const save = async () => {
    const trimmed = value.trim()
    if (trimmed && !SLACK_USER_ID_RE.test(trimmed)) {
      setError('formato inválido (ex: U07ABC123)')
      return
    }
    setSaving(true)
    try {
      await setAgenteSlackUserId(
        agente.uid,
        trimmed || null,
        agente.name,
      )
      setEditing(false)
      setError(null)
    } catch {
      setError('falha ao salvar')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="text"
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value.toUpperCase())
            if (error) setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') cancel()
          }}
          placeholder="U07ABC123"
          className="w-32 rounded border border-app-border bg-app-input px-2 py-1 font-mono text-[11px] tabular-nums text-app-text outline-none focus:border-app-border-strong"
          disabled={saving}
        />
        <button
          type="button"
          onClick={save}
          disabled={saving}
          title="Salvar"
          className="flex h-6 w-6 items-center justify-center rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 transition-colors hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-300"
        >
          <Check size={11} />
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          title="Cancelar"
          className="flex h-6 w-6 items-center justify-center rounded border border-app-border bg-app-card text-app-muted transition-colors hover:bg-app-elev hover:text-app-text disabled:opacity-50"
        >
          <X size={11} />
        </button>
        {error && (
          <span className="text-[10px] text-rose-600 dark:text-rose-400">
            {error}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {agente.slackUserId ? (
        <span className="rounded border border-app-border bg-app-elev px-1.5 py-0.5 font-mono text-[10.5px] tabular-nums text-app-text">
          {agente.slackUserId}
        </span>
      ) : (
        <span className="text-[10.5px] text-app-subtle" title="Sem Slack ID, fica fora do envio">
,
        </span>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={start}
          title="Editar Slack ID"
          className="flex h-6 w-6 items-center justify-center rounded text-app-subtle transition-colors hover:bg-app-elev hover:text-app-text"
        >
          <Pencil size={10} />
        </button>
      )}
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-app-muted">
      {children}
    </th>
  )
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="whitespace-nowrap px-3 py-3 align-middle text-app-text">{children}</td>
  )
}

/**
 * Renderiza um Firestore Timestamp como data BR. Se `relative` for true,
 * mostra "há X min/h/dias" embaixo da data, útil pra "Último login".
 */
function TimestampCell({
  ts,
  relative,
  emptyHint = '-',
}: {
  ts?: Timestamp
  relative?: boolean
  emptyHint?: string
}) {
  const d = ts && typeof ts.toDate === 'function' ? ts.toDate() : null
  if (!d) {
    return <span className="text-[11px] text-app-subtle">{emptyHint}</span>
  }
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(2)
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return (
    <div className="leading-tight">
      <div
        className="font-mono text-[11px] tabular-nums text-app-text"
        title={d.toLocaleString('pt-BR')}
      >
        {dd}/{mm}/{yy} {hh}:{mi}
      </div>
      {relative && (
        <div className="font-mono text-[9.5px] text-app-subtle">
          {relativeFromNow(d)}
        </div>
      )}
    </div>
  )
}

function relativeFromNow(d: Date): string {
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return 'agora há pouco'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h}h`
  const days = Math.floor(h / 24)
  if (days < 30) return `há ${days}d`
  const months = Math.floor(days / 30)
  return `há ${months} mês${months === 1 ? '' : 'es'}`
}

function translateAuthError(code: string): string {
  switch (code) {
    case 'auth/email-already-in-use':
      return 'Este email já está cadastrado.'
    case 'auth/invalid-email':
      return 'Email inválido.'
    case 'auth/weak-password':
      return 'Senha muito fraca.'
    case 'auth/user-not-found':
      return 'Nenhuma conta no Auth com esse email, pode ter sido apagada manualmente.'
    case 'auth/too-many-requests':
      return 'Muitas tentativas seguidas. Aguarde alguns minutos.'
    case 'auth/network-request-failed':
      return 'Sem conexão. Cheque a internet e tente de novo.'
    default:
      return 'Operação falhou. Tente de novo.'
  }
}
