import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../contexts/ThemeContext'

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  return (
    <button
      onClick={toggle}
      title={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
      aria-label="Alternar tema"
      className="rounded p-1.5 text-app-muted transition-colors hover:bg-app-elev hover:text-app-text"
    >
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}
