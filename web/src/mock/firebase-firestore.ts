/**
 * Substituto de `firebase/firestore` no modo demo. Implementa só o subconjunto
 * da API que o app usa, em cima do `store` em memória.
 */
import { Sentinel, Timestamp, clone, store, type DocData } from './store'
import { onTransactionWritten } from './validator'

export { Timestamp }

// Retoma validações simuladas interrompidas por um reload da página.
for (const path of store.overlayPaths()) {
  const d = store.get(path)
  if (path.startsWith('transactions/') && d?.systemValidation === 'pending') {
    onTransactionWritten(path.slice('transactions/'.length), undefined, d)
  }
}

export type DocumentData = DocData
export type Unsubscribe = () => void

/* -------------------------------- Refs --------------------------------- */

export interface Firestore {
  readonly type: 'firestore'
}

const DB: Firestore = { type: 'firestore' }

export function getFirestore(): Firestore {
  return DB
}

export class CollectionReference {
  readonly type = 'collection'
  readonly path: string
  constructor(path: string) {
    this.path = path
  }
}

export class DocumentReference {
  readonly type = 'document'
  readonly path: string
  readonly id: string
  constructor(path: string) {
    this.path = path
    this.id = path.split('/').pop() ?? ''
  }
}

function autoId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  for (let i = 0; i < 20; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

export function collection(_parent: unknown, ...segments: string[]): CollectionReference {
  return new CollectionReference(segments.join('/'))
}

export function doc(
  parent: Firestore | CollectionReference,
  ...segments: string[]
): DocumentReference {
  if (parent instanceof CollectionReference) {
    return new DocumentReference(`${parent.path}/${segments[0] ?? autoId()}`)
  }
  return new DocumentReference(segments.join('/'))
}

/* ------------------------------- Queries ------------------------------- */

type Op = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'array-contains'

interface Constraint {
  kind: 'where' | 'orderBy' | 'limit'
  field?: string
  op?: Op
  value?: unknown
  dir?: 'asc' | 'desc'
  n?: number
}

export class Query {
  readonly type = 'query'
  readonly path: string
  readonly constraints: Constraint[]
  constructor(path: string, constraints: Constraint[]) {
    this.path = path
    this.constraints = constraints
  }
}

export function query(ref: CollectionReference | Query, ...cs: Constraint[]): Query {
  if (ref instanceof Query) return new Query(ref.path, [...ref.constraints, ...cs])
  return new Query(ref.path, cs)
}

export function where(field: string, op: Op, value: unknown): Constraint {
  return { kind: 'where', field, op, value }
}

export function orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): Constraint {
  return { kind: 'orderBy', field, dir }
}

export function limit(n: number): Constraint {
  return { kind: 'limit', n }
}

function getField(data: DocData, field: string): unknown {
  let cur: unknown = data
  for (const part of field.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as DocData)[part]
  }
  return cur
}

function cmpValue(v: unknown): string | number | boolean | null | undefined {
  if (v instanceof Timestamp) return v.toMillis()
  if (v instanceof Date) return v.getTime()
  return v as string | number | boolean | null | undefined
}

function compare(a: unknown, b: unknown): number {
  const x = cmpValue(a)
  const y = cmpValue(b)
  if (x === y) return 0
  if (x === undefined || x === null) return -1
  if (y === undefined || y === null) return 1
  return x < y ? -1 : 1
}

function matches(data: DocData, c: Constraint): boolean {
  const v = getField(data, c.field!)
  const target = c.value
  switch (c.op) {
    case '==':
      return compare(v, target) === 0 && v !== undefined
    case '!=':
      return v !== undefined && compare(v, target) !== 0
    case '<':
      return v !== undefined && compare(v, target) < 0
    case '<=':
      return v !== undefined && compare(v, target) <= 0
    case '>':
      return v !== undefined && compare(v, target) > 0
    case '>=':
      return v !== undefined && compare(v, target) >= 0
    case 'in':
      return Array.isArray(target) && target.some((t) => compare(v, t) === 0)
    case 'array-contains':
      return Array.isArray(v) && v.some((t) => compare(t, target) === 0)
    default:
      return true
  }
}

function runQuery(q: Query | CollectionReference): QueryDocumentSnapshot[] {
  const constraints = q instanceof Query ? q.constraints : []
  let rows = store.list(q.path)
  for (const c of constraints) {
    if (c.kind === 'where') rows = rows.filter(([, d]) => matches(d, c))
  }
  const orders = constraints.filter((c) => c.kind === 'orderBy')
  if (orders.length) {
    rows.sort(([, a], [, b]) => {
      for (const o of orders) {
        const r = compare(getField(a, o.field!), getField(b, o.field!))
        if (r !== 0) return o.dir === 'desc' ? -r : r
      }
      return 0
    })
  }
  const lim = constraints.find((c) => c.kind === 'limit')
  if (lim?.n !== undefined) rows = rows.slice(0, lim.n)
  return rows.map(([id, d]) => new QueryDocumentSnapshot(`${q.path}/${id}`, d))
}

/* ------------------------------ Snapshots ------------------------------ */

export class DocumentSnapshot {
  readonly id: string
  readonly ref: DocumentReference
  private readonly _data: DocData | undefined
  readonly metadata = { hasPendingWrites: false, fromCache: false }

  constructor(path: string, data: DocData | undefined) {
    this.ref = new DocumentReference(path)
    this.id = this.ref.id
    this._data = data
  }
  exists(): boolean {
    return this._data !== undefined
  }
  data(): DocData {
    return clone(this._data) as DocData
  }
  get(field: string): unknown {
    return this._data ? getField(this._data, field) : undefined
  }
}

export class QueryDocumentSnapshot extends DocumentSnapshot {}

export class QuerySnapshot {
  readonly docs: QueryDocumentSnapshot[]
  readonly metadata = { hasPendingWrites: false, fromCache: false }
  constructor(docs: QueryDocumentSnapshot[]) {
    this.docs = docs
  }
  get size(): number {
    return this.docs.length
  }
  get empty(): boolean {
    return this.docs.length === 0
  }
  forEach(cb: (d: QueryDocumentSnapshot) => void): void {
    this.docs.forEach(cb)
  }
}

/* -------------------------------- Reads -------------------------------- */

export async function getDoc(ref: DocumentReference): Promise<DocumentSnapshot> {
  return new DocumentSnapshot(ref.path, store.get(ref.path))
}

export async function getDocs(q: Query | CollectionReference): Promise<QuerySnapshot> {
  return new QuerySnapshot(runQuery(q))
}

type SnapCb<T> = (snap: T) => void

export function onSnapshot(
  target: DocumentReference | Query | CollectionReference,
  next: SnapCb<never>,
  error?: (e: Error) => void,
): Unsubscribe {
  const emit = () => {
    try {
      if (target instanceof DocumentReference) {
        ;(next as SnapCb<DocumentSnapshot>)(
          new DocumentSnapshot(target.path, store.get(target.path)),
        )
      } else {
        ;(next as SnapCb<QuerySnapshot>)(new QuerySnapshot(runQuery(target)))
      }
    } catch (e) {
      if (error) error(e as Error)
      else console.error(e)
    }
  }
  let active = true
  if (target instanceof DocumentReference && target.path.startsWith('metas_rollup/') && !store.get(target.path)) {
    const month = target.id
    void import('./rollup').then((m) => m.computeRollup(month))
  }
  // Primeiro snapshot assíncrono, como no SDK real.
  setTimeout(() => active && emit(), 0)
  const unsub = store.subscribe(() => active && emit())
  return () => {
    active = false
    unsub()
  }
}

/* ------------------------------- Writes -------------------------------- */

export function serverTimestamp(): Sentinel {
  return new Sentinel('serverTimestamp')
}
export function deleteField(): Sentinel {
  return new Sentinel('delete')
}
export function increment(n: number): Sentinel {
  return new Sentinel('increment', n)
}

function resolveValue(v: unknown, prev: unknown): unknown {
  if (v instanceof Sentinel) {
    if (v.kind === 'serverTimestamp') return Timestamp.now()
    if (v.kind === 'increment') return (typeof prev === 'number' ? prev : 0) + v.value
    return undefined
  }
  if (v instanceof Timestamp) return v
  if (Array.isArray(v)) return v.map((x) => resolveValue(x, undefined))
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const out: DocData = {}
    for (const [k, val] of Object.entries(v)) {
      const r = resolveValue(val, undefined)
      if (!(val instanceof Sentinel && val.kind === 'delete')) out[k] = r
    }
    return out
  }
  if (v instanceof Date) return Timestamp.fromDate(v)
  return v
}

function setPath(target: DocData, path: string[], value: unknown): void {
  let cur = target
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i]
    if (!cur[k] || typeof cur[k] !== 'object' || cur[k] instanceof Timestamp) cur[k] = {}
    cur = cur[k] as DocData
  }
  const last = path[path.length - 1]
  if (value instanceof Sentinel && value.kind === 'delete') {
    delete cur[last]
  } else {
    cur[last] = resolveValue(value, cur[last])
  }
}

function deepMerge(base: DocData, patch: DocData): DocData {
  const out = clone(base)
  for (const [k, v] of Object.entries(patch)) {
    if (v instanceof Sentinel) {
      setPath(out, [k], v)
    } else if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      !(v instanceof Timestamp) &&
      out[k] &&
      typeof out[k] === 'object' &&
      !Array.isArray(out[k]) &&
      !(out[k] instanceof Timestamp)
    ) {
      out[k] = deepMerge(out[k] as DocData, v as DocData)
    } else {
      out[k] = resolveValue(v, out[k])
    }
  }
  return out
}

function applySet(path: string, data: DocData, opts?: { merge?: boolean }): void {
  const prev = store.get(path)
  const next = opts?.merge && prev ? deepMerge(prev, data) : (resolveValue(data, undefined) as DocData)
  store.put(path, next)
  afterWrite(path, prev, next)
}

function applyUpdate(path: string, patch: DocData): void {
  const prev = store.get(path)
  if (!prev) {
    const err = new Error(`No document to update: ${path}`) as Error & { code: string }
    err.code = 'not-found'
    throw err
  }
  const next = clone(prev)
  for (const [k, v] of Object.entries(patch)) setPath(next, k.split('.'), v)
  store.put(path, next)
  afterWrite(path, prev, next)
}

function applyDelete(path: string): void {
  store.remove(path)
}

function afterWrite(path: string, prev: DocData | undefined, next: DocData): void {
  if (path.startsWith('transactions/')) onTransactionWritten(path.slice('transactions/'.length), prev, next)
}

export async function setDoc(
  ref: DocumentReference,
  data: DocData,
  opts?: { merge?: boolean },
): Promise<void> {
  applySet(ref.path, data, opts)
}

export async function updateDoc(ref: DocumentReference, patch: DocData): Promise<void> {
  applyUpdate(ref.path, patch)
}

export async function addDoc(ref: CollectionReference, data: DocData): Promise<DocumentReference> {
  const d = doc(ref)
  applySet(d.path, data)
  return d
}

export async function deleteDoc(ref: DocumentReference): Promise<void> {
  applyDelete(ref.path)
}

type PendingOp = () => void

export class WriteBatch {
  private ops: PendingOp[] = []
  set(ref: DocumentReference, data: DocData, opts?: { merge?: boolean }): WriteBatch {
    this.ops.push(() => applySet(ref.path, data, opts))
    return this
  }
  update(ref: DocumentReference, patch: DocData): WriteBatch {
    this.ops.push(() => applyUpdate(ref.path, patch))
    return this
  }
  delete(ref: DocumentReference): WriteBatch {
    this.ops.push(() => applyDelete(ref.path))
    return this
  }
  async commit(): Promise<void> {
    for (const op of this.ops) op()
    this.ops = []
  }
}

export function writeBatch(): WriteBatch {
  return new WriteBatch()
}

class Transaction extends WriteBatch {
  async get(ref: DocumentReference): Promise<DocumentSnapshot> {
    return getDoc(ref)
  }
}

export async function runTransaction<T>(
  _db: Firestore,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const tx = new Transaction()
  const result = await fn(tx)
  await tx.commit()
  return result
}
