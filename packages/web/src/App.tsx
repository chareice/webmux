import { Navigate, Route, Routes } from 'react-router-dom'
import { LogOut } from 'lucide-react'

import { AuthProvider, useAuth } from './auth.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { AgentsPage } from './pages/AgentsPage.tsx'
import { SessionsPage } from './pages/SessionsPage.tsx'
import './App.css'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="app-loading">
        <span>Loading...</span>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth()

  if (!user) return <>{children}</>

  return (
    <div className="app-layout">
      <nav className="top-bar">
        <div className="top-bar-left">
          <span className="top-bar-brand">webmux</span>
        </div>
        <div className="top-bar-right">
          {user.avatarUrl ? (
            <img
              alt={user.githubLogin}
              className="top-bar-avatar"
              src={user.avatarUrl}
            />
          ) : null}
          <span className="top-bar-username">{user.githubLogin}</span>
          <button
            className="secondary-button top-bar-logout"
            onClick={logout}
            type="button"
          >
            <LogOut size={14} />
            <span className="button-label">Logout</span>
          </button>
        </div>
      </nav>
      <main className="app-main">{children}</main>
    </div>
  )
}

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppLayout>
                <AgentsPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/agents/:agentId"
          element={
            <ProtectedRoute>
              <SessionsPage />
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
  )
}

export default App
