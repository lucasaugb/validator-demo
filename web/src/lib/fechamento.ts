import { auth } from '../firebase/config'

/**
 * Cliente HTTP pro Cloud Run Service `fechamento-pdf`. Envia o Firebase ID
 * Token do admin no header pra autenticação server-side.
 *
 * URL configurada via `VITE_FECHAMENTO_URL` (definida em web/.env.local após
 * deploy do service). Em dev sem URL, falha com mensagem clara.
 */

const SERVICE_URL = import.meta.env.VITE_FECHAMENTO_URL as string | undefined

export interface PreviewAgent {
  agenteId: string
  agenteName: string
  setor?: string
  validatedTransactions: number
  activations: number
  activationsPendingOperation: number
  payableRawTotal: number
  hasSlackId: boolean
}

export interface PreviewAdmin {
  uid: string
  name: string
  role: 'admin' | 'super_admin' | string
  hasSlackId: boolean
}

export interface PreviewSupervisor {
  uid: string
  name: string
  setor: string
  hasSlackId: boolean
}

export interface PreviewResponse {
  month: string
  setor: string
  agents: PreviewAgent[]
  totalPayable: number
  agentsWithSlack: number
  agentsWithoutSlack: number
  pendingOperationCount: number
  /**
   * Quantos transações validadas estão com `usdConversionPending: true`. Quando
   * &gt; 0, o servidor recusa o /close, comissão sairia em fallback face-value
   * (sem conversão real). Frontend mostra alerta e pede recálculo manual.
   */
  fxPendingCount: number
  canClose: boolean
  admins: PreviewAdmin[]
  adminsWithSlack: number
  adminsWithoutSlack: number
  /**
   * Supervisores que vão receber o resumo de fechamento. Cada um recebe um
   * PDF filtrado pelo próprio setor. Quando o admin escolhe um setor
   * específico, só o supervisor desse setor aparece aqui.
   */
  supervisors: PreviewSupervisor[]
  supervisorsWithSlack: number
  supervisorsWithoutSlack: number
  /**
   * Quando o (mês, setor) já foi encerrado, o backend devolve aqui o snapshot
   * resumido. O frontend usa isso pra alertar "Já fechou em X · pago Y" antes
   * de enviar. Pra REFECHAR (re-pagar), o admin precisa marcar `force=true`
   * no /close.
   */
  existingClosing: {
    month: string
    setor: string
    closedBy?: { uid?: string; name?: string; role?: string }
    totals?: { payableTotal?: number; agentCount?: number }
    version?: number
  } | null
}

export interface CloseResponse {
  month: string
  setor: string
  sent: Array<{
    agenteId: string
    agenteName: string
    slackUserId: string
    fileId?: string
    payableTotal: number
  }>
  skipped_no_slack: Array<{
    agenteId: string
    agenteName: string
    reason: string
  }>
  errors: Array<{
    agenteId: string
    agenteName: string
    error: string
  }>
  adminSent: Array<{
    uid: string
    name: string
    role: string
    slackUserId: string
    fileId?: string
  }>
  adminSkipped: Array<{
    uid: string
    name: string
    role: string
    reason: string
  }>
  adminErrors: Array<{
    uid: string
    name: string
    role: string
    error: string
  }>
  supervisorSent: Array<{
    uid: string
    name: string
    setor: string
    slackUserId: string
    fileId?: string
    agentCount: number
  }>
  supervisorSkipped: Array<{
    uid: string
    name: string
    setor: string
    reason: string
  }>
  supervisorErrors: Array<{
    uid: string
    name: string
    setor: string
    error: string
  }>
  sentCount: number
  skippedCount: number
  errorCount: number
  adminSentCount: number
  adminSkippedCount: number
  adminErrorCount: number
  supervisorSentCount: number
  supervisorSkippedCount: number
  supervisorErrorCount: number
}

async function authHeader(): Promise<string> {
  const user = auth.currentUser
  if (!user) throw new Error('Não autenticado')
  const token = await user.getIdToken()
  return `Bearer ${token}`
}

async function call<T>(
  path: '/preview' | '/close',
  body: { month: string; setor: string; force?: boolean },
): Promise<T> {
  if (!SERVICE_URL) {
    throw new Error(
      'VITE_FECHAMENTO_URL não configurada: defina em web/.env.local',
    )
  }
  const resp = await fetch(`${SERVICE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: await authHeader(),
    },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    let detail = ''
    try {
      detail = JSON.stringify(await resp.json())
    } catch {
      detail = await resp.text()
    }
    throw new Error(`HTTP ${resp.status}: ${detail}`)
  }
  return (await resp.json()) as T
}

export function previewFechamento(
  month: string,
  setor: string,
): Promise<PreviewResponse> {
  return call<PreviewResponse>('/preview', { month, setor })
}

export function executeFechamento(
  month: string,
  setor: string,
  options: { force?: boolean } = {},
): Promise<CloseResponse> {
  return call<CloseResponse>('/close', {
    month,
    setor,
    force: options.force,
  })
}
