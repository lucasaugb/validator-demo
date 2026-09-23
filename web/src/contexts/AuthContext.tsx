import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
} from 'firebase/auth'
import type { User } from 'firebase/auth'
import { doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore'
import { auth, db } from '../firebase/config'
import { setActivityActor } from '../lib/activityLog'
import type { Agente } from '../types'

// Janela mínima entre escritas de `lastLoginAt` na mesma aba. Sem isso,
// re-renderizações que disparam onAuthStateChanged (token refresh, página
// recarregada) gerariam writes desnecessários. 1 write por usuário a cada
// 10min é suficiente pra "última vez que ele apareceu no sistema".
const LAST_LOGIN_THROTTLE_MS = 10 * 60 * 1000
const LAST_LOGIN_STORAGE_KEY = 'validator:lastLoginTouchedAt'

interface AuthContextValue {
  user: User | null
  agente: Agente | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [agente, setAgente] = useState<Agente | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // unsubscribe do listener do doc do agente, recriado a cada troca de
    // usuário. Sem isso, logout não derrubaria o listener anterior.
    let unsubAgente: (() => void) | null = null

    const unsubAuth = onAuthStateChanged(auth, (fbUser) => {
      setUser(fbUser)
      // Derruba listener anterior antes de criar um novo (ou ao deslogar).
      if (unsubAgente) {
        unsubAgente()
        unsubAgente = null
      }
      if (fbUser) {
        // onSnapshot em vez de getDoc: assim mudanças no doc (avatarUrl,
        // setor, role, active, etc.) refletem na UI sem F5.
        unsubAgente = onSnapshot(
          doc(db, 'agentes', fbUser.uid),
          (snap) => {
            const ag = snap.exists()
              ? ({ uid: snap.id, ...snap.data() } as Agente)
              : null
            setAgente(ag)
            setActivityActor(ag)
            setLoading(false)
          },
          (err) => {
            console.warn('falha lendo doc do agente', err)
            setAgente(null)
            setActivityActor(null)
            setLoading(false)
          },
        )
        // Best-effort: marca último login. Disparado uma vez por mudança
        // de auth state (throttle local evita writes em token refresh).
        touchLastLogin(fbUser.uid).catch((err) => {
          console.warn('falha gravando lastLoginAt', err)
        })
      } else {
        setAgente(null)
        setActivityActor(null)
        setLoading(false)
      }
    })
    return () => {
      if (unsubAgente) unsubAgente()
      unsubAuth()
    }
  }, [])

  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password)
  }

  const signOut = async () => {
    await fbSignOut(auth)
  }

  return (
    <AuthContext.Provider value={{ user, agente, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider')
  return ctx
}

/**
 * Marca `lastLoginAt` no doc do agente, com throttle local pra evitar writes
 * a cada token refresh (que dispara onAuthStateChanged múltiplas vezes/hora).
 * Custo aproximado: ~1 write por usuário a cada 10 minutos de atividade.
 */
async function touchLastLogin(uid: string): Promise<void> {
  try {
    const raw = localStorage.getItem(`${LAST_LOGIN_STORAGE_KEY}:${uid}`)
    const last = raw ? Number(raw) : 0
    if (Number.isFinite(last) && Date.now() - last < LAST_LOGIN_THROTTLE_MS) {
      return
    }
  } catch {
    // localStorage indisponível (modo private, etc.), segue gravando.
  }
  await updateDoc(doc(db, 'agentes', uid), {
    lastLoginAt: serverTimestamp(),
  })
  try {
    localStorage.setItem(`${LAST_LOGIN_STORAGE_KEY}:${uid}`, String(Date.now()))
  } catch {
    // ignore
  }
}
