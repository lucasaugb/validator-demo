/** Substituto de `firebase/app` no modo demo. */
import { installDemoFetch } from './fetch'

installDemoFetch()

export interface FirebaseApp {
  name: string
}

export class FirebaseError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'FirebaseError'
  }
}

export function initializeApp(_config?: unknown, name = '[DEFAULT]'): FirebaseApp {
  return { name }
}

export async function deleteApp(): Promise<void> {}
