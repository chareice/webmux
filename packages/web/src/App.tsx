import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { LogOut, Settings } from 'lucide-react'

import { AuthProvider, useAuth } from './auth.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { AgentsPage } from './pages/AgentsPage.tsx'
import { ThreadsPage } from './pages/ThreadsPage.tsx'
import { NewThreadPage } from './pages/NewThreadPage.tsx'
import { ThreadDetailPage } from './pages/ThreadDetailPage.tsx'
import { ProjectsPage } from './pages/ProjectsPage.tsx'
import { ProjectDetailPage } from './pages/ProjectDetailPage.tsx'
import { NewProjectPage } from './pages/NewProjectPage.tsx'
import { LlmConfigPage } from './pages/LlmConfigPage.tsx'
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
  const location = useLocation()

  if (!user) return <>{children}</>

  return (
    <div className="app-layout">
      <nav className="top-bar">
        <div className="top-bar-left">
          <span className="top-bar-brand">webmux</span>
          <div className="top-bar-nav">
            <Link
              className={`top-bar-nav-link ${location.pathname === '/' ? 'active' : ''}`}
              to="/"
            >
              Agents
            </Link>
            <Link
              className={`top-bar-nav-link ${location.pathname.startsWith('/threads') || location.pathname.includes('/threads') ? 'active' : ''}`}
              to="/threads"
            >
              Threads
            </Link>
            <Link
              className={`top-bar-nav-link ${location.pathname.startsWith('/projects') ? 'active' : ''}`}
              to="/projects"
            >
              Projects
            </Link>
            <Link
              className={`top-bar-nav-link ${location.pathname.startsWith('/settings') ? 'active' : ''}`}
              to="/settings/llm"
            >
              <Settings size={14} />
              Settings
            </Link>
          </div>
        </div>
        <div className="top-bar-right">
          {user.avatarUrl ? (
            <img
              alt={user.displayName}
              className="top-bar-avatar"
              src={user.avatarUrl}
            />
          ) : null}
          <span className="top-bar-username">{user.displayName}</span>
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
          path="/threads"
          element={
            <ProtectedRoute>
              <AppLayout>
                <ThreadsPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/agents/:agentId/threads/new"
          element={
            <ProtectedRoute>
              <AppLayout>
                <NewThreadPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/agents/:agentId/threads/:threadId"
          element={
            <ProtectedRoute>
              <AppLayout>
                <ThreadDetailPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/projects"
          element={
            <ProtectedRoute>
              <AppLayout>
                <ProjectsPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/projects/new"
          element={
            <ProtectedRoute>
              <AppLayout>
                <NewProjectPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/projects/:projectId"
          element={
            <ProtectedRoute>
              <AppLayout>
                <ProjectDetailPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings/llm"
          element={
            <ProtectedRoute>
              <AppLayout>
                <LlmConfigPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
  )
}

export default App
