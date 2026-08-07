import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { FontSizeProvider } from './context/FontSizeContext'
import { BetCartProvider } from './context/BetCartContext'
import LoginPage from './pages/LoginPage'
import MainPage from './pages/MainPage'

function RequireAuth({ children }) {
  const { user, checking } = useAuth()

  if (checking) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-page)',
          color: 'var(--text-muted)',
        }}
      >
        로그인 확인 중...
      </div>
    )
  }
  if (!user) {
    return <Navigate to="/login" replace />
  }
  return children
}

function AppRoutes() {
  const { user } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <MainPage />
          </RequireAuth>
        }
      />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <FontSizeProvider>
          <AuthProvider>
            <BetCartProvider>
              <AppRoutes />
            </BetCartProvider>
          </AuthProvider>
        </FontSizeProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
