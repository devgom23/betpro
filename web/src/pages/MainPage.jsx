import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useFontSize } from '../context/FontSizeContext'
import { api } from '../api/client'
import LeaguePage from './LeaguePage'
import TotalDbPage from './TotalDbPage'
import HeadToHeadPage from './HeadToHeadPage'
import AdminMasterPage from './AdminMasterPage'
import AdminAccountsPage from './AdminAccountsPage'
import BetHistoryPage from './BetHistoryPage'
import WeeklyPickPage from './WeeklyPickPage'
import UserLeagueModal from '../components/UserLeagueModal/UserLeagueModal'
import './MainPage.css'

// 공식 데이터에만 있는 탭들. 내 데이터는 "내가 만든 리그"만 쓰므로 여기 탭은 띄우지 않는다.
const MASTER_ONLY_TABS = ['total', 'h2h', 'admin_master', 'admin_accounts']

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
  // 스코프/탭/네비 위치를 localStorage에 저장해뒀다가 새로고침(F5) 때 그대로 복원한다
  // — 안 그러면 새로고침할 때마다 항상 "공식 데이터 · EPL"로 초기화돼버린다.
  const [scope, setScope] = useState(() => localStorage.getItem('betpro_scope') || 'master')
  // 목록과 그것이 어느 스코프의 것인지를 함께 담는다 — 스코프를 바꾼 직후 이전 스코프의
  // 리그 목록으로 탭을 잘못 고르는(예: 내 데이터에서 EPL을 여는) 상황을 막기 위함.
  const [leagueState, setLeagueState] = useState({ scope: null, list: [] })
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('betpro_activeTab') || 'EPL')
  // 상단 네비 4개 중 무엇을 보고 있는지. 'leagues'일 때만 리그 탭 줄이 보인다.
  const [view, setView] = useState(() => localStorage.getItem('betpro_view') || 'leagues')
  const [showLeagueModal, setShowLeagueModal] = useState(false)
  const isUser = scope === 'user'
  const ready = leagueState.scope === scope
  const leagues = ready ? leagueState.list : []

  // 리그 목록은 스코프마다 다르다 (공식=6대리그 고정 / 내 데이터=내가 만든 리그).
  // 리그를 만들거나 지운 뒤에도 같은 함수로 다시 불러 탭을 갱신한다.
  const loadLeagues = useCallback(async () => {
    try {
      const res = await api.get(`/api/leagues?scope=${scope}`)
      setLeagueState({ scope, list: Array.isArray(res) ? res : res.leagues || [] })
    } catch {
      setLeagueState({ scope, list: [] })
    }
  }, [scope])

  useEffect(() => {
    loadLeagues()
  }, [loadLeagues])

  useEffect(() => { localStorage.setItem('betpro_scope', scope) }, [scope])
  useEffect(() => { localStorage.setItem('betpro_activeTab', activeTab) }, [activeTab])
  useEffect(() => { localStorage.setItem('betpro_view', view) }, [view])

  // 목록이 확정되면 열린 탭을 정리한다 — 스코프 전환뿐 아니라 리그 생성·삭제 직후에도
  // 같은 규칙으로 동작한다(사라진 리그를 보고 있으면 첫 리그로, 하나도 없으면 안내 화면으로).
  useEffect(() => {
    if (!ready) return
    setActiveTab((cur) => {
      if (!isUser && MASTER_ONLY_TABS.includes(cur)) return cur
      if (leagues.some((lg) => lg.code === cur)) return cur
      return leagues[0]?.code ?? ''
    })
  }, [ready, isUser, leagues])

  return (
    <div className="main-page">
      <header className="top-bar">
        <div className="top-bar-brand">
          <span className="app-name">⚽ BET PRO W</span>
          <span className="app-version-chip">v1.0</span>
        </div>

        <div className="scope-toggle">
          <button
            className={view === 'leagues' && !isUser ? 'active' : ''}
            onClick={() => { setView('leagues'); setScope('master') }}
          >
            공식 데이터
          </button>
          <button
            className={view === 'leagues' && isUser ? 'active' : ''}
            onClick={() => { setView('leagues'); setScope('user') }}
          >
            내 데이터
          </button>
          <button className={view === 'weekly' ? 'active' : ''} onClick={() => setView('weekly')}>
            이번주 픽
          </button>
          <button className={view === 'bet_history' ? 'active' : ''} onClick={() => setView('bet_history')}>
            베팅내역
          </button>
        </div>

        <div className="top-bar-spacer" />

        <div className="top-bar-right">
          <span className="info-item">
            {user.role === 'admin' ? '관리자' : '고객'} {user.username}
          </span>
          <span className="info-item">접속 {formatDateTime(loginTime)}</span>
          <span className="info-item">이용기간 {formatPeriod(user.start_date, user.expiry)}</span>
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
              Light
            </button>
            <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>
              Dark
            </button>
          </div>
          <button className="logout-button" onClick={logout}>
            로그아웃
          </button>
        </div>
      </header>

      {view === 'leagues' && (
      <nav className="tab-bar">
        <div className="tab-bar-leagues">
          {leagues.map((lg) => (
            <button
              key={lg.code}
              className={activeTab === lg.code ? 'active' : ''}
              onClick={() => setActiveTab(lg.code)}
            >
              {lg.label}
            </button>
          ))}
          {isUser && (
            <button className="tab-manage" onClick={() => setShowLeagueModal(true)}>
              ＋ 리그 생성
            </button>
          )}
        </div>
        {!isUser && (
          <div className="tab-bar-admin">
            <button
              className={activeTab === 'total' ? 'active' : ''}
              onClick={() => setActiveTab('total')}
            >
              통합DB
            </button>
            <button className={activeTab === 'h2h' ? 'active' : ''} onClick={() => setActiveTab('h2h')}>
              상대전적
            </button>
            {user.role === 'admin' && (
              <>
                <button
                  className={activeTab === 'admin_master' ? 'active' : ''}
                  onClick={() => setActiveTab('admin_master')}
                >
                  마스터관리
                </button>
                <button
                  className={activeTab === 'admin_accounts' ? 'active' : ''}
                  onClick={() => setActiveTab('admin_accounts')}
                >
                  계정관리
                </button>
              </>
            )}
          </div>
        )}
      </nav>
      )}

      <main className="content">
        {view === 'weekly' && <WeeklyPickPage onGoBetHistory={() => setView('bet_history')} />}
        {view === 'bet_history' && <BetHistoryPage scope={scope} />}
        {view === 'leagues' && <>
        {!isUser && activeTab === 'total' && <TotalDbPage scope={scope} />}
        {!isUser && activeTab === 'h2h' && <HeadToHeadPage scope={scope} />}
        {!isUser && activeTab === 'admin_master' && user.role === 'admin' && <AdminMasterPage />}
        {!isUser && activeTab === 'admin_accounts' && user.role === 'admin' && <AdminAccountsPage />}
        {isUser && ready && leagues.length === 0 && (
          <div className="no-league-guide">
            <p className="no-league-title">🗂 아직 만든 리그가 없습니다</p>
            <p className="no-league-desc">
              위 <strong>＋ 리그 생성</strong>을 눌러 원하는 리그를 만들면 탭이 생깁니다. 그 탭에서
              경기 데이터를 올리면 그 리그 자료만으로 26개 지표와 플핸 예측이 계산됩니다.
            </p>
            <button className="btn-primary" onClick={() => setShowLeagueModal(true)}>
              ＋ 리그 생성
            </button>
          </div>
        )}
        {/* 목록이 확정되고, 열린 탭이 그 스코프에 실제로 있는 리그일 때만 그린다.
            (스코프 전환 도중 이전 스코프의 리그 코드로 조회가 나가는 걸 막는다) */}
        {ready && leagues.some((lg) => lg.code === activeTab) && (
          <LeaguePage key={`${scope}:${activeTab}`} code={activeTab} scope={scope} />
        )}
        </>}
      </main>

      {showLeagueModal && (
        <UserLeagueModal
          leagues={leagues}
          onClose={() => setShowLeagueModal(false)}
          onChanged={loadLeagues}
        />
      )}
    </div>
  )
}
