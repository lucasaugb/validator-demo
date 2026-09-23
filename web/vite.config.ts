import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Modo demo (padrão): os imports `firebase/*` são trocados por um backend
// simulado em memória (web/src/mock) com dados fictícios, roda 100% no
// navegador, sem projeto Firebase. Para usar um Firebase real, defina
// VITE_DEMO_MODE=false em web/.env.local e preencha as credenciais.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const demo = env.VITE_DEMO_MODE !== 'false'
  const mockDir = fileURLToPath(new URL('./src/mock/', import.meta.url))

  return {
    // GitHub Pages serve em /<repo>/: o workflow define VITE_BASE.
    base: env.VITE_BASE || '/',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: demo
        ? [{ find: /^firebase\/(app|auth|firestore|storage)$/, replacement: `${mockDir}firebase-$1.ts` }]
        : [],
    },
    define: demo
      ? {
          'import.meta.env.VITE_DEMO_MODE': JSON.stringify('true'),
          'import.meta.env.VITE_FECHAMENTO_URL': JSON.stringify('https://demo-api.local/fechamento'),
        }
      : {},
  }
})
