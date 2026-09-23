import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const missing = Object.entries(firebaseConfig).filter(([, v]) => !v).map(([k]) => k)
if (missing.length > 0 && import.meta.env.VITE_DEMO_MODE !== 'true') {
  console.warn(
    `[Firebase] Variáveis de ambiente ausentes: ${missing.join(', ')}.\n` +
    `Crie um arquivo web/.env.local com base em .env.example.`
  )
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
// Idioma dos emails gerados pelo Firebase Auth (reset de senha, verificação de
// email etc). Sem isso, cai no default 'en' e a equipe recebe texto inglês.
// O template em si segue sendo o padrão do Firebase, pra customizar copy,
// acessar Firebase Console → Authentication → Templates.
auth.languageCode = 'pt-BR'
export const db = getFirestore(app)
export const storage = getStorage(app)
