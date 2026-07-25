import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import LeagueTable from '../components/LeagueTable/LeagueTable'
import FilterForm from '../components/FilterForm/FilterForm'
import HeadToHeadResult from '../components/HeadToHead/HeadToHeadResult'
import RtSummaryBar from '../components/RtSummaryBar/RtSummaryBar'

const ODDS_KEYS = ['kw', 'kd', 'kl', 'khw', 'khd', 'khl', 'fw', 'fd', 'fl']

function buildQueryString(scope, query) {
  const params = new URLSearchParams({ scope })
  if (query) {
    if (query.season) params.set('season', query.season)
    if (query.round) params.set('round', query.round)
    for (const key of ODDS_KEYS) {
      if (query[key] !== undefined && query[key] !== null) {
        params.set(key, String(query[key]))
      }
    }
  }
  return params.toString()
}

function describeQuery(query) {
  if (!query) return ''
  const parts = []
  if (query.season && query.season !== 'ALL') parts.push(`S=${query.season}`)
  if (query.round && query.round !== 'ALL') parts.push(`R=${query.round}`)
  for (const key of ODDS_KEYS) {
    if (query[key] !== undefined && query[key] !== null) {
      parts.push(`${key.toUpperCase()}=${query[key]}`)
    }
  }
  return parts.join(' · ') || '전체'
}

export default function LeaguePage({ code, scope }) {
  const { user } = useAuth()
  const [filters, setFilters] = useState(null)
  const [query, setQuery] = useState(null)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [teams, setTeams] = useState([])
  const [h2h, setH2h] = useState(null) // {home, away, cross} | null — 있으면 표 대신 상대전적 표시
  const [reloadKey, setReloadKey] = useState(0)

  const [delConfirm, setDelConfirm] = useState(false)
  const [busyDelete, setBusyDelete] = useState(false)
  const [deleteNotice, setDeleteNotice] = useState('')

  // 리그/스코프가 바뀌면 시즌·라운드 선택지부터 다시 불러온다
  useEffect(() => {
    let cancelled = false
    setFilters(null)
    setQuery(null)
    setH2h(null)
    api
      .get(`/api/leagues/${code}/filters?scope=${scope}`)
      .then((res) => {
        if (cancelled) return
        setFilters(res)
        setQuery({ season: res.latest?.season ?? 'ALL', round: res.latest?.round ?? 'ALL' })
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [code, scope, reloadKey])

  async function handleDeleteLeagueData() {
    if (!delConfirm) {
      setDeleteNotice('동의 체크박스를 선택하세요.')
      return
    }
    setBusyDelete(true)
    setDeleteNotice('')
    try {
      await api.post('/api/admin/master/delete_league', { league: code, confirm: true })
      setDeleteNotice(`'${code}' 데이터를 모두 삭제했습니다.`)
      setDelConfirm(false)
      setReloadKey((k) => k + 1)
    } catch (err) {
      setDeleteNotice(`실패: ${err.message}`)
    } finally {
      setBusyDelete(false)
    }
  }

  // 스코프/리그/현재 조회 시즌이 바뀌면 상대전적 조회용 팀 목록도 그 시즌 기준으로 다시 불러온다
  useEffect(() => {
    const season = query?.season ?? 'ALL'
    api
      .get(`/api/teams?scope=${scope}&code=${code}&season=${season}`)
      .then((res) => setTeams(res.teams))
      .catch(() => setTeams([]))
  }, [scope, code, query?.season])

  // 조회 조건(query)이 확정되면 실제 표 데이터를 불러온다 (조건 입력 중엔 재조회 안 함)
  useEffect(() => {
    if (!query) return
    let cancelled = false
    setError('')
    api
      .get(`/api/leagues/${code}?${buildQueryString(scope, query)}`)
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [code, scope, query])

  function handleSearch(nextQuery) {
    setH2h(null) // 조회 조건 필터는 상대전적 모드를 초기화하고 원래 표로 돌아간다
    setQuery(nextQuery)
  }

  if (error) return <p className="error-text">{error}</p>
  if (!filters || !data) return <p className="loading-text">불러오는 중...</p>

  return (
    <div>
      <div className="league-dashboard">
        <span>
          📋 등록된 시즌 {filters.seasons.length} · 경기수 {filters.total_rows.toLocaleString()}
        </span>
        <RtSummaryBar summary={filters.rt_summary} inline />
      </div>

      <FilterForm filters={filters} onSearch={handleSearch} teams={teams} onH2HSearch={setH2h} />

      {h2h ? (
        <>
          <div className="league-summary">
            <span>
              🆚 상대전적 조회: {h2h.home} vs {h2h.away}
              {h2h.cross ? ' (홈원 교차보기)' : ''}
            </span>
            <button className="btn-reset" onClick={() => setH2h(null)}>
              ✕ 표로 돌아가기
            </button>
          </div>
          <HeadToHeadResult scope={scope} home={h2h.home} away={h2h.away} cross={h2h.cross} limit={50} />
        </>
      ) : (
        <>
          <div className="league-summary">
            <span>🔍 조회 조건: {describeQuery(query)}</span>
            <span>
              <strong>{data.total.toLocaleString()}</strong>경기
            </span>
            <RtSummaryBar summary={data.rt_summary} inline />
          </div>
          <LeagueTable
            columns={data.columns}
            rows={data.rows}
            scope={scope}
            highlightCols={ODDS_KEYS.filter((k) => query?.[k] !== undefined).map((k) => k.toUpperCase())}
          />
        </>
      )}

      {user.role === 'admin' && scope === 'master' && (
        <div className="danger-zone">
          <label className="confirm-check">
            <input
              type="checkbox"
              checked={delConfirm}
              onChange={(e) => setDelConfirm(e.target.checked)}
            />
            Data를 삭제하시면 현재 등록된 모든 Data가 삭제가 됩니다. 동의하십니까?
          </label>
          <button className="btn-danger" disabled={busyDelete} onClick={handleDeleteLeagueData}>
            {busyDelete ? '삭제 중...' : '경기 Data 모두삭제'}
          </button>
          {deleteNotice && <p className="recompute-notice">{deleteNotice}</p>}
        </div>
      )}
    </div>
  )
}
