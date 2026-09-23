import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { BalanceVisibilityProvider } from './contexts/BalanceVisibilityContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Login } from './pages/Login'
import { AgenteDashboard } from './pages/AgenteDashboard'
import { AdminDashboard } from './pages/AdminDashboard'

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BalanceVisibilityProvider>
          <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/agente/*"
              element={
                <ProtectedRoute roles={['agente']}>
                  <AgenteDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/*"
              element={
                <ProtectedRoute roles={['supervisor', 'admin', 'super_admin']}>
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
          </BrowserRouter>
        </BalanceVisibilityProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
