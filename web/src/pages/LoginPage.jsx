import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import './LoginPage.css'

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
      <form className="login-card" onSubmit={handleSubmit}>
        <h1 className="login-title">BETPRO</h1>
        <p className="login-subtitle">축구 핸디캡 베팅 분석 시스템</p>

        <label className="field">
          <span>아이디</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </label>

        <label className="field">
          <span>비밀번호</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        <div className="checkbox-row">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={keepLogin}
              onChange={(e) => setKeepLogin(e.target.checked)}
            />
            <span>로그인 유지</span>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={saveUsername}
              onChange={(e) => setSaveUsername(e.target.checked)}
            />
            <span>아이디 저장</span>
          </label>
        </div>

        {error && <p className="login-error">{error}</p>}

        <button type="submit" className="login-button" disabled={loading}>
          {loading ? '로그인 중...' : '로그인'}
        </button>
      </form>
    </div>
  )
}
