import { createContext, useContext, useEffect, useState } from 'react'
import { api, ApiError, getToken, setToken, clearToken } from '../api/client'

const AuthContext = createContext(null)

const SAVED_USERNAME_KEY = 'betpro_saved_username'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [checking, setChecking] = useState(true) // 최초 로딩 시 자동로그인 확인 중
  const [loginTime, setLoginTime] = useState(null) // 상단바 "접속시간" 표시용

  useEffect(() => {
    // 새로고침 시 저장된 토큰이 아직 유효한지 서버에 확인
    async function checkSession() {
      if (!getToken()) {
        setChecking(false)
        return
      }
      try {
        const me = await api.get('/api/me')
        setUser(me)
        setLoginTime(new Date())
      } catch {
        clearToken()
      } finally {
        setChecking(false)
      }
    }
    checkSession()
  }, [])

  async function login(username, password, keepLogin, saveUsername) {
    const data = await api.post('/api/login', {
      username,
      password,
      keep_login: keepLogin,
    })
    setToken(data.token, keepLogin)
    setUser(data.user)
    setLoginTime(new Date())

    if (saveUsername) {
      localStorage.setItem(SAVED_USERNAME_KEY, username)
    } else {
      localStorage.removeItem(SAVED_USERNAME_KEY)
    }
  }

  async function logout() {
    try {
      await api.post('/api/logout', {})
    } catch {
      // 서버 호출 실패해도 클라이언트 쪽 로그아웃은 진행
    }
    clearToken()
    setUser(null)
    setLoginTime(null)
  }

  function getSavedUsername() {
    return localStorage.getItem(SAVED_USERNAME_KEY) || ''
  }

  return (
    <AuthContext.Provider value={{ user, checking, loginTime, login, logout, getSavedUsername }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth는 AuthProvider 안에서만 사용할 수 있습니다.')
  return ctx
}

export { ApiError }
