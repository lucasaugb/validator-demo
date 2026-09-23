/**
 * Substituto de `firebase/auth` no modo demo. Contas ficam no `store`
 * (seed + criadas pelo visitante); a sessão fica no sessionStorage.
 */
import { FirebaseError, type FirebaseApp } from './firebase-app'
import { store } from './store'

const SESSION_KEY = 'validator-demo:session'

export interface User {
  uid: string
  email: string | null
  getIdToken(): Promise<string>
}

type AuthListener = (u: User | null) => void

function makeUser(uid: string, email: string): User {
  return { uid, email, getIdToken: async () => 'demo-token' }
}

export class Auth {
  currentUser: User | null = null
  languageCode = 'pt-BR'
  readonly isPrimary: boolean
  listeners = new Set<AuthListener>()

  constructor(isPrimary: boolean) {
    this.isPrimary = isPrimary
    if (isPrimary) {
      try {
        const raw = window.sessionStorage.getItem(SESSION_KEY)
        if (raw) {
          const { uid, email } = JSON.parse(raw) as { uid: string; email: string }
          this.currentUser = makeUser(uid, email)
        }
      } catch {
        /* ignore */
      }
    }
  }

  setUser(u: User | null): void {
    this.currentUser = u
    if (this.isPrimary) {
      try {
        if (u) window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ uid: u.uid, email: u.email }))
        else window.sessionStorage.removeItem(SESSION_KEY)
      } catch {
        /* ignore */
      }
    }
    for (const l of this.listeners) l(u)
  }
}

const primary = new Auth(true)
const secondary = new WeakMap<FirebaseApp, Auth>()

export function getAuth(app?: FirebaseApp): Auth {
  if (!app || app.name === '[DEFAULT]') return primary
  let a = secondary.get(app)
  if (!a) {
    a = new Auth(false)
    secondary.set(app, a)
  }
  return a
}

export function onAuthStateChanged(auth: Auth, cb: AuthListener): () => void {
  auth.listeners.add(cb)
  setTimeout(() => cb(auth.currentUser), 0)
  return () => auth.listeners.delete(cb)
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function signInWithEmailAndPassword(
  auth: Auth,
  email: string,
  password: string,
): Promise<{ user: User }> {
  await delay(250)
  const u = store.users.get(email.trim().toLowerCase())
  if (!u || u.password !== password) {
    throw new FirebaseError('auth/invalid-credential', 'Credenciais inválidas')
  }
  const user = makeUser(u.uid, u.email)
  auth.setUser(user)
  return { user }
}

export async function createUserWithEmailAndPassword(
  auth: Auth,
  email: string,
  password: string,
): Promise<{ user: User }> {
  const key = email.trim().toLowerCase()
  if (store.users.has(key)) {
    throw new FirebaseError('auth/email-already-in-use', 'E-mail já cadastrado')
  }
  if (password.length < 6) throw new FirebaseError('auth/weak-password', 'Senha fraca')
  const uid = 'u_' + Math.random().toString(36).slice(2, 12)
  store.addUser({ uid, email: key, password })
  const user = makeUser(uid, key)
  auth.setUser(user)
  return { user }
}

export async function signOut(auth: Auth): Promise<void> {
  auth.setUser(null)
}

export async function updatePassword(user: User, newPassword: string): Promise<void> {
  if (newPassword.length < 6) throw new FirebaseError('auth/weak-password', 'Senha fraca')
  for (const u of store.users.values()) {
    if (u.uid === user.uid) store.addUser({ ...u, password: newPassword })
  }
}

export async function sendPasswordResetEmail(): Promise<void> {
  // Demo: nenhum e-mail é enviado.
  await delay(200)
}
