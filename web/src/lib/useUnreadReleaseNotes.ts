import { useEffect, useState } from 'react'
import type { Role } from '../types'
import {
  RELEASE_NOTES_SEEN_EVENT,
  unreadReleaseNotesCount,
} from '../data/releaseNotes'

/**
 * Contagem reativa de notas de atualização não-lidas, pro badge do nav.
 *
 * Recalcula quando: monta, o usuário marca como visto (evento de janela) ou
 * o localStorage muda noutra aba (`storage`). Sem listener de Firestore, é
 * tudo local, custo zero.
 */
export function useUnreadReleaseNotes(
  role: Role | undefined,
  uid: string | undefined,
): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    const recompute = () => setCount(unreadReleaseNotesCount(role, uid))
    recompute()
    window.addEventListener(RELEASE_NOTES_SEEN_EVENT, recompute)
    window.addEventListener('storage', recompute)
    return () => {
      window.removeEventListener(RELEASE_NOTES_SEEN_EVENT, recompute)
      window.removeEventListener('storage', recompute)
    }
  }, [role, uid])

  return count
}
