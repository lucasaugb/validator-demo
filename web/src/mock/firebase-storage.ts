/**
 * Substituto de `firebase/storage` no modo demo. Uploads viram data URLs
 * (ficam no próprio doc, então sobrevivem ao reload enquanto couberem no
 * localStorage).
 */

export interface FirebaseStorage {
  readonly type: 'storage'
}

export interface StorageReference {
  fullPath: string
  name: string
}

const files = new Map<string, string>()

export function getStorage(): FirebaseStorage {
  return { type: 'storage' }
}

export function ref(_storage: FirebaseStorage, path = ''): StorageReference {
  return { fullPath: path, name: path.split('/').pop() ?? '' }
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

export async function uploadBytes(r: StorageReference, data: Blob): Promise<{ ref: StorageReference }> {
  files.set(r.fullPath, await toDataUrl(data))
  return { ref: r }
}

export async function getDownloadURL(r: StorageReference): Promise<string> {
  const url = files.get(r.fullPath)
  if (!url) throw new Error(`storage/object-not-found: ${r.fullPath}`)
  return url
}

export async function listAll(folder: StorageReference): Promise<{ items: StorageReference[] }> {
  const prefix = folder.fullPath.replace(/\/$/, '') + '/'
  return {
    items: [...files.keys()]
      .filter((p) => p.startsWith(prefix))
      .map((p) => ({ fullPath: p, name: p.split('/').pop() ?? '' })),
  }
}

export async function deleteObject(r: StorageReference): Promise<void> {
  files.delete(r.fullPath)
}
