import { initializeApp, deleteApp } from 'firebase/app'
import {
  createUserWithEmailAndPassword,
  getAuth,
  sendPasswordResetEmail,
  signOut,
  updatePassword,
} from 'firebase/auth'
import { auth } from '../firebase/config'
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import type { Unsubscribe } from 'firebase/firestore'
import {
  deleteObject,
  getDownloadURL,
  listAll,
  ref,
  uploadBytes,
} from 'firebase/storage'
import { db, storage } from '../firebase/config'
import { compressImage } from './imageCompress'
import { logActivity } from './activityLog'
import type { Agente, Role, Setor } from '../types'

const COL = 'agentes'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export interface CreateAgenteInput {
  name: string
  email: string
  password: string
  /**
   * Qualquer papel. super_admin só pode ser atribuído por outro super_admin
   * (UI gateia + firestore.rules confirmam). Admin/super_admin são globais
   * (sem setor); agente e supervisor exigem setor.
   */
  role: Role
  setor?: Setor
  /** Slack member ID (ex: U07ABC123): opcional na criação. */
  slackUserId?: string
}

/**
 * URL da Cloud Function `purge_auth_by_email`. Configurável via env (build
 * time). Quando não está setado, o frontend pula a tentativa de purge e cai
 * direto no erro "email já cadastrado", admin precisa apagar manualmente
 * em Firebase Console > Authentication.
 */
const PURGE_AUTH_URL =
  import.meta.env.VITE_PURGE_AUTH_URL ||
  'https://us-central1-validator-demo-project.cloudfunctions.net/purge-auth-by-email'

/**
 * URL da Cloud Function `reset_gestor_passwords`. Padroniza a senha de todos
 * (ou um) gestor pra `validator2026` + seta `mustChangePassword=true`.
 */
const RESET_GESTOR_PASSWORDS_URL =
  import.meta.env.VITE_RESET_GESTOR_PASSWORDS_URL ||
  'https://us-central1-validator-demo-project.cloudfunctions.net/reset-gestor-passwords'

async function tryPurgeOrphanAuth(email: string): Promise<boolean> {
  try {
    const token = await auth.currentUser?.getIdToken()
    if (!token) return false
    const resp = await fetch(PURGE_AUTH_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    })
    if (resp.ok) {
      const body = (await resp.json().catch(() => ({}))) as { purgedUid?: string }
      return !!body.purgedUid
    }
    return false
  } catch (err) {
    console.warn('tryPurgeOrphanAuth falhou (segue erro original):', err)
    return false
  }
}

export async function createAgente(input: CreateAgenteInput): Promise<string> {
  return await createAgenteOnce(input).catch(async (err: { code?: string }) => {
    // Reusar email após exclusão: o doc some, mas a conta no Firebase Auth
    // fica órfã (client SDK não apaga Auth de outro user). Quando isso
    // acontece, a Cloud Function `purge_auth_by_email` apaga o órfão e a
    // gente tenta criar de novo. Se o purge falhar, propaga o erro original.
    if (err?.code === 'auth/email-already-in-use') {
      const purged = await tryPurgeOrphanAuth(input.email)
      if (purged) return await createAgenteOnce(input)
      throw new Error(
        'Esse email já existe no Firebase Auth como conta órfã de uma exclusão anterior. ' +
          'Apague manualmente em Firebase Console > Authentication > Users e tente de novo, ' +
          'ou peça pra fazer deploy da Cloud Function purge-auth-by-email.',
      )
    }
    throw err
  })
}

async function createAgenteOnce(input: CreateAgenteInput): Promise<string> {
  const tempName = `temp-${Date.now()}`
  const tempApp = initializeApp(firebaseConfig, tempName)
  try {
    const tempAuth = getAuth(tempApp)
    const cred = await createUserWithEmailAndPassword(
      tempAuth,
      input.email,
      input.password,
    )
    const uid = cred.user.uid

    const data: Record<string, unknown> = {
      email: input.email,
      name: input.name,
      role: input.role,
      active: true,
      // Força troca de senha no primeiro login, quem cria define uma temp
      // password no form, e o usuário cadastrado precisa substituir antes de
      // entrar no app. Flag é limpa por `changeMyPasswordAndClearFlag`.
      mustChangePassword: true,
      createdAt: serverTimestamp(),
    }
    if (input.setor) data.setor = input.setor
    if (input.slackUserId) data.slackUserId = input.slackUserId

    await setDoc(doc(db, COL, uid), data)

    await signOut(tempAuth)

    const noteParts = [`papel: ${input.role}`]
    if (input.setor) noteParts.push(`setor: ${input.setor}`)
    if (input.slackUserId) noteParts.push(`slack: ${input.slackUserId}`)
    await logActivity({
      action: 'agente.create',
      targetType: 'agente',
      targetId: uid,
      targetLabel: `${input.name} <${input.email}>`,
      note: noteParts.join(' · '),
    })

    return uid
  } finally {
    await deleteApp(tempApp)
  }
}

/**
 * Atualiza o `name` do agente: super_admin only no UI, rules confirmam.
 */
export async function setAgenteName(
  uid: string,
  name: string,
  previousName?: string,
): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Nome não pode ser vazio')
  await updateDoc(doc(db, COL, uid), { name: trimmed })
  await logActivity({
    action: 'agente.update',
    targetType: 'agente',
    targetId: uid,
    targetLabel: trimmed,
    note: previousName ? `nome: ${previousName} → ${trimmed}` : `nome → ${trimmed}`,
  })
}

/**
 * Atualiza o `slackUserId` do agente. Passar `null` ou string vazia REMOVE o
 * campo do documento (DELETE_FIELD), evitando que "" cause loops na Cloud
 * Function de envio.
 */
export async function setAgenteSlackUserId(
  uid: string,
  slackUserId: string | null,
  nameHint?: string,
): Promise<void> {
  const value = slackUserId?.trim()
  const patch: Record<string, unknown> = value
    ? { slackUserId: value }
    : { slackUserId: deleteField() }
  await updateDoc(doc(db, COL, uid), patch)
  await logActivity({
    action: 'agente.update',
    targetType: 'agente',
    targetId: uid,
    targetLabel: nameHint ?? uid,
    note: value ? `slack → ${value}` : 'slack removido',
  })
}

/**
 * Troca a senha do usuário logado e limpa o flag `mustChangePassword` em
 * `agentes/{uid}`. Chamado pelo gate `ForcePasswordChange` no primeiro
 * login + qualquer auto-serviço futuro de troca de senha.
 *
 * Requer auth recente (Firebase exige reauth se sessão > ~5min sem refresh
 * desde o login). No primeiro login imediato após `signIn`, passa fácil.
 * Erros `auth/requires-recent-login` propagam, a UI mostra "Faça login
 * novamente e tente de novo" e dá um botão de logout.
 */
export async function changeMyPasswordAndClearFlag(
  newPassword: string,
): Promise<void> {
  if (!auth.currentUser) throw new Error('Sessão expirada. Faça login novamente.')
  await updatePassword(auth.currentUser, newPassword)
  await updateDoc(doc(db, COL, auth.currentUser.uid), {
    mustChangePassword: deleteField(),
  })
}

/**
 * Dispara um email de redefinição de senha pra `email` via Firebase Auth.
 *
 * O SDK do client NÃO exige privilégio pra chamar, qualquer pessoa pode
 * triggar reset pra qualquer email cadastrado. Não é vulnerabilidade porque
 * o email vai SEMPRE pro dono do endereço (não pro requisitante); o invasor
 * que dispara reset alheio só faz spam pro inbox do dono. Mesmo assim, a UI
 * gateia: super_admin pra qualquer um; admin só pra gestor (role 'agente').
 *
 * O `actionCodeSettings.url` força o link no email a redirecionar de volta
 * pro Validator depois do reset (em vez da página intermediária do Firebase,
 * que tem cara de phishing pra filtros de spam). `handleCodeInApp=false`
 * mantém o reset flow no domínio do Firebase Hosting do Auth, necessário
 * porque o app não tem rota custom pra reset (usaríamos `__/auth/action`).
 *
 * Logado na trilha de auditoria como `agente.password-reset`.
 */
export interface ResetGestorPasswordsResult {
  resetCount: number
  errorCount: number
  errors: Array<{ uid: string; email: string; error: string }>
}

/**
 * Reseta a senha dos gestores pra `validator2026` (constante padrão). Sem
 * `uid` aplica em TODOS os gestores. Com `uid` aplica só naquele gestor.
 *
 * Backend: Cloud Function `reset_gestor_passwords` em `pipeline/auth_admin`.
 * Requer header `Authorization: Bearer <idToken>` do super_admin ativo,
 * é checado lá. Retorna contagem + lista de erros por uid.
 *
 * Side-effect: o doc do gestor recebe `mustChangePassword: true`, então o
 * usuário cai em `ForcePasswordChange` no próximo login.
 */
export async function resetGestorPasswords(
  uid?: string,
): Promise<ResetGestorPasswordsResult> {
  const token = await auth.currentUser?.getIdToken()
  if (!token) throw new Error('Sessão expirada. Faça login novamente.')
  const resp = await fetch(RESET_GESTOR_PASSWORDS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(uid ? { uid } : {}),
  })
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}) as { error?: string })
    throw new Error(body.error || `Falha (HTTP ${resp.status}).`)
  }
  const body = (await resp.json()) as ResetGestorPasswordsResult
  await logActivity({
    action: 'agente.password-reset',
    targetType: 'agente',
    targetId: uid ?? 'bulk',
    targetLabel: uid ? `gestor ${uid}` : `${body.resetCount} gestores`,
    note: uid
      ? 'senha resetada pra padrão (validator2026)'
      : `reset em massa: ${body.resetCount} ok, ${body.errorCount} erros`,
  })
  return body
}

export async function sendPasswordReset(
  email: string,
  uid: string,
  nameHint?: string,
): Promise<void> {
  await sendPasswordResetEmail(auth, email, {
    url: `${window.location.origin}/login`,
    handleCodeInApp: false,
  })
  await logActivity({
    action: 'agente.password-reset',
    targetType: 'agente',
    targetId: uid,
    targetLabel: nameHint ? `${nameHint} <${email}>` : email,
    note: 'email de redefinição enviado',
  })
}

/**
 * Remove o usuário do sistema (apaga o doc em `agentes/{uid}`). Como o doc é
 * a fonte de verdade pra role/setor/active nas firestore.rules, apagá-lo
 * efetivamente revoga TODO acesso: o usuário pode até autenticar no Firebase
 * Auth, mas qualquer rule cai em null no `userDoc()` e nega.
 *
 * Nota: a conta no Firebase Auth permanece (client SDK não pode apagar Auth
 * de outro usuário; precisa de Admin SDK / Cloud Function). Isso é ok porque
 * sem o doc o usuário não tem acesso a nada. Se quiser purge total, criar
 * Cloud Function `onUserDocDelete` que chame `admin.auth().deleteUser(uid)`.
 *
 * Bloqueada nas rules pra super_admin apenas, admin desativa.
 */
export async function deleteAgente(uid: string, nameHint?: string): Promise<void> {
  await deleteDoc(doc(db, COL, uid))
  await logActivity({
    action: 'agente.delete',
    targetType: 'agente',
    targetId: uid,
    targetLabel: nameHint ?? uid,
    note: 'doc removido (conta auth permanece órfã)',
  })
}

export async function setAgenteActive(
  uid: string,
  active: boolean,
  nameHint?: string,
): Promise<void> {
  await updateDoc(doc(db, COL, uid), { active })
  await logActivity({
    action: active ? 'agente.activate' : 'agente.deactivate',
    targetType: 'agente',
    targetId: uid,
    targetLabel: nameHint ?? uid,
  })
}

export async function setAgenteRole(
  uid: string,
  role: Role,
  nameHint?: string,
): Promise<void> {
  // Admin não tem setor: limpa o campo se promovendo agente → admin.
  const patch: Record<string, unknown> = { role }
  if (role === 'admin' || role === 'super_admin') {
    patch.setor = deleteField()
  }
  await updateDoc(doc(db, COL, uid), patch)
  await logActivity({
    action: 'agente.update',
    targetType: 'agente',
    targetId: uid,
    targetLabel: nameHint ?? uid,
    note: `papel → ${role}`,
  })
}

/**
 * Concede/revoga a capability `canEditMetas` (definir metas na tela /admin/metas).
 * super_admin only: a UI gateia e as firestore.rules confirmam (admin não
 * pode alterar esse campo). Passar `false` REMOVE o campo do doc.
 */
export async function setAgenteCanEditMetas(
  uid: string,
  canEdit: boolean,
  nameHint?: string,
): Promise<void> {
  const patch: Record<string, unknown> = canEdit
    ? { canEditMetas: true }
    : { canEditMetas: deleteField() }
  await updateDoc(doc(db, COL, uid), patch)
  await logActivity({
    action: 'agente.update',
    targetType: 'agente',
    targetId: uid,
    targetLabel: nameHint ?? uid,
    note: canEdit ? 'metas: acesso concedido' : 'metas: acesso removido',
  })
}

export async function setAgenteSetor(
  uid: string,
  setor: Setor,
  nameHint?: string,
): Promise<void> {
  await updateDoc(doc(db, COL, uid), { setor })
  await logActivity({
    action: 'agente.update',
    targetType: 'agente',
    targetId: uid,
    targetLabel: nameHint ?? uid,
    note: `setor → ${setor}`,
  })
}

/**
 * Faz upload da foto de perfil pro Storage e grava o `avatarUrl` no doc.
 *
 * Path: `users/{uid}/avatar-{ts}.jpg`. O timestamp no nome serve como
 * cache-buster (a URL muda, browsers e CDN não cacheiam a anterior). Antes
 * de gravar a nova, tenta apagar avatares antigos no folder (best-effort).
 *
 * Compressão segue a mesma rota dos comprovantes: canvas → JPEG 0.82, max
 * 1600px. Suficiente pra avatar; mantém arquivos pequenos (<200KB típico).
 */
export async function uploadAvatar(uid: string, file: File): Promise<string> {
  const compressed = await compressImage(file)
  const ts = Date.now()
  const path = `users/${uid}/avatar-${ts}.jpg`
  const r = ref(storage, path)
  await uploadBytes(r, compressed, { contentType: 'image/jpeg' })
  const url = await getDownloadURL(r)

  await updateDoc(doc(db, COL, uid), { avatarUrl: url })

  // Best-effort: apaga avatares anteriores do folder. Falha aqui não
  // bloqueia: o arquivo novo já está em uso.
  try {
    const folder = ref(storage, `users/${uid}`)
    const all = await listAll(folder)
    await Promise.all(
      all.items
        .filter((item) => item.fullPath !== path)
        .map((item) => deleteObject(item).catch(() => undefined)),
    )
  } catch {
    // ignore
  }

  await logActivity({
    action: 'agente.update',
    targetType: 'agente',
    targetId: uid,
    targetLabel: uid,
    note: 'avatar atualizado',
  })

  return url
}

/**
 * Remove o avatar do usuário: apaga os arquivos do Storage e limpa o campo
 * `avatarUrl` no doc, voltando pro fallback de iniciais.
 */
export async function removeAvatar(uid: string): Promise<void> {
  try {
    const folder = ref(storage, `users/${uid}`)
    const all = await listAll(folder)
    await Promise.all(all.items.map((item) => deleteObject(item).catch(() => undefined)))
  } catch {
    // ignore
  }
  await updateDoc(doc(db, COL, uid), { avatarUrl: deleteField() })
  await logActivity({
    action: 'agente.update',
    targetType: 'agente',
    targetId: uid,
    targetLabel: uid,
    note: 'avatar removido',
  })
}

export function subscribeAgentes(cb: (agentes: Agente[]) => void): Unsubscribe {
  const q = query(collection(db, COL), orderBy('createdAt', 'desc'))
  return onSnapshot(q, (snap) => {
    cb(
      snap.docs.map((d) => {
        const data = { uid: d.id, ...d.data() } as Agente
        // Defesa: admin/super_admin não têm setor. Se o doc estiver com setor
        // legado (ex.: gestor promovido sem o cleanup, ou doc criado fora do
        // form), zera no client pra UI nunca contabilizar admin sob um setor.
        // bug 2026-05-26
        if (
          (data.role === 'admin' || data.role === 'super_admin') &&
          data.setor !== undefined
        ) {
          data.setor = undefined
        }
        return data
      }),
    )
  })
}

/**
 * Garante que TODO admin/super_admin no Firestore não tenha `setor` setado.
 *
 * Por que: `subscribeAgentes` já normaliza no client, mas o Firestore pode
 * ter `setor` legado (admin promovido sem o cleanup do form). Pra métricas
 * BQ e quaisquer caminhos que leiam o doc cru, precisamos do dado limpo.
 *
 * Roda em `AgenteManagement` ao mount (super_admin only). Idempotente:
 * deleteField num campo já ausente não erra. Retorna a contagem de updates
 * disparados.
 *
 * Não é eficiente em escala (1 write por admin), mas o número de admins é
 * pequeno (≤10 tipicamente).
 */
export async function cleanupOrphanSetorOnAdmins(agentes: Agente[]): Promise<number> {
  const targets = agentes.filter(
    (a) => a.role === 'admin' || a.role === 'super_admin',
  )
  let cleaned = 0
  for (const a of targets) {
    try {
      await updateDoc(doc(db, COL, a.uid), { setor: deleteField() })
      cleaned += 1
    } catch (err) {
      console.warn(`cleanupOrphanSetorOnAdmins falhou pra ${a.uid}:`, err)
    }
  }
  return cleaned
}
