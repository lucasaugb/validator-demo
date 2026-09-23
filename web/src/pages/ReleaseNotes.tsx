import { useEffect, useMemo } from 'react'
import { PageHeader } from '../components/AppShell'
import { useAuth } from '../contexts/AuthContext'
import {
  markReleaseNotesSeen,
  visibleReleaseNotes,
  type ReleaseAudience,
  type ReleaseCategory,
  type ReleaseNote,
} from '../data/releaseNotes'

/**
 * "Notas de atualização": timeline da evolução do sistema, filtrada pelo papel.
 *
 * Conteúdo 100% estático (ver data/releaseNotes.ts): sem leitura de banco, custo
 * zero. Estética sóbria (ver feedback_serious_no_frufru), mas com COR comedida:
 * cada categoria tem um tom próprio, ajuda a leitura/varredura sem glow nem
 * ícones cartoon. Ao abrir, marca tudo como visto (zera o badge do nav).
 */

const CATEGORY_LABEL: Record<ReleaseCategory, string> = {
  recurso: 'Novo',
  melhoria: 'Melhoria',
  correcao: 'Correção',
  visual: 'Visual',
  seguranca: 'Segurança',
  desempenho: 'Desempenho',
}

// Tons suaves (10% de fundo), sem anel nem brilho, cor a serviço da leitura.
const CATEGORY_CLS: Record<ReleaseCategory, string> = {
  recurso: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  melhoria: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  correcao: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  visual: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  seguranca: 'bg-teal-500/10 text-teal-700 dark:text-teal-300',
  desempenho: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
}

const AUDIENCE_SCOPE: Record<ReleaseAudience, string | null> = {
  todos: null, // geral: não precisa de etiqueta
  supervisor: 'Supervisão',
  admin: 'Administração',
  desenvolvedor: 'Desenvolvedor',
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  // Constrói em horário local pra evitar o off-by-one do parsing UTC.
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1)
  return dt
    .toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
    .replace(/\bde\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function ReleaseNotes() {
  const { agente } = useAuth()
  const notes = useMemo(
    () => visibleReleaseNotes(agente?.role),
    [agente?.role],
  )

  useEffect(() => {
    if (agente?.uid) markReleaseNotesSeen(agente.role, agente.uid)
  }, [agente?.uid, agente?.role])

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Notas de atualização"
        subtitle="Histórico de evoluções e melhorias do sistema"
      />

      {notes.length === 0 ? (
        <div className="panel px-6 py-12 text-center text-sm text-app-muted">
          Nenhuma atualização registrada.
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map((note, i) => (
            <NoteCard key={`${note.version}-${note.date}-${i}`} note={note} />
          ))}
        </div>
      )}
    </div>
  )
}

function NoteCard({ note }: { note: ReleaseNote }) {
  const scope = AUDIENCE_SCOPE[note.audience]
  return (
    <article
      className={`panel p-5 ${
        note.highlight ? 'border-l-2 border-l-app-accent' : ''
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row">
        {/* Coluna de metadados: data em destaque, versão e escopo abaixo. */}
        <div className="shrink-0 sm:w-44">
          <div className="text-sm font-semibold capitalize text-app-text">
            {formatDate(note.date)}
          </div>
          {note.time && (
            <div className="mt-0.5 font-mono text-[11px] text-app-subtle">
              {note.time}
            </div>
          )}
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-xs text-app-muted">
              v{note.version}
            </span>
            {scope && (
              <span className="rounded bg-app-elev px-1.5 py-0.5 text-[10px] font-medium text-app-muted">
                {scope}
              </span>
            )}
          </div>
        </div>

        {/* Conteúdo */}
        <div className="min-w-0 flex-1 sm:border-l sm:border-app-border sm:pl-5">
          <h3 className="text-[15px] font-semibold tracking-tight text-app-text">
            {note.title}
          </h3>
          <ul className="mt-3 space-y-2">
            {note.changes.map((change, idx) => (
              <li key={idx} className="flex items-baseline gap-3">
                <span
                  className={`inline-flex w-[92px] shrink-0 justify-center rounded px-2 py-0.5 text-[11px] font-semibold ${CATEGORY_CLS[change.category]}`}
                >
                  {CATEGORY_LABEL[change.category]}
                </span>
                <span className="flex-1 text-[13px] leading-relaxed text-app-text">
                  {change.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </article>
  )
}
