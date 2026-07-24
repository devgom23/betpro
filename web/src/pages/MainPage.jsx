import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import './MainPage.css'

export default function MainPage() {
  const { user, logout } = useAuth()
  const [scope, setScope] = useState('master')
  const [dashboard, setDashboard] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setError('')
    setDashboard(null)
    api
      .get(`/api/dashboard?scope=${scope}`)
      .then((data) => {
        if (!cancelled) setDashboard(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [scope])

  return (
    <div className="main-page">
      <header className="top-bar">
        <div className="top-bar-left">
          <span className="app-name">BETPRO</span>
          <div className="scope-toggle">
            <button
              className={scope === 'master' ? 'active' : ''}
              onClick={() => setScope('master')}
            >
              📊 공식 데이터
            </button>
            <button
              className={scope === 'user' ? 'active' : ''}
              onClick={() => setScope('user')}
            >
              👤 내 데이터
            </button>
          </div>
        </div>
        <div className="top-bar-right">
          <span className="user-info">
            {user.username}
            {user.role === 'admin' ? ' (관리자)' : ''}
            {user.days_left != null ? ` · D-${user.days_left}` : ' · 기간 무제한'}
          </span>
          <button className="logout-button" onClick={logout}>
            로그아웃
          </button>
        </div>
      </header>

      <main className="content">
        <h2 className="section-title">리그별 업로드 현황</h2>
        {error && <p className="error-text">{error}</p>}
        {!dashboard && !error && <p className="loading-text">불러오는 중...</p>}

        {dashboard && (
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>리그</th>
                <th>경기수</th>
                <th>시즌</th>
                <th>결과보유</th>
                <th>예정</th>
                <th>국내배당</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.rows.map((row) => (
                <tr key={row.코드}>
                  <td>{row.리그}</td>
                  <td>{row.경기수.toLocaleString()}</td>
                  <td>{row.시즌}</td>
                  <td>{row.결과보유.toLocaleString()}</td>
                  <td>{row.예정.toLocaleString()}</td>
                  <td>{row.국내배당.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </div>
  )
}
