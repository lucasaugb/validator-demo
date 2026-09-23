/**
 * Banco em memória que imita o Firestore no modo demo.
 *
 * - A base (seed) é gerada de forma determinística a cada carregamento.
 * - Tudo que o visitante altera vai pra um "overlay" persistido no
 *   localStorage (docs alterados + ids deletados). Assim a base pode ter
 *   milhares de docs sem estourar a cota do navegador.
 * - Listeners (onSnapshot) são notificados de forma assíncrona após cada write.
 */
import { buildSeed } from './seed'

/* ------------------------------ Timestamp ------------------------------ */

export class Timestamp {
  readonly seconds: number
  readonly nanoseconds: number

  constructor(seconds: number, nanoseconds: number) {
    this.seconds = seconds
    this.nanoseconds = nanoseconds
  }

  static fromMillis(ms: number): Timestamp {
    const s = Math.floor(ms / 1000)
    return new Timestamp(s, Math.round((ms - s * 1000) * 1e6))
  }
  static fromDate(d: Date): Timestamp {
    return Timestamp.fromMillis(d.getTime())
  }
  static now(): Timestamp {
    return Timestamp.fromMillis(Date.now())
  }
  toMillis(): number {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6)
  }
  toDate(): Date {
    return new Date(this.toMillis())
  }
  isEqual(other: Timestamp): boolean {
    return other instanceof Timestamp && other.toMillis() === this.toMillis()
  }
  valueOf(): string {
    return String(this.toMillis()).padStart(16, '0')
  }
  toJSON(): { seconds: number; nanoseconds: number } {
    return { seconds: this.seconds, nanoseconds: this.nanoseconds }
  }
}

/* ------------------------------ Sentinels ------------------------------ */

export class Sentinel {
  readonly kind: 'serverTimestamp' | 'delete' | 'increment'
  readonly value: number

  constructor(kind: 'serverTimestamp' | 'delete' | 'increment', value = 0) {
    this.kind = kind
    this.value = value
  }
}

/* ------------------------------ Tipos base ----------------------------- */

export type DocData = Record<string, unknown>

type Listener = () => void

const OVERLAY_KEY = 'validator-demo:overlay:v1'

interface Overlay {
  docs: Record<string, DocData>
  deleted: string[]
  users: Record<string, DemoUser>
}

export interface DemoUser {
  uid: string
  email: string
  password: string
}

/* --------------------------- (de)serialização -------------------------- */

function encode(v: unknown): unknown {
  if (v instanceof Timestamp) return { __ts: v.toMillis() }
  if (Array.isArray(v)) return v.map(encode)
  if (v && typeof v === 'object') {
    const out: DocData = {}
    for (const [k, val] of Object.entries(v)) out[k] = encode(val)
    return out
  }
  return v
}

function decode(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decode)
  if (v && typeof v === 'object') {
    const o = v as DocData
    if (typeof o.__ts === 'number' && Object.keys(o).length === 1) {
      return Timestamp.fromMillis(o.__ts)
    }
    const out: DocData = {}
    for (const [k, val] of Object.entries(o)) out[k] = decode(val)
    return out
  }
  return v
}

export function clone<T>(v: T): T {
  if (v instanceof Timestamp) return v
  if (Array.isArray(v)) return v.map(clone) as T
  if (v && typeof v === 'object') {
    const out: DocData = {}
    for (const [k, val] of Object.entries(v)) out[k] = clone(val)
    return out as T
  }
  return v
}

/* -------------------------------- Store -------------------------------- */

class DemoStore {
  private docs = new Map<string, DocData>()
  private overlay: Overlay = { docs: {}, deleted: [], users: {} }
  private listeners = new Set<Listener>()
  private notifyScheduled = false
  users = new Map<string, DemoUser>()

  constructor() {
    const seed = buildSeed()
    for (const [path, data] of Object.entries(seed.docs)) this.docs.set(path, data)
    for (const u of seed.users) this.users.set(u.email.toLowerCase(), u)

    try {
      const raw = window.localStorage.getItem(OVERLAY_KEY)
      if (raw) {
        const parsed = decode(JSON.parse(raw)) as Overlay
        this.overlay = {
          docs: parsed.docs ?? {},
          deleted: parsed.deleted ?? [],
          users: parsed.users ?? {},
        }
      }
    } catch {
      this.overlay = { docs: {}, deleted: [], users: {} }
    }
    for (const path of this.overlay.deleted) this.docs.delete(path)
    for (const [path, data] of Object.entries(this.overlay.docs)) this.docs.set(path, data)
    for (const u of Object.values(this.overlay.users)) this.users.set(u.email.toLowerCase(), u)
  }

  get(path: string): DocData | undefined {
    return this.docs.get(path)
  }

  /** Docs cujo path é `<collection>/<id>` (sem subcoleções). */
  list(collection: string): Array<[string, DocData]> {
    const prefix = collection + '/'
    const out: Array<[string, DocData]> = []
    for (const [path, data] of this.docs) {
      if (path.startsWith(prefix) && !path.slice(prefix.length).includes('/')) {
        out.push([path.slice(prefix.length), data])
      }
    }
    return out
  }

  /** Paths dos docs criados/alterados pelo visitante. */
  overlayPaths(): string[] {
    return Object.keys(this.overlay.docs)
  }

  put(path: string, data: DocData): void {
    this.docs.set(path, data)
    this.overlay.docs[path] = data
    this.overlay.deleted = this.overlay.deleted.filter((p) => p !== path)
    this.changed()
  }

  remove(path: string): void {
    this.docs.delete(path)
    delete this.overlay.docs[path]
    if (!this.overlay.deleted.includes(path)) this.overlay.deleted.push(path)
    this.changed()
  }

  addUser(u: DemoUser): void {
    this.users.set(u.email.toLowerCase(), u)
    this.overlay.users[u.email.toLowerCase()] = u
    this.persist()
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  reset(): void {
    try {
      window.localStorage.removeItem(OVERLAY_KEY)
    } catch {
      /* ignore */
    }
  }

  private changed(): void {
    this.persist()
    if (this.notifyScheduled) return
    this.notifyScheduled = true
    setTimeout(() => {
      this.notifyScheduled = false
      for (const l of [...this.listeners]) l()
    }, 0)
  }

  private persist(): void {
    try {
      window.localStorage.setItem(OVERLAY_KEY, JSON.stringify(encode(this.overlay)))
    } catch {
      // Cota estourada (muitas imagens anexadas): segue só em memória.
    }
  }
}

export const store = new DemoStore()

/** Limpa as alterações do visitante e recarrega a base fictícia original. */
export function resetDemo(): void {
  store.reset()
  window.location.reload()
}
