/**
 * Intercepta as chamadas HTTP pro backend (Cloud Functions / Cloud Run) no
 * modo demo e responde localmente. Chamadas pra qualquer outro host (ex.:
 * API pública de câmbio) seguem normalmente.
 */
import { store, type DocData } from './store'

export const DEMO_API_HOST = 'demo-api.local'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

function setorMatches(agSetor: unknown, setor: string): boolean {
  if (setor === 'all' || setor === 'todos' || !setor) return true
  if (setor === 'premium_starter') return agSetor === 'premium' || agSetor === 'starter'
  if (setor === 'online_eventos') return agSetor === 'online' || agSetor === 'eventos'
  return agSetor === setor
}

function preview(month: string, setor: string) {
  const agentes = store.list('agentes').map(([uid, d]) => ({ uid, ...d }) as DocData & { uid: string })
  const transactions = store.list('transactions').map(([, d]) => d)
  const gestores = agentes.filter((a) => a.role === 'agente' && setorMatches(a.setor, setor))

  let pendingOperationCount = 0
  const agents = gestores.map((g) => {
    const mine = transactions.filter(
      (d) =>
        d.agenteId === g.uid &&
        String(d.transactionDate ?? '').startsWith(month) &&
        d.systemValidation === 'verified' &&
        d.conversationValidation === 'approved',
    )
    const activations = mine.filter((d) => d.isActivation)
    const pendingOp = activations.filter((d) => d.lastOperationDate === undefined).length
    pendingOperationCount += pendingOp
    const volume = mine.reduce((s, d) => s + Number(d.usdAmount ?? d.amount ?? 0), 0)
    return {
      agenteId: g.uid,
      agenteName: String(g.name),
      setor: g.setor as string | undefined,
      validatedTransactions: mine.length,
      activations: activations.length,
      activationsPendingOperation: pendingOp,
      payableRawTotal: Math.round((volume * 0.01 + activations.length * 5) * 100) / 100,
      hasSlackId: Boolean(g.slackUserId),
    }
  })
  const admins = agentes
    .filter((a) => a.role === 'admin' || a.role === 'super_admin')
    .map((a) => ({ uid: a.uid, name: String(a.name), role: String(a.role), hasSlackId: Boolean(a.slackUserId) }))
  const supervisors = agentes
    .filter((a) => a.role === 'supervisor')
    .map((a) => ({ uid: a.uid, name: String(a.name), setor: String(a.setor), hasSlackId: Boolean(a.slackUserId) }))

  return {
    month,
    setor,
    agents,
    totalPayable: agents.reduce((s, a) => s + a.payableRawTotal, 0),
    agentsWithSlack: agents.filter((a) => a.hasSlackId).length,
    agentsWithoutSlack: agents.filter((a) => !a.hasSlackId).length,
    pendingOperationCount,
    fxPendingCount: 0,
    canClose: pendingOperationCount === 0,
    admins,
    adminsWithSlack: admins.filter((a) => a.hasSlackId).length,
    adminsWithoutSlack: admins.filter((a) => !a.hasSlackId).length,
    supervisors,
    supervisorsWithSlack: supervisors.filter((s) => s.hasSlackId).length,
    supervisorsWithoutSlack: supervisors.filter((s) => !s.hasSlackId).length,
  }
}

function close(month: string, setor: string) {
  const p = preview(month, setor)
  // Demo: nenhum PDF/Slack é enviado de verdade, tudo cai em "skipped".
  return {
    month,
    setor,
    sent: [],
    skipped_no_slack: p.agents.map((a) => ({
      agenteId: a.agenteId,
      agenteName: a.agenteName,
      reason: 'Modo demo: envio desativado',
    })),
    errors: [],
    adminSent: [],
    adminSkipped: [],
    adminErrors: [],
    supervisorSent: [],
    supervisorSkipped: [],
    supervisorErrors: [],
    sentCount: 0,
    skippedCount: p.agents.length,
    errorCount: 0,
    adminSentCount: 0,
    adminSkippedCount: 0,
    adminErrorCount: 0,
    supervisorSentCount: 0,
    supervisorSkippedCount: 0,
    supervisorErrorCount: 0,
  }
}

async function handle(url: URL, init?: RequestInit): Promise<Response> {
  await new Promise((r) => setTimeout(r, 400))
  let body: Record<string, string> = {}
  try {
    body = init?.body ? JSON.parse(String(init.body)) : {}
  } catch {
    body = {}
  }
  if (url.pathname.endsWith('/preview')) return json(preview(body.month, body.setor))
  if (url.pathname.endsWith('/close')) return json(close(body.month, body.setor))
  // purge-auth-by-email, reset-gestor-passwords etc.
  return json({ ok: true, updated: 0, demo: true })
}

export function installDemoFetch(): void {
  const w = window as Window & { __demoFetchInstalled?: boolean }
  if (w.__demoFetchInstalled) return
  w.__demoFetchInstalled = true
  const original = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    try {
      const url = new URL(raw, window.location.href)
      if (url.hostname === DEMO_API_HOST || url.hostname.endsWith('cloudfunctions.net')) {
        return handle(url, init)
      }
    } catch {
      /* URL relativa inválida: segue o fluxo normal */
    }
    return original(input, init)
  }
}
