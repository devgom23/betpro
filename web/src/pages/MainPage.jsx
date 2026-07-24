import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import LeaguePage from './LeaguePage'
import TotalDbPage from './TotalDbPage'
import HeadToHeadPage from './HeadToHeadPage'
import AdminMasterPage from './AdminMasterPage'
import AdminAccountsPage from './AdminAccountsPage'
import './MainPage.css'

export default function MainPage() {
  const { user, logout } = useAuth()
  const [scope, setScope] = useState('master')
  const [leagues, setLeagues] = useState([])
  const [activeTab, setActiveTab] = useState('total')

  useEffect(() => {
    api.get('/api/leagues').then(setLeagues).catch(() => setLeagues([]))
  }, [])

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
