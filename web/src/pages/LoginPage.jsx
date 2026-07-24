import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import './LoginPage.css'

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

export default function LoginPage() {
  const { login, getSavedUsername } = useAuth()
  const navigate = useNavigate()

  const [username, setUsername] = useState(getSavedUsername())
  const [password, setPassword] = useState('')
  const [keepLogin, setKeepLogin] = useState(false)
  const [saveUsername, setSaveUsername] = useState(!!getSavedUsername())
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username, password, keepLogin, saveUsername)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message || '로그인에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-title">
            <span className="brand-logo">⚽</span> BET PRO W
          </div>
          <p className="brand-version">Version 1.0 Update 2026-06-01</p>
          <p className="brand-promo">흥보문구 입력 예정</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="input-group">
            <span className="input-icon">
              <UserIcon />
            </span>
            <input
              type="text"
              placeholder="ID를 입력해주세요"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </label>

          <label className="input-group">
            <span className="input-icon">
              <LockIcon />
            </span>
            <input
              type="password"
              placeholder="비밀번호를 입력해주세요"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error && <p className="login-error">{error}</p>}

          <button type="submit" className="login-button" disabled={loading}>
            {loading ? '로그인 중...' : '로그인'}
          </button>

          <div className="checkbox-row">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={keepLogin}
                onChange={(e) => setKeepLogin(e.target.checked)}
              />
              <span>로그인을 유지</span>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={saveUsername}
                onChange={(e) => setSaveUsername(e.target.checked)}
              />
              <span>ID저장</span>
            </label>
          </div>
        </form>
      </div>
    </div>
  )
}
