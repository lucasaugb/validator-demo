import { useRef, useState } from 'react'
import { Camera, Loader2, Trash2 } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { Avatar } from '../components/Avatar'
import { useAuth } from '../contexts/AuthContext'
import { removeAvatar, uploadAvatar } from '../lib/agentes'
import { setorLabel } from '../types'

/**
 * Página de perfil: cada usuário gerencia a própria foto.
 *
 * Bem simples por design: foto grande no centro, botões pra trocar/remover,
 * dados básicos do usuário (nome, email, role, setor). Edição de outros
 * campos fica em `/admin/agentes` (e só super_admin).
 */
export function Profile() {
  const { agente } = useAuth()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!agente) return null

  const handleFile = async (file: File) => {
    setError(null)
    setSuccess(false)
    if (!file.type.startsWith('image/')) {
      setError('Selecione uma imagem.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Imagem muito grande (máx 10MB).')
      return
    }
    setUploading(true)
    try {
      await uploadAvatar(agente.uid, file)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao enviar foto.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleRemove = async () => {
    if (!agente.avatarUrl) return
    setError(null)
    setUploading(true)
    try {
      await removeAvatar(agente.uid)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao remover foto.')
    } finally {
      setUploading(false)
    }
  }

  const roleLabelMap: Record<string, string> = {
    agente: 'Gestor',
    supervisor: 'Supervisor',
    admin: 'Admin',
    super_admin: 'Super Admin',
  }

  return (
    <>
      <PageHeader
        title="Meu perfil"
        subtitle="Atualize sua foto e veja seus dados"
        showQuickBar={false}
      />

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* Card da foto */}
        <section className="panel overflow-hidden">
          <div className="panel-head">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-app-muted">
              Foto de perfil
            </h3>
          </div>
          <div className="flex flex-col items-center gap-4 px-6 py-6">
            <div className="relative">
              <Avatar
                seed={agente.uid}
                name={agente.name}
                photoUrl={agente.avatarUrl}
                size={140}
              />
              {uploading && (
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm">
                  <Loader2 size={28} className="animate-spin text-white" />
                </div>
              )}
            </div>

            <div className="flex w-full flex-col gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleFile(f)
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-[12px] font-semibold btn-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Camera size={13} />
                {agente.avatarUrl ? 'Trocar foto' : 'Enviar foto'}
              </button>
              {agente.avatarUrl && (
                <button
                  type="button"
                  onClick={handleRemove}
                  disabled={uploading}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-app-border bg-app-card px-3 py-2 text-[11px] font-medium text-app-muted transition-colors hover:bg-app-elev hover:text-app-text disabled:opacity-60"
                >
                  <Trash2 size={12} />
                  Remover foto
                </button>
              )}
            </div>

            {error && (
              <p className="w-full rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11.5px] text-rose-700 dark:text-rose-300">
                {error}
              </p>
            )}
            {success && (
              <p className="w-full rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11.5px] text-emerald-700 dark:text-emerald-300">
                Foto atualizada.
              </p>
            )}

            <p className="text-center text-[10.5px] text-app-subtle">
              JPG, PNG ou WebP · máx 10MB · comprimida automaticamente
            </p>
          </div>
        </section>

        {/* Dados do usuário */}
        <section className="panel overflow-hidden">
          <div className="panel-head">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-app-muted">
              Dados da conta
            </h3>
          </div>
          <dl className="divide-y divide-app-border/60 text-[12.5px]">
            <Row label="Nome" value={agente.name} />
            <Row label="Email" value={agente.email} mono />
            <Row label="Papel" value={roleLabelMap[agente.role] ?? agente.role} />
            {agente.setor && (
              <Row label="Setor" value={setorLabel[agente.setor]} />
            )}
            {agente.slackUserId && (
              <Row label="Slack ID" value={agente.slackUserId} mono />
            )}
            <Row label="Status" value={agente.active ? 'Ativo' : 'Inativo'} />
          </dl>
          <div className="border-t border-app-border bg-app-elev/30 px-4 py-2.5 text-[10.5px] text-app-subtle">
            Pra alterar nome, email ou setor, fale com um administrador.
          </div>
        </section>
      </div>
    </>
  )
}

function Row({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-app-subtle">
        {label}
      </dt>
      <dd
        className={`min-w-0 truncate text-right text-app-text ${
          mono ? 'font-mono text-[11.5px] tabular-nums' : ''
        }`}
        title={value}
      >
        {value}
      </dd>
    </div>
  )
}
