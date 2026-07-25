import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useFontSize } from '../context/FontSizeContext'
import { api } from '../api/client'
import LeaguePage from './LeaguePage'
import TotalDbPage from './TotalDbPage'
import HeadToHeadPage from './HeadToHeadPage'
import AdminMasterPage from './AdminMasterPage'
import AdminAccountsPage from './AdminAccountsPage'
import './MainPage.css'

function formatDateTime(date) {
  if (!date) return '-'
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatPeriod(startDate, expiry) {
  const start = startDate || '-'
  const end = !expiry || expiry === 'permanent' ? '무제한' : expiry
  return `${start} ~ ${end}`
}

export default function MainPage() {
  const { user, loginTime, logout } = useAuth()
  const { theme, setTheme } = useTheme()
  const { fontSize, setFontSize } = useFontSize()
  const [scope, setScope] = useState('master')
  const [leagues, setLeagues] = useState([])
  const [activeTab, setActiveTab] = useState('EPL')

  useEffect(() => {
    api.get('/api/leagues').then(setLeagues).catch(() => setLeagues([]))
  }, [])

  return (
    <div className="main-page">
      <header className="info-bar">
        <div className="info-bar-left">
          <span className="info-item">
            🛡️ {user.role === 'admin' ? '관리자' : '고객'} {user.username}
          </span>
          <span className="info-item">접속시간 {formatDateTime(loginTime)}</span>
          <span className="info-item">이용가능기간 {formatPeriod(user.start_date, user.expiry)}</span>
        </div>
        <div className="info-bar-right">
          <div className="font-size-toggle">
            <button
              className={fontSize === 'small' ? 'active' : ''}
              onClick={() => setFontSize('small')}
            >
              작은글씨
            </button>
            <button
              className={fontSize === 'large' ? 'active' : ''}
              onClick={() => setFontSize('large')}
            >
              큰글씨
            </button>
          </div>
          <div className="theme-toggle">
            <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>
              ☀ Light
            </button>
            <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>
              Dark ☾
            </button>
          </div>
          <button className="logout-button" onClick={logout}>
            로그아웃
          </button>
        </div>
      </header>

      <div className="brand-bar">
        <span className="app-name">⚽ BET PRO W</span>
        <span className="app-version">Version 1.0 Update 2026-06-01</span>
      </div>

      <nav className="scope-bar">
        <div className="scope-toggle">
          <button className={scope === 'master' ? 'active' : ''} onClick={() => setScope('master')}>
            📊 공식 데이터
          </button>
          <button className={scope === 'user' ? 'active' : ''} onClick={() => setScope('user')}>
            👤 내 데이터
          </button>
        </div>
      </nav>

      <nav className="tab-bar">
        {leagues.map((lg) => (
          <button
            key={lg.code}
            className={activeTab === lg.code ? 'active' : ''}
            onClick={() => setActiveTab(lg.code)}
          >
            {lg.label}
          </button>
        ))}
        <button className={activeTab === 'total' ? 'active' : ''} onClick={() => setActiveTab('total')}>
          📈 통합DB
        </button>
        <button className={activeTab === 'h2h' ? 'active' : ''} onClick={() => setActiveTab('h2h')}>
          🆚 상대전적
        </button>
        {user.role === 'admin' && (
          <>
            <button
              className={activeTab === 'admin_master' ? 'active' : ''}
              onClick={() => setActiveTab('admin_master')}
            >
              🛠 마스터관리
            </button>
            <button
              className={activeTab === 'admin_accounts' ? 'active' : ''}
              onClick={() => setActiveTab('admin_accounts')}
            >
              👑 계정관리
            </button>
          </>
        )}
      </nav>

      <main className="content">
        {activeTab === 'total' && <TotalDbPage scope={scope} />}
        {activeTab === 'h2h' && <HeadToHeadPage scope={scope} />}
        {activeTab === 'admin_master' && user.role === 'admin' && <AdminMasterPage />}
        {activeTab === 'admin_accounts' && user.role === 'admin' && <AdminAccountsPage />}
        {!['total', 'h2h', 'admin_master', 'admin_accounts'].includes(activeTab) && (
          <LeaguePage code={activeTab} scope={scope} />
        )}
      </main>
    </div>
  )
}
